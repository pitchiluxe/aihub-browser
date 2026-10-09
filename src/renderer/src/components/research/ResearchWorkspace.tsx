import React, { useEffect, useRef, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { useBrowserStore } from '../../store/browserStore'
import { IS_INCOGNITO } from '../../services/incognitoMode'
import { createResearchRunGuard, generateResearchClaims } from '../../services/researchGeneration'
import { RESEARCH_LIMITS as L, type ResearchBridge, type ResearchProject, type Citation, type CapturedSource, type ResearchCapsule } from '../../../../shared/research/types'
import { safeResearchUrl } from '../../../../shared/research/validation'
import { importResearchCapsule, renderCapsuleHtml } from '../../../../shared/research/capsule'
import ResearchReport from './ResearchReport'
import EvidenceDrawer from './EvidenceDrawer'
import ResearchDialog from './ResearchDialog'
import CapsulePreview from './CapsulePreview'
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
  const current = useRef<ResearchProject | null>(null), revision = useRef(0), mounted = useRef(true), queue = useRef(Promise.resolve()), guard = useRef(createResearchRunGuard())
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
                if (p.notes.length) { const saved = await bridge().save(p); if (!saved.ok) throw Error(saved.error); items = [saved.value, ...items] }
              }
              localStorage.setItem('aihub-research-migrated-v1', 'true')
            } catch { setError('Previous notes could not be imported. The original notes are preserved.') }
          }
        }
        if (mounted.current) { setProjects(items); setActive(items[0]?.id ?? '') }
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
      try { const result = await bridge().save(updated); if (!result.ok) throw Error(result.error); if (mounted.current) setStatus('Saved') }
      catch (e) { if (mounted.current) { setStatus('Not saved — retry Save project'); setError(e instanceof Error ? e.message : 'Save failed.') } }
    }); return queue.current
  }
  const edit = (next: ResearchProject) => { invalidate(); void persist(next) }
  const choose = (id: string) => { invalidate(); setActive(id); setSelected([]); setDraft(''); setEvidence(null); setExporting(false); setError('') }
  const create = async () => { if (projects.length >= L.projects) return; const next = newProject(); choose(next.id); await persist(next) }
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
  return <div className="research-workspace">
    <header className="research-header"><div className="research-heading"><FlaskConical size={24} /><div><h1>Research workspace</h1><p>Find the evidence. Keep the insight.</p></div></div><div className="research-actions"><label className="research-file" tabIndex={0} role="button" onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.querySelector<HTMLInputElement>('input')?.click() } }}>Import JSON<input type="file" accept=".json,application/json" onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; if (file.size > L.importBytes) { setError('Capsules must be smaller than 5 MB.'); return } try { const result = importResearchCapsule(await file.text()); if (result.ok) setImported(result.value); else setError(result.error) } catch { setError('Could not read this capsule.') } }} /></label><button disabled={loading || projects.length >= L.projects} onClick={create}>New project</button></div></header>
    {IS_INCOGNITO && <p className="research-private">Private research stays in this window until it closes. Files you export remain on your computer.</p>}<div aria-live="polite" className="research-status">{status}</div>{error && <p role="alert" className="research-error">{error}</p>}
    <div className="research-grid"><aside className="research-sidebar"><h2>Projects <small>{projects.length}/{L.projects}</small></h2>{projects.map(p => <button className={active === p.id ? 'project active' : 'project'} key={p.id} onClick={() => choose(p.id)}>{p.title}</button>)}{loading && <p>Loading projects…</p>}{!loading && !projects.length && <p className="research-muted">Create a project to start collecting evidence.</p>}</aside>{project ? <><section className="research-editor">
      <label>Project name<input value={project.title} maxLength={L.titleChars} onChange={e => edit({ ...project, title: e.target.value })} /></label><label>Research question<textarea placeholder="What do you want to learn from these pages?" rows={3} value={project.question} maxLength={L.questionChars} onChange={e => edit({ ...project, question: e.target.value })} /></label><label>Report style<select value={project.mode} onChange={e => edit({ ...project, mode: e.target.value as ResearchProject['mode'] })}><option value="summary">Summary</option><option value="compare">Compare sources</option><option value="bibliography">Annotated bibliography</option></select></label>
      <div className="research-section-title"><h2>Choose open pages</h2><span>{project.sources.length}/{L.sources} captures</span></div><p className="research-muted">Only selected pages are captured. Each capture is a dated, immutable version.</p>
      {tabs.filter(t => !t.isHome && t.pageType === 'browser' && safeResearchUrl(t.url)).map(t => <label className="research-tab" key={t.id}><input type="checkbox" checked={selected.includes(t.id)} disabled={capturing || t.isLoading || t.asleep || (!selected.includes(t.id) && selected.length >= L.sources - project.sources.length)} onChange={() => setSelected(s => s.includes(t.id) ? s.filter(x => x !== t.id) : [...s, t.id])} /><span>{t.title || t.url}{t.asleep ? ' · Sleeping: open tab first' : t.isLoading ? ' · Loading' : ''}</span></label>)}
      <button disabled={!selected.length || capturing || project.sources.length >= L.sources} onClick={() => consent ? void capture() : setConsentDialog(true)}>{capturing ? 'Capturing…' : 'Capture selected'}</button><div className="research-url"><input aria-label="Source URL" placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} /><button disabled={!onNavigate} onClick={() => { if (!safeResearchUrl(url)) { setError('Enter a complete HTTP or HTTPS URL without credentials.'); return } openSource(url); setUrl(''); setStatus('Open the page, return here and select it for capture.') }}>Open page</button></div>
      {project.sources.map(s => <div className="research-source" key={s.id}><strong>{s.title}</strong><small>{new Date(s.capturedAt).toLocaleString()} · {s.provenance === 'imported' ? 'Shared excerpts only' : s.captureType}{s.truncated ? ' · Truncated' : ''}</small><button onClick={() => edit({ ...project, sources: project.sources.filter(x => x.id !== s.id), claims: project.claims.map(c => ({ ...c, reviewed: false })) })}>Remove capture</button></div>)}
      <h2>Your notes</h2>{project.notes.map(n => <div className="research-note" key={n.id}><p>{n.text}</p><button onClick={() => edit({ ...project, notes: project.notes.filter(x => x.id !== n.id) })}>Remove note</button></div>)}<textarea aria-label="New note" placeholder="Add your own thoughts…" value={draft} maxLength={L.noteChars} onChange={e => setDraft(e.target.value)} /><button disabled={!draft.trim() || project.notes.length >= L.notes} onClick={() => { edit({ ...project, notes: [...project.notes, { id: crypto.randomUUID(), text: draft.trim(), createdAt: new Date().toISOString() }] }); setDraft('') }}>Add note</button>
      <p className="research-muted">Generation uses {provider}. Selected passages and your notes may be sent to configured cloud providers, including fallback providers.</p><div className="research-actions"><button className="primary" disabled={generating || capturing || !project.sources.length} onClick={generate}>{generating ? 'Generating…' : 'Generate report'}</button>{generating && <button onClick={invalidate}>Cancel generation</button>}</div><div className="research-actions"><button onClick={() => persist(project)}>Save project</button><button onClick={() => setDeleting(true)}>Delete project</button></div>
    </section><main className="research-main"><div className="research-actions"><button onClick={markdown}>Save Markdown</button><button disabled={!project.claims.length} onClick={() => setExporting(true)}>Share capsule</button></div><ResearchReport project={project} onClaim={claim => edit({ ...project, claims: project.claims.map(c => c.id === claim.id ? claim : c) })} onEvidence={setEvidence} /></main></> : <div className="research-empty"><h2>Your next discovery starts here</h2><p>Create a project, collect pages, and keep a portable report with its evidence.</p></div>}</div>
    {consentDialog && <ResearchDialog title="Capture selected pages" onClose={() => setConsentDialog(false)}><p>AIHub will save readable text from only the pages you selected in this window. Form fields and editable drafts are excluded. Signed-in page text may still contain personal information.</p><p>Capturing does not call AI. Generate report sends saved passages and notes to {provider}; configured cloud fallback may also be used.</p><button onClick={() => setConsentDialog(false)}>Cancel</button><button className="primary" onClick={() => { setConsent(true); setConsentDialog(false); void capture() }}>Allow capture</button></ResearchDialog>}
    {project && evidence && <EvidenceDrawer source={project.sources.find(s => s.id === evidence.sourceId)} citation={evidence} onClose={() => setEvidence(null)} onNavigate={openSource} />}{project && exporting && <CapsulePreview project={project} privateWindow={IS_INCOGNITO} onClose={() => setExporting(false)} onExport={exportCapsule} />}
    {project && deleting && <ResearchDialog title="Delete research project" onClose={() => setDeleting(false)}><p>Delete {project.title} and its saved evidence?</p><button onClick={() => setDeleting(false)}>Cancel</button><button onClick={async () => { const id = project.id; invalidate(); await queue.current; const result = await bridge().remove(id); if (result.ok) { setProjects(items => items.filter(p => p.id !== id)); choose(''); setDeleting(false) } else setError(result.error) }}>Delete permanently</button></ResearchDialog>}
    {imported && <ResearchDialog title="Import research capsule" onClose={() => setImported(null)}><h3>{imported.title}</h3><p>{imported.question}</p><p>{imported.claims.length} findings · {imported.sources.length} sources. These are shared excerpts, not pages captured in this browser. All findings start unreviewed.</p><p className="research-muted">Import does not open links, contact AI, or load external content.</p><button onClick={() => setImported(null)}>Cancel</button><button disabled={projects.length >= L.projects} onClick={async () => { choose(imported.id); await persist(imported); setImported(null) }}>Import project</button></ResearchDialog>}
  </div>
}

