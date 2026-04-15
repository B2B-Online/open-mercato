import type { CatalogPricingResolver, PriceRow, PricingContext } from '@open-mercato/core/modules/catalog/lib/pricing'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createCredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { EntityManager } from '@mikro-orm/postgresql'

const INTEGRATION_ID = 'sync_b2bapi'

export interface B2BApiPricingDriverConfig {
  cacheTtlSeconds?: number
  currencyCode?: string
}

interface B2BApiCredentialsShape {
  pricingApiUrl: string
  pricingApiKey: string
  gci: string
  pricingPriority?: number
  pricingCacheTtlSeconds?: number
}

interface PriceApiResponse {
  contractor_net_price?: number | string | null
  net_price?: number | string | null
  gross_price?: number | string | null
  quantity?: number
  success?: boolean
  error?: string
}

interface CacheEntry {
  price: PriceRow
  expiresAt: number
}

// Global in-memory cache shared across all resolver invocations
// Key: `${tenantId}:${organizationId}:${symbol}:${customerId}`
const globalCache = new Map<string, CacheEntry>()

async function resolveCredentials(
  tenantId: string,
  organizationId: string,
): Promise<B2BApiCredentialsShape | null> {
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const credentialsService = createCredentialsService(em)
    const raw = await credentialsService.getRaw(INTEGRATION_ID, { tenantId, organizationId })
    if (!raw) return null

    const { pricingApiUrl, pricingApiKey, gci } = raw
    if (!pricingApiUrl || !pricingApiKey || !gci) return null

    return raw as unknown as B2BApiCredentialsShape
  } catch {
    return null
  }
}

/**
 * Creates a B2BAPI pricing driver that resolves prices by calling the b2bapi pricing endpoint.
 * Credentials (pricingApiUrl, pricingApiKey, gci) are read from the integration settings
 * stored in the database — configurable via the Integrations UI, not environment variables.
 *
 * The driver uses the product's `sku` field as the b2bapi `symbol` for price lookups.
 */
export function createB2BApiPricingDriver(config: B2BApiPricingDriverConfig = {}): CatalogPricingResolver {
  const { currencyCode = 'USD' } = config

  return async (rows: PriceRow[], ctx: PricingContext): Promise<PriceRow | null | undefined> => {
    if (rows.length === 0) return undefined

    const targetRow = rows.find((row) => {
      if (!row.product) return false
      if (typeof row.product === 'string') return false
      return Boolean(row.product.sku)
    })

    if (!targetRow || !targetRow.product || typeof targetRow.product === 'string') {
      return undefined
    }

    const symbol = targetRow.product.sku
    if (!symbol) return undefined

    const tenantId = targetRow.product.tenantId
    const organizationId = targetRow.product.organizationId
    if (!tenantId || !organizationId) return undefined

    // Load credentials from DB (per-tenant)
    const credentials = await resolveCredentials(tenantId, organizationId)
    if (!credentials) return undefined

    const { pricingApiUrl, pricingApiKey, gci } = credentials
    const cacheTtlSeconds = credentials.pricingCacheTtlSeconds ?? config.cacheTtlSeconds ?? 60

    const customerId = ctx.customerId ?? ''
    const cacheKey = `${tenantId}:${organizationId}:${symbol}:${customerId}`

    // Check cache
    const now = Date.now()
    const cached = globalCache.get(cacheKey)
    if (cached && cached.expiresAt > now) {
      return cached.price
    }

    try {
      const baseUrl = pricingApiUrl.replace(/\/$/, '')
      const params = new URLSearchParams({ gci, symbols: symbol })
      if (customerId) {
        params.set('cid', customerId)
      }
      const url = `${baseUrl}/product/prices/?${params.toString()}`

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${pricingApiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        return null
      }

      const data: PriceApiResponse = await response.json()

      let amount: number | null = null
      if (data.contractor_net_price !== undefined && data.contractor_net_price !== null) {
        amount = typeof data.contractor_net_price === 'string'
          ? parseFloat(data.contractor_net_price)
          : data.contractor_net_price
      } else if (data.net_price !== undefined && data.net_price !== null) {
        amount = typeof data.net_price === 'string'
          ? parseFloat(data.net_price)
          : data.net_price
      }

      if (amount === null || isNaN(amount)) {
        return null
      }

      const priceRow: PriceRow = {
        id: `b2bapi-live-${symbol}-${customerId}`,
        organizationId: targetRow.product.organizationId,
        tenantId: targetRow.product.tenantId,
        currencyCode,
        kind: 'live',
        minQuantity: 1,
        maxQuantity: null,
        unitPriceNet: amount.toFixed(4),
        unitPriceGross: null,
        taxRate: null,
        taxAmount: null,
        channelId: null,
        userId: null,
        userGroupId: null,
        customerId: customerId || null,
        customerGroupId: null,
        metadata: null,
        startsAt: null,
        endsAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        priceKind: { code: 'live' } as PriceRow['priceKind'],
        product: targetRow.product,
        variant: null,
        offer: null,
      }

      globalCache.set(cacheKey, {
        price: priceRow,
        expiresAt: now + cacheTtlSeconds * 1000,
      })

      return priceRow
    } catch {
      return null
    }
  }
}
