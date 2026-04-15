import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import B2BApiConfigWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'sync_b2bapi.injection.config',
    title: 'B2BAPI Sync Tools',
    features: ['data_sync.configure'],
    priority: 100,
  },
  Widget: B2BApiConfigWidget,
}

export default widget
