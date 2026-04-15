import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ImportItem } from '@open-mercato/core/modules/data_sync/lib/adapter'
import { SyncExternalIdMapping } from '@open-mercato/core/modules/integrations/data/entities'
import { CatalogProductCategory } from '@open-mercato/core/modules/catalog/data/entities'
import type { CategoryRow, BrandRow, WebsiteProductRow } from './db-client'
import { mapProductToImportItem } from './mapper'

const INTEGRATION_ID = 'sync_b2bapi'

export type ReconciliationSettings = {
  deactivateMissingProducts: boolean
}

export function buildDefaultReconciliationSettings(): ReconciliationSettings {
  return {
    deactivateMissingProducts: true,
  }
}

type UpsertResult = {
  localId: string
  action: 'create' | 'update' | 'skip'
}

export type B2BApiDataMapping = {
  mediaBaseUrl?: string
}

export interface B2BApiCatalogImporter {
  upsertCategory(row: CategoryRow): Promise<UpsertResult>
  upsertBrand(row: BrandRow): Promise<UpsertResult>
  upsertProduct(row: WebsiteProductRow, mapping: B2BApiDataMapping): Promise<ImportItem[]>
  reconcileProducts(seenExternalIds: Set<string>, reconciliation: ReconciliationSettings): Promise<void>
}

/**
 * Slugify a category name or path segment for use as a slug.
 */
function slugifyCategoryName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150)
}

