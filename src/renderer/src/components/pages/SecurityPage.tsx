import React, { useCallback, useEffect, useState } from 'react'
import { Shield, ShieldAlert, ScanLine, Bot, RefreshCw, ExternalLink, FileSearch, FolderSearch, Loader2, Lock, ArrowUpRight } from 'lucide-react'
import type { AgentReport, SecuritySnapshot } from '../../../../shared/security'
import { IS_INCOGNITO } from '../../services/incognitoMode'
import { useBrowserStore } from '../../store/browserStore'

const button = 'inline-flex items-center justify-center gap-2 rounded-xl border border-aihub-border/50 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-aihub-accent/10 disabled:opacity-40 disabled:cursor-not-allowed'
export default function SecurityPage() {
  const [snapshot, setSnapshot] = useState<SecuritySnapshot | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [scanning, setScanning] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [question, setQuestion] = useState('Review my recent security findings and recommend what I should do next.')
  const [report, setReport] = useState<AgentReport | null>(null)
  const refresh = useCallback(async () => {
    try {
      const result = await window.electronAPI.security.snapshot()
      if (!result.ok) throw Error(result.error)
      setSnapshot(result.value)
    } catch (e) { setError(e instanceof Error ? e.message : 'Cannot read security status.') }
  }, [])
  useEffect(() => { void refresh(); const timer = setInterval(() => { void refresh() }, 15_000); return () => clearInterval(timer) }, [refresh])
  const scan = async (kind: 'file' | 'folder' | 'quick' | 'full') => {
    setError(''); setNotice(''); setScanning(kind)
    try {
      const result = await window.electronAPI.security.scan(kind)
      if (!result.ok) throw Error(result.error)
      const value = result.value
      if (!value?.cancelled) setNotice(value?.message || (value?.detected || value?.blocked ? 'Defender reported a detection or scanning error. Review Windows Security.' : 'Defender completed the scan. No new detections reported.'))
      await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Scan did not complete.') }
    finally { setScanning('') }
  }
  const analyze = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setAnalyzing(true); setReport(null)
    try {
      const result = await window.electronAPI.security.analyze(question)
      if (!result.ok) throw Error(result.error)
      setReport(result.value); await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Local security analysis is unavailable.') }
    finally { setAnalyzing(false) }
  }
  const openWindows = async () => {
    try { const r = await window.electronAPI.security.openWindows(); if (!r.ok) throw Error(r.error) }
    catch (e) { setError(e instanceof Error ? e.message : 'Cannot open Windows Security.') }
  }
  const protection = snapshot?.defender
  const active = protection?.active && protection.realTime
  const warnings = snapshot?.events.filter(e => e.severity !== 'info').length || 0
  return (
    <div className="h-full overflow-y-auto bg-aihub-bg text-aihub-text">
      <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-emerald-400 mb-3"><Shield size={14} /> AIHub Protection</div>
            <h1 className="text-3xl font-semibold tracking-tight">Security Center</h1>
            <p className="text-sm text-aihub-muted mt-2">Device protection. Browser evidence. A local AI second opinion.</p>
          </div>
          <button className={button} onClick={() => { setError(''); void refresh() }}><RefreshCw size={14} /> Refresh</button>
        </header>
        {IS_INCOGNITO && <p role="note" className="text-sm text-violet-300 rounded-xl bg-violet-500/10 p-4">Private security findings stay in memory for this window. Defender scans and Windows protection history are managed by Windows.</p>}
        {error && <div role="alert" className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">{error}</div>}
        {notice && <div role="status" className="p-4 rounded-xl bg-aihub-card border border-aihub-border/40 text-sm">{notice}</div>}

        <section className="grid gap-4 md:grid-cols-3" aria-label="Protection overview">
          <div className="rounded-2xl border border-aihub-border/40 bg-aihub-card/70 p-5">
            <Shield size={22} className={active ? 'text-emerald-400' : 'text-amber-400'} />
            <h2 className="font-semibold mt-4">{!protection ? 'Checking Defender…' : active ? 'Defender protection active' : protection.available ? 'Protection needs attention' : 'Defender unavailable'}</h2>
            <p className="mt-2 text-xs leading-relaxed text-aihub-muted">{protection?.message || (protection ? `Mode: ${protection.mode}. Real-time protection ${protection.realTime ? 'on' : 'off'}.` : 'Reading Windows protection status.')}</p>
            {protection?.signaturesUpdated && <p className="text-xs text-aihub-muted mt-2">Intelligence updated {new Date(protection.signaturesUpdated).toLocaleString()}</p>}
          </div>
          <div className="rounded-2xl border border-aihub-border/40 bg-aihub-card/70 p-5">
            <FileSearch size={22} className="text-sky-400" /><h2 className="font-semibold mt-4">Download Guardian</h2>
            <p className="mt-2 text-xs leading-relaxed text-aihub-muted">Completed downloads are queued for Defender. Detections block opening; unavailable scans require your decision. Changed files are scanned again.</p>
            <button className="text-xs text-sky-300 flex gap-1 items-center mt-3" onClick={() => useBrowserStore.getState().focusOrOpenPage('aihub://downloads', 'downloads')}>View downloads <ArrowUpRight size={12} /></button>
          </div>
          <div className="rounded-2xl border border-aihub-border/40 bg-aihub-card/70 p-5">
            <ShieldAlert size={22} className="text-amber-400" /><h2 className="font-semibold mt-4">{warnings} recorded warnings</h2>
            <p className="mt-2 text-xs leading-relaxed text-aihub-muted">Phishing indicators and local HTML checks are evidence to review. They do not establish that a page or file is safe. Past warnings remain in the timeline.</p>
          </div>
        </section>

        <section className="rounded-2xl border border-aihub-border/40 p-5 space-y-4" aria-label="Defender scans">
          <div className="flex items-center gap-2"><ScanLine size={18} className="text-emerald-400" /><h2 className="font-semibold">Run a Defender scan</h2></div>
          <p className="text-xs text-aihub-muted">File and folder scans inspect excluded items and report results without applying remediation. Quick and full scans follow Windows policy. AIHub never disables protection or adds exclusions.</p>
          <div className="flex flex-wrap gap-2">
            {(['quick', 'full', 'file', 'folder'] as const).map(kind => <button key={kind} className={button} disabled={!!scanning || snapshot?.busy || !protection?.active} onClick={() => { void scan(kind) }}>{kind === 'folder' ? <FolderSearch size={15} /> : <ScanLine size={15} />}{kind[0].toUpperCase() + kind.slice(1)} scan</button>)}
            <button className={button} onClick={() => { void openWindows() }}>Windows Security <ExternalLink size={14} /></button>
          </div>
          {(scanning || snapshot?.busy) && <p role="status" className="flex items-center gap-2 text-sm text-emerald-300"><Loader2 size={14} className="animate-spin" />{scanning ? `${scanning[0].toUpperCase() + scanning.slice(1)} scan requested. Waiting for Defender…` : 'Defender has scans queued or running…'}</p>}
        </section>

        <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.03] p-5 space-y-4" aria-label="Local security analyst">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold flex items-center gap-2"><Bot size={19} className="text-emerald-400" /> Local Security Analyst</h2><span className="text-xs text-aihub-muted flex items-center gap-1"><Lock size={12} /> Ollama · {snapshot?.model || 'Choose a local model in Settings'}</span></div>
          <p className="text-xs text-aihub-muted leading-relaxed">Reviews Defender status and recent findings on your computer. No cloud fallback. The analyst explains evidence and recommends next steps; scan controls above perform the actions.</p>
          <form onSubmit={analyze} className="flex flex-col sm:flex-row gap-2">
            <textarea aria-label="Ask the security analyst" value={question} onChange={e => setQuestion(e.target.value)} maxLength={1000} rows={2} className="flex-1 rounded-xl border border-aihub-border/50 bg-aihub-bg px-4 py-3 text-sm resize-none focus:outline-none focus:border-emerald-400/50" />
            <button type="submit" className={`${button} bg-emerald-500/15 text-emerald-300`} disabled={analyzing || !question.trim()}>{analyzing ? <Loader2 size={15} className="animate-spin" /> : <Bot size={15} />}{analyzing ? 'Reviewing…' : 'Review evidence'}</button>
          </form>
          {report && <div className="border-t border-emerald-500/20 pt-4 text-sm space-y-3"><p className="whitespace-pre-wrap">{report.summary}</p><ul className="list-disc pl-5 space-y-2 text-aihub-muted">{report.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ul><p className="text-xs text-aihub-muted">AI interpretation · verify recommendations against the evidence below. No action was executed.</p></div>}
        </section>

        <section aria-label="Security timeline">
          <div className="flex justify-between items-center mb-3"><h2 className="font-semibold">Security timeline</h2><span className="text-xs text-aihub-muted">Latest 200 events</span></div>
          {!snapshot ? <p className="text-sm text-aihub-muted">Loading security evidence…</p> : !snapshot.events.length ? <div className="rounded-2xl border border-aihub-border/40 p-8 text-sm text-aihub-muted">No findings recorded yet. Download scans, suspicious-page indicators, and local HTML warnings will appear here.</div> : <div className="space-y-2">{snapshot.events.map(event => <article key={event.id} className="rounded-xl border border-aihub-border/40 bg-aihub-card/50 p-4 flex gap-3">
            <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${event.severity === 'high' ? 'bg-red-400' : event.severity === 'warning' ? 'bg-amber-400' : 'bg-emerald-400'}`} />
            <div className="min-w-0 flex-1"><div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-medium break-all">{event.title}</h3><time className="text-xs text-aihub-muted">{new Date(event.at).toLocaleString()}</time></div><p className="text-xs text-aihub-muted mt-1 leading-relaxed break-words">{event.detail}</p>{event.findings?.map(f => <p key={f.code} className="text-xs text-aihub-muted mt-2"><strong>{f.title}:</strong> {f.detail}</p>)}</div>
          </article>)}</div>}
        </section>
      </div>
    </div>
  )
}
