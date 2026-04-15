import type {
  DataSyncAdapter,
  DataMapping,
  ImportBatch,
  ImportItem,
  ValidationResult,
  StreamImportInput,
} from '@open-mercato/core/modules/data_sync/lib/adapter'
import { validateCredentials, type B2BApiCredentials } from './credentials'
import { createB2BApiDbClient } from './db-client'
import { createB2BApiCatalogImporter, buildDefaultReconciliationSettings, type B2BApiDataMapping } from './catalog-importer'
import { encodeCursor, decodeCursor } from './cursor'

// Static field mapping returned by getMapping
function buildStaticMapping(entityType: string): DataMapping {
  return {
    entityType,
    fields: [],
    matchStrategy: 'externalId',
  }
}

function assertEntityType(entityType: string): 'products' | 'categories' | 'brands' {
  if (entityType === 'products' || entityType === 'categories' || entityType === 'brands') {
    return entityType
  }
  throw new Error(`Unsupported B2BAPI entity type: ${entityType}`)
}

export const b2bApiDataSyncAdapter: DataSyncAdapter = {
  providerKey: 'b2bapi',
  direction: 'import',
  supportedEntities: ['products', 'categories', 'brands'],

  async getMapping(input): Promise<DataMapping> {
    assertEntityType(input.entityType)
    return buildStaticMapping(input.entityType)
  },

  async validateConnection(input): Promise<ValidationResult> {
    let credentials: B2BApiCredentials
    try {
      credentials = validateCredentials(input.credentials)
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Invalid credentials',
      }
    }

    const client = createB2BApiDbClient(credentials)
    try {
      const productCount = await client.countProducts(credentials.frontendId)
      return {
        ok: true,
        message: 'B2BAPI connection validated successfully',
        details: { productCount },
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'B2BAPI connection failed',
      }
    } finally {
      await client.close()
    }
  },

  async *streamImport(input: StreamImportInput): AsyncIterable<ImportBatch> {
    const entityType = assertEntityType(input.entityType)
    const credentials = validateCredentials(input.credentials)
    const client = createB2BApiDbClient(credentials)
    const importer = await createB2BApiCatalogImporter(input.scope)
    const dataMapping: B2BApiDataMapping = {}

    try {
      // ── categories ──────────────────────────────────────────────────────────
      if (entityType === 'categories') {
        const rows = await client.queryCategories({ frontendId: credentials.frontendId })
        const items: ImportItem[] = []
        for (const row of rows) {
          try {
            const result = await importer.upsertCategory(row)
            items.push({
              externalId: String(row.id),
              action: result.action,
              data: { localId: result.localId, name: row.name },
            })
          } catch (error) {
            items.push({
              externalId: String(row.id),
              action: 'failed',
              data: { errorMessage: error instanceof Error ? error.message : String(error) },
            })
          }
        }
        yield {
          items,
          cursor: encodeCursor({ afterId: null }),
          hasMore: false,
          processedCount: rows.length,
          batchIndex: 0,
        }
        return
      }

      // ── brands ───────────────────────────────────────────────────────────────
      if (entityType === 'brands') {
        const rows = await client.queryBrands({ frontendId: credentials.frontendId })
        const items: ImportItem[] = []
        for (const row of rows) {
          try {
            const result = await importer.upsertBrand(row)
            items.push({
              externalId: String(row.id),
              action: result.action,
              data: { localId: result.localId, name: row.name },
            })
          } catch (error) {
            items.push({
              externalId: String(row.id),
              action: 'failed',
              data: { errorMessage: error instanceof Error ? error.message : String(error) },
            })
          }
        }
        yield {
          items,
          cursor: encodeCursor({ afterId: null }),
          hasMore: false,
          processedCount: rows.length,
          batchIndex: 0,
        }
        return
      }

      // ── products (keyset pagination by id) ──────────────────────────────────
      let batchIndex = 0

      let afterId: number | null = null

      if (input.cursor) {
        const parsed = decodeCursor(input.cursor)
        afterId = parsed.afterId
      }

      const seenExternalIds = new Set<string>()
      const reconciliation = buildDefaultReconciliationSettings()
      const safeFullSync = !input.cursor

      while (true) {
        const rows = await client.queryProducts({
          frontendId: credentials.frontendId,
          batchSize: input.batchSize,
          afterId,
        })

        const items: ImportItem[] = []
        for (const row of rows) {
          try {
            const imported = await importer.upsertProduct(row, dataMapping)
            for (const item of imported) {
              seenExternalIds.add(item.externalId)
              items.push(item)
            }
          } catch (error) {
            items.push({
              externalId: row.symbol,
              action: 'failed',
              data: { errorMessage: error instanceof Error ? error.message : String(error) },
            })
          }
        }

        const hasMore = rows.length === input.batchSize

        if (hasMore) {
          const lastRow = rows[rows.length - 1]
          afterId = lastRow.id
        }

        yield {
          items,
          cursor: encodeCursor({ afterId }),
          hasMore,
          processedCount: rows.length,
          batchIndex,
          refreshCoverageEntityTypes: ['catalog:catalog_product'],
        }

        batchIndex += 1

        if (!hasMore) break
      }

      // Reconcile after a full (non-resumed) sync
      if (safeFullSync && seenExternalIds.size > 0) {
        await importer.reconcileProducts(seenExternalIds, reconciliation)
      }
    } finally {
      await client.close()
    }
  },
}
