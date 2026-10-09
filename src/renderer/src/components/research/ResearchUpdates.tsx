import React, { useState } from 'react'
import type { ResearchProject } from '../../../../shared/research/types'
import type { ResearchMonitor, ResearchMonitorBridge } from '../../../../shared/research/monitorTypes'
import ResearchDialog from './ResearchDialog'

export default function ResearchUpdates({ project, monitors, bridge, loading, error: loadError, onClose, onRefresh, onPrepareProposal }: {
  project: ResearchProject; monitors: ResearchMonitor[]; bridge: ResearchMonitorBridge; loading: boolean; error: string
  onClose(): void; onRefresh(): Promise<void>; onPrepareProposal(): void
}) {
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [removing, setRemoving] = useState<ResearchMonitor | null>(null)
  const perform = async (id: string, work: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(id); setError('')
    try { const result = await work(); if (!result.ok) throw Error(result.error || 'The update could not be saved.'); await onRefresh() }
    catch (e) { setError(e instanceof Error ? e.message : 'The update could not be saved.') }
    finally { setBusy('') }
  }
  return <ResearchDialog title="Research source updates" className="research-updates-dialog" onClose={onClose}>
    <p>Changes show what appeared in the public text. They do not prove that a saved finding is false.</p>
    {loading && <p className="research-muted">Loading source checks…</p>}
    {loadError && <p role="alert" className="research-error">{loadError}</p>}
    {!monitors.length && !loading && <p className="research-muted">No sources are being monitored in this project.</p>}
    {monitors.map(monitor => {
      const source = project.sources.find(s => s.id === monitor.sourceId)
      return <article className="research-monitor-card" key={monitor.id}>
        <div className="research-monitor-heading"><strong>{source?.title || 'Research source'}</strong><span className={monitor.status === 'active' ? 'research-monitor-active' : 'research-monitor-paused'}>{monitor.status === 'active' ? 'Checking while app is open' : 'Paused'}</span></div>
        <p className="research-muted">Last successful check {new Date(monitor.latest.checkedAt).toLocaleString()} · Next check {new Date(monitor.nextDueAt).toLocaleString()}{source?.truncated ? ' · Original capture was truncated' : ''}</p>
        {monitor.error && <p role="alert" className="research-error">{monitor.error}</p>}
        <div className="research-actions"><button disabled={!!busy} onClick={() => void perform(monitor.id, () => bridge.check({ projectId: project.id, monitorId: monitor.id }))}>{busy === monitor.id ? 'Checking…' : 'Check now'}</button><button disabled={!!busy} onClick={() => void perform(monitor.id, () => bridge.setPaused({ projectId: project.id, monitorId: monitor.id, paused: monitor.status === 'active' }))}>{monitor.status === 'active' ? 'Pause' : 'Resume'}</button><button disabled={!!busy} onClick={() => setRemoving(monitor)}>Stop monitoring</button></div>
        {!monitor.changes.length && <p className="research-muted">No public changes recorded.</p>}
        {monitor.changes.slice().reverse().map(change => <section className="research-monitor-change" key={change.id}>
          <h3>{change.acknowledged ? 'Change reviewed' : 'Source changed'} · {new Date(change.observedAt).toLocaleString()}</h3>
          {change.truncated && <p className="research-warning">Only the retained part of this page was compared.</p>}
          {change.passages.map((passage, index) => <div className="research-monitor-passages" key={index}><div><small>Before</small><p>{passage.before || 'No passage'}</p></div><div><small>After</small><p>{passage.after || 'No passage'}</p></div></div>)}
          {change.impacts.map((impact, index) => <div className="research-monitor-impact" key={index}><p>{impact.status === 'missing' ? 'Quoted passage missing from latest observation — review needed' : impact.status === 'present' ? 'Quote still present; surrounding source changed' : 'Original citation remains unmatched'}</p><blockquote>{impact.quote}</blockquote></div>)}
          {!change.acknowledged && <button disabled={!!busy} onClick={() => void perform(monitor.id, () => bridge.acknowledge({ projectId: project.id, monitorId: monitor.id, changeId: change.id }))}>Dismiss update</button>}
        </section>)}
      </article>
    })}
    <div className="research-actions"><button disabled={!monitors.some(m => m.changes.length)} onClick={onPrepareProposal}>Prepare updated report</button><button onClick={onClose}>Close</button></div>
    {error && <p role="alert" className="research-error">{error}</p>}
    {removing && <ResearchDialog title="Stop monitoring this source" onClose={() => setRemoving(null)}><p>Remove its baseline and saved update history? Your original capture and findings stay in the project.</p><button onClick={() => setRemoving(null)}>Keep monitoring</button><button onClick={() => void perform(removing.id, () => bridge.remove({ projectId: project.id, monitorId: removing.id })).then(() => setRemoving(null))}>Stop monitoring</button></ResearchDialog>}
  </ResearchDialog>
}
