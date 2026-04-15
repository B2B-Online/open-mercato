import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerDataSyncAdapter } from '@open-mercato/core/modules/data_sync/lib/adapter-registry'
import { registerCatalogPricingResolver } from '@open-mercato/core/modules/catalog/lib/pricing'
import { b2bApiDataSyncAdapter } from './lib/adapter'
import { createB2BApiPricingDriver } from './lib/pricing-driver'

export function register(_container: AppContainer): void {
  registerDataSyncAdapter(b2bApiDataSyncAdapter)

  // Pricing driver reads gci, pricingApiUrl, pricingApiKey from integration credentials
  // stored in the database — configurable via Integrations UI, not environment variables.
  registerCatalogPricingResolver(createB2BApiPricingDriver())
}
