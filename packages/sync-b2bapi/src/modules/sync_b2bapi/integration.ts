import { buildIntegrationDetailWidgetSpotId, type IntegrationBundle, type IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const syncB2BApiDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('sync_b2bapi')

export const integration: IntegrationDefinition = {
  id: 'sync_b2bapi',
  title: 'B2BAPI Product Sync',
  description: 'Import ishark/b2bapi product catalog into Open Mercato via direct PostgreSQL connection with live pricing resolution.',
  category: 'data_sync',
  hub: 'data_sync',
  providerKey: 'b2bapi',
  icon: 'database',
  package: '@open-mercato/sync-b2bapi',
  version: '1.0.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['b2bapi', 'ishark', 'catalog', 'products', 'live-pricing'],
  detailPage: {
    widgetSpotId: syncB2BApiDetailWidgetSpotId,
  },
  credentials: {
    fields: [
      {
        key: 'dbHost',
        label: 'Database Host',
        type: 'text',
        required: true,
        placeholder: 'db.example.com',
        helpText: 'Hostname of the ishark PostgreSQL read replica.',
      },
      {
        key: 'dbPort',
        label: 'Database Port',
        type: 'text',
        required: true,
        placeholder: '5432',
        helpText: 'PostgreSQL port, usually 5432.',
      },
      {
        key: 'dbName',
        label: 'Database Name',
        type: 'text',
        required: true,
        helpText: 'Name of the ishark database.',
      },
      {
        key: 'dbUser',
        label: 'Database User',
        type: 'text',
        required: true,
        helpText: 'Read-only PostgreSQL user for the ishark database.',
      },
      {
        key: 'dbPassword',
        label: 'Database Password',
        type: 'secret',
        required: true,
        helpText: 'Password for the PostgreSQL user.',
      },
      {
        key: 'frontendId',
        label: 'Frontend ID',
        type: 'text',
        required: true,
        helpText: 'The ishark frontend_id that scopes the sync to a single website/storefront.',
      },
      {
        key: 'pricingApiUrl',
        label: 'Pricing API URL',
        type: 'url',
        required: true,
        placeholder: 'https://b2bapi.example.com',
        helpText: 'Base URL of the b2bapi pricing endpoint.',
      },
      {
        key: 'pricingApiKey',
        label: 'Pricing API Key',
        type: 'secret',
        required: true,
        helpText: 'Bearer token for authenticating with the b2bapi pricing endpoint.',
      },
      {
        key: 'gci',
        label: 'GCI (Supplier Identifier)',
        type: 'text',
        required: true,
        helpText: 'Greencheck supplier identifier used to route pricing requests to the correct distributor driver.',
      },
      {
        key: 'pricingPriority',
        label: 'Pricing Priority',
        type: 'text',
        required: false,
        placeholder: '0',
        helpText: 'Priority of this pricing resolver relative to others. Higher number = higher priority.',
      },
      {
        key: 'pricingCacheTtlSeconds',
        label: 'Pricing Cache TTL (seconds)',
        type: 'text',
        required: false,
        placeholder: '60',
        helpText: 'How long to cache live price responses per product/customer pair.',
      },
    ],
  },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
