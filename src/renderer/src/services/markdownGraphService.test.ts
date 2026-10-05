import { describe, it, expect } from 'vitest'
import { buildMarkdownGraph, type MarkdownNote } from './markdownGraphService'

const note = (id: string, extra: Partial<MarkdownNote> = {}): MarkdownNote => ({
  id, filePath: `C:\\vault\\${id}.md`, title: id, url: '', category: 'General', tags: [], createdAt: 0, ...extra,
})

describe('buildMarkdownGraph', () => {
  it('turns every note into a node, including vault notes', () => {
    const { nodes } = buildMarkdownGraph([note('a'), note('vault:b.md', { origin: 'vault', filePath: '/v/b.md' })])
    expect(nodes.map(n => n.id)).toEqual(['a', 'vault:b.md'])
    expect(nodes.map(n => n.origin)).toEqual(['clip', 'vault'])
  })

  it('links [[wikilinks]] by file name, case-insensitively', () => {
    const { links } = buildMarkdownGraph([
      note('a', { category: 'X', links: ['deep note'] }),
      note('vault:p/Deep Note.md', { category: 'Y', title: 'Something else', filePath: '/v/p/Deep Note.md' }),
    ])
    expect(links).toContainEqual({ source: 'a', target: 'vault:p/Deep Note.md', strength: 0.7 })
  })

  it('links notes sharing a tag across categories', () => {
    const { links } = buildMarkdownGraph([
      note('a', { category: 'X', tags: ['llm'] }), note('b', { category: 'Y', tags: ['llm'] }), note('c', { category: 'Z' }),
    ])
    // Two category anchors ring-link, plus the tag link a–b (deduped against the ring).
    expect(links.some(l => [l.source, l.target].sort().join() === 'a,b')).toBe(true)
  })

  it('handles an empty store', () => {
    expect(buildMarkdownGraph([])).toEqual({ nodes: [], links: [] })
  })
})
