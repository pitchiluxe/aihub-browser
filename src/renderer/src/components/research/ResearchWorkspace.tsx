import React, { useEffect, useRef, useState } from 'react'
import { FlaskConical, FileText, Layers, Sparkles, Plus, Bell } from 'lucide-react'
import { useBrowserStore } from '../../store/browserStore'
import { IS_INCOGNITO } from '../../services/incognitoMode'
import { createResearchRunGuard, generateResearchClaims } from '../../services/researchGeneration'
import { RESEARCH_LIMITS as L, type ResearchBridge, type ResearchProject, type Citation, type CapturedSource, type ResearchCapsule } from '../../../../shared/research/types'
import type { MonitorComparison } from '../../../../shared/research/monitorTypes'
import { safeResearchUrl } from '../../../../shared/research/validation'
import { importResearchCapsule, renderCapsuleHtml } from '../../../../shared/research/capsule'
import ResearchReport from './ResearchReport'
import EvidenceDrawer from './EvidenceDrawer'
import ResearchDialog from './ResearchDialog'
import CapsulePreview from './CapsulePreview'
import LegacyResearchNotes, { loadLegacyResearchNotes } from './LegacyResearchNotes'
import ResearchNotepad from './ResearchNotepad'
import ResearchMonitorSetup from './ResearchMonitorSetup'
import ResearchUpdates from './ResearchUpdates'
import ResearchUpdateProposal from './ResearchUpdateProposal'
import { useResearchMonitors } from './useResearchMonitors'
import './research.css'
const newProject = (): ResearchProject => { const when = new Date().toISOString(); return { schemaVersion: 1, id: crypto.randomUUID(), title: 'Untitled research', question: '', createdAt: when, updatedAt: when, mode: 'summary', sources: [], claims: [], notes: [] } }
const bridge = (): ResearchBridge => window.electronAPI.research
export default function ResearchWorkspace({ onNavigate }: { onNavigate?: (url: string) => void }) {
  const tabs = useBrowserStore(s => s.tabs)
  const [projects, setProjects] = useState<ResearchProject[]>([]), [active, setActive] = useState(''), [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true), [generating, setGenerating] = useState(false), [capturing, setCapturing] = useState(false)
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [draft, setDraft] = useState(''), [url, setUrl] = useState('')
  const [consent, setConsent] = useState(false), [consentDialog, setConsentDialog] = useState(false), [exporting, setExporting] = useState(false), [deleting, setDeleting] = useState(false)
  const [evidence, setEvidence] = useState<Citation | null>(null), [imported, setImported] = useState<ResearchProject | null>(null), [provider, setProvider] = useState('your configured AI provider')
  const [legacyNotes] = useState(() => IS_INCOGNITO ? [] : loadLegacyResearchNotes()), [showLegacy, setShowLegacy] = useState(false)
  const versions = useRef(new Map<string, string>()), blocked = useRef(new Set<string>())
  const [conflicted, setConflicted] = useState(false)
  const current = useRef<ResearchProject | null>(null), revision = useRef(0), mounted = useRef(true), queue = useRef(Promise.resolve()), guard = useRef(createResearchRunGuard())
  const monitorBridge = window.electronAPI.research.monitors
  const { monitors, loading: monitorsLoading, error: monitorError, refresh: refreshMonitors } = useResearchMonitors(active, IS_INCOGNITO, monitorBridge)
  const [monitorSource, setMonitorSource] = useState<CapturedSource | null>(null), [showUpdates, setShowUpdates] = useState(false)
  const [loadedComparison, setLoadedComparison] = useState<{ source: CapturedSource; result: MonitorComparison } | null>(null)
  const [proposal, setProposal] = useState<import('../../../../shared/research/monitorTypes').MonitorProposal | null>(null)
  const matchingLoadedTab = (source: CapturedSource) => tabs.find(tab => {
    if (tab.pageType !== 'browser' || tab.isLoading || tab.asleep || !safeResearchUrl(tab.url) || !source.url) return false
    try { const open = new URL(tab.url), saved = new URL(source.url); return open.origin === saved.origin && open.pathname.replace(/\/$/, '') === saved.pathname.replace(/\/$/, '') && open.search === saved.search } catch { return false }
  })
  const openSource = (value: string) => { if (safeResearchUrl(value)) useBrowserStore.getState().addTab(value, 'browser') }
  const project = projects.find(p => p.id === active) ?? null; current.current = project
  const invalidate = () => { revision.current++; guard.current.cancel(); setGenerating(false); setCapturing(false) }
  useEffect(() => {
    mounted.current = true
    void (async () => {
      try {
        const result = await bridge().list(); if (!mounted.current) return; if (!result.ok) throw Error(result.error)
        let items = result.value
        if (!IS_INCOGNITO && !localStorage.getItem('aihub-research-migrated-v1')) {
          const raw = localStorage.getItem('aihub-research-notes-v1')
          if (raw && raw.length <= L.importBytes && items.length < L.projects) {
            try {
              const old: unknown = JSON.parse(raw)
              if (Array.isArray(old)) {
                const p = newProject(); p.title = 'Previous research · user notes'
                p.notes = old.filter(n => n && typeof n.text === 'string' && n.text.trim() && n.text.length <= L.noteChars).slice(0, L.notes).map(n => ({ id: crypto.randomUUID(), text: n.text, createdAt: p.createdAt }))
                if (p.notes.length) { const saved = await bridge().save(p, null); if (!saved.ok) throw Error(saved.error); items = [saved.value, ...items] }
                if (p.notes.length < old.length) setStatus('Some previous notes exceed project limits. All originals are available in Previous notepad.')
              }
              localStorage.setItem('aihub-research-migrated-v1', 'true')
            } catch { setError('Previous notes could not be imported. The original notes are preserved.') }
          }
        }
        if (mounted.current) { const requested = bridge().monitors?.consumeOpenProject?.() ?? null; versions.current = new Map(items.map(p => [p.id, p.updatedAt])); setProjects(items); setActive(items.some(p => p.id === requested) ? requested! : items[0]?.id ?? '') }
      } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Research could not load.') }
      finally { if (mounted.current) setLoading(false) }
    })()
    window.electronAPI.settings?.getAIConfig?.().then((c: any) => { if (mounted.current) setProvider(c.primaryProvider === 'openrouter' ? 'OpenRouter (cloud)' : `Ollama${c.fallbackProvider === 'openrouter' ? ' with OpenRouter cloud fallback' : ''}`) }).catch(() => {})
    return () => { mounted.current = false; guard.current.cancel(); revision.current++ }
  }, [])
  const persist = (next: ResearchProject) => {
    const updated = { ...next, updatedAt: new Date().toISOString() }; current.current = updated
    setProjects(items => [updated, ...items.filter(p => p.id !== updated.id)]); setStatus('Saving…')
    queue.current = queue.current.then(async () => {
      try {
        if (blocked.current.has(updated.id)) return
        const result = await bridge().save(updated, versions.current.get(updated.id) ?? null)
        if (!result.ok) { if (result.error.includes('another window')) { blocked.current.add(updated.id); if (mounted.current) setConflicted(true) } throw Error(result.error) }
        versions.current.set(updated.id, result.value.updatedAt)
        if (mounted.current) { setProjects(items => items.map(p => p === updated ? result.value : p)); if (current.current === updated) current.current = result.value; setStatus('Saved') }
      } catch (e) { if (mounted.current) { setStatus('Not saved'); setError(e instanceof Error ? e.message : 'Save failed. Retry Save project.') } }
    }); return queue.current
  }
  const edit = (next: ResearchProject) => { invalidate(); void persist(next) }
  const choose = (id: string) => { invalidate(); setActive(id); setSelected([]); setDraft(''); setEvidence(null); setExporting(false); setMonitorSource(null); setProposal(null); setShowUpdates(false); setLoadedComparison(null); setError('') }
  const prepareProposal = async () => {
    if (!project || !monitorBridge) return
    const target = project, uiRevision = revision.current
    setError('')
    try { const result = await monitorBridge.prepareProposal({ projectId: target.id, expectedUpdatedAt: target.updatedAt }); if (!mounted.current || revision.current !== uiRevision || current.current?.id !== target.id || current.current?.updatedAt !== target.updatedAt) return; if (!result.ok) throw Error(result.error); setProposal(result.value); setShowUpdates(false) }
    catch (e) { if (mounted.current && revision.current === uiRevision && current.current?.id === target.id && current.current?.updatedAt === target.updatedAt) setError(e instanceof Error ? e.message : 'The updated report proposal could not be prepared.') }
  }
  useEffect(() => bridge().monitors?.onOpenProject?.(id => { if (projects.some(p => p.id === id)) choose(id) }), [projects])
  const checkLoaded = async (source: CapturedSource) => {
    if (!project || !bridge().monitors) { setError('Open the source in this window before checking its loaded page.'); return }
    const target = project, uiRevision = revision.current
    setError(''); setStatus('Checking the page already open in this window…')
    try {
      const tab = matchingLoadedTab(source)
      if (!tab) { setStatus(''); setError('Open the matching source page in a regular browser tab first.'); return }
      const result = await bridge().monitors.compareLoaded({ projectId: target.id, sourceId: source.id, expectedUpdatedAt: target.updatedAt, tabId: tab.id })
      if (!mounted.current || revision.current !== uiRevision || current.current?.id !== target.id || current.current?.updatedAt !== target.updatedAt) return
      if (!result.ok) { setStatus(''); setError(result.error); return }
      setStatus('Loaded page compared. Server freshness is not verified.')
      setLoadedComparison({ source, result: result.value })
    } catch (e) { if (mounted.current && revision.current === uiRevision && current.current?.id === target.id && current.current?.updatedAt === target.updatedAt) { setStatus(''); setError(e instanceof Error ? e.message : 'The loaded page could not be compared.') } }
  }
  const unacknowledged = monitors.reduce((count, monitor) => count + monitor.changes.filter(change => !change.acknowledged).length, 0)
  const create = async () => { if (projects.length >= L.projects) return; const next = newProject(); choose(next.id); await persist(next) }
  const reload = async () => { invalidate(); await queue.current; const result = await bridge().list(); if (!result.ok) { setError(result.error); return } versions.current = new Map(result.value.map(p => [p.id, p.updatedAt])); blocked.current.clear(); setProjects(result.value); choose(result.value[0]?.id ?? ''); setConflicted(false); setStatus('Loaded saved projects') }
  const capture = async () => {
    if (!current.current || capturing) return
    const original = current.current, ids = selected.filter(id => tabs.some(t => t.id === id && !t.isLoading && !t.asleep && safeResearchUrl(t.url))).slice(0, L.sources - original.sources.length); if (!ids.length) return
    invalidate(); const rev = revision.current; setCapturing(true); setError('')
    const sources: CapturedSource[] = [], errors: string[] = []
    try {
      for (let i = 0; i < ids.length; i += 2) {
        if (!mounted.current || revision.current !== rev || current.current?.id !== original.id) return
        const results = await Promise.all(ids.slice(i, i + 2).map(async id => { try { return await bridge().capture(id) } catch { return { ok: false as const, error: 'Capture failed.' } } }))
        results.forEach((r, index) => { if (r.ok) sources.push(r.value); else errors.push(`${tabs.find(t => t.id === ids[i + index])?.title ?? 'Page'}: ${r.error}`) })
      }
      if (!mounted.current || revision.current !== rev || current.current?.id !== original.id) return
      if (sources.length) await persist({ ...original, sources: [...original.sources, ...sources] })
      setSelected([]); if (errors.length) setError(errors.join('\n'))
    } finally { if (mounted.current && revision.current === rev) setCapturing(false) }
  }
  const generate = async () => {
    if (!current.current || generating || capturing) return
    const original = current.current, run = guard.current.begin(original.id); setGenerating(true); setError('')
    const result = await generateResearchClaims(original, window.electronAPI.ai, run.signal)
    if (!mounted.current || !guard.current.current(original.id, run.token)) return
    if (result.ok) await persist({ ...original, claims: result.value }); else setError(result.error)
    if (mounted.current && guard.current.current(original.id, run.token)) setGenerating(false)
  }
  const exportCapsule = async (capsule: ResearchCapsule) => {
    const result = await window.electronAPI.file.saveZip({ filename: 'research-capsule.zip', files: [{ path: 'index.html', content: renderCapsuleHtml(capsule) }, { path: 'project.aihub-research.json', content: JSON.stringify(capsule, null, 2) }] })
    if (result?.error) throw Error(result.error)
    if (result?.success || result?.ok) { setExporting(false); setStatus('Capsule exported') }
  }
  const markdown = () => { if (!project) return; void window.electronAPI.file.saveMd({ title: project.title, content: `# ${project.title}\n\n${project.question}\n\n${project.claims.map(c => `## ${c.reviewed ? 'Reviewed' : 'Needs review'}\n${c.text}\n${c.citations.map(q => `> ${q.quote}`).join('\n')}`).join('\n\n')}\n\n## Sources\n${project.sources.map(s => `${s.title}\n${s.url ?? 'URL omitted'}\nCaptured ${s.capturedAt}`).join('\n\n')}` }).catch(() => setError('Markdown export failed.')) }
  const backupDraft = async () => { if (!project) return; try { const result = await window.electronAPI.file.saveText({ filename: 'research-unsaved-draft.json', content: JSON.stringify(project, null, 2) }); if (result?.error) throw Error(result.error) } catch { setError('Could not export your unsaved draft. It is still available in this window.') } }
  return <div className="research-workspace">
    <header className="research-header"><div className="research-heading"><span className="research-brand-icon"><FlaskConical size={16} /></span><div><h1>Research workspace</h1><p>{project?.notes.length ?? 0} notes · {project?.sources.length ?? 0} sources · Evidence-backed research</p></div></div><div className="research-actions"><select aria-label="Active research project" className="research-project-select" value={active} onChange={e => choose(e.target.value)}><option value="">{loading ? 'Loading projects…' : 'Choose project'}</option>{projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select>{project && !IS_INCOGNITO && <button onClick={() => setShowUpdates(true)}><Bell size={12} />Updates {unacknowledged > 0 && <span className="research-badge">{unacknowledged}</span>}</button>}<label className="research-file" tabIndex={0} role="button" onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.querySelector<HTMLInputElement>('input')?.click() } }}>Import JSON<input type="file" accept=".json,application/json" onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; if (file.size > L.importBytes) { setError('Capsules must be smaller than 5 MB.'); return } try { const result = importResearchCapsule(await file.text()); if (result.ok) setImported(result.value); else setError(result.error) } catch { setError('Could not read this capsule.') } }} /></label><button disabled={loading || projects.length >= L.projects} onClick={create}><Plus size={12} />New project</button></div></header>
    {IS_INCOGNITO && <p className="research-private">Private research stays in this window until it closes. Files you export remain on your computer.</p>}<div aria-live="polite" className="research-status">{status}</div>{error && <p role="alert" className="research-error">{error}</p>}{conflicted && <div className="research-actions"><p>Export your current draft before reloading saved projects. This private backup includes captured text and your notes.</p><button onClick={backupDraft}>Export unsaved draft</button><button onClick={reload}>Reload saved projects</button></div>}
    <div className="research-grid"><ResearchNotepad project={project} draft={draft} onDraft={setDraft} onAdd={() => { if (!project) return; edit({ ...project, notes: [...project.notes, { id: crypto.randomUUID(), text: draft.trim(), createdAt: new Date().toISOString() }] }); setDraft('') }} onRemove={id => { if (project) edit({ ...project, notes: project.notes.filter(n => n.id !== id) }) }} legacy={legacyNotes.length ? <button className="research-legacy-button" onClick={() => setShowLegacy(true)}>Previous notepad</button> : undefined} />{project ? <><section className="research-editor"><div className="research-pane-title"><Layers size={13} /><h2>Research sources</h2><span>{projects.length}/{L.projects} projects</span></div>
      <label>Project name<input value={project.title} maxLength={L.titleChars} onChange={e => edit({ ...project, title: e.target.value })} /></label><label>Research question<textarea placeholder="What do you want to learn from these pages?" rows={3} value={project.question} maxLength={L.questionChars} onChange={e => edit({ ...project, question: e.target.value })} /></label><label>Report style<select className="research-mode-select" value={project.mode} onChange={e => edit({ ...project, mode: e.target.value as ResearchProject['mode'] })}><option value="summary">Summary</option><option value="compare">Compare sources</option><option value="bibliography">Annotated bibliography</option></select></label>
      <div className="research-section-title"><h2>Choose open pages</h2><span>{project.sources.length}/{L.sources} captures</span></div><p className="research-muted">Only selected pages are captured. Each capture is a dated, immutable version.</p>
      {tabs.filter(t => !t.isHome && t.pageType === 'browser' && safeResearchUrl(t.url)).map(t => <label className="research-tab" key={t.id}><input type="checkbox" checked={selected.includes(t.id)} disabled={capturing || t.isLoading || t.asleep || (!selected.includes(t.id) && selected.length >= L.sources - project.sources.length)} onChange={() => setSelected(s => s.includes(t.id) ? s.filter(x => x !== t.id) : [...s, t.id])} /><span>{t.title || t.url}{t.asleep ? ' · Sleeping: open tab first' : t.isLoading ? ' · Loading' : ''}</span></label>)}
      <button disabled={!selected.length || capturing || project.sources.length >= L.sources} onClick={() => consent ? void capture() : setConsentDialog(true)}>{capturing ? 'Capturing…' : 'Capture selected'}</button><div className="research-url"><input aria-label="Source URL" placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} /><button disabled={!onNavigate} onClick={() => { if (!safeResearchUrl(url)) { setError('Enter a complete HTTP or HTTPS URL without credentials.'); return } openSource(url); setUrl(''); setStatus('Open the page, return here and select it for capture.') }}>Open page</button></div>
      {project.sources.map(s => { const monitor = monitors.find(m => m.sourceId === s.id); return <div className="research-source" key={s.id}><strong>{s.title}</strong><small>{new Date(s.capturedAt).toLocaleString()} · {s.provenance === 'imported' ? s.title.startsWith('Public HTML observation:') || s.title.startsWith('Loaded page observation:') ? 'Updated observation excerpt' : 'Shared excerpts only' : s.captureType}{s.truncated ? ' · Truncated' : ''}</small>{monitor && <small>{monitor.status === 'active' ? 'Keep current · monitoring' : 'Keep current · paused'}</small>}{s.provenance === 'captured' && s.url && !IS_INCOGNITO && !monitor && <button disabled={!monitorBridge} onClick={() => setMonitorSource(s)}>Keep current</button>}{s.provenance === 'captured' && <button disabled={!matchingLoadedTab(s) || !monitorBridge} onClick={() => void checkLoaded(s)}>Check loaded page</button>}{monitor && <button onClick={() => setShowUpdates(true)}>View updates</button>}<button onClick={() => edit({ ...project, sources: project.sources.filter(x => x.id !== s.id), claims: project.claims.map(c => ({ ...c, reviewed: false })) })}>Remove capture</button></div> })}
      <p className="research-muted">Generation uses {provider}. Selected passages and your notes may be sent to configured cloud providers, including fallback providers.</p><div className="research-actions"><button className="primary" disabled={generating || capturing || !project.sources.length} onClick={generate}>{generating ? 'Generating…' : 'Generate report'}</button>{generating && <button onClick={invalidate}>Cancel generation</button>}</div><div className="research-actions"><button onClick={() => persist(project)}>Save project</button><button onClick={() => setDeleting(true)}>Delete project</button></div>
    </section><main className="research-main"><div className="research-pane-title"><FileText size={13} /><h2>Research report</h2></div><div className="research-actions"><button onClick={markdown}>Save Markdown</button><button disabled={!project.claims.length} onClick={() => setExporting(true)}><Sparkles size={12} />Share capsule</button></div><ResearchReport project={project} onClaim={claim => edit({ ...project, claims: project.claims.map(c => c.id === claim.id ? claim : c) })} onEvidence={setEvidence} onRemove={id => edit({ ...project, claims: project.claims.filter(c => c.id !== id) })} /></main></> : <div className="research-empty"><h2>Your next discovery starts here</h2><p>Create a project, collect pages, and keep a portable report with its evidence.</p></div>}</div>
    {consentDialog && <ResearchDialog title="Capture selected pages" onClose={() => setConsentDialog(false)}><p>AIHub will save readable text from only the pages you selected in this window. Form fields and editable drafts are excluded. Signed-in page text may still contain personal information.</p><p>Capturing does not call AI. Generate report sends saved passages and notes to {provider}; configured cloud fallback may also be used.</p><button onClick={() => setConsentDialog(false)}>Cancel</button><button className="primary" onClick={() => { setConsent(true); setConsentDialog(false); void capture() }}>Allow capture</button></ResearchDialog>}
    {project && evidence && <EvidenceDrawer source={project.sources.find(s => s.id === evidence.sourceId)} citation={evidence} onClose={() => setEvidence(null)} onNavigate={openSource} />}{project && exporting && <CapsulePreview project={project} privateWindow={IS_INCOGNITO} onClose={() => setExporting(false)} onExport={exportCapsule} />}
    {project && monitorSource && monitorBridge && <ResearchMonitorSetup project={project} source={monitorSource} bridge={monitorBridge} onClose={() => setMonitorSource(null)} onCreated={() => { setMonitorSource(null); void refreshMonitors(); setStatus('Source monitoring started') }} />}
    {project && showUpdates && monitorBridge && <ResearchUpdates project={project} monitors={monitors} bridge={monitorBridge} loading={monitorsLoading} error={monitorError} onClose={() => setShowUpdates(false)} onRefresh={refreshMonitors} onPrepareProposal={() => void prepareProposal()} />}
    {project && proposal && monitorBridge && <ResearchUpdateProposal original={project} proposal={proposal} provider={provider} bridge={monitorBridge} ai={window.electronAPI.ai} onClose={() => setProposal(null)} onAccepted={saved => { versions.current.set(saved.id, saved.updatedAt); setProjects(items => [saved, ...items]); setActive(saved.id); current.current = saved; setProposal(null); setStatus('Updated report saved as a new research project') }} />}
    {loadedComparison && <ResearchDialog title="Check loaded page" onClose={() => setLoadedComparison(null)}><p>This compares the open page in this window with your saved capture. It does not reload the page or verify the server&apos;s latest version.</p>{loadedComparison.result.truncated && <p className="research-warning">One of the compared captures is truncated.</p>}{!loadedComparison.result.passages.length && <p>No text changes found in the compared capture.</p>}{loadedComparison.result.passages.map((change, index) => <div className="research-monitor-passages" key={index}><div><small>Saved capture</small><p>{change.before || 'No passage'}</p></div><div><small>Loaded page</small><p>{change.after || 'No passage'}</p></div></div>)}{loadedComparison.result.impacts.map((impact, index) => <div className="research-monitor-impact" key={index}><p>{impact.status === 'missing' ? 'Quoted passage missing from the loaded page — review needed' : impact.status === 'present' ? 'Quote still present; surrounding page changed' : 'Original citation remains unmatched'}</p><blockquote>{impact.quote}</blockquote></div>)}<div className="research-actions">{IS_INCOGNITO && <button disabled={!monitorBridge} onClick={() => { setLoadedComparison(null); void prepareProposal() }}>Prepare private report proposal</button>}<button onClick={() => setLoadedComparison(null)}>Close</button></div></ResearchDialog>}
    {project && deleting && <ResearchDialog title="Delete research project" onClose={() => setDeleting(false)}><p>Delete {project.title} and its saved evidence?</p><button onClick={() => setDeleting(false)}>Cancel</button><button onClick={async () => { const id = project.id; invalidate(); await queue.current; const result = await bridge().remove(id); if (result.ok) { setProjects(items => items.filter(p => p.id !== id)); choose(''); setDeleting(false) } else setError(result.error) }}>Delete permanently</button></ResearchDialog>}
    {showLegacy && <LegacyResearchNotes notes={legacyNotes} onClose={() => setShowLegacy(false)} />}
    {imported && <ResearchDialog title="Import research capsule" onClose={() => setImported(null)}><h3>{imported.title}</h3><p>{imported.question}</p><p>{imported.claims.length} findings · {imported.sources.length} sources. These are shared excerpts, not pages captured in this browser. All findings start unreviewed.</p><p className="research-muted">Import does not open links, contact AI, or load external content.</p><button onClick={() => setImported(null)}>Cancel</button><button disabled={projects.length >= L.projects} onClick={async () => { choose(imported.id); await persist(imported); setImported(null) }}>Import project</button></ResearchDialog>}
  </div>
}
