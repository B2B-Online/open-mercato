import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import SupplierPricesWidget from './widget.client'

const widget: InjectionWidgetModule<unknown, unknown> = {
  metadata: {
    id: 'sync_b2bapi.injection.supplier-prices',
    title: 'Supplier Prices',
    features: ['sales.manage'],
    priority: 50,
  },
  Widget: SupplierPricesWidget as InjectionWidgetModule<unknown, unknown>['Widget'],
}

export default widget
