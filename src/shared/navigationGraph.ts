export interface TrailNode { id: string; url: string; title: string; domain: string; firstSeen: number; lastSeen: number; visits: number }
export interface TrailEdge { source: string; target: string; firstSeen: number; lastSeen: number; count: number }
export interface NavigationGraph { nodes: TrailNode[]; edges: TrailEdge[] }
export const EMPTY_NAVIGATION_GRAPH = (): NavigationGraph => ({ nodes: [], edges: [] })
export function trailUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/token|secret|password|api[-_]?key|signature|credential/i.test(key)) url.searchParams.delete(key)
    return url.href.slice(0, 4096)
  } catch { return null }
}
/** Record only observed transitions; proximity in time never invents an edge. */
export function recordTransition(graph: NavigationGraph, source: string | null, target: string, title: string, now = Date.now()): NavigationGraph {
  const url = trailUrl(target)
  if (!url) return graph
  const nodes = graph.nodes.map(node => ({ ...node }))
  const edges = graph.edges.map(edge => ({ ...edge }))
  let node = nodes.find(node => node.id === url)
  if (node) { node.lastSeen = now; node.visits++; node.title = title || node.title }
  else { node = { id: url, url, title: title.slice(0, 300) || new URL(url).hostname, domain: new URL(url).hostname, firstSeen: now, lastSeen: now, visits: 1 }; nodes.push(node) }
  const from = source ? trailUrl(source) : null
  if (from && from !== url) {
    if (!nodes.some(node => node.id === from)) nodes.push({ id: from, url: from, title: new URL(from).hostname, domain: new URL(from).hostname, firstSeen: now, lastSeen: now, visits: 1 })
    const edge = edges.find(edge => edge.source === from && edge.target === url)
    if (edge) { edge.lastSeen = now; edge.count++ }
    else edges.push({ source: from, target: url, firstSeen: now, lastSeen: now, count: 1 })
  }
  nodes.sort((a, b) => b.lastSeen - a.lastSeen)
  nodes.length = Math.min(nodes.length, 500)
  const live = new Set(nodes.map(node => node.id))
  return { nodes, edges: edges.filter(edge => live.has(edge.source) && live.has(edge.target)).sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 1500) }
}
export function removeTrailUrl(graph: NavigationGraph, value: string): NavigationGraph {
  const url = trailUrl(value)
  return { nodes: graph.nodes.filter(node => node.id !== url), edges: graph.edges.filter(edge => edge.source !== url && edge.target !== url) }
}
export function connectedTrail(graph: NavigationGraph, id: string): Set<string> {
  const found = new Set([id]), queue = [id]
  for (let at = 0; at < queue.length; at++) {
    for (const edge of graph.edges) if (edge.source === queue[at] && !found.has(edge.target)) { found.add(edge.target); queue.push(edge.target) }
  }
  return found
}
