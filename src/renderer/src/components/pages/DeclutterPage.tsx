import React, { useMemo, useState } from 'react'
import { Eye, EyeOff, Globe2, RotateCcw, Trash2, WandSparkles } from 'lucide-react'
import { useBrowserStore } from '../../store/browserStore'
import { buildDeclutterStyleScript, loadDeclutterRules, normalizeOrigin, normalizeSelectors, saveDeclutterRules, selectorsForOrigin, type DeclutterRule } from '../../extensions/declutterRules'

function applyToOrigin(origin: string, selectors: string[]) {
  const { tabs, tabWcIds } = useBrowserStore.getState()
  const script = buildDeclutterStyleScript(selectors)
  tabs.forEach(tab => {
    if (tab.pageType !== 'browser' || tab.isHome || tab.asleep || normalizeOrigin(tab.url) !== origin) return
    const wcId = tabWcIds[tab.id]
    if (wcId != null) void window.electronAPI?.webview?.execScript?.(wcId, script)?.catch?.(() => {})
  })
}

export default function DeclutterPage() {
  const [rules, setRules] = useState<DeclutterRule[]>(() => loadDeclutterRules())
  const tabs = useBrowserStore(s => s.tabs)
  const tabWcIds = useBrowserStore(s => s.tabWcIds)
  const origins = useMemo(() => Array.from(new Set(tabs
    .filter(tab => tab.pageType === 'browser' && !tab.isHome && !tab.asleep && tabWcIds[tab.id] != null)
    .map(tab => normalizeOrigin(tab.url)).filter((origin): origin is string => !!origin))), [tabs, tabWcIds])
  const [origin, setOrigin] = useState('')
  const selectedOrigin = origins.includes(origin) ? origin : origins[0] || ''
  const existing = rules.find(rule => rule.origin === selectedOrigin)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const persist = (next: DeclutterRule[]) => {
    if (!saveDeclutterRules(next)) { setError('Could not save this rule in local browser storage.'); return false }
    setRules(next)
    return true
  }

  const preview = () => {
    setError(''); setMessage('')
    if (!selectedOrigin || !origins.includes(selectedOrigin)) { setError('Open a website tab to preview a cleanup rule.'); return }
    const parsed = normalizeSelectors(draft.split(/\r?\n/))
    if (!parsed.ok) { setError(parsed.error); return }
    applyToOrigin(selectedOrigin, parsed.selectors)
    const rule: DeclutterRule = { id: existing?.id || `declutter-${Date.now()}`, origin: selectedOrigin, selectors: parsed.selectors, enabled: true, updatedAt: Date.now() }
    const next = [...rules.filter(item => item.origin !== selectedOrigin), rule]
    if (persist(next)) setMessage('Preview applied to open tabs for this site.')
  }

  const toggle = (rule: DeclutterRule) => {
    const updated = { ...rule, enabled: !rule.enabled, updatedAt: Date.now() }
    const next = rules.map(item => item.id === rule.id ? updated : item)
    if (persist(next)) applyToOrigin(rule.origin, updated.enabled ? selectorsForOrigin(rule.origin, next) : [])
  }

  const remove = (rule: DeclutterRule) => {
    const next = rules.filter(item => item.id !== rule.id)
    if (persist(next)) applyToOrigin(rule.origin, selectorsForOrigin(rule.origin, next))
  }

  return <div className="h-full overflow-y-auto px-6 py-7" style={{ color: 'rgb(var(--ds-text-2))' }}>
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-2"><div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(34,211,238,.14)', color: '#67e8f9' }}><WandSparkles size={20} /></div><div><h1 className="text-xl font-semibold">Site Declutter</h1><p className="text-xs" style={{ color: 'rgb(var(--ds-text-4))' }}>Hide distracting page elements with private, local rules.</p></div></div>
      <div className="rounded-2xl p-5 mt-6" style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)' }}>
        <label className="text-xs font-semibold block mb-2">Website tab</label>
        <div className="relative mb-4"><Globe2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgb(var(--ds-text-4))' }} /><select aria-label="Website tab" value={selectedOrigin} onChange={e => setOrigin(e.target.value)} className="w-full pl-9 pr-3 py-2 rounded-xl text-sm outline-none" style={{ color: 'rgb(var(--ds-text-2))', background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)' }}><option value="">No open website tab</option>{origins.map(item => <option key={item} value={item}>{item}</option>)}</select></div>
        <label htmlFor="declutter-selectors" className="text-xs font-semibold block mb-2">CSS selectors <span className="font-normal" style={{ color: 'rgb(var(--ds-text-4))' }}>one per line, e.g. .sidebar</span></label>
        <textarea id="declutter-selectors" value={draft || existing?.selectors.join('\n') || ''} onChange={e => { setDraft(e.target.value); setError(''); setMessage('') }} placeholder={'.sidebar\n[aria-label="advertisement"]'} rows={6} maxLength={9000} className="w-full px-3 py-2 rounded-xl text-sm font-mono outline-none resize-y" style={{ color: 'rgb(var(--ds-text-2))', background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)' }} />
        <div className="flex items-center gap-3 mt-3"><button type="button" onClick={preview} disabled={!selectedOrigin} className="px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-40" style={{ background: 'rgba(34,211,238,.16)', color: '#67e8f9', border: '1px solid rgba(34,211,238,.3)' }}><span className="flex items-center gap-2"><Eye size={14} /> Preview & save</span></button>{existing && <button type="button" onClick={() => { applyToOrigin(existing.origin, []); setMessage('AIHub cleanup styles removed from open matching tabs.') }} className="px-3 py-2 rounded-xl text-xs flex items-center gap-2" style={{ background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)' }}><RotateCcw size={13} /> Restore page</button>}{error && <span role="alert" className="text-xs text-red-400">{error}</span>}{message && <span role="status" className="text-xs" style={{ color: '#67e8f9' }}>{message}</span>}</div>
      </div>
      <section className="mt-7"><h2 className="text-sm font-semibold mb-3">Saved site rules</h2>{rules.length === 0 ? <p className="text-xs" style={{ color: 'rgb(var(--ds-text-4))' }}>No rules saved yet. Choose an open site and preview a selector to begin.</p> : <div className="grid gap-2">{rules.map(rule => <article key={rule.id} className="rounded-xl p-3 flex items-center gap-3" style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)' }}><Globe2 size={15} style={{ color: '#67e8f9' }} /><div className="min-w-0 flex-1"><div className="text-xs font-semibold truncate">{rule.origin}</div><div className="text-[11px] truncate mt-1" style={{ color: 'rgb(var(--ds-text-4))' }}>{rule.selectors.join(', ')}</div></div><button type="button" aria-label={rule.enabled ? `Pause ${rule.origin}` : `Enable ${rule.origin}`} onClick={() => toggle(rule)} className="p-2 rounded-lg" title={rule.enabled ? 'Pause rule' : 'Enable rule'} style={{ color: 'rgb(var(--ds-text-3))' }}>{rule.enabled ? <EyeOff size={15} /> : <Eye size={15} />}</button><button type="button" aria-label={`Delete ${rule.origin}`} onClick={() => remove(rule)} className="p-2 rounded-lg" title="Delete rule" style={{ color: '#fb7185' }}><Trash2 size={15} /></button></article>)}</div>}</section>
      <p className="mt-6 text-[11px]" style={{ color: 'rgb(var(--ds-text-4))' }}>Rules are stored on this device, scoped to the exact site origin, and do not send page content anywhere.</p>
    </div>
  </div>
}
