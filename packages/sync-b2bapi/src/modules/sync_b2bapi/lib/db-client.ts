import { Pool, type PoolConfig } from 'pg'
import type { B2BApiCredentials } from './credentials'

export const MAX_BATCH_SIZE = 1000

const PRODUCT_COLUMNS = `
  id, symbol, part_number, name, short_name, short_description,
  long_description, category_id, brand_id, ean, weight, unit_name,
  is_hidden, is_available, is_suggested, is_promotion, is_new_product,
  thumbnail_path, image_path, custom_1, custom_2, custom_3, custom_4,
  custom_5, custom_6, custom_7, custom_8
`

export interface WebsiteProductRow {
  id: number
  symbol: string
  part_number: string | null
  name: string
  short_name: string | null
  short_description: string | null
  long_description: string | null
  category_id: number | null
  brand_id: number | null
  ean: string | null
  weight: string | null
  unit_name: string | null
  is_hidden: boolean
  is_available: boolean
  is_suggested: boolean
  is_promotion: boolean
  is_new_product: boolean
  thumbnail_path: string | null
  image_path: string | null
  custom_1: string | null
  custom_2: string | null
  custom_3: string | null
  custom_4: string | null
  custom_5: string | null
  custom_6: string | null
  custom_7: string | null
  custom_8: string | null
}

export interface CategoryRow {
  id: number
  name: string
  slug: string | null
  path: string | null
  parent_id: number | null
  level: number
}

export interface BrandRow {
  id: number
  name: string
  external_code: string | null
}

export interface B2BApiDbClient {
  queryProducts(params: {
    frontendId: number
    batchSize: number
    afterId: number | null
  }): Promise<WebsiteProductRow[]>

  queryProductById(params: { frontendId: number; productId: number }): Promise<WebsiteProductRow | null>
  queryCategories(params: { frontendId: number }): Promise<CategoryRow[]>
  queryBrands(params: { frontendId: number }): Promise<BrandRow[]>
  countProducts(frontendId: number): Promise<number>
  close(): Promise<void>
}

export function createB2BApiDbClient(credentials: B2BApiCredentials): B2BApiDbClient {
  const config: PoolConfig = {
    host: credentials.dbHost,
    port: credentials.dbPort,
    database: credentials.dbName,
    user: credentials.dbUser,
    password: credentials.dbPassword,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: { rejectUnauthorized: false },
  }

  const pool = new Pool(config)

  return {
    async queryProducts({ frontendId, batchSize, afterId }) {
      const effectiveBatchSize = Math.min(batchSize, MAX_BATCH_SIZE)
      const query = `
        SELECT ${PRODUCT_COLUMNS}
        FROM website_products_view
        WHERE frontend_id = $1
          AND id > $2
        ORDER BY id ASC
        LIMIT $3
      `
      const result = await pool.query<WebsiteProductRow>(query, [
        frontendId,
        afterId ?? 0,
        effectiveBatchSize,
      ])
      return result.rows
    },

    async queryProductById({ frontendId, productId }) {
      const query = `
        SELECT ${PRODUCT_COLUMNS}
        FROM website_products_view
        WHERE frontend_id = $1 AND id = $2
        LIMIT 1
      `
      const result = await pool.query<WebsiteProductRow>(query, [frontendId, productId])
      return result.rows[0] ?? null
    },

    async queryCategories({ frontendId }) {
      const query = `
        SELECT id, name, slug, path, parent_id, level
        FROM category
        WHERE frontend_id = $1
        ORDER BY level ASC, id ASC
      `
      const result = await pool.query<CategoryRow>(query, [frontendId])
      return result.rows
    },

    async queryBrands({ frontendId }) {
      const query = `
        SELECT id, name, external_code
        FROM brand
        WHERE frontend_id = $1
        ORDER BY id ASC
      `
      const result = await pool.query<BrandRow>(query, [frontendId])
      return result.rows
    },

    async countProducts(frontendId) {
      const query = `
        SELECT COUNT(*) AS count
        FROM website_products_view
        WHERE frontend_id = $1
      `
      const result = await pool.query<{ count: string }>(query, [frontendId])
      return parseInt(result.rows[0].count, 10)
    },

    async close() {
      await pool.end()
    },
  }
}
