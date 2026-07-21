import React, { useState, useEffect } from 'react'
import { Palette, Bot, Shield, Info, CheckCircle2, Loader2, RefreshCw, Download, Wifi, Brain, Globe, Sparkles, Trash2, Mail, FileCode , BookMarked } from 'lucide-react'
import ClaudeKitSection from './ClaudeKitSection'
import { useBibleSettings } from '../../services/bibleSettings'
import { useBrowserStore } from '../../store/browserStore'
import {
  THEMES, loadCustomThemes, deleteCustomTheme, generateThemes, CustomTheme,
} from '../../services/themeService'
import {
  WINDOW_STYLES, loadCustomWindowStyles, deleteCustomWindowStyle, generateWindowStyles,
  CustomWindowStyle, WindowStyle,
} from '../../services/windowStyleService'
import { mailStatus, mailConnect, mailDisconnect, mailSetCredentials } from '../../services/mailService'

const PAGE_SIZE = 40

const S = 'px-8 py-6 border-b border-aihub-border/20'
const LBL = 'text-sm font-semibold text-aihub-text mb-0.5'
const DESC = 'text-xs text-aihub-muted mb-3'
const ROW = 'flex items-center justify-between py-3 border-b border-aihub-border/15 last:border-0'

// Small pill switch used by the Bible section.
function BibleToggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={on}
      style={{
        width: 42, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer',
        position: 'relative', transition: 'background 0.16s',
        background: on ? 'rgb(var(--ds-accent) / 0.9)' : 'rgba(127,127,127,0.28)',
      }}>
      <span style={{
        position: 'absolute', top: 3, left: on ? 21 : 3, width: 18, height: 18,
        borderRadius: '50%', background: '#fff', transition: 'left 0.16s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }} />
    </button>
  )
}

const TRANSPARENCY = [
  { value: 'none',    label: 'Solid',  desc: 'Standard window' },
  { value: 'acrylic', label: 'Aero',   desc: 'Frosted glass blur (Win 10/11)' },
  { value: 'mica',    label: 'Mica',   desc: 'Tinted material (Win 11 only)' },
  { value: 'tabbed',  label: 'Tabbed', desc: 'Layered Mica variant (Win 11)' },
  { value: 'auto',    label: 'Auto',   desc: 'Let Windows pick the material' },
]

const OPACITY_LEVELS = [
  { value: 1,    label: '100%', desc: 'Fully opaque' },
  { value: 0.95, label: '95%',  desc: 'Slight fade' },
  { value: 0.9,  label: '90%',  desc: 'Soft see-through' },
  { value: 0.85, label: '85%',  desc: 'Ghost window' },
]

const GLASS_LEVELS = [
  { value: 'subtle', label: 'Subtle', desc: 'Barely see-through' },
  { value: 'medium', label: 'Medium', desc: 'Balanced glass' },
  { value: 'strong', label: 'Strong', desc: 'Maximum transparency' },
]

const SEARCH_ENGINES = [
  { value: 'google',     label: 'Google' },
  { value: 'bing',       label: 'Bing' },
  { value: 'duckduckgo', label: 'DuckDuckGo' },
  { value: 'perplexity', label: 'Perplexity AI' },
]

