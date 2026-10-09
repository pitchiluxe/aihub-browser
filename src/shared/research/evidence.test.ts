import { describe, it, expect } from 'vitest'
import { matchCitation, normalizeEvidence, claimNeedsReview } from './evidence'
import { safeResearchUrl, validateProject, validateCapsule } from './validation'
const source = { id: 's1', title: 'Study', url: 'https://example.org/study', capturedAt: '2026-10-08T12:00:00.000Z', text: 'A result. A result.', truncated: false, captureType: 'page' as const, provenance: 'captured' as const }
const claim = { id: 'c1', text: 'The result', citations: [{ sourceId: 's1', quote: 'A result.' }], reviewed: true, kind: 'finding' as const }
const project = { schemaVersion: 1 as const, id: 'p1', title: 'Study', question: '', createdAt: source.capturedAt, updatedAt: source.capturedAt, mode: 'summary' as const, sources: [source], claims: [claim], notes: [] }
describe('research evidence', () => {
  it('matches a repeated phrase deterministically', () => { expect(matchCitation(source, claim.citations[0])).toMatchObject({ start: 0, end: 9 }) })
  it('normalizes whitespace consistently but does not invent support', () => {
    expect(normalizeEvidence(' A\t result.\r\n Next ')).toBe('A result.\nNext')
    expect(matchCitation(source, { sourceId: 's1', quote: 'Invented.' })).toBeNull()
    expect(matchCitation(source, { sourceId: 'unknown', quote: 'A result.' })).toBeNull()
    expect(matchCitation(source, { sourceId: 's1', quote: '' })).toBeNull()
  })
  it('does not match across imported excerpts', () => {
    expect(matchCitation({ ...source, text: 'First\n\nSecond', captureType: 'excerpts', provenance: 'imported', excerpts: ['First', 'Second'] }, { sourceId: 's1', quote: 'First\n\nSecond' })).toBeNull()
  })
  it('requires evidence and user review separately', () => {
    expect(claimNeedsReview(project, claim)).toBe(false)
    expect(claimNeedsReview(project, { ...claim, reviewed: false })).toBe(true)
    expect(claimNeedsReview(project, { ...claim, citations: [] })).toBe(true)
  })
})
describe('research validation', () => {
  it('allows only web links without credentials', () => {
    expect(safeResearchUrl('https://example.org')).toBe(true)
    for (const url of ['javascript:alert(1)', 'file:///a', 'https://user:secret@example.org', null]) expect(safeResearchUrl(url)).toBe(false)
  })
  it('constructs known fields and enforces bounds and uniqueness', () => {
    expect(validateProject({ ...project, secret: 'never retained' })).toEqual({ ok: true, value: project })
    for (const value of [{ ...project, sources: [source, source] }, { ...project, title: 'x'.repeat(201) }, { ...project, createdAt: 'nonsense' }, { ...project, sources: [{ ...source, text: 'x'.repeat(12001) }] }]) expect(validateProject(value).ok).toBe(false)
  })
  it('keeps unsupported citations readable while refusing dangerous metadata', () => {
    expect(validateProject({ ...project, claims: [{ ...claim, citations: [{ sourceId: 'missing', quote: 'Unverified' }] }] }).ok).toBe(true)
    expect(validateProject({ ...project, sources: [{ ...source, url: 'javascript:alert(1)' }] }).ok).toBe(false)
  })
  it('permits imported shared excerpts with no original URL', () => {
    const { url, ...rest } = source
    expect(validateProject({ ...project, sources: [{ ...rest, provenance: 'imported', captureType: 'excerpts', excerpts: [rest.text] }] }).ok).toBe(true)
    expect(validateProject({ ...project, sources: [{ ...rest }] }).ok).toBe(false)
  })
  it('rejects invalid capsule formats', () => {
    expect(validateCapsule({ ...project, kind: 'unknown' }).ok).toBe(false)
    expect(validateCapsule(null).ok).toBe(false)
  })
})