export async function createB2BApiCatalogImporter(
  scope: { organizationId: string; tenantId: string },
): Promise<B2BApiCatalogImporter> {
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const commandBus = container.resolve('commandBus') as CommandBus

  // In-memory caches to avoid redundant lookups within a single sync run
  const categoryCache = new Map<number, Promise<string | null>>()
  const brandCache = new Map<number, Promise<string | null>>()

  function buildCommandContext(): CommandRuntimeContext {
    return {
      container,
      auth: null,
      organizationScope: {
        selectedId: scope.organizationId,
        filterIds: [scope.organizationId],
        allowedIds: [scope.organizationId],
        tenantId: scope.tenantId,
      },
      selectedOrganizationId: scope.organizationId,
      organizationIds: [scope.organizationId],
    }
  }

  async function executeCommand<TResult>(commandId: string, input: Record<string, unknown>): Promise<TResult> {
    try {
      const executed = await commandBus.execute<Record<string, unknown>, TResult>(commandId, {
        input,
        ctx: buildCommandContext(),
      })
      return executed.result
    } catch (error) {
      const message = error instanceof Error ? error.message : JSON.stringify(error)
      throw new Error(`${commandId} failed: ${message}`)
    }
  }

  async function lookupLocalId(entityType: string, externalId: string): Promise<string | null> {
    const row = await findOneWithDecryption(
      em,
      SyncExternalIdMapping,
      {
        integrationId: INTEGRATION_ID,
        internalEntityType: entityType,
        externalId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      },
      undefined,
      scope,
    )
    return row?.internalEntityId ?? null
  }

  async function storeMapping(entityType: string, localId: string, externalId: string): Promise<void> {
    const existing = await findOneWithDecryption(
      em,
      SyncExternalIdMapping,
      {
        integrationId: INTEGRATION_ID,
        internalEntityType: entityType,
        externalId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      },
      undefined,
      scope,
    )

    if (existing) {
      existing.internalEntityId = localId
      existing.syncStatus = 'synced'
      existing.lastSyncedAt = new Date()
      await em.flush()
      return
    }

    const created = em.create(SyncExternalIdMapping, {
      integrationId: INTEGRATION_ID,
      internalEntityType: entityType,
      internalEntityId: localId,
      externalId,
      syncStatus: 'synced',
      lastSyncedAt: new Date(),
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
    await em.persistAndFlush(created)
  }

  /**
   * Resolve the parent category local ID from a dot-separated path.
   * e.g. "electronics.phones" → find/create "electronics" first, then return its ID.
   * Requirements: 4.4
   */
  async function resolveParentCategoryFromPath(
    path: string | null,
    currentName: string,
  ): Promise<string | null> {
    if (!path) return null

    // The path includes the current node; parent is everything before the last dot
    const segments = path.split('.')
    if (segments.length <= 1) return null

    // Parent path is all segments except the last
    const parentSegments = segments.slice(0, -1)
    const parentSlug = slugifyCategoryName(parentSegments.join('-'))

    // Look up by slug in open-mercato
    const existing = await findOneWithDecryption(
      em,
      CatalogProductCategory,
      {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        slug: parentSlug,
        deletedAt: null,
      },
      undefined,
      scope,
    )
    if (existing) return existing.id

    // Create the parent category on-the-fly using the last segment of parentSegments as name
    const parentName = parentSegments[parentSegments.length - 1]
    const grandparentPath = parentSegments.length > 1 ? parentSegments.join('.') : null
    const grandparentId = await resolveParentCategoryFromPath(grandparentPath, parentName)

    const created = await executeCommand<{ categoryId: string }>('catalog.categories.create', {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      name: parentName,
      slug: parentSlug,
      parentId: grandparentId,
      isActive: true,
    })
    return created.categoryId
  }

  async function upsertCategory(row: CategoryRow): Promise<UpsertResult> {
    const externalId = String(row.id)
    const slug = row.slug ? slugifyCategoryName(row.slug) : slugifyCategoryName(row.name)

    // Check existing mapping
    const mappedId = await lookupLocalId('catalog_product_category', externalId)
    const existingId = mappedId
      ?? (await findOneWithDecryption(
        em,
        CatalogProductCategory,
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          slug,
          deletedAt: null,
        },
        undefined,
        scope,
      ))?.id
      ?? null

    // Resolve parent from path (Requirement 4.4)
    const parentId = await resolveParentCategoryFromPath(row.path, row.name)

    const input = {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      name: row.name,
      slug,
      parentId,
      isActive: true,
    }

    if (existingId) {
      await executeCommand('catalog.categories.update', { id: existingId, ...input })
      await storeMapping('catalog_product_category', existingId, externalId)
      return { localId: existingId, action: 'update' }
    }

    const created = await executeCommand<{ categoryId: string }>('catalog.categories.create', input)
    await storeMapping('catalog_product_category', created.categoryId, externalId)
    return { localId: created.categoryId, action: 'create' }
  }

  /**
   * Upsert a brand. Since open-mercato has no dedicated brand entity, brands are
   * tracked via external ID mapping and stored as product metadata.
   * The returned localId is a stable synthetic ID derived from the mapping.
   * Requirements: 4.2
   */
  async function upsertBrand(row: BrandRow): Promise<UpsertResult> {
    const externalId = String(row.id)

    const mappedId = await lookupLocalId('catalog_brand', externalId)
    if (mappedId) {
      return { localId: mappedId, action: 'update' }
    }

    // Generate a stable local ID for the brand using a UUID-like key
    // We store the brand info in the mapping metadata field
    const { randomUUID } = await import('crypto')
    const localId = randomUUID()

    await storeMapping('catalog_brand', localId, externalId)
    return { localId, action: 'create' }
  }

  /**
   * Resolve the local category ID for a given ishark category_id.
   * Uses in-memory cache to avoid repeated DB lookups within a sync run.
   */
  async function resolveCategoryLocalId(categoryId: number | null): Promise<string | null> {
    if (categoryId === null) return null
    if (!categoryCache.has(categoryId)) {
      categoryCache.set(categoryId, (async () => {
        return lookupLocalId('catalog_product_category', String(categoryId))
      })())
    }
    return categoryCache.get(categoryId) ?? null
  }

  /**
   * Resolve the local brand ID for a given ishark brand_id.
   * Uses in-memory cache to avoid repeated DB lookups within a sync run.
   */
  async function resolveBrandLocalId(brandId: number | null): Promise<string | null> {
    if (brandId === null) return null
    if (!brandCache.has(brandId)) {
      brandCache.set(brandId, (async () => {
        return lookupLocalId('catalog_brand', String(brandId))
      })())
    }
    return brandCache.get(brandId) ?? null
  }

  /**
   * Upsert a product. Resolves category and brand local IDs first.
   * Matches by symbol as externalId (Requirement 1.3, 1.4).
   * Requirements: 1.2, 1.3, 1.4, 4.1, 4.2, 4.3
   */
  async function upsertProduct(row: WebsiteProductRow, mapping: B2BApiDataMapping): Promise<ImportItem[]> {
    const externalId = row.symbol

    const categoryLocalId = await resolveCategoryLocalId(row.category_id)
    const brandLocalId = await resolveBrandLocalId(row.brand_id)

    const importItem = mapProductToImportItem(row, categoryLocalId, brandLocalId, mapping.mediaBaseUrl)

    const mappedId = await lookupLocalId('catalog_product', externalId)

    const productPayload = {
      title: importItem.data.name,
      handle: importItem.data.slug,
      description: importItem.data.description,
      sku: importItem.data.externalId,
      isActive: importItem.data.isActive,
      weightValue: importItem.data.weight ? parseFloat(String(importItem.data.weight)) : null,
      defaultMediaUrl: importItem.data.imageUrl ?? importItem.data.thumbnailUrl ?? null,
      metadata: {
        b2bapi: {
          partNumber: importItem.data.partNumber,
          shortDescription: importItem.data.shortDescription,
          ean: importItem.data.ean,
          weight: importItem.data.weight,
          unitName: importItem.data.unitName,
          thumbnailUrl: importItem.data.thumbnailUrl,
          imageUrl: importItem.data.imageUrl,
          categoryId: importItem.data.categoryId,
          brandId: importItem.data.brandId,
          isAvailable: importItem.data.isAvailable,
          isSuggested: importItem.data.isSuggested,
          isPromotion: importItem.data.isPromotion,
          isNewProduct: importItem.data.isNewProduct,
          customFields: importItem.data.customFields,
        },
      },
    }

    const variantExternalId = `${externalId}__default`

    if (mappedId) {
      await executeCommand('catalog.products.update', { id: mappedId, ...productPayload })

      // Ensure default variant exists
      const existingVariantId = await lookupLocalId('catalog_variant', variantExternalId)
      if (!existingVariantId) {
        const createdVariant = await executeCommand<{ variantId: string }>('catalog.variants.create', {
          productId: mappedId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          sku: externalId,
          name: importItem.data.name,
          isDefault: true,
          isActive: importItem.data.isActive,
          weightValue: importItem.data.weight ? parseFloat(String(importItem.data.weight)) : null,
        })
        await storeMapping('catalog_variant', createdVariant.variantId, variantExternalId)
      }

      return [{ ...importItem, action: 'update', data: { ...importItem.data, localId: mappedId } }]
    }

    // Create new product
    const created = await executeCommand<{ productId: string }>('catalog.products.create', {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      ...productPayload,
    })

    await storeMapping('catalog_product', created.productId, externalId)

    // Create default variant
    const existingVariantId = await lookupLocalId('catalog_variant', variantExternalId)
    if (!existingVariantId) {
      const createdVariant = await executeCommand<{ variantId: string }>('catalog.variants.create', {
        productId: created.productId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        sku: externalId,
        name: importItem.data.name,
        isDefault: true,
        isActive: importItem.data.isActive,
        weightValue: importItem.data.weight ? parseFloat(String(importItem.data.weight)) : null,
      })
      await storeMapping('catalog_variant', createdVariant.variantId, variantExternalId)
    }

    return [{ ...importItem, action: 'create', data: { ...importItem.data, localId: created.productId } }]
  }

  /**
   * Reconcile products: mark products absent from the b2bapi source as inactive.
   * Requirements: 1.5
   */
  async function reconcileProducts(
    seenExternalIds: Set<string>,
    reconciliation: ReconciliationSettings,
  ): Promise<void> {
    if (!reconciliation.deactivateMissingProducts) return
    if (seenExternalIds.size === 0) return

    const mappings = await findWithDecryption(
      em,
      SyncExternalIdMapping,
      {
        integrationId: INTEGRATION_ID,
        internalEntityType: 'catalog_product',
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      },
      undefined,
      scope,
    )

    for (const mapping of mappings) {
      if (seenExternalIds.has(mapping.externalId)) continue
      await executeCommand('catalog.products.update', {
        id: mapping.internalEntityId,
        isActive: false,
      })
    }
  }

  return {
    upsertCategory,
    upsertBrand,
    upsertProduct,
    reconcileProducts,
  }
}
