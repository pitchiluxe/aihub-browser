import React from 'react'
import type { CapturedSource, Citation } from '../../../../shared/research/types'
import { matchCitation, normalizeEvidence } from '../../../../shared/research/evidence'
import ResearchDialog from './ResearchDialog'
export default function EvidenceDrawer({ source, citation, onClose, onNavigate }: { source?: CapturedSource; citation: Citation; onClose: () => void; onNavigate?: (url: string) => void }) {
  const match = source && matchCitation(source, citation), text = source ? normalizeEvidence(source.text) : ''
  return <ResearchDialog title="Source evidence" onClose={onClose}><p>{source?.title ?? 'Source unavailable'}</p><p className="research-muted">{source ? `${source.provenance === 'imported' ? 'Imported shared excerpts' : source.captureType === 'transcript' ? 'Captured transcript' : 'Captured page'} · ${new Date(source.capturedAt).toLocaleString()}${source.truncated ? ' · Truncated' : ''}` : 'This citation has no source in the project.'}</p><p>{match ? 'Excerpt matched. This does not verify the finding.' : 'Unmatched quote — needs review.'}</p><blockquote>{citation.quote}</blockquote>{source && <pre className="research-evidence">{match ? <>{text.slice(0, match.start)}<mark>{text.slice(match.start, match.end)}</mark>{text.slice(match.end)}</> : text}</pre>}{source?.url && onNavigate && <button onClick={() => onNavigate(source.url!)}>Open original source</button>}<button onClick={onClose}>Close evidence</button></ResearchDialog>
}
