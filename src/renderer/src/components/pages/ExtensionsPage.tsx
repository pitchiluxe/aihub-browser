import React, { useState, useCallback } from 'react'
import { Search, Plus, X, ChevronDown, ChevronUp, Trash2, Code2, Puzzle } from 'lucide-react'
import { EXTENSION_DEFS, ExtensionDef } from '../../extensions/extensionDefs'
import { CustomExt, loadCustomExts, saveCustomExts } from '../../extensions/customExts'
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
  const [customExts, setCustomExts] = useState<CustomExt[]>(loadCustomExts)

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
    <div className="h-full w-full overflow-y-auto" style={{ background: 'linear-gradient(180deg, #06080f 0%, #080c1a 100%)', color: '#e2e8f0' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 px-6 pt-6 pb-4" style={{ background: 'linear-gradient(180deg,rgba(6,8,15,0.98) 80%,transparent)', backdropFilter: 'blur(12px)' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#f59e0b,#d97706)', boxShadow: '0 0 20px rgba(245,158,11,0.3)' }}>
              <Puzzle size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Extensions</h1>
              <p className="text-xs" style={{ color: '#475569' }}>{activeCount} active · {allExts.length} installed</p>
            </div>
          </div>
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

        {/* Search */}
        <div className="relative mb-3">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#334155' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search extensions…"
            className="w-full pl-9 pr-4 py-2 rounded-xl text-sm outline-none"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: '#cbd5e1' }}
          />
        </div>

        {/* Category filter */}
        <div className="flex gap-1.5 flex-wrap">
          {CATEGORIES.map(c => (
            <button key={c} onClick={() => setCategory(c)}
              className="px-3 py-1 rounded-lg text-xs font-medium transition-all"
              style={category === c
                ? { background: 'rgba(245,158,11,0.18)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.28)' }
                : { background: 'rgba(255,255,255,0.04)', color: '#475569', border: '1px solid rgba(255,255,255,0.06)' }}>
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
              style={{ background: enabled ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.025)', border: `1px solid ${enabled ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.06)'}` }}>
              {/* Card header */}
              <div className="p-4">
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
                    style={{ background: `${isCustom ? '#6366f1' : (ext as ExtensionDef).color}18`, border: `1px solid ${isCustom ? '#6366f1' : (ext as ExtensionDef).color}28` }}>
                    {ext.icon}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-white">{ext.name}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full"
                        style={{ background: isCustom ? 'rgba(99,102,241,0.15)' : `${(ext as ExtensionDef).color}15`, color: isCustom ? '#818cf8' : (ext as ExtensionDef).color }}>
                        {isCustom ? 'Custom' : ext.category}
                      </span>
                    </div>
                    <p className="text-xs mt-0.5 leading-snug" style={{ color: '#64748b' }}>{ext.tagline}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Settings gear — only for built-in exts with settings */}
                    {builtIn && builtIn.settings.length > 0 && (
                      <button
                        onClick={() => setExpanded(isOpen ? null : ext.id)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                        style={{ background: isOpen ? 'rgba(255,255,255,0.08)' : 'transparent', color: isOpen ? '#94a3b8' : '#334155' }}
                        title="Settings"
                      >
                        {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    )}
                    {/* Delete for custom exts */}
                    {isCustom && (
                      <button
                        onClick={() => deleteCustom(ext.id)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                        style={{ color: '#334155' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#f87171'; (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.1)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#334155'; (e.currentTarget as HTMLElement).style.background = '' }}
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

              {/* Settings panel (built-in only) */}
              {isOpen && builtIn && builtIn.settings.length > 0 && (
                <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                  <p className="text-[10px] uppercase tracking-widest pt-3 font-bold" style={{ color: '#1e3a5f' }}>Settings</p>
                  {builtIn.settings.map(setting => {
                    const val = state?.settings?.[setting.key] ?? setting.default
                    return (
                      <div key={setting.key}>
                        <div className="flex justify-between items-center mb-1.5">
                          <label className="text-xs" style={{ color: '#64748b' }}>{setting.label}</label>
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
                            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#cbd5e1' }}
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
          <div className="col-span-full flex flex-col items-center justify-center py-20" style={{ color: '#1e3a5f' }}>
            <Puzzle size={40} className="mb-4 opacity-30" />
            <p className="text-sm">No extensions match your search</p>
          </div>
        )}
      </div>

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
        background: checked ? '#3b82f6' : 'rgba(255,255,255,0.08)',
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
  const [icon, setIcon]         = useState('⚡')
  const [category, setCategory] = useState('Productivity')
  const [inject, setInject]     = useState(CODE_TEMPLATE)
  const [remove, setRemove]     = useState(REMOVE_TEMPLATE)

  const handleCreate = () => {
    if (!name.trim()) return
    const id = 'custom-' + Date.now()
    onCreate({ id, name: name.trim(), tagline: tagline.trim() || 'Custom extension', icon: icon || '⚡', category, injectCode: inject, removeCode: remove })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col"
        style={{ background: '#0d1526', border: '1px solid rgba(255,255,255,0.08)', maxHeight: '90vh' }}>
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center gap-2.5">
            <Code2 size={18} style={{ color: '#f59e0b' }} />
            <span className="text-sm font-semibold text-white">Create Extension</span>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ color: '#475569', background: 'rgba(255,255,255,0.05)' }}>
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Row 1: icon + name + category */}
          <div className="flex gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-widest font-bold block mb-1.5" style={{ color: '#334155' }}>Icon</label>
              <input value={icon} onChange={e => setIcon(e.target.value)} maxLength={2}
                className="w-14 h-9 text-center text-xl rounded-xl outline-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }} />
            </div>
            <div className="flex-1">
              <label className="text-[10px] uppercase tracking-widest font-bold block mb-1.5" style={{ color: '#334155' }}>Name *</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="My Extension"
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0' }} />
            </div>
            <div className="w-36">
              <label className="text-[10px] uppercase tracking-widest font-bold block mb-1.5" style={{ color: '#334155' }}>Category</label>
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0' }}>
                {CATEGORIES.filter(c => c !== 'All').map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Tagline */}
          <div>
            <label className="text-[10px] uppercase tracking-widest font-bold block mb-1.5" style={{ color: '#334155' }}>Tagline</label>
            <input value={tagline} onChange={e => setTagline(e.target.value)} placeholder="One-line description of what it does"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0' }} />
          </div>

          {/* Inject code */}
          <div>
            <label className="text-[10px] uppercase tracking-widest font-bold block mb-1.5" style={{ color: '#334155' }}>Inject Code <span style={{ color: '#1e3a5f', textTransform: 'none', fontWeight: 400 }}>— runs on every page when enabled</span></label>
            <textarea
              value={inject}
              onChange={e => setInject(e.target.value)}
              rows={12}
              spellCheck={false}
              className="w-full px-4 py-3 rounded-xl text-xs font-mono outline-none resize-none"
              style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.07)', color: '#94a3b8', lineHeight: 1.7 }}
            />
          </div>

          {/* Remove code */}
          <div>
            <label className="text-[10px] uppercase tracking-widest font-bold block mb-1.5" style={{ color: '#334155' }}>Remove Code <span style={{ color: '#1e3a5f', textTransform: 'none', fontWeight: 400 }}>— runs when extension is toggled off</span></label>
            <textarea
              value={remove}
              onChange={e => setRemove(e.target.value)}
              rows={2}
              spellCheck={false}
              className="w-full px-4 py-3 rounded-xl text-xs font-mono outline-none resize-none"
              style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.07)', color: '#94a3b8', lineHeight: 1.7 }}
            />
          </div>

          <p className="text-xs" style={{ color: '#1e3a5f' }}>
            ⚠ Extension code runs in the context of every web page you visit. Only install extensions you trust.
          </p>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm transition-all"
            style={{ background: 'rgba(255,255,255,0.05)', color: '#64748b', border: '1px solid rgba(255,255,255,0.07)' }}>
            Cancel
          </button>
          <button onClick={handleCreate} disabled={!name.trim()}
            className="px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{
              background: name.trim() ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'rgba(255,255,255,0.05)',
              color: name.trim() ? '#fff' : '#334155',
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
