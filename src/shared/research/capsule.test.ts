import { it, expect } from 'vitest'
import { buildResearchCapsule, renderCapsuleHtml, importResearchCapsule } from './capsule'
import type { ResearchProject } from './types'
const when = '2026-10-08T12:00:00.000Z'
const p: ResearchProject = { schemaVersion: 1, id: 'p', title: '<script>alert(1)</script>', question: 'Study', createdAt: when, updatedAt: when, mode: 'summary', sources: [{ id: 's', title: 'Source', url: 'https://example.org', capturedAt: when, text: 'Shared passage. PRIVATE REMAINDER', captureType: 'page', provenance: 'captured', truncated: false }], claims: [{ id: 'c', text: 'Finding', citations: [{ sourceId: 's', quote: 'Shared passage.' }], reviewed: true, kind: 'finding' }], notes: [{ id: 'n', text: 'PRIVATE NOTE', createdAt: when }] }
const selection = { claimIds: ['c'], sourceIds: ['s'], claimText: {}, sourceUrls: {}, quotes: {} }
it('exports only evidence excerpts and renders safe offline HTML', () => {
  const result = buildResearchCapsule(p, selection); expect(result.ok).toBe(true)
  if (!result.ok) return
  const json = JSON.stringify(result.value), html = renderCapsuleHtml(result.value)
  expect(json).not.toContain('PRIVATE'); expect(html).not.toContain('<script'); expect(html).not.toContain('<img'); expect(html).toContain('&lt;script&gt;'); expect(html).toContain("default-src 'none'")
  const imported = importResearchCapsule(json); expect(imported.ok).toBe(true)
  if (imported.ok) { expect(imported.value.id).not.toBe(p.id); expect(imported.value.sources[0].provenance).toBe('imported'); expect(imported.value.sources[0].id).not.toBe('s'); expect(imported.value.claims[0].reviewed).toBe(false) }
})
it('removes URLs and never launders edited or invented quotations into evidence', () => {
  const result = buildResearchCapsule(p, { ...selection, sourceUrls: { s: null }, quotes: { 'c:0': 'Invented passage' } })
  expect(result.ok).toBe(true); if (result.ok) { expect(result.value.sources[0].url).toBeUndefined(); expect(result.value.sources[0].excerpts).toEqual([]); expect(result.value.claims[0].reviewed).toBe(false); expect(renderCapsuleHtml(result.value)).toContain('Needs review'); expect(importResearchCapsule(JSON.stringify(result.value)).ok).toBe(true) }
  expect(buildResearchCapsule(p, { ...selection, sourceUrls: { s: 'javascript:alert(1)' } }).ok).toBe(false)
})
it('rejects invalid and over-limit JSON before import', () => {
  expect(importResearchCapsule('x'.repeat(5 * 1024 * 1024 + 1)).ok).toBe(false)
  expect(importResearchCapsule('{"kind":"wrong"}').ok).toBe(false)
})
it('removes excluded-source quotations from both export files', () => {
  const result = buildResearchCapsule(p, { ...selection, sourceIds: [] })
  expect(result.ok).toBe(true); if (!result.ok) return
  expect(JSON.stringify(result.value)).not.toContain('Shared passage.')
  expect(renderCapsuleHtml(result.value)).not.toContain('Shared passage.')
  expect(result.value.claims[0].citations).toEqual([])
})
