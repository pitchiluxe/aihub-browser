import type { CapturedSource, Citation, EvidenceMatch, ResearchClaim, ResearchProject } from './types'
export function normalizeEvidence(text: string): string { return text.replace(/\r\n?/g, '\n').replace(/[\t\u00a0 ]+/g, ' ').replace(/ *\n */g, '\n').trim() }
export function matchCitation(source: CapturedSource, citation: Citation): EvidenceMatch | null {
  if (source.id !== citation.sourceId) return null
  const quote = normalizeEvidence(citation.quote)
  if (!quote) return null
  if (source.provenance === 'imported' && !source.excerpts?.some(e => normalizeEvidence(e).includes(quote))) return null
  const start = normalizeEvidence(source.text).indexOf(quote)
  return start < 0 ? null : { sourceId: source.id, quote, start, end: start + quote.length }
}
export function claimNeedsReview(project: ResearchProject, claim: ResearchClaim): boolean {
  return !claim.reviewed || !claim.citations.length || claim.citations.some(c => {
    const s = project.sources.find(s => s.id === c.sourceId)
    return !s || !matchCitation(s, c)
  })
}
