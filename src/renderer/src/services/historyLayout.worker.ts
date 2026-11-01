import { layoutHistoryGraph } from '../../../shared/historyLayout'
import type { NavigationGraph } from '../../../shared/navigationGraph'
self.onmessage = (event: MessageEvent<NavigationGraph>) => {
  const layout = layoutHistoryGraph(event.data)
  self.postMessage(layout, { transfer: [layout.positions.buffer, layout.categories.buffer, layout.links.buffer] })
}