export default function SettingsPage() {
  const { ollamaStatus, setOllamaStatus } = useBrowserStore()
  const [settings, setSettings] = useState<any>(null)
  const [appVersion, setAppVersion] = useState('')
  const [cacheCleared, setCacheCleared] = useState(false)
  const [historyCleared, setHistoryCleared] = useState(false)
  const [pullingModel, setPullingModel] = useState('')
  const [pullResult, setPullResult] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [checkingAI, setCheckingAI] = useState(false)
  const [profile, setProfile] = useState<any>(null)
  const [isDefault, setIsDefault] = useState(false)
  const [settingDefault, setSettingDefault] = useState(false)
  // AI API config
  const [aiCfg, setAiCfg] = useState<any>(null)
  const [aiKeyInput, setAiKeyInput] = useState('')
  const [aiModelInput, setAiModelInput] = useState('')
  const [aiOllamaUrl, setAiOllamaUrl] = useState('')
  const [savingAI, setSavingAI] = useState(false)
  const [aiSaved, setAiSaved] = useState(false)
  // Custom themes
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>(() => loadCustomThemes())
  const [genBusy, setGenBusy] = useState(false)
  const [themePage, setThemePage] = useState(0)
  // Custom window styles
  const [customWindowStyles, setCustomWindowStyles] = useState<CustomWindowStyle[]>(() => loadCustomWindowStyles())
  const [winGenBusy, setWinGenBusy] = useState(false)
  const [winStylePage, setWinStylePage] = useState(0)
  // Gmail account
  const [gmailConnected, setGmailConnected] = useState(false)
  const [gmailEmail, setGmailEmail] = useState<string | null>(null)
  const [gmailBusy, setGmailBusy] = useState(false)
  const [showGmailCreds, setShowGmailCreds] = useState(false)
  const [gClientId, setGClientId] = useState('')
  const [gClientSecret, setGClientSecret] = useState('')
  const [gmailError, setGmailError] = useState('')
  // Bible reader preferences (localStorage; the open reader updates live)
  const [bible, setBible] = useBibleSettings()

  useEffect(() => {
    // Real version from the main process (app.getVersion()) — never hardcode;
    // in dev this reports the electron binary's version, in packaged builds
    // the app version from package.json.
    window.electronAPI.appInfo?.().then((i: any) => setAppVersion(i?.version || '')).catch(() => {})
    window.electronAPI.settings.get().then(setSettings)
    window.electronAPI.brain.getProfile().then(setProfile)
    checkAI()
    window.electronAPI.app?.isDefaultBrowser?.().then((v: boolean) => setIsDefault(!!v))
    window.electronAPI.settings.getAIConfig().then((cfg: any) => {
      setAiCfg(cfg)
      setAiKeyInput(cfg?.openrouterKey || '')
      setAiModelInput(cfg?.openrouterModel || '')
      setAiOllamaUrl(cfg?.ollamaUrl || '')
    })
    mailStatus().then(s => { setGmailConnected(s.connected); setGmailEmail(s.email) })
  }, [])

  const connectGmail = async () => {
    setGmailBusy(true)
    setGmailError('')
    if (gClientId.trim()) await mailSetCredentials(gClientId.trim(), gClientSecret.trim())
    const r = await mailConnect()
    setGmailBusy(false)
    if (r.ok) { setGmailConnected(true); setGmailEmail(r.email || null) }
    else { setGmailError(r.error || 'Could not connect to Gmail') }
  }
  const disconnectGmail = async () => { await mailDisconnect(); setGmailConnected(false); setGmailEmail(null) }

  const handleSetDefault = async () => {
    setSettingDefault(true)
    await window.electronAPI.app?.setDefaultBrowser?.()
    const now = await window.electronAPI.app?.isDefaultBrowser?.()
    setIsDefault(!!now)
    setSettingDefault(false)
  }

  const checkAI = async () => {
    setCheckingAI(true)
    try {
      const status = await window.electronAPI.ollama.status()
      setOllamaStatus(status)
    } catch {
      setOllamaStatus({ running: false, models: [] })
    } finally {
      setCheckingAI(false)
    }
  }

  const update = async (key: string, value: any) => {
    setSettings((prev: any) => ({ ...prev, [key]: value }))
    await window.electronAPI.settings.set({ [key]: value })
  }

  const applyTransparency = async (mode: string) => {
    await update('transparency', mode)
    await window.electronAPI.window.setTransparency(mode)
  }

  const applyGlassIntensity = async (level: string) => {
    await update('glassIntensity', level)
    document.body.dataset.glass = level
  }

  const applyOpacity = async (value: number) => {
    await update('windowOpacity', value)
    await window.electronAPI.window.setOpacity?.(value)
  }

  // Apply a bundled window-style preset — all three chrome settings at once.
  const applyWindowStyle = async (s: WindowStyle) => {
    await applyTransparency(s.transparency)
    await applyGlassIntensity(s.glassIntensity)
    await applyOpacity(s.opacity)
  }

  const handleGenerateWindowStyles = async () => {
    setWinGenBusy(true)
    try {
      await generateWindowStyles(6)
      setCustomWindowStyles(loadCustomWindowStyles())
    } finally {
      setWinGenBusy(false)
    }
  }

  const handleDeleteWindowStyle = (id: string) => {
    setCustomWindowStyles(deleteCustomWindowStyle(id))
  }

  // Which built-in preset (if any) matches the current settings — used to
  // highlight the active card since presets aren't stored by id.
  const activeWindowStyleId = (): string | undefined => {
    const all: WindowStyle[] = [...WINDOW_STYLES, ...customWindowStyles]
    const match = all.find(s =>
      s.transparency === (settings?.transparency || 'none') &&
      s.glassIntensity === (settings?.glassIntensity || 'medium') &&
      s.opacity === (settings?.windowOpacity ?? 1))
    return match?.id
  }

  const applyTheme = async (theme: string) => {
    await update('theme', theme)
    document.dispatchEvent(new CustomEvent('aihub-theme-change', { detail: theme }))
  }

  const handleGenerateThemes = async () => {
    setGenBusy(true)
    try {
      const count = 5 + Math.floor(Math.random() * 6) // 5–10
      await generateThemes(count)
      setCustomThemes(loadCustomThemes())
    } finally {
      setGenBusy(false)
    }
  }

  const handleDeleteTheme = async (id: string) => {
    setCustomThemes(deleteCustomTheme(id))
    if (settings.theme === id) applyTheme('dark') // active theme removed — fall back
  }

  const clearCache = async () => {
    await window.electronAPI.cache.clear()
    setCacheCleared(true); setTimeout(() => setCacheCleared(false), 3000)
  }
  const clearHistory = async () => {
    await window.electronAPI.history.clear()
    setHistoryCleared(true); setTimeout(() => setHistoryCleared(false), 3000)
  }
  const pullModel = async (model: string) => {
    if (!model) return
    setPullingModel(model); setPullResult('')
    const res = await window.electronAPI.ollama.pull(model)
    setPullingModel(''); setCustomModel('')
    if (res.success) { setPullResult(`Model "${model}" installed successfully`); checkAI() }
    else setPullResult(`Install failed: ${res.error}`)
  }

  const saveAIConfig = async () => {
    setSavingAI(true)
    await window.electronAPI.settings.setAIConfig({
      openrouterKey:   aiKeyInput.trim(),
      openrouterModel: aiModelInput.trim(),
      ollamaUrl:       aiOllamaUrl.trim(),
    })
    setAiSaved(true)
    setTimeout(() => setAiSaved(false), 2500)
    setSavingAI(false)
    checkAI()
  }

  if (!settings) return <div className="flex items-center justify-center h-full"><Loader2 size={20} className="animate-spin text-aihub-muted" /></div>

  const aiModels = ollamaStatus?.models || []
  const hasCloud = !!(aiCfg?.resolvedKey)

  return (
    <div className="flex flex-col h-full bg-aihub-bg text-aihub-text overflow-y-auto">
      <div className="px-8 pt-8 pb-4 border-b border-aihub-border/30">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-aihub-muted mt-0.5">Customize your AIHub Browser</p>
      </div>

      {/* Appearance */}
      <Section icon={<Palette size={15} />} title="Appearance">
        <div className="mb-5">
          <div className="flex items-center justify-between mb-0.5">
            <div className={LBL} style={{ marginBottom: 0 }}>Color Theme</div>
            <button
              onClick={handleGenerateThemes}
              disabled={genBusy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
              style={{
                background: 'rgb(var(--ds-accent) / 0.12)', color: 'rgb(var(--ds-accent-soft))',
                border: '1px solid rgb(var(--ds-accent) / 0.25)',
                cursor: genBusy ? 'wait' : 'pointer', opacity: genBusy ? 0.7 : 1,
              }}
            >
              {genBusy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {genBusy ? 'Designing…' : 'Generate with AI'}
            </button>
          </div>
          <div className={DESC}>
            {THEMES.length + customThemes.length} themes — AI generates 5–10 new non-duplicate palettes per click (works offline too)
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' }}>
            {[...THEMES, ...customThemes].slice(themePage * PAGE_SIZE, themePage * PAGE_SIZE + PAGE_SIZE).map(t => {
              const active = (settings.theme || 'dark') === t.id
              const isCustom = 'custom' in t
              return (
                <div key={t.id} style={{ position: 'relative' }}>
                  {isCustom && (
                    <button
                      onClick={e => { e.stopPropagation(); handleDeleteTheme(t.id) }}
                      title="Delete theme"
                      style={{
                        position: 'absolute', top: 6, right: 6, zIndex: 2,
                        width: 22, height: 22, borderRadius: 7, border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'transparent', color: 'rgb(var(--ds-text-4) / 0.6)',
                        transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = '#f87171'; el.style.background = 'rgba(239,68,68,0.12)' }}
                      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = 'rgb(var(--ds-text-4) / 0.6)'; el.style.background = 'transparent' }}
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                <button onClick={() => applyTheme(t.id)}
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 12, textAlign: 'left',
                    border: active ? `1.5px solid ${t.swatch[1]}` : '1px solid var(--ds-border-sm)',
                    background: 'var(--ds-glass-xs)',
                    boxShadow: active ? `0 0 14px ${t.swatch[1]}40` : 'none',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--ds-glass-sm)' }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--ds-glass-xs)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    {/* Swatch: theme background disc with accent core */}
                    <span style={{
                      width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                      background: t.swatch[0],
                      border: `1.5px solid ${t.swatch[1]}`,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.swatch[1], display: 'inline-block' }} />
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: active ? t.swatch[1] : 'rgb(var(--ds-text-2))' }}>{t.name}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'rgb(var(--ds-text-4))' }}>{t.desc}</div>
                </button>
                </div>
              )
            })}
          </div>
          <Pager total={THEMES.length + customThemes.length} page={themePage} setPage={setThemePage} />
        </div>

        {/* ── Window Style presets ── */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-0.5">
            <div className={LBL} style={{ marginBottom: 0 }}>Window Style</div>
            <button
              onClick={handleGenerateWindowStyles}
              disabled={winGenBusy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
              style={{
                background: 'rgb(var(--ds-accent) / 0.12)', color: 'rgb(var(--ds-accent-soft))',
                border: '1px solid rgb(var(--ds-accent) / 0.25)',
                cursor: winGenBusy ? 'wait' : 'pointer', opacity: winGenBusy ? 0.7 : 1,
              }}
            >
              {winGenBusy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {winGenBusy ? 'Designing…' : 'Generate with AI'}
            </button>
          </div>
          <div className={DESC}>
            {WINDOW_STYLES.length + customWindowStyles.length} presets — bundles material, glass level & opacity. Material change needs a restart to fully apply.
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' }}>
            {[...WINDOW_STYLES, ...customWindowStyles]
              .slice(winStylePage * PAGE_SIZE, winStylePage * PAGE_SIZE + PAGE_SIZE)
              .map(s => {
                const active = activeWindowStyleId() === s.id
                const isCustom = 'custom' in s
                return (
                  <div key={s.id} style={{ position: 'relative' }}>
                    {isCustom && (
                      <button
                        onClick={e => { e.stopPropagation(); handleDeleteWindowStyle(s.id) }}
                        title="Delete style"
                        style={{
                          position: 'absolute', top: 6, right: 6, zIndex: 2,
                          width: 22, height: 22, borderRadius: 7, border: 'none', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: 'transparent', color: 'rgb(var(--ds-text-4) / 0.6)', transition: 'all 0.12s',
                        }}
                        onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = '#f87171'; el.style.background = 'rgba(239,68,68,0.12)' }}
                        onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = 'rgb(var(--ds-text-4) / 0.6)'; el.style.background = 'transparent' }}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                    <button onClick={() => applyWindowStyle(s)}
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: 12, textAlign: 'left',
                        border: active ? '1.5px solid rgb(var(--ds-accent))' : '1px solid var(--ds-border-sm)',
                        background: 'var(--ds-glass-xs)',
                        boxShadow: active ? '0 0 14px rgb(var(--ds-accent) / 0.25)' : 'none',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--ds-glass-sm)' }}
                      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--ds-glass-xs)' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{
                          width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                          border: '1.5px solid rgb(var(--ds-accent) / 0.5)',
                          background: s.transparency === 'none'
                            ? 'rgb(var(--ds-bg-3))'
                            : `rgb(var(--ds-accent) / ${0.10 + (1 - s.opacity) * 2})`,
                          backdropFilter: 'blur(2px)',
                        }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: active ? 'rgb(var(--ds-accent-soft))' : 'rgb(var(--ds-text-2))' }}>{s.name}</span>
                      </div>
                      <div style={{ fontSize: 10.5, color: 'rgb(var(--ds-text-4))' }}>{s.desc}</div>
                    </button>
                  </div>
                )
              })}
          </div>
          <Pager total={WINDOW_STYLES.length + customWindowStyles.length} page={winStylePage} setPage={setWinStylePage} />
        </div>

        {/* ── Legacy per-setting material picker (kept for fine control) ── */}
        <div className="mb-4">
          <div className={LBL}>Material (advanced)</div>
          <div className={DESC}>Glass transparency effect — requires restart to fully apply</div>
          <div className="flex gap-2">
            {TRANSPARENCY.map(opt => {
              const active = settings.transparency === opt.value
              return (
                <button key={opt.value} onClick={() => applyTransparency(opt.value)}
                  style={{
                    flex: 1, padding: '10px 12px', borderRadius: 12, textAlign: 'left',
                    border: active ? '1.5px solid #3b82f6' : '1px solid var(--ds-border)',
                    background: active
                      ? 'linear-gradient(135deg, rgba(59,130,246,0.18), rgba(99,102,241,0.1))'
                      : 'var(--ds-glass-xs)',
                    cursor: 'pointer',
                    boxShadow: active ? '0 0 16px rgba(59,130,246,0.18)' : 'none',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--ds-glass-sm)'
                  }}
                  onMouseLeave={e => {
                    if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--ds-glass-xs)'
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: active ? '#60a5fa' : 'rgb(var(--ds-text-2))', marginBottom: 2 }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: active ? '#93c5fd' : 'rgb(var(--ds-text-4))' }}>{opt.desc}</div>
                </button>
              )
            })}
          </div>
        </div>
        {settings.transparency && settings.transparency !== 'none' && (
          <div className="mb-4">
            <div className={LBL}>Glass Intensity</div>
            <div className={DESC}>How see-through the window is when a glass style is active</div>
            <div className="flex gap-2">
              {GLASS_LEVELS.map(opt => {
                const active = (settings.glassIntensity || 'medium') === opt.value
                return (
                  <button key={opt.value} onClick={() => applyGlassIntensity(opt.value)}
                    style={{
                      flex: 1, padding: '10px 12px', borderRadius: 12, textAlign: 'left',
                      border: active ? '1.5px solid #3b82f6' : '1px solid var(--ds-border)',
                      background: active
                        ? 'linear-gradient(135deg, rgba(59,130,246,0.18), rgba(99,102,241,0.1))'
                        : 'var(--ds-glass-xs)',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: active ? '#60a5fa' : 'rgb(var(--ds-text-2))', marginBottom: 2 }}>{opt.label}</div>
                    <div style={{ fontSize: 11, color: active ? '#93c5fd' : 'rgb(var(--ds-text-4))' }}>{opt.desc}</div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        <div className="mb-4">
          <div className={LBL}>Window Opacity</div>
          <div className={DESC}>Fades the entire window, tab content included — applies instantly</div>
          <div className="flex gap-2">
            {OPACITY_LEVELS.map(opt => {
              const active = (settings.windowOpacity ?? 1) === opt.value
              return (
                <button key={opt.value} onClick={() => applyOpacity(opt.value)}
                  style={{
                    flex: 1, padding: '10px 12px', borderRadius: 12, textAlign: 'left',
                    border: active ? '1.5px solid #3b82f6' : '1px solid var(--ds-border)',
                    background: active
                      ? 'linear-gradient(135deg, rgba(59,130,246,0.18), rgba(99,102,241,0.1))'
                      : 'var(--ds-glass-xs)',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: active ? '#60a5fa' : 'rgb(var(--ds-text-2))', marginBottom: 2 }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: active ? '#93c5fd' : 'rgb(var(--ds-text-4))' }}>{opt.desc}</div>
                </button>
              )
            })}
          </div>
        </div>
        <div className={ROW}>
          <div><div className={LBL}>Default Search</div></div>
          <select value={settings.searchEngine||'google'} onChange={e => update('searchEngine', e.target.value)}
            className="bg-aihub-card border border-aihub-border/40 rounded-lg px-3 py-1.5 text-sm text-aihub-text outline-none">
            {SEARCH_ENGINES.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select>
        </div>
      </Section>

      {/* AI */}
      <Section icon={<Bot size={15} />} title="AI Assistant">
        <div className={ROW}>
          <div>
            <div className={LBL}>Ollama (Local AI)</div>
            <div className="text-xs text-aihub-muted">Private AI running on your device — ollama.com</div>
          </div>
          <div className="flex items-center gap-2">
            {checkingAI
              ? <Loader2 size={13} className="animate-spin text-aihub-muted" />
              : ollamaStatus?.running
                ? <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle2 size={12} /> Running</span>
                : <span className="flex items-center gap-1 text-xs text-aihub-muted">Offline</span>}
            <button
              onClick={checkAI}
              disabled={checkingAI}
              title="Re-check Ollama status"
              className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-aihub-card transition-all"
              style={{ color: checkingAI ? '#60a5fa' : undefined }}
            >
              <RefreshCw size={11} className={checkingAI ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        <div className={ROW}>
          <div>
            <div className={LBL}>OpenRouter (Cloud AI)</div>
            <div className="text-xs text-aihub-muted">Fallback when Ollama is offline — openrouter.ai</div>
          </div>
          {hasCloud
            ? <span className="flex items-center gap-1 text-xs text-blue-400"><CheckCircle2 size={12} /> Key loaded</span>
            : <span className="text-xs text-aihub-muted">No key</span>}
        </div>

        {ollamaStatus?.running && aiModels.length > 0 && (
          <div className={ROW}>
            <div><div className={LBL}>AI Model</div><div className="text-xs text-aihub-muted">Active model for conversations</div></div>
            <select value={settings.aiModel||'llama3'} onChange={e => update('aiModel', e.target.value)}
              className="bg-aihub-card border border-aihub-border/40 rounded-lg px-3 py-1.5 text-sm text-aihub-text outline-none">
              {aiModels.map((m: string) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        )}

        <div className="py-3">
          <div className={LBL}>Install AI Model</div>
          <div className={DESC}>Add new AI models (e.g. llama3, mistral, phi3, gemma)</div>
          <div className="flex gap-2">
            <input type="text" value={customModel} onChange={e => setCustomModel(e.target.value)}
              placeholder="Model name (e.g. llama3)"
              className="flex-1 bg-aihub-card border border-aihub-border/40 rounded-xl px-3 py-2 text-sm text-aihub-text placeholder:text-aihub-muted/50 outline-none focus:border-aihub-accent"
              style={{ userSelect:'text' }} />
            <button onClick={() => pullModel(customModel)} disabled={!customModel||!!pullingModel}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-aihub-accent text-white text-sm font-medium disabled:opacity-40">
              {pullingModel ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Install
            </button>
          </div>
          {pullResult && <p className={`mt-2 text-xs ${pullResult.includes('success') ? 'text-green-400' : 'text-red-400'}`}>{pullResult}</p>}
        </div>
      </Section>

      {/* AI API Config */}
      <Section icon={<Bot size={15} />} title="AI Configuration">
        <p className="text-xs text-aihub-muted mb-4">
          Configure your AI credentials. OpenRouter is used when Ollama is offline.
          Get a free key at <span className="text-aihub-accent">openrouter.ai</span>.
        </p>
        {aiCfg?.resolvedKey && (
          <div className="mb-3 px-3 py-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400 flex items-center gap-2">
            <CheckCircle2 size={12} /> OpenRouter key is active (from .env.local or settings)
          </div>
        )}
        <div className="space-y-3">
          <div>
            <div className={LBL}>OpenRouter API Key</div>
            <input
              type="password"
              value={aiKeyInput}
              onChange={e => setAiKeyInput(e.target.value)}
              placeholder={aiCfg?.resolvedKey ? `Current: ${aiCfg.resolvedKey}` : 'sk-or-v1-…'}
              className="w-full bg-aihub-card border border-aihub-border/40 rounded-xl px-3 py-2 text-sm text-aihub-text placeholder:text-aihub-muted/40 outline-none mt-1"
              style={{ userSelect: 'text' }}
            />
          </div>
          <div>
            <div className={LBL}>Cloud Model</div>
            <input
              type="text"
              value={aiModelInput}
              onChange={e => setAiModelInput(e.target.value)}
              placeholder={aiCfg?.resolvedModel || 'meta-llama/llama-3.3-70b-instruct:free'}
              className="w-full bg-aihub-card border border-aihub-border/40 rounded-xl px-3 py-2 text-sm text-aihub-text placeholder:text-aihub-muted/40 outline-none mt-1"
              style={{ userSelect: 'text' }}
            />
          </div>
          <div>
            <div className={LBL}>Ollama URL</div>
            <input
              type="text"
              value={aiOllamaUrl}
              onChange={e => setAiOllamaUrl(e.target.value)}
              placeholder={aiCfg?.resolvedOllama || 'http://localhost:11434'}
              className="w-full bg-aihub-card border border-aihub-border/40 rounded-xl px-3 py-2 text-sm text-aihub-text placeholder:text-aihub-muted/40 outline-none mt-1"
              style={{ userSelect: 'text' }}
            />
          </div>
          <button
            onClick={saveAIConfig}
            disabled={savingAI}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-aihub-accent text-white text-sm font-medium disabled:opacity-40 transition-all"
          >
            {savingAI ? <Loader2 size={13} className="animate-spin" /> : aiSaved ? <CheckCircle2 size={13} /> : null}
            {aiSaved ? 'Saved!' : 'Save AI Config'}
          </button>
        </div>
      </Section>

      {/* AI Memory / Brain */}
      <Section icon={<Brain size={15} />} title="AI Memory">
        <div className={ROW}>
          <div><div className={LBL}>Browsing Intelligence</div><div className="text-xs text-aihub-muted">Sites visited and patterns learned</div></div>
          <div className="text-sm text-aihub-muted">{profile?.topDomains?.length || 0} domains tracked</div>
        </div>
        {profile?.topCategories?.length > 0 && (
          <div className={ROW}>
            <div><div className={LBL}>Your Interests</div></div>
            <div className="flex flex-wrap gap-1.5 max-w-[200px] justify-end">
              {profile.topCategories.slice(0,5).map((c: string) => (
                <span key={c} className="text-xs px-2 py-0.5 rounded-full bg-aihub-accent/15 text-aihub-accent">{c}</span>
              ))}
            </div>
          </div>
        )}
        <div className={ROW}>
          <div><div className={LBL}>Clear AI Memory</div><div className="text-xs text-aihub-muted">Reset personalization data</div></div>
          <button onClick={() => clearHistory()} className="px-4 py-1.5 rounded-xl text-xs bg-aihub-card hover:bg-aihub-border/40 text-aihub-muted transition-all">Reset</button>
        </div>
      </Section>

      {/* Bible reader */}
      <Section icon={<BookMarked size={15} />} title="Bible">
        <div className={ROW}>
          <div>
            <div className={LBL}>Text size</div>
            <div className="text-xs text-aihub-muted">How large the verses read on the page</div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range" min={0.85} max={1.5} step={0.05}
              value={bible.fontScale}
              onChange={e => setBible({ fontScale: parseFloat(e.target.value) })}
              style={{ width: 130 }}
            />
            <span className="w-10 text-right text-xs text-aihub-muted">{Math.round(bible.fontScale * 100)}%</span>
          </div>
        </div>

        <div className={ROW}>
          <div>
            <div className={LBL}>Paper</div>
            <div className="text-xs text-aihub-muted">Aged parchment, or plain modern stock</div>
          </div>
          <div className="flex gap-1.5">
            {(['aged', 'clean'] as const).map(p => (
              <button key={p} onClick={() => setBible({ paper: p })}
                className="rounded-xl px-3 py-1.5 text-xs font-medium capitalize transition-all"
                style={bible.paper === p
                  ? { background: 'rgb(var(--ds-accent) / 0.9)', color: '#fff' }
                  : { background: 'var(--ds-glass-sm)', color: 'rgb(var(--ds-text-4))' }}>
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className={ROW}>
          <div>
            <div className={LBL}>Justified columns</div>
            <div className="text-xs text-aihub-muted">Straight edges like a printed Bible</div>
          </div>
          <BibleToggle on={bible.justify} onClick={() => setBible({ justify: !bible.justify })} />
        </div>

        <div className={ROW}>
          <div>
            <div className={LBL}>Verse numbers</div>
            <div className="text-xs text-aihub-muted">Superscript numbers before each verse</div>
          </div>
          <BibleToggle on={bible.verseNumbers} onClick={() => setBible({ verseNumbers: !bible.verseNumbers })} />
        </div>

        <div className={ROW}>
          <div>
            <div className={LBL}>Animate page turns</div>
            <div className="text-xs text-aihub-muted">The 3D fold. Off changes the page instantly</div>
          </div>
          <BibleToggle on={bible.animateTurn} onClick={() => setBible({ animateTurn: !bible.animateTurn })} />
        </div>

        <div className={ROW}>
          <div>
            <div className={LBL}>Open on the cover</div>
            <div className="text-xs text-aihub-muted">Off goes straight to where you left off</div>
          </div>
          <BibleToggle on={bible.showCover} onClick={() => setBible({ showCover: !bible.showCover })} />
        </div>

        <div className={ROW}>
          <div>
            <div className={LBL}>Highlights, notes &amp; saved verses</div>
            <div className="text-xs text-aihub-muted">Stored on this device only — never uploaded</div>
          </div>
          <button
            onClick={async () => {
              if (!confirm('Delete every highlight, note and saved verse? This cannot be undone.')) return
              await window.electronAPI.bible.setMarks({ highlights: {}, saved: [], notes: {}, lastRead: null })
              alert('Bible marks cleared.')
            }}
            className="rounded-xl px-3 py-1.5 text-xs font-medium"
            style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}
          >
            Clear all
          </button>
        </div>
      </Section>

      {/* Gmail */}
      <Section icon={<Mail size={15} />} title="Gmail">
        <div className="mb-2">
          {gmailConnected ? (
            <div className="flex items-center justify-between">
              <div className={LBL} style={{ marginBottom: 0 }}>Connected: {gmailEmail}</div>
              <button onClick={disconnectGmail} className="px-3 py-1.5 rounded-xl text-xs font-medium" style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}>Disconnect</button>
            </div>
          ) : (
            <>
              <div className={DESC}>Sign-in opens once in your system browser, then mail lives here. Advanced: use your own Google OAuth client below.</div>
              <button onClick={connectGmail} disabled={gmailBusy}
                className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: 'rgb(var(--ds-accent))', color: '#fff', border: 'none', opacity: gmailBusy ? 0.7 : 1 }}>
                {gmailBusy ? 'Waiting…' : 'Connect Gmail'}
              </button>
              <button onClick={() => setShowGmailCreds(v => !v)} className="ml-3 text-xs" style={{ color: 'rgb(var(--ds-accent-soft))', background: 'none', border: 'none', cursor: 'pointer' }}>
                {showGmailCreds ? 'Hide' : 'Use my own Google credentials'}
              </button>
              {showGmailCreds && (
                <div className="mt-3 flex flex-col gap-2" style={{ maxWidth: 460 }}>
                  <input value={gClientId} onChange={e => setGClientId(e.target.value)} placeholder="OAuth client_id"
                    className="bg-aihub-card border border-aihub-border/40 rounded-lg px-3 py-1.5 text-sm text-aihub-text outline-none" />
                  <input value={gClientSecret} onChange={e => setGClientSecret(e.target.value)} placeholder="OAuth client_secret (optional for desktop clients)"
                    className="bg-aihub-card border border-aihub-border/40 rounded-lg px-3 py-1.5 text-sm text-aihub-text outline-none" />
                </div>
              )}
              {gmailError && <div style={{ fontSize: 11, color: '#f87171', marginTop: 6 }}>{gmailError}</div>}
            </>
          )}
        </div>
      </Section>

      {/* Claude Kit Generator */}
      <Section icon={<FileCode size={15} />} title="Claude Kit Generator">
        <ClaudeKitSection />
      </Section>

      {/* Privacy */}
      <Section icon={<Shield size={15} />} title="Privacy & Data">
        <div className={ROW}>
          <div><div className={LBL}>Clear Cache</div><div className="text-xs text-aihub-muted">Remove cached pages and media</div></div>
          <button onClick={clearCache} className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm transition-all ${cacheCleared ? 'bg-green-500/20 text-green-400' : 'bg-aihub-card hover:bg-aihub-border/40 text-aihub-text'}`}>
            {cacheCleared ? <><CheckCircle2 size={13} /> Cleared</> : 'Clear Cache'}
          </button>
        </div>
        <div className={ROW}>
          <div><div className={LBL}>Clear History</div><div className="text-xs text-aihub-muted">Remove all visited pages</div></div>
          <button onClick={clearHistory} className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm transition-all ${historyCleared ? 'bg-green-500/20 text-green-400' : 'bg-aihub-card hover:bg-aihub-border/40 text-aihub-text'}`}>
            {historyCleared ? <><CheckCircle2 size={13} /> Cleared</> : 'Clear History'}
          </button>
        </div>
      </Section>

      {/* System */}
      <Section icon={<Globe size={15} />} title="System">
        <div className={ROW}>
          <div>
            <div className={LBL}>Default Browser</div>
            <div className="text-xs text-aihub-muted">
              {isDefault ? 'AIhub-Browser is your default browser' : 'Set AIhub-Browser as your default browser'}
            </div>
          </div>
          {isDefault ? (
            <span className="flex items-center gap-1.5 text-xs text-green-400 font-medium">
              <CheckCircle2 size={13} /> Default
            </span>
          ) : (
            <button
              onClick={handleSetDefault}
              disabled={settingDefault}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm bg-aihub-accent text-white hover:bg-aihub-accent-glow transition-all disabled:opacity-50"
            >
              {settingDefault ? <Loader2 size={13} className="animate-spin" /> : <Globe size={13} />}
              Set as Default
            </button>
          )}
        </div>
      </Section>

      {/* About */}
      <Section icon={<Info size={15} />} title="About">
        <div className={ROW}><div className={LBL}>AIHub Browser</div><span className="text-sm text-aihub-muted">{appVersion ? `v${appVersion}` : '…'}</span></div>
        <div className={ROW}><div className={LBL}>AI Engine</div><span className="text-sm text-aihub-muted">Local AI · Cloud Backup</span></div>
        <div className={ROW}><div className={LBL}>Data Privacy</div><span className="text-sm text-green-400">100% Local · Never uploaded</span></div>
        <div className={ROW}><div className={LBL}>Created by</div><span className="text-sm text-aihub-accent font-semibold">Erick Omari</span></div>
      </Section>

      <div className="h-16" />
    </div>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className={S}>
      <div className="flex items-center gap-2 mb-4 text-aihub-accent">
        {icon}<h2 className="text-xs font-bold uppercase tracking-wider">{title}</h2>
      </div>
      {children}
    </div>
  )
}

// Pager — keeps big theme / window-style grids from growing the page vertically.
// Hidden entirely when everything fits on one page.
function Pager({ total, page, setPage }: { total: number; page: number; setPage: (p: number) => void }) {
  const pages = Math.ceil(total / PAGE_SIZE)
  if (pages <= 1) return null
  const clamp = (p: number) => Math.max(0, Math.min(pages - 1, p))
  const btn = (label: string, target: number, disabled: boolean) => (
    <button
      onClick={() => setPage(clamp(target))}
      disabled={disabled}
      style={{
        padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
        border: '1px solid var(--ds-border-sm)', background: 'var(--ds-glass-xs)',
        color: disabled ? 'rgb(var(--ds-text-4) / 0.4)' : 'rgb(var(--ds-text-3))',
        cursor: disabled ? 'default' : 'pointer', transition: 'all 0.12s',
      }}
    >{label}</button>
  )
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10 }}>
      {btn('‹ Prev', page - 1, page === 0)}
      <span style={{ fontSize: 11, color: 'rgb(var(--ds-text-4))' }}>Page {page + 1} of {pages}</span>
      {btn('Next ›', page + 1, page >= pages - 1)}
    </div>
  )
}
