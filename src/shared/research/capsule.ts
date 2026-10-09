import { RESEARCH_LIMITS, type ResearchProject, type ResearchCapsule, type ResearchResult } from './types'
import { validateCapsule, validateProject } from './validation'
import { matchCitation, normalizeEvidence, claimNeedsReview } from './evidence'
export interface CapsuleSelection { claimIds: string[]; sourceIds: string[]; claimText: Record<string, string>; sourceUrls: Record<string, string | null>; quotes: Record<string, string> }
export function buildResearchCapsule(project: ResearchProject, selection: CapsuleSelection): ResearchResult<ResearchCapsule> {
  const checked = validateProject(project)
  if (!checked.ok) return checked
  const claims = project.claims.filter(c => selection.claimIds.includes(c.id)).map(c => {
    const text = selection.claimText[c.id] ?? c.text
    const citations = c.citations.map((x, i) => ({ ...x, quote: selection.quotes[`${c.id}:${i}`] ?? x.quote }))
    return { ...c, text, citations, reviewed: c.reviewed && text === c.text && citations.every((x, i) => x.quote === c.citations[i].quote && selection.sourceIds.includes(x.sourceId)) }
  })
  const sources = project.sources.filter(s => selection.sourceIds.includes(s.id)).map(s => {
    const excerpts = [...new Set(claims.flatMap(c => c.citations.filter(x => x.sourceId === s.id && matchCitation(s, x)).map(x => normalizeEvidence(x.quote))))]
    const url = Object.hasOwn(selection.sourceUrls, s.id) ? selection.sourceUrls[s.id] : s.url
    return { id: s.id, title: s.title, ...(url ? { url } : {}), capturedAt: s.capturedAt, excerpts, truncated: s.truncated }
  })
  return validateCapsule({ schemaVersion: 1, kind: 'aihub-research-capsule', title: project.title, question: project.question, mode: project.mode, exportedAt: new Date().toISOString(), sources, claims })
}
export function importResearchCapsule(raw: string): ResearchResult<ResearchProject> {
  try {
    if (new TextEncoder().encode(raw).length > RESEARCH_LIMITS.importBytes) throw Error('Capsules must be smaller than 5 MB.')
    const checked = validateCapsule(JSON.parse(raw)); if (!checked.ok) return checked
    const c = checked.value, ids = new Map(c.sources.map(s => [s.id, crypto.randomUUID()]))
    const when = new Date().toISOString()
    return validateProject({ schemaVersion: 1, id: crypto.randomUUID(), title: c.title, question: c.question, mode: c.mode, createdAt: when, updatedAt: when,
      sources: c.sources.map(s => ({ ...s, id: ids.get(s.id), text: s.excerpts.join('\n\n'), captureType: 'excerpts', provenance: 'imported' })),
      claims: c.claims.map(x => ({ ...x, id: crypto.randomUUID(), reviewed: false, citations: x.citations.map(q => ({ ...q, sourceId: ids.get(q.sourceId) ?? q.sourceId })) })), notes: [] })
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Invalid capsule.' } }
}
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
export function renderCapsuleHtml(capsule: ResearchCapsule): string {
  const checked = validateCapsule(capsule); if (!checked.ok) throw Error(checked.error)
  const imported = importResearchCapsule(JSON.stringify(checked.value)); if (!imported.ok) throw Error(imported.error)
  const p = imported.value
  // Restore explicit author review for display; importing into a workspace always resets it.
  p.claims.forEach((c, i) => { c.reviewed = capsule.claims[i].reviewed })
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(capsule.title)}</title><style>body{font:16px/1.7 system-ui;color:#18283b;background:#f3f6fa;max-width:850px;margin:40px auto;padding:20px}article,section{background:white;border:1px solid #d6e0ec;border-radius:16px;padding:24px;margin:20px 0}h1{line-height:1.2}blockquote{border-left:3px solid #12818f;padding-left:18px;white-space:pre-wrap;overflow-wrap:anywhere}a{color:#086978}small{color:#536477}details{margin-top:16px}summary{cursor:pointer}p{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><small>AIHub · Research capsule · ${escapeHtml(capsule.exportedAt)}</small><h1>${escapeHtml(capsule.title)}</h1><p>${escapeHtml(capsule.question)}</p><p>Shared excerpts only. Quote matching is not fact verification. Review original sources before relying on findings.</p>${p.claims.map(c => `<article><small>${claimNeedsReview(p, c) ? 'Needs review' : 'Author reviewed · excerpt matched'}${c.kind === 'suggested-disagreement' ? ' · Suggested disagreement' : ''}</small><p>${escapeHtml(c.text)}</p>${c.citations.map(q => { const s = p.sources.find(s => s.id === q.sourceId); return `<details><summary>${escapeHtml(s?.title ?? 'Unavailable source')} · ${s && matchCitation(s, q) ? 'Excerpt matched' : 'Unmatched quote'}</summary><blockquote>${escapeHtml(q.quote)}</blockquote></details>` }).join('')}</article>`).join('')}<section><h2>Sources</h2>${capsule.sources.map(s => `<p>${s.url ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title)}</a>` : escapeHtml(s.title)}<br><small>Captured ${escapeHtml(s.capturedAt)} · shared excerpts${s.truncated ? ' · original capture truncated' : ''}</small></p>`).join('')}</section></body></html>`
}
