import React, { useRef, useState } from 'react'
import type { ResearchProject, ResearchClaim, Citation, CapturedSource } from '../../../../shared/research/types'
import type { MonitorProposal, ResearchMonitorBridge } from '../../../../shared/research/monitorTypes'
import { createResearchRunGuard, generateResearchClaims } from '../../services/researchGeneration'
import ResearchDialog from './ResearchDialog'
import ResearchReport from './ResearchReport'
import EvidenceDrawer from './EvidenceDrawer'

export default function ResearchUpdateProposal({ original, proposal, provider, bridge, ai, onClose, onAccepted }: {
  original: ResearchProject; proposal: MonitorProposal; provider: string; bridge: ResearchMonitorBridge
  ai: Parameters<typeof generateResearchClaims>[1]; onClose(): void; onAccepted(project: ResearchProject): void
}) {
  const [claims, setClaims] = useState<ResearchClaim[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [evidence, setEvidence] = useState<{ source?: CapturedSource; citation: Citation } | null>(null)
  const guard = useRef(createResearchRunGuard()), running = useRef(false)
  const generate = async () => {
    if (running.current) return
    running.current = true; setBusy(true); setError('')
    const run = guard.current.begin(proposal.project.id)
    const result = await generateResearchClaims(proposal.project, ai, run.signal)
    if (!guard.current.current(proposal.project.id, run.token)) return
    if (result.ok) setClaims(result.value); else setError(result.error)
    running.current = false; setBusy(false)
  }
  const close = () => { guard.current.cancel(); onClose() }
  const accept = async () => {
    setBusy(true); setError('')
    try {
      const result = await bridge.acceptProposal({ token: proposal.token, expectedUpdatedAt: original.updatedAt, claims })
      if (!result.ok) throw Error(result.error)
      onAccepted(result.value)
    } catch (e) { setError(e instanceof Error ? e.message : 'The updated report could not be saved.') }
    finally { setBusy(false) }
  }
  return <ResearchDialog title="Review updated report proposal" className="research-proposal-dialog" onClose={close}>
    <p>Current research stays saved as-is. This proposal uses the checked page versions shown below and will become a separate project if accepted.</p>
    <p className="research-muted">Generating sends the proposal&apos;s source passages and your saved notes to {provider}. Review claims and citations before accepting.</p>
    <div className="research-proposal-columns"><section><h3>Current report · {original.title}</h3><ResearchReport project={original} disabled={busy} onClaim={() => {}} onEvidence={citation => setEvidence({ citation, source: original.sources.find(source => source.id === citation.sourceId) })} onRemove={() => {}} /></section><section><h3>Updated evidence · {proposal.project.title}</h3>{proposal.project.sources.map(source => <article className="research-proposal-source" key={source.id}><strong>{source.title}</strong><small>{new Date(source.capturedAt).toLocaleString()} · {source.provenance === 'imported' ? 'Checked excerpt; not a browser capture' : source.captureType}</small><p>{source.text.slice(0, 1800)}{source.text.length > 1800 ? '…' : ''}</p></article>)}{claims.length ? <ResearchReport project={{ ...proposal.project, claims }} disabled={busy} onClaim={claim => setClaims(items => items.map(item => item.id === claim.id ? claim : item))} onEvidence={citation => setEvidence({ citation, source: proposal.project.sources.find(source => source.id === citation.sourceId) })} onRemove={id => setClaims(items => items.filter(item => item.id !== id))} /> : <p className="research-muted">Generate a draft to review its evidence-backed findings.</p>}</section></div>
    {error && <p role="alert" className="research-error">{error}</p>}
    <div className="research-actions"><button onClick={close}>Cancel</button><button disabled={busy} onClick={() => void generate()}>{busy ? 'Generating…' : claims.length ? 'Regenerate proposal' : 'Generate proposal'}</button><button className="primary" disabled={busy || !claims.length} onClick={() => void accept()}>Accept as new project</button></div>
    {evidence && <EvidenceDrawer source={evidence.source} citation={evidence.citation} onClose={() => setEvidence(null)} />}
  </ResearchDialog>
}
