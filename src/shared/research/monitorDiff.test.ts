import { describe, it, expect } from 'vitest'
import { compareObservation } from './monitorDiff'
import { validateMonitorInput } from './monitorValidation'
import type { ResearchProject } from './types'
const when = '2026-10-08T12:00:00.000Z'
const source = { id: 'source', title: 'Prices', url: 'https://example.com', capturedAt: when, text: 'Price $120 on 2026-10-08', truncated: false, captureType: 'page' as const, provenance: 'captured' as const }
const project: ResearchProject = { schemaVersion: 1, id: 'project', title: 'Test', question: '', mode: 'summary', createdAt: when, updatedAt: when, notes: [], sources: [source], claims: [
  { id: 'good', text: 'Price', kind: 'finding', reviewed: true, citations: [{ sourceId: 'source', quote: source.text }] },
  { id: 'bad', text: 'Invented', kind: 'finding', reviewed: false, citations: [{ sourceId: 'source', quote: 'Invented' }] },
  { id: 'other', text: 'Other', kind: 'finding', reviewed: false, citations: [{ sourceId: 'other', quote: 'Other' }] },
] }
const obs = (text: string, truncated = false) => ({ id: 'obs', requestedUrl: source.url, finalUrl: source.url, checkedAt: when, text, truncated, kind: 'public-html' as const })
describe('research changes', () => {
  it('retains dates and prices, identifies missing quotes without modifying findings', () => {
    const before = JSON.stringify(project)
    const r = compareObservation(project, source.id, obs(source.text), obs('Price $150 on 2026-10-09'))
    expect(r.passages).toEqual([{ before: source.text, after: 'Price $150 on 2026-10-09' }])
    expect(r.impacts.map(i => [i.claimId, i.status])).toEqual([['good', 'missing'], ['bad', 'already-unmatched']])
    expect(JSON.stringify(project)).toBe(before)
  })
  it('ignores whitespace and preserves repeated paragraphs', () => {
    expect(compareObservation(project, source.id, obs('A\nA\nB'), obs(' A\nA\n B ')).passages).toEqual([])
    expect(compareObservation(project, source.id, obs('A\nA\nB'), obs('A\nB')).passages).toEqual([{ before: 'A', after: '' }])
  })
  it('marks retained quote as present and exposes bounded truncation', () => {
    const r = compareObservation(project, source.id, obs(source.text), obs(source.text + '\nExtra', true))
    expect(r.impacts[0].status).toBe('present'); expect(r.truncated).toBe(true)
    const big = compareObservation(project, source.id, obs('x'.repeat(12000)), obs('y'.repeat(12000)))
    expect(big.passages[0].before.length).toBeLessThanOrEqual(1000)
  })
  it('does not report a retained long observation as truncated when the fetch was complete', () => {
    const text = 'A'.repeat(12000)
    const r = compareObservation(project, source.id, obs(text), obs(text + 'B'))
    expect(r.truncated).toBe(false)
  })
  it('rejects oversized identifiers and invalid project revisions', () => {
    expect(validateMonitorInput({ projectId: 'p', sourceId: 's', expectedUpdatedAt: when }).ok).toBe(true)
    expect(validateMonitorInput({ projectId: 'x'.repeat(101), sourceId: 's', expectedUpdatedAt: when }).ok).toBe(false)
    expect(validateMonitorInput({ projectId: 'p', sourceId: 's', expectedUpdatedAt: 'invalid' }).ok).toBe(false)
  })
})
