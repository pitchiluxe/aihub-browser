import React, { useState } from 'react'
import type { ResearchProject, CapturedSource } from '../../../../shared/research/types'
import type { MonitorPreview, ResearchMonitorBridge, IntervalHours } from '../../../../shared/research/monitorTypes'
import ResearchDialog from './ResearchDialog'

export default function ResearchMonitorSetup({ project, source, bridge, onClose, onCreated }: {
  project: ResearchProject; source: CapturedSource; bridge: ResearchMonitorBridge; onClose(): void; onCreated(): void
}) {
  const [preview, setPreview] = useState<MonitorPreview | null>(null)
  const [intervalHours, setIntervalHours] = useState<IntervalHours>(24)
  const [notifications, setNotifications] = useState(true)
  const [acceptMismatch, setAcceptMismatch] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const check = async () => {
    setBusy(true); setError('')
    try {
      const result = await bridge.preview({ projectId: project.id, sourceId: source.id, expectedUpdatedAt: project.updatedAt })
      if (!result.ok) throw Error(result.error)
      setPreview(result.value); setAcceptMismatch(false)
    } catch (e) { setError(e instanceof Error ? e.message : 'The public source could not be checked.') }
    finally { setBusy(false) }
  }
  const start = async () => {
    if (!preview || (preview.missingQuotes.length > 0 && !acceptMismatch)) return
    setBusy(true); setError('')
    try {
      const result = await bridge.confirm({ projectId: project.id, sourceId: source.id, expectedUpdatedAt: project.updatedAt, token: preview.token, intervalHours, notifications, acceptMismatch })
      if (!result.ok) throw Error(result.error)
      onCreated()
    } catch (e) { setError(e instanceof Error ? e.message : 'Monitoring could not start.') }
    finally { setBusy(false) }
  }
  return <ResearchDialog title="Keep this source current" onClose={onClose}>
    <p>AIHub will check this public HTTPS page while the app is open. It does not use website cookies or your signed-in session. The public copy may differ from the page you captured.</p>
    <p className="research-muted">Selected source: {source.url}</p>
    <label>Check frequency<select value={intervalHours} onChange={e => setIntervalHours(Number(e.target.value) as IntervalHours)}><option value={24}>Daily</option><option value={6}>Every six hours</option><option value={1}>Hourly</option></select></label>
    <label className="research-monitor-check"><input type="checkbox" checked={notifications} onChange={e => setNotifications(e.target.checked)} />Notify me when this source changes</label>
    {!preview && <button className="primary" disabled={busy} onClick={() => void check()}>{busy ? 'Checking public page…' : 'Preview public version'}</button>}
    {preview && <section className="research-monitor-preview"><h3>Public version preview</h3><p>{preview.observation.finalUrl}</p><p>{preview.observation.text.slice(0, 700)}{preview.observation.text.length > 700 ? '…' : ''}</p>{preview.observation.truncated && <p className="research-warning">The public text was truncated. Changes are compared only within the saved portion.</p>}
      {preview.missingQuotes.length > 0 && <><p className="research-warning"><strong>Public version differs.</strong> These saved passages are missing from the public page:</p>{preview.missingQuotes.map((quote, index) => <blockquote key={index}>{quote}</blockquote>)}<label className="research-monitor-check"><input type="checkbox" checked={acceptMismatch} onChange={e => setAcceptMismatch(e.target.checked)} />I reviewed these differences and want to monitor this public version</label></>}
      <div className="research-actions"><button disabled={busy} onClick={() => { setPreview(null); setAcceptMismatch(false) }}>Check again</button><button className="primary" disabled={busy || (preview.missingQuotes.length > 0 && !acceptMismatch)} onClick={() => void start()}>{busy ? 'Starting…' : 'Start monitoring'}</button></div>
    </section>}
    {error && <p role="alert" className="research-error">{error}</p>}
    <button onClick={onClose}>Cancel</button>
  </ResearchDialog>
}
