import type { NavigationGraph, TrailNode } from './navigationGraph'
export const TRAIL_CATEGORIES = ['Development', 'Research', 'Business', 'Media', 'Personal'] as const
export function trailCategory(node: TrailNode): number {
  const text = `${node.domain} ${node.title}`.toLowerCase()
  if (/github|gitlab|localhost|127\.0\.0\.1|stackoverflow|developer|documentation|npmjs|code|programming/.test(text)) return 0
  if (/research|wikipedia|arxiv|science|education|learn|paper|docs/.test(text)) return 1
  if (/finance|trading|business|quickbooks|aws|azure|accounting/.test(text)) return 2
  if (/youtube|netflix|music|spotify|video|entertainment/.test(text)) return 3
  return 4
}
export function layoutHistoryGraph(graph: NavigationGraph) {
  const positions = new Float32Array(graph.nodes.length * 3)
  const categories = new Uint8Array(graph.nodes.length)
  const counts = [0, 0, 0, 0, 0]
  const totals = [0, 0, 0, 0, 0]
  for (const node of graph.nodes) totals[trailCategory(node)]++
  graph.nodes.forEach((node, index) => {
    const category = trailCategory(node), slot = counts[category]++
    categories[index] = category
    const phase = category * Math.PI * 2 / 5
    const y = 1 - (slot + 0.5) / Math.max(1, totals[category]) * 2
    const radius = Math.sqrt(Math.max(0, 1 - y * y))
    const angle = slot * Math.PI * (3 - Math.sqrt(5))
    const size = 20 + Math.cbrt(totals[category]) * 4
    positions[index * 3] = Math.cos(phase) * 85 + Math.cos(angle) * radius * size
    positions[index * 3 + 1] = y * size
    positions[index * 3 + 2] = Math.sin(phase) * 85 + Math.sin(angle) * radius * size
  })
  const byId = new Map(graph.nodes.map((node, index) => [node.id, index]))
  const links: number[] = []
  for (const edge of graph.edges) {
    const from = byId.get(edge.source), to = byId.get(edge.target)
    if (from !== undefined && to !== undefined) links.push(from, to)
  }
  return { positions, categories, links: new Uint16Array(links) }
}
