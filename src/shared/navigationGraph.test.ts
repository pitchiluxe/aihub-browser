import { describe, expect, it } from 'vitest'
import { EMPTY_NAVIGATION_GRAPH, connectedTrail, recordTransition, removeTrailUrl } from './navigationGraph'
import { layoutHistoryGraph } from './historyLayout'
describe('observed navigation trails', () => {
  it('records direction, revisits, and titles without inventing chronological links', () => {
    let graph = recordTransition(EMPTY_NAVIGATION_GRAPH(), null, 'https://a.test', 'A', 1)
    graph = recordTransition(graph, null, 'https://unrelated.test', 'Other', 2)
    expect(graph.edges).toHaveLength(0)
    graph = recordTransition(graph, 'https://a.test', 'https://b.test', 'B', 3)
    graph = recordTransition(graph, 'https://b.test', 'https://c.test', 'C', 4)
    graph = recordTransition(graph, 'https://a.test', 'https://b.test', 'B again', 5)
    expect(graph.edges.find(edge => edge.source === 'https://a.test/')?.count).toBe(2)
    expect(connectedTrail(graph, 'https://a.test/')).toEqual(new Set(['https://a.test/', 'https://b.test/', 'https://c.test/']))
    expect(connectedTrail(graph, 'https://c.test/').size).toBe(1)
    expect(graph.nodes.find(node => node.id === 'https://b.test/')?.title).toBe('B again')
  })
  it('removes attached links with a page and ignores non-web URLs', () => {
    const graph = recordTransition(EMPTY_NAVIGATION_GRAPH(), 'https://a.test', 'https://b.test/?token=private#secret', 'B')
    expect(JSON.stringify(graph)).not.toMatch(/private|secret/)
    expect(removeTrailUrl(graph, 'https://a.test').edges).toHaveLength(0)
    expect(recordTransition(graph, null, 'file:///secret', 'secret')).toBe(graph)
  })
  it('caps retained pages and produces finite deterministic positions', () => {
    let graph = EMPTY_NAVIGATION_GRAPH()
    for (let i = 0; i < 510; i++) graph = recordTransition(graph, i ? `https://example.com/${i - 1}` : null, `https://example.com/${i}`, `Page ${i}`, i)
    expect(graph.nodes).toHaveLength(500)
    const layout = layoutHistoryGraph(graph)
    expect(layout.positions).toHaveLength(1500)
    expect([...layout.positions].every(Number.isFinite)).toBe(true)
    expect(layoutHistoryGraph(graph).positions).toEqual(layout.positions)
    expect([...layout.links].every(index => index < 500)).toBe(true)
  })
})
