import { RESEARCH_LIMITS as L, type ResearchResult, type ResearchProject, type ResearchCapsule, type ResearchClaim, type CapturedSource, type ResearchMode } from './types'
import { normalizeEvidence } from './evidence'
export function safeResearchUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password } catch { return false }
}
const record = (v: any) => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('Invalid research object.'); return v }
const str = (v: any, max: number, empty = false): string => { if (typeof v !== 'string' || v.length > max || (!empty && !v.trim())) throw Error('Invalid or oversized research text.'); return v }
const id = (v: any) => { const s = str(v, 100); if (!/^[a-zA-Z0-9_-]+$/.test(s)) throw Error('Invalid identifier.'); return s }
const date = (v: any) => { const s = str(v, 32); if (!/^\d{4}-\d{2}-\d{2}T/.test(s) || !Number.isFinite(Date.parse(s))) throw Error('Invalid capture date.'); return s }
const bool = (v: any): boolean => { if (typeof v !== 'boolean') throw Error('Invalid research flag.'); return v }
const array = (v: any, max: number): any[] => { if (!Array.isArray(v) || v.length > max) throw Error('Research limit exceeded.'); return v }
const mode = (v: any): ResearchMode => { if (!['summary', 'compare', 'bibliography'].includes(v)) throw Error('Invalid report mode.'); return v }
const unique = (items: { id: string }[]) => { if (new Set(items.map(s => s.id)).size !== items.length) throw Error('Duplicate research identifiers.') }
function claims(value: any): ResearchClaim[] {
  const items = array(value, L.claims).map(v => { const c = record(v)
    if (!['finding', 'suggested-disagreement'].includes(c.kind)) throw Error('Invalid finding type.')
    return { id: id(c.id), text: str(c.text, L.claimChars), reviewed: bool(c.reviewed), kind: c.kind, citations: array(c.citations, 20).map(v => { const x = record(v); return { sourceId: id(x.sourceId), quote: str(x.quote, L.quoteChars) } }) }
  }); unique(items); return items
}
function source(value: any): CapturedSource {
  const s = record(value)
  if (!['captured', 'imported'].includes(s.provenance) || !['page', 'transcript', 'excerpts'].includes(s.captureType)) throw Error('Invalid evidence provenance.')
  if (s.url !== undefined && !safeResearchUrl(s.url)) throw Error('Unsafe source URL.')
  if (s.provenance === 'captured' && (!s.url || s.captureType === 'excerpts')) throw Error('Captured sources require an original web URL.')
  if (s.provenance === 'imported' && s.captureType !== 'excerpts') throw Error('Imported sources contain shared excerpts only.')
  const text = str(s.text, L.sourceChars, s.provenance === 'imported')
  const excerpts = s.provenance === 'imported' ? array(s.excerpts, L.claims).map(v => str(v, L.quoteChars)) : undefined
  if (excerpts && normalizeEvidence(excerpts.join('\n\n')) !== normalizeEvidence(text)) throw Error('Imported evidence does not match its excerpts.')
  return { id: id(s.id), title: str(s.title, L.titleChars), ...(s.url !== undefined ? { url: s.url } : {}), capturedAt: date(s.capturedAt), text, truncated: bool(s.truncated), captureType: s.captureType, provenance: s.provenance, ...(excerpts ? { excerpts } : {}) }
}
function bounded(value: unknown) { if (new TextEncoder().encode(JSON.stringify(value)).length > L.importBytes) throw Error('Research data exceeds 5 MB.') }
export function validateProject(value: unknown): ResearchResult<ResearchProject> {
  try {
    bounded(value); const p = record(value)
    if (p.schemaVersion !== 1) throw Error('Unsupported research version.')
    const sources = array(p.sources, L.sources).map(source); unique(sources)
    const notes = array(p.notes, L.notes).map(v => { const n = record(v); return { id: id(n.id), text: str(n.text, L.noteChars), createdAt: date(n.createdAt) } }); unique(notes)
    return { ok: true, value: { schemaVersion: 1, id: id(p.id), title: str(p.title, L.titleChars), question: str(p.question, L.questionChars, true), createdAt: date(p.createdAt), updatedAt: date(p.updatedAt), mode: mode(p.mode), sources, claims: claims(p.claims), notes } }
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Invalid research project.' } }
}
export function validateCapsule(value: unknown): ResearchResult<ResearchCapsule> {
  try {
    bounded(value); const p = record(value)
    if (p.schemaVersion !== 1 || p.kind !== 'aihub-research-capsule') throw Error('Unsupported capsule format.')
    const sources = array(p.sources, L.sources).map(v => { const s = record(v)
      if (s.url !== undefined && !safeResearchUrl(s.url)) throw Error('Unsafe source URL.')
      const excerpts = array(s.excerpts, L.claims).map(v => str(v, L.quoteChars))
      if (excerpts.join('\n\n').length > L.sourceChars) throw Error('Shared source excerpts exceed the limit.')
      return { id: id(s.id), title: str(s.title, L.titleChars), ...(s.url !== undefined ? { url: s.url } : {}), capturedAt: date(s.capturedAt), excerpts, truncated: bool(s.truncated) }
    }); unique(sources)
    return { ok: true, value: { schemaVersion: 1, kind: 'aihub-research-capsule', title: str(p.title, L.titleChars), question: str(p.question, L.questionChars, true), mode: mode(p.mode), exportedAt: date(p.exportedAt), sources, claims: claims(p.claims) } }
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Invalid research capsule.' } }
}
