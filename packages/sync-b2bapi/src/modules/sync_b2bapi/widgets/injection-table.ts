import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
import { syncB2BApiDetailWidgetSpotId } from '../integration'

export const injectionTable: ModuleInjectionTable = {
  [syncB2BApiDetailWidgetSpotId]: [
    {
      widgetId: 'sync_b2bapi.injection.config',
      kind: 'tab',
      groupLabel: 'sync_b2bapi.tabs.tools',
      priority: 100,
    },
  ],
  'sales.document.detail.order:tabs': [
    {
      widgetId: 'sync_b2bapi.injection.supplier-prices',
      kind: 'tab',
      groupLabel: 'sync_b2bapi.tabs.supplierPrices',
      priority: 50,
    },
  ],
}

export default injectionTable
