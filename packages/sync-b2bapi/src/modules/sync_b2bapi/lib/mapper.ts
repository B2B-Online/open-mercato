import type { ImportItem } from '@open-mercato/core/modules/data_sync/lib/adapter'
import type { WebsiteProductRow } from './db-client'

/**
 * Slugify a string for use as a product slug.
 * Converts short_name (or name as fallback) to a URL-safe slug.
 */
function slugifyProductName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150)
}

/**
 * Maps a WebsiteProductRow to an ImportItem data payload.
 *
 * Explicitly excludes price fields:
 *   net_price, gross_price, default_price_net, default_price_gross
 *
 * Requirements: 1.2, 3.4
 */
export function mapProductToImportItem(
  row: WebsiteProductRow,
  categoryLocalId: string | null,
  brandLocalId: string | null,
  mediaBaseUrl?: string,
): ImportItem {
  const slugSource = row.short_name ?? row.name
  const slug = slugifyProductName(slugSource)

  const thumbnailUrl = row.thumbnail_path
    ? `${mediaBaseUrl ?? ''}${row.thumbnail_path}`
    : null

  const imageUrl = row.image_path
    ? `${mediaBaseUrl ?? ''}${row.image_path}`
    : null

  const customFields: Record<string, string | null> = {
    custom_1: row.custom_1,
    custom_2: row.custom_2,
    custom_3: row.custom_3,
    custom_4: row.custom_4,
    custom_5: row.custom_5,
    custom_6: row.custom_6,
    custom_7: row.custom_7,
    custom_8: row.custom_8,
  }

  return {
    externalId: row.symbol,
    action: 'create',
    data: {
      // Identity
      externalId: row.symbol,
      partNumber: row.part_number,

      // Content
      name: row.name,
      slug,
      shortDescription: row.short_description,
      description: row.long_description,

      // Taxonomy
      ean: row.ean,
      weight: row.weight,
      unitName: row.unit_name,

      // Media
      thumbnailUrl,
      imageUrl,

      // Relations
      categoryId: categoryLocalId,
      brandId: brandLocalId,

      // Flags
      isAvailable: row.is_available,
      isActive: !row.is_hidden,
      isSuggested: row.is_suggested,
      isPromotion: row.is_promotion,
      isNewProduct: row.is_new_product,

      // Custom fields stored as JSON object
      customFields,
    },
  }
}
