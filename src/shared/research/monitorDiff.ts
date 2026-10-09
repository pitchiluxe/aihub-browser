import { matchCitation, normalizeEvidence } from './evidence'
import { MONITOR_LIMITS as L, type Impact, type Observation, type PassageChange } from './monitorTypes'
import type { ResearchProject } from './types'
export function compareObservation(project: ResearchProject, sourceId: string, before: Observation, after: Observation) {
  const oldText = normalizeEvidence(before.text), newText = normalizeEvidence(after.text)
  const source = project.sources.find(s => s.id === sourceId)
  const impacts: Impact[] = project.claims.flatMap(claim => claim.citations.filter(c => c.sourceId === sourceId).map(citation => ({
    claimId: claim.id, quote: citation.quote,
    status: !source || !matchCitation(source, citation) ? 'already-unmatched' as const : newText.includes(normalizeEvidence(citation.quote)) ? 'present' as const : 'missing' as const,
  })))
  const passages: PassageChange[] = []
  if (oldText !== newText) {
    // Multiset subtraction preserves duplicate paragraphs without a quadratic alignment matrix.
    const missing = (lines: string[], other: string[]) => {
      const counts = new Map<string, number>(); for (const p of other) counts.set(p, (counts.get(p) || 0) + 1)
      return lines.filter(p => { const n = counts.get(p) || 0; if (n) { counts.set(p, n - 1); return false } return true })
    }
    const oldLines = oldText.split('\n').filter(Boolean), newLines = newText.split('\n').filter(Boolean)
    const removed = missing(oldLines, newLines), added = missing(newLines, oldLines)
    for (let i = 0; i < Math.min(L.passages, Math.max(removed.length, added.length)); i++) passages.push({ before: (removed[i] || '').slice(0, L.passageChars), after: (added[i] || '').slice(0, L.passageChars) })
    // Reordering is significant even when every paragraph remains present.
    if (!passages.length) passages.push({ before: oldText.slice(0, L.passageChars), after: newText.slice(0, L.passageChars) })
  }
  return { passages, impacts, version: newText, truncated: before.truncated || after.truncated }
}
