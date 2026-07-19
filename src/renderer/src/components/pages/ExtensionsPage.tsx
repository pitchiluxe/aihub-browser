import React, { useState, useCallback, useEffect } from 'react'
import { Search, Plus, X, ChevronDown, ChevronUp, Trash2, Code2, Puzzle, Sparkles } from 'lucide-react'
import { EXTENSION_DEFS, ExtensionDef } from '../../extensions/extensionDefs'
import { CustomExt, loadCustomExts, saveCustomExts } from '../../extensions/customExts'
import { buildGenerationPrompt, parseGeneratedExtensions } from '../../services/extensionGenerator'
import { useBrowserStore } from '../../store/browserStore'

const CATEGORIES = ['All', 'Media', 'Privacy', 'Productivity', 'Accessibility', 'Developer', 'Reading'] as const

function execInAllTabs(script: string) {
  const { tabWcIds } = useBrowserStore.getState()
  Object.values(tabWcIds).forEach(wcId => {
    window.electronAPI?.webview?.execScript?.(wcId, script)?.catch?.(() => {})
  })
}

export default function ExtensionsPage() {
  const { extensionStates, setExtensionEnabled, setExtensionSettings } = useBrowserStore()

  const [search, setSearch]       = useState('')
  const [category, setCategory]   = useState<string>('All')
  const [expanded, setExpanded]   = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showGenerate, setShowGenerate] = useState(false)
  const [customExts, setCustomExts] = useState<CustomExt[]>(loadCustomExts)

  // The page stays mounted (App hides it with display:none), so re-read
  // storage on window focus to pick up changes made while it wasn't visible.
  useEffect(() => {
    const sync = () => setCustomExts(loadCustomExts())
    window.addEventListener('focus', sync)
    return () => window.removeEventListener('focus', sync)
  }, [])

  const allExts: Array<ExtensionDef | (CustomExt & { isCustom: true })> = [
    ...EXTENSION_DEFS,
    ...customExts.map(c => ({ ...c, isCustom: true as const })),
  ]

  const filtered = allExts.filter(ext => {
    const matchSearch = !search || ext.name.toLowerCase().includes(search.toLowerCase()) || ext.tagline.toLowerCase().includes(search.toLowerCase())
    const matchCat = category === 'All' || ext.category === category
    return matchSearch && matchCat
  })

  const activeCount = Object.values(extensionStates).filter(s => s.enabled).length

  const toggleExt = useCallback((ext: ExtensionDef | (CustomExt & { isCustom: true }), enabled: boolean) => {
    setExtensionEnabled(ext.id, enabled)
    if (enabled) {
      const settings = extensionStates[ext.id]?.settings || {}
      const script = 'isCustom' in ext
        ? ext.injectCode
        : ext.inject(settings)
      execInAllTabs(script)
    } else {
      const removeScript = 'isCustom' in ext ? ext.removeCode : ext.remove
      execInAllTabs(removeScript)
    }
  }, [extensionStates, setExtensionEnabled])

  const updateSetting = useCallback((extId: string, key: string, value: any) => {
    const ext = EXTENSION_DEFS.find(e => e.id === extId)
    if (!ext) return
    const newSettings = { ...(extensionStates[extId]?.settings || {}), [key]: value }
    setExtensionSettings(extId, newSettings)
    if (extensionStates[extId]?.enabled) {
      execInAllTabs(ext.remove)
      setTimeout(() => execInAllTabs(ext.inject(newSettings)), 60)
    }
  }, [extensionStates, setExtensionSettings])

  const deleteCustom = useCallback((id: string) => {
    execInAllTabs(`var e=document.getElementById('__ext_${id}');if(e)e.remove()`)
    setExtensionEnabled(id, false)
    const updated = customExts.filter(c => c.id !== id)
    setCustomExts(updated)
    saveCustomExts(updated)
  }, [customExts, setExtensionEnabled])

  return (
    <div className="h-full w-full overflow-y-auto" style={{ background: 'var(--ds-page-bg)', color: 'rgb(var(--ds-text-2))' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 px-6 pt-6 pb-4" style={{ background: 'var(--ds-page-header)', backdropFilter: 'blur(12px)' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#f59e0b,#d97706)', boxShadow: '0 0 20px rgba(245,158,11,0.3)' }}>
              <Puzzle size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Extensions</h1>
              <p className="text-xs" style={{ color: 'rgb(var(--ds-text-4))' }}>{activeCount} active · {allExts.length} installed</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowGenerate(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
              style={{ background: 'rgba(139,92,246,0.12)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.25)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(139,92,246,0.22)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(139,92,246,0.12)' }}
            >
              <Sparkles size={13} /> Generate with AI
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
              style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.2)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(245,158,11,0.2)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(245,158,11,0.12)' }}
            >
              <Plus size={13} /> Create Extension
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgb(var(--ds-text-4) / 0.75)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search extensions…"
            className="w-full pl-9 pr-4 py-2 rounded-xl text-sm outline-none"
            style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-2))' }}
          />
        </div>

        {/* Category filter */}
        <div className="flex gap-1.5 flex-wrap">
          {CATEGORIES.map(c => (
            <button key={c} onClick={() => setCategory(c)}
              className="px-3 py-1 rounded-lg text-xs font-medium transition-all"
              style={category === c
                ? { background: 'rgba(245,158,11,0.18)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.28)' }
                : { background: 'var(--ds-glass-sm)', color: 'rgb(var(--ds-text-4))', border: '1px solid var(--ds-border-sm)' }}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Extension grid */}
      <div className="px-6 pb-8 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))' }}>
        {filtered.map(ext => {
          const isCustom = 'isCustom' in ext
          const state = extensionStates[ext.id]
          const enabled = state?.enabled || false
          const isOpen = expanded === ext.id
          const builtIn = isCustom ? null : (ext as ExtensionDef)

          return (
            <div key={ext.id}
              className="rounded-2xl overflow-hidden transition-all"
              style={{ background: enabled ? 'var(--ds-glass-sm)' : 'var(--ds-glass-xs)', border: `1px solid ${enabled ? 'var(--ds-glass-lg)' : 'var(--ds-glass-sm)'}` }}>
              {/* Card header */}
              <div className="p-4">
                <div className="flex items-start gap-3">
                  {/* Icon — dark solid tile + strong border so the emoji reads
                      clearly instead of washing out into the card background */}
                  {(() => {
                    const accent = isCustom ? '#6366f1' : (ext as ExtensionDef).color
                    return (
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
                        style={{
                          background: `linear-gradient(145deg, ${accent}38 0%, ${accent}14 100%), #0a0e1a`,
                          border: `1.5px solid ${accent}80`,
                          boxShadow: `0 2px 10px rgba(0,0,0,0.55), inset 0 1px 0 ${accent}30`,
                          textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 0 1px rgba(0,0,0,0.6)',
                          filter: 'saturate(1.25)',
                        }}>
                        {ext.icon}
                      </div>
                    )
                  })()}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-white">{ext.name}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full"
                        style={{ background: isCustom ? 'rgba(99,102,241,0.15)' : `${(ext as ExtensionDef).color}15`, color: isCustom ? '#818cf8' : (ext as ExtensionDef).color }}>
                        {isCustom ? 'Custom' : ext.category}
                      </span>
                    </div>
                    <p className="text-xs mt-0.5 leading-snug" style={{ color: 'rgb(var(--ds-text-4))' }}>{ext.tagline}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Info/settings expander — every card has a how-to panel */}
                    <button
                      onClick={() => setExpanded(isOpen ? null : ext.id)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                      style={{ background: isOpen ? 'var(--ds-glass-md)' : 'transparent', color: isOpen ? 'rgb(var(--ds-text-3))' : 'rgb(var(--ds-text-4) / 0.75)' }}
                      title={builtIn && builtIn.settings.length > 0 ? 'How to use & settings' : 'How to use'}
                    >
                      {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {/* Delete for custom exts */}
                    {isCustom && (
                      <button
                        onClick={() => deleteCustom(ext.id)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                        style={{ color: 'rgb(var(--ds-text-4) / 0.75)' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#f87171'; (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.1)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgb(var(--ds-text-4) / 0.75)'; (e.currentTarget as HTMLElement).style.background = '' }}
                        title="Delete extension"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                    {/* Toggle */}
                    <Toggle checked={enabled} onChange={v => toggleExt(ext, v)} />
                  </div>
                </div>
              </div>

              {/* Info + settings panel */}
              {isOpen && (
                <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: 'var(--ds-glass-sm)' }}>
                  <p className="text-[10px] uppercase tracking-widest pt-3 font-bold" style={{ color: 'rgb(var(--ds-text-4) / 0.8)' }}>How to use</p>
                  <p className="text-xs leading-relaxed" style={{ color: 'rgb(var(--ds-text-3))' }}>
                    {builtIn
                      ? builtIn.howTo
                      : (ext as CustomExt).howTo || 'Enable the toggle and the extension runs on every page you open. ' + ext.tagline}
                  </p>
                </div>
              )}
              {isOpen && builtIn && builtIn.settings.length > 0 && (
                <div className="px-4 pb-4 space-y-3">
                  <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: 'rgb(var(--ds-text-4) / 0.8)' }}>Settings</p>
                  {builtIn.settings.map(setting => {
                    const val = state?.settings?.[setting.key] ?? setting.default
                    return (
                      <div key={setting.key}>
                        <div className="flex justify-between items-center mb-1.5">
                          <label className="text-xs" style={{ color: 'rgb(var(--ds-text-4))' }}>{setting.label}</label>
                          {setting.type === 'range' && (
                            <span className="text-xs font-mono" style={{ color: '#60a5fa' }}>{typeof val === 'number' ? (setting.step && setting.step < 1 ? (val * 100).toFixed(0) + '%' : val) : val}</span>
                          )}
                        </div>
                        {setting.type === 'range' && (
                          <input
                            type="range"
                            min={setting.min} max={setting.max} step={setting.step}
                            value={val}
                            onChange={e => updateSetting(ext.id, setting.key, parseFloat(e.target.value))}
                            className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                            style={{ accentColor: (ext as ExtensionDef).color || '#60a5fa' }}
                          />
                        )}
                        {setting.type === 'select' && (
                          <select
                            value={val}
                            onChange={e => updateSetting(ext.id, setting.key, e.target.value)}
                            className="w-full px-3 py-1.5 rounded-lg text-xs outline-none"
                            style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-2))' }}
                          >
                            {setting.options?.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-20" style={{ color: 'rgb(var(--ds-text-4) / 0.8)' }}>
            <Puzzle size={40} className="mb-4 opacity-30" />
            <p className="text-sm">No extensions match your search</p>
          </div>
        )}
      </div>

      {/* Generate with AI Modal */}
      {showGenerate && (
        <GenerateExtModal
          existing={allExts.map(e => ({ name: e.name, tagline: e.tagline, category: e.category }))}
          onClose={() => setShowGenerate(false)}
          onGenerated={(exts) => {
            const updated = [...customExts, ...exts]
            setCustomExts(updated)
            saveCustomExts(updated)
          }}
        />
      )}

      {/* Create Extension Modal */}
      {showCreate && (
        <CreateExtModal
          onClose={() => setShowCreate(false)}
          onCreate={(ext) => {
            const updated = [...customExts, ext]
            setCustomExts(updated)
            saveCustomExts(updated)
            setShowCreate(false)
          }}
        />
      )}
    </div>
  )
}

// ── Toggle Switch ────────────────────────────────────────────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className="shrink-0 relative"
      style={{
        width: 38, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
        background: checked ? '#3b82f6' : 'var(--ds-glass-md)',
        transition: 'background 0.2s',
        boxShadow: checked ? '0 0 10px rgba(59,130,246,0.35)' : 'none',
      }}
    >
      <span style={{
        position: 'absolute', top: 3,
        left: checked ? 19 : 3,
        width: 16, height: 16, borderRadius: '50%',
        background: '#fff',
        transition: 'left 0.18s cubic-bezier(0.4,0,0.2,1)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
      }} />
    </button>
  )
}

// ── Create Extension Modal ───────────────────────────────────────────────────
const CODE_TEMPLATE = `// Your extension runs in every page's context.
// Use a unique window key to avoid conflicts.
(function () {
  var K = '__ext_myextension';
  if (window[K]) return; // already running

  // --- Your code here ---

  window[K] = {
    remove: function () {
      // Undo everything your extension did
      delete window[K];
    }
  };
})()`;

const REMOVE_TEMPLATE = `window.__ext_myextension && window.__ext_myextension.remove()`;

function CreateExtModal({ onClose, onCreate }: {
  onClose: () => void
  onCreate: (ext: CustomExt) => void
}) {
  const [name, setName]         = useState('')
  const [tagline, setTagline]   = useState('')
  const [howTo, setHowTo]       = useState('')
  const [icon, setIcon]         = useState('⚡')
  const [category, setCategory] = useState('Productivity')
  const [inject, setInject]     = useState(CODE_TEMPLATE)
  const [remove, setRemove]     = useState(REMOVE_TEMPLATE)

  const handleCreate = () => {
    if (!name.trim()) return
    const id = 'custom-' + Date.now()
    onCreate({ id, name: name.trim(), tagline: tagline.trim() || 'Custom extension', icon: icon || '⚡', category, injectCode: inject, removeCode: remove, ...(howTo.trim() ? { howTo: howTo.trim() } : {}) })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col"
        style={{ background: 'rgb(var(--ds-bg-2))', border: '1px solid var(--ds-border-sm)', maxHeight: '90vh' }}>
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--ds-border-sm)' }}>
          <div className="flex items-center gap-2.5">
            <Code2 size={18} style={{ color: '#f59e0b' }} />
            <span className="text-sm font-semibold text-white">Create Extension</span>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ color: 'rgb(var(--ds-text-4))', background: 'var(--ds-glass-sm)' }}>
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Row 1: icon + name + category */}
          <div className="flex gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-widest font-bold block mb-1.5" style={{ color: 'rgb(var(--ds-text-4) / 0.75)' }}>Icon</label>
              <input value={icon} onChange={e => setIcon(e.target.value)} maxLength={2}
                className="w-14 h-9 text-center text-xl rounded-xl outline-none"
                style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: '#fff' }} />
            </div>
            <div className="flex-1">
              <label className="text-[10px] uppercase tracking-widest font-bold block mb-1.5" style={{ color: 'rgb(var(--ds-text-4) / 0.75)' }}>Name *</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="My Extension"
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-2))' }} />
            </div>
            <div className="w-36">
              <label className="text-[10px] uppercase tracking-widest font-bold block mb-1.5" style={{ color: 'rgb(var(--ds-text-4) / 0.75)' }}>Category</label>
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-2))' }}>
                {CATEGORIES.filter(c => c !== 'All').map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Tagline */}
          <div>
            <label className="text-[10px] uppercase tracking-widest font-bold block mb-1.5" style={{ color: 'rgb(var(--ds-text-4) / 0.75)' }}>Tagline</label>
            <input value={tagline} onChange={e => setTagline(e.target.value)} placeholder="One-line description of what it does"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-2))' }} />
          </div>

          {/* How to use */}
          <div>
            <label className="text-[10px] uppercase tracking-widest font-bold block mb-1.5" style={{ color: 'rgb(var(--ds-text-4) / 0.75)' }}>How to use <span style={{ color: 'rgb(var(--ds-text-4) / 0.8)', textTransform: 'none', fontWeight: 400 }}>— optional, shown in the card's info panel</span></label>
            <input value={howTo} onChange={e => setHowTo(e.target.value)} placeholder="e.g. Toggle on, then click the button that appears bottom-right"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-2))' }} />
          </div>

          {/* Inject code */}
          <div>
            <label className="text-[10px] uppercase tracking-widest font-bold block mb-1.5" style={{ color: 'rgb(var(--ds-text-4) / 0.75)' }}>Inject Code <span style={{ color: 'rgb(var(--ds-text-4) / 0.8)', textTransform: 'none', fontWeight: 400 }}>— runs on every page when enabled</span></label>
            <textarea
              value={inject}
              onChange={e => setInject(e.target.value)}
              rows={12}
              spellCheck={false}
              className="w-full px-4 py-3 rounded-xl text-xs font-mono outline-none resize-none"
              style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-3))', lineHeight: 1.7 }}
            />
          </div>

          {/* Remove code */}
          <div>
            <label className="text-[10px] uppercase tracking-widest font-bold block mb-1.5" style={{ color: 'rgb(var(--ds-text-4) / 0.75)' }}>Remove Code <span style={{ color: 'rgb(var(--ds-text-4) / 0.8)', textTransform: 'none', fontWeight: 400 }}>— runs when extension is toggled off</span></label>
            <textarea
              value={remove}
              onChange={e => setRemove(e.target.value)}
              rows={2}
              spellCheck={false}
              className="w-full px-4 py-3 rounded-xl text-xs font-mono outline-none resize-none"
              style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-3))', lineHeight: 1.7 }}
            />
          </div>

          <p className="text-xs" style={{ color: 'rgb(var(--ds-text-4) / 0.8)' }}>
            ⚠ Extension code runs in the context of every web page you visit. Only install extensions you trust.
          </p>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4" style={{ borderTop: '1px solid var(--ds-border-sm)' }}>
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm transition-all"
            style={{ background: 'var(--ds-glass-sm)', color: 'rgb(var(--ds-text-4))', border: '1px solid var(--ds-border-sm)' }}>
            Cancel
          </button>
          <button onClick={handleCreate} disabled={!name.trim()}
            className="px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{
              background: name.trim() ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'var(--ds-glass-sm)',
              color: name.trim() ? '#fff' : 'rgb(var(--ds-text-4) / 0.75)',
              border: 'none', cursor: name.trim() ? 'pointer' : 'not-allowed',
              boxShadow: name.trim() ? '0 0 16px rgba(245,158,11,0.3)' : 'none',
            }}>
            Create Extension
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Generate with AI Modal ───────────────────────────────────────────────────
function GenerateExtModal({ existing, onClose, onGenerated }: {
  existing: { name: string; tagline: string; category?: string }[]
  onClose: () => void
  onGenerated: (exts: CustomExt[]) => void
}) {
  const [topic, setTopic]     = useState('')
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')
  const [summary, setSummary] = useState('')
  const [attempt, setAttempt] = useState(0)

  const MAX_ATTEMPTS = 3

  const generate = async () => {
    setBusy(true); setError(''); setSummary('')
    try {
      // Free-tier models are flaky run-to-run: the same prompt can come back
      // truncated or malformed one minute and perfect the next. Retry the
      // whole request a couple of times before surfacing an error — each
      // retry re-samples and may land on a different fallback model.
      let lastError = ''
      for (let i = 1; i <= MAX_ATTEMPTS; i++) {
        setAttempt(i)
        // preferCloud: strict-JSON output — small local models fumble it, so
        // route to the cloud chain first and use Ollama only as fallback.
        const result = await window.electronAPI.ai.chat(
          [{ role: 'user', content: buildGenerationPrompt(topic, existing) }],
          undefined,
          { preferCloud: true },
        )
        if (!result || result.provider === 'error' || result.provider === 'none') {
          lastError = result?.content || 'AI is unavailable.'
          continue
        }
        const { extensions, discarded } = parseGeneratedExtensions(result.content || '', existing)
        if (extensions.length === 0) {
          lastError = `The AI response couldn't be parsed (model: ${result.model}).`
          continue
        }
        onGenerated(extensions)
        setSummary(`Added ${extensions.length} extension${extensions.length === 1 ? '' : 's'}${discarded > 0 ? ` · ${discarded} discarded as invalid` : ''}`)
        setTimeout(onClose, 1800)
        return
      }
      setError(`${lastError}\n\nTried ${MAX_ATTEMPTS} times — the free AI models are having a moment. Wait a minute and try again, or set a stronger model in Settings → AI Configuration.`)
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setBusy(false)
      setAttempt(0)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden flex flex-col"
        style={{ background: 'rgb(var(--ds-bg-2))', border: '1px solid var(--ds-border-sm)' }}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--ds-border-sm)' }}>
          <div className="flex items-center gap-2.5">
            <Sparkles size={18} style={{ color: '#a78bfa' }} />
            <span className="text-sm font-semibold text-white">Generate Extensions with AI</span>
          </div>
          <button onClick={onClose} disabled={busy}
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ color: 'rgb(var(--ds-text-4))', background: 'var(--ds-glass-sm)' }}>
            <X size={14} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="text-[10px] uppercase tracking-widest font-bold block mb-1.5" style={{ color: 'rgb(var(--ds-text-4) / 0.75)' }}>
              Topic <span style={{ color: 'rgb(var(--ds-text-4) / 0.8)', textTransform: 'none', fontWeight: 400 }}>— optional</span>
            </label>
            <input
              value={topic}
              onChange={e => setTopic(e.target.value)}
              disabled={busy}
              placeholder="e.g. tools for reading articles — leave empty and I'll pick useful ones"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-2))' }}
            />
          </div>

          {busy && (
            <p className="text-xs" style={{ color: 'rgb(var(--ds-text-4))' }}>
              ✨ Generating 5–10 extensions{attempt > 1 ? ` — attempt ${attempt}/${MAX_ATTEMPTS}` : ''}… can take 30–60s.
            </p>
          )}
          {error && (
            <p className="text-xs whitespace-pre-wrap" style={{ color: '#f87171' }}>{error}</p>
          )}
          {summary && (
            <p className="text-xs font-semibold" style={{ color: '#4ade80' }}>{summary}</p>
          )}

          <p className="text-xs" style={{ color: 'rgb(var(--ds-text-4) / 0.8)' }}>
            ⚠ Generated code runs in the context of every web page you visit. New extensions start disabled — review, then enable the ones you want.
          </p>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4" style={{ borderTop: '1px solid var(--ds-border-sm)' }}>
          <button onClick={onClose} disabled={busy}
            className="px-4 py-2 rounded-xl text-sm transition-all"
            style={{ background: 'var(--ds-glass-sm)', color: 'rgb(var(--ds-text-4))', border: '1px solid var(--ds-border-sm)' }}>
            Close
          </button>
          <button onClick={generate} disabled={busy}
            className="px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{
              background: busy ? 'var(--ds-glass-sm)' : 'linear-gradient(135deg,#8b5cf6,#6d28d9)',
              color: busy ? 'rgb(var(--ds-text-4) / 0.75)' : '#fff',
              border: 'none', cursor: busy ? 'not-allowed' : 'pointer',
              boxShadow: busy ? 'none' : '0 0 16px rgba(139,92,246,0.3)',
            }}>
            {busy ? 'Generating…' : '✨ Generate'}
          </button>
        </div>
      </div>
    </div>
  )
}
