import React, { useState, useEffect } from 'react'
import { Palette, Bot, Shield, ShieldBan, Layers, Info, CheckCircle2, Loader2, RefreshCw, Download, Brain, Globe, Sparkles, Trash2, Mail, FileCode , BookMarked, Lock } from 'lucide-react'
import ClaudeKitSection from './ClaudeKitSection'
import { useBibleSettings } from '../../services/bibleSettings'
import { TRANSLATIONS } from '../../services/bibleService'
import { BADGES, isUnlocked, type UnlockKind } from '../../services/bibleRewards'
import { useBrowserStore } from '../../store/browserStore'
import {
  THEMES, loadCustomThemes, deleteCustomTheme, generateThemes, CustomTheme,
} from '../../services/themeService'
import {
  WINDOW_STYLES, loadCustomWindowStyles, deleteCustomWindowStyle, generateWindowStyles,
  CustomWindowStyle, WindowStyle,
} from '../../services/windowStyleService'
import { mailStatus, mailConnect, mailDisconnect, mailSetCredentials } from '../../services/mailService'
import { auditTheme } from '../../services/themeQuality'
import { mergeLocalJsonArrays } from '../../services/backupLocal'

const PAGE_SIZE = 40

// OpenRouter's free meta-router: it selects among the free models available at
// request time, so it is the one "model" that can never go stale.
const OR_FREE_AUTO = 'openrouter/free'

const OR_FILTERS = [
  { value: 'all',         label: 'All Models' },
  { value: 'free',        label: 'Free Models' },
  { value: 'paid',        label: 'Paid Models' },
  { value: 'vision',      label: 'Vision' },
  { value: 'tools',       label: 'Tool Calling' },
  { value: 'reasoning',   label: 'Reasoning' },
  { value: 'coding',      label: 'Coding' },
  { value: 'longContext', label: 'Long Context' },
]

function matchesFilter(m: any, filter: string): boolean {
  switch (filter) {
    case 'free':        return !!m.free
    case 'paid':        return !m.free
    case 'vision':      return !!m.capabilities?.vision
    case 'tools':       return !!m.capabilities?.tools
    case 'reasoning':   return !!m.capabilities?.reasoning
    case 'coding':      return !!m.capabilities?.coding
    case 'longContext': return (m.contextLength || 0) >= 100_000
    default:            return true
  }
}

function fmtContext(tokens: number): string {
  if (!tokens) return '—'
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`
  return String(tokens)
}

/** Per-token price → the per-million figure OpenRouter quotes in its own UI. */
function fmtPrice(perToken: number): string {
  if (!perToken) return '$0'
  const perM = perToken * 1_000_000
  return `$${perM.toFixed(perM < 0.01 ? 4 : perM < 1 ? 3 : 2)}`
}

function orLabel(id: string): string {
  return id === OR_FREE_AUTO ? 'Free Auto (openrouter/free)' : (id || '—')
}

/**
 * OpenRouter model selector.
 *
 * A bare slug ("mistralai/mistral-7b") tells the user nothing about what they
 * are choosing, so each row carries whether it's free, how much context it
 * has, what it can do, and — for paid models — what it costs. The free
 * meta-router is pinned to the top because it is the recommended fallback and
 * never appears in the catalog itself.
 */
function ModelPicker({ value, models, all, onChange }: { value: string; models: any[]; all: any[]; onChange: (id: string) => void }) {
  // Looked up in the WHOLE catalog, not the filtered view. Switching the
  // filter to "Paid Models" while a free model is selected does not make that
  // model unknown — reading it out of the filtered list is what produced
  // "Saved selection — catalog unavailable" for a model sitting right there
  // in the catalog.
  const selected = all.find(m => m.id === value) || models.find(m => m.id === value)
  const known = !!selected || !all.length
  return (
    <div className="max-w-[62%] text-right">
      <select
        value={value || OR_FREE_AUTO}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-aihub-card border border-aihub-border/40 rounded-lg px-3 py-1.5 text-sm text-aihub-text outline-none">
        <option value={OR_FREE_AUTO}>OpenRouter Free Auto</option>
        {/* The selected model always needs an option to sit in, even when the
            current filter excludes it — otherwise the <select> would silently
            show something the user did not choose. */}
        {value && value !== OR_FREE_AUTO && !models.some(m => m.id === value) && (
          <option value={value}>
            {selected ? `${selected.name} (hidden by filter)` : `${value}${all.length ? ' (saved — not in catalog)' : ' (saved)'}`}
          </option>
        )}
        {models.map(m => (
          <option key={m.id} value={m.id}>
            {m.name}{m.free ? ' — FREE' : ''}{m.deprecated ? ' (deprecated)' : ''}
          </option>
        ))}
      </select>
      <div className="mt-1 text-[11px] text-aihub-muted">
        {value === OR_FREE_AUTO || !value
          ? 'Picks whichever free model is available at request time'
          : selected
            ? [
                selected.free ? 'FREE' : 'PAID',
                `Context: ${fmtContext(selected.contextLength)}`,
                selected.capabilities?.tools ? 'Tools' : '',
                selected.capabilities?.vision ? 'Vision' : '',
                selected.capabilities?.reasoning ? 'Reasoning' : '',
                selected.free ? '' : `${fmtPrice(selected.pricing?.prompt)}/1M in`,
                selected.free ? '' : `${fmtPrice(selected.pricing?.completion)}/1M out`,
              ].filter(Boolean).join(' · ')
            : known
              ? 'Saved selection'
              : 'Saved selection — not in the current OpenRouter catalog'}
      </div>
    </div>
  )
}

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
  // Startup — reopen last session
  const [restoreSession, setRestoreSession] = useState(true)
  useEffect(() => {
    window.electronAPI.settings.get()
      .then((cfg: any) => setRestoreSession(cfg?.restoreSession !== false))
      .catch(() => {})
  }, [])
  const toggleRestoreSession = async () => {
    const next = !restoreSession
    setRestoreSession(next)
    await window.electronAPI.settings.set({ restoreSession: next })
  }

  // DNS-over-HTTPS + download sorting
  const [doh, setDoh] = useState('off')
  const [sortDownloads, setSortDownloads] = useState(true)
  useEffect(() => {
    window.electronAPI.privacy.getDoh().then((r: any) => setDoh(r?.provider || 'off')).catch(() => {})
    window.electronAPI.settings.get().then((cfg: any) => setSortDownloads(cfg?.sortDownloads !== false)).catch(() => {})
  }, [])
  const chooseDoh = async (provider: string) => {
    const res = await window.electronAPI.privacy.setDoh(provider)
    if (res?.ok) setDoh(provider)
  }
  const toggleSortDownloads = async () => {
    const next = !sortDownloads
    setSortDownloads(next)
    await window.electronAPI.settings.set({ sortDownloads: next })
  }

  // Backup file — move everything to another computer
  const [backupBusy, setBackupBusy] = useState<'' | 'export' | 'import'>('')
  const [backupMsg, setBackupMsg] = useState('')
  const [pendingImport, setPendingImport] = useState<{ summary: any; device: string; createdAt: number } | null>(null)

  // The pieces that live in localStorage rather than on disk travel too.
  const LOCAL_BACKUP_KEYS = ['aihub-custom-themes', 'aihub-custom-window-styles', 'aihub-custom-exts']
  const collectLocal = () => {
    const out: Record<string, string> = {}
    for (const key of LOCAL_BACKUP_KEYS) {
      const value = localStorage.getItem(key)
      if (value) out[key] = value
    }
    return out
  }

  const exportBackup = async () => {
    setBackupBusy('export'); setBackupMsg('')
    const res = await window.electronAPI.backup.export(collectLocal())
    setBackupBusy('')
    if (res?.cancelled) return
    setBackupMsg(res?.ok
      ? `Saved ${res.summary.verses} verses, ${res.summary.bookmarks} bookmarks and ${res.summary.highlights} highlights to ${res.path}`
      : (res?.error || 'Export failed'))
  }

  const chooseBackup = async () => {
    setBackupBusy('import'); setBackupMsg('')
    const res = await window.electronAPI.backup.preview()
    setBackupBusy('')
    if (res?.cancelled) return
    if (!res?.ok) { setBackupMsg(res?.error || 'Could not read that file'); return }
    setPendingImport({ summary: res.summary, device: res.device, createdAt: res.createdAt })
  }

  const applyBackup = async () => {
    setBackupBusy('import')
    const res = await window.electronAPI.backup.apply()
    setBackupBusy('')
    setPendingImport(null)
    if (!res?.ok) { setBackupMsg(res?.error || 'Import failed'); return }
    // Merge the localStorage-only parts here, where localStorage actually is.
    for (const [key, incoming] of Object.entries(res.local || {})) {
      const merged = mergeLocalJsonArrays(localStorage.getItem(key) || undefined, incoming as string)
      if (merged) localStorage.setItem(key, merged)
    }
    setBackupMsg(`Imported ${res.summary.verses} verses, ${res.summary.bookmarks} bookmarks, ${res.summary.themes} themes. Restarting the view…`)
    // Bookmarks, themes and extensions are all read at startup, so the
    // simplest honest way to show the imported state is a reload.
    setTimeout(() => window.location.reload(), 1200)
  }

  // Encrypted sync (Google Drive)
  const [syncStatus, setSyncStatus] = useState<{ lastSyncAt: number; bookmarks: number; remote: { updatedAt: number; device: string } | null; error: string } | null>(null)
  const [syncPass, setSyncPass] = useState('')
  const [syncBusy, setSyncBusy] = useState<'' | 'push' | 'pull'>('')
  const [syncMsg, setSyncMsg] = useState('')
  const refreshSync = () => window.electronAPI.sync.status().then(setSyncStatus).catch(() => {})
  useEffect(() => { refreshSync() }, [])
  const runSync = async (dir: 'push' | 'pull') => {
    setSyncBusy(dir); setSyncMsg('')
    const res = dir === 'push'
      ? await window.electronAPI.sync.push(syncPass)
      : await window.electronAPI.sync.pull(syncPass)
    setSyncBusy('')
    setSyncMsg(res?.ok
      ? (dir === 'push' ? `Uploaded ${res.uploaded} bookmarks` : `Merged ${res.bookmarks} bookmarks from ${res.from || 'another device'}`)
      : (res?.error || 'Sync failed'))
    refreshSync()
  }

  // Obsidian vault
  const [vault, setVault] = useState<{ vaultPath: string; exists: boolean; isVault: boolean }>({ vaultPath: '', exists: false, isVault: false })
  useEffect(() => { window.electronAPI.obsidian.status().then(setVault).catch(() => {}) }, [])
  const chooseVault = async () => {
    const res = await window.electronAPI.obsidian.chooseVault()
    if (res && !res.cancelled) setVault(res)
  }
  const clearVault = async () => setVault(await window.electronAPI.obsidian.clearVault())

  // Tab strip layout
  const [tabLayout, setTabLayout] = useState<'horizontal' | 'vertical'>('horizontal')
  useEffect(() => {
    window.electronAPI.settings.get()
      .then((cfg: any) => setTabLayout(cfg?.tabLayout === 'vertical' ? 'vertical' : 'horizontal'))
      .catch(() => {})
  }, [])
  const chooseTabLayout = async (next: 'horizontal' | 'vertical') => {
    setTabLayout(next)
    await window.electronAPI.settings.set({ tabLayout: next })
    // The strip lives in App, which is not re-mounted by a settings write —
    // tell it directly so the change is visible without a restart.
    document.dispatchEvent(new CustomEvent('aihub-tab-layout', { detail: next }))
  }

  // Ad & tracker blocking
  const [adblock, setAdblock] = useState<{ enabled: boolean; allowlist: string[]; custom: string[] } | null>(null)
  const [adblockStats, setAdblockStats] = useState<{ total: number; topDomains: Record<string, number> }>({ total: 0, topDomains: {} })
  const [adblockListSize, setAdblockListSize] = useState(0)
  const [customDraft, setCustomDraft] = useState('')

  useEffect(() => {
    let alive = true
    const load = async () => {
      const r = await window.electronAPI.adblock.get()
      if (!alive || !r) return
      setAdblock(r.config); setAdblockStats(r.stats); setAdblockListSize(r.listSize)
    }
    load()
    // The counter only moves while pages are loading, so a slow poll is plenty
    // and costs nothing next to a per-request IPC push.
    const t = setInterval(load, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const toggleAdblock = async () => {
    const next = await window.electronAPI.adblock.setEnabled(!(adblock?.enabled ?? true))
    setAdblock(next)
  }
  const saveCustomDomains = async (raw: string) => {
    const next = await window.electronAPI.adblock.setCustom(
      raw.split(/[\s,]+/).map(d => d.trim()).filter(Boolean))
    setAdblock(next)
  }

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
  const [claudeKeyInput, setClaudeKeyInput] = useState('')
  const [chatGptKeyInput, setChatGptKeyInput] = useState('')
  const [savingAI, setSavingAI] = useState(false)
  const [aiSaved, setAiSaved] = useState(false)
  // OpenRouter catalog — fetched live, never a baked-in list, because the free
  // tier is re-cut without notice and a stale slug is a guaranteed dead request.
  const [orModels, setOrModels] = useState<any[]>([])
  const [orMeta, setOrMeta] = useState<any>(null)
  const [orFilter, setOrFilter] = useState('all')
  const [orLoading, setOrLoading] = useState(false)
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
  // Which reader styles the study room has earned. Read once — the badge list
  // only grows, and Settings is not the place to watch it happen live.
  const [studyBadges, setStudyBadges] = useState<string[]>([])
  useEffect(() => {
    ;(window.electronAPI as any)?.bible?.getStudy?.()
      .then((s: any) => setStudyBadges(Array.isArray(s?.badges) ? s.badges : []))
      .catch(() => {})
  }, [])

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
      // The key is deliberately never sent to the renderer — the field stays
      // empty and shows a masked placeholder instead.
      setAiModelInput(cfg?.openrouterModel || '')
      setAiOllamaUrl(cfg?.ollamaUrl || '')
    })
    loadOrModels()
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
      // Empty means "keep the stored key" — Settings never receives it, so it
      // cannot echo it back, and blanking the field must not wipe it.
      openrouterKey:   aiKeyInput.trim(),
      openrouterModel: aiModelInput.trim(),
      ollamaUrl:       aiOllamaUrl.trim(),
      claudeKey:       claudeKeyInput.trim(),
      chatGptKey:      chatGptKeyInput.trim(),
    })
    setAiKeyInput('')
    setClaudeKeyInput('')
    setChatGptKeyInput('')
    setAiCfg(await window.electronAPI.settings.getAIConfig())
    setAiSaved(true)
    setTimeout(() => setAiSaved(false), 2500)
    setSavingAI(false)
    checkAI()
  }

  // Routing controls save on change — a half-applied provider configuration
  // that only takes effect after a separate Save press is a trap.
  const updateAI = async (patch: any) => {
    setAiCfg((prev: any) => ({ ...prev, ...patch }))
    await window.electronAPI.settings.setAIConfig(patch)
  }

  const loadOrModels = async (refresh = false) => {
    setOrLoading(true)
    try {
      const res = await window.electronAPI.ai.models({ refresh })
      setOrModels(res?.models || [])
      setOrMeta(res)
    } catch {
      // A catalog fetch that fails leaves the previous list and the saved
      // selection exactly as they were (§33).
    } finally {
      setOrLoading(false)
    }
  }

  if (!settings) return <div className="flex items-center justify-center h-full"><Loader2 size={20} className="animate-spin text-aihub-muted" /></div>

  const aiModels = ollamaStatus?.models || []
  const hasCloud = !!(aiCfg?.hasKey ?? aiCfg?.resolvedKey)
  const primary    = aiCfg?.primaryProvider || 'ollama'
  const fallbackOn = aiCfg?.fallbackEnabled !== false
  // Filtering is client-side: the whole catalog is already here, and a
  // round-trip per dropdown change would be a needless stall.
  const filteredOr = orModels.filter(m => matchesFilter(m, orFilter))

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
                  {/* Contrast grade. A theme can look striking as two swatches
                      and still be unreadable in use; this is the number that
                      decides, measured the way WCAG defines it. */}
                  <ContrastBadge theme={t} />
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
      <Section icon={<Bot size={15} />} title="Ollama Models">
        <p className="text-xs text-aihub-muted mb-3">
          Local models live on your device — private, free, and used first.
          Routing between local and cloud is configured in AI Configuration below.
        </p>
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
          Local Ollama answers first. OpenRouter takes over only when Ollama is
          unavailable — or never, if you turn automatic fallback off.
        </p>

        {/* ── Primary ─────────────────────────────────────────────── */}
        <div className="text-[11px] font-semibold tracking-wider text-aihub-muted uppercase mb-2">Primary AI</div>
        <div className={ROW}>
          <div><div className={LBL}>Provider</div></div>
          <select
            value={primary}
            onChange={e => updateAI({ primaryProvider: e.target.value })}
            className="bg-aihub-card border border-aihub-border/40 rounded-lg px-3 py-1.5 text-sm text-aihub-text outline-none">
            <option value="ollama">Local Ollama</option>
            <option value="openrouter">OpenRouter</option>
          </select>
        </div>
        <div className={ROW}>
          <div>
            <div className={LBL}>Model</div>
            {primary === 'ollama' && !aiModels.length && (
              <div className="text-xs text-aihub-muted">No installed models detected</div>
            )}
          </div>
          {primary === 'ollama'
            ? <select value={settings.aiModel || ''} onChange={e => update('aiModel', e.target.value)}
                className="bg-aihub-card border border-aihub-border/40 rounded-lg px-3 py-1.5 text-sm text-aihub-text outline-none max-w-[60%]">
                <option value="">First available</option>
                {aiModels.map((m: string) => <option key={m} value={m}>{m}</option>)}
              </select>
            : <ModelPicker value={aiModelInput} models={filteredOr} all={orModels} onChange={id => { setAiModelInput(id); updateAI({ openrouterModel: id }) }} />}
        </div>
        <div className={ROW}>
          <div><div className={LBL}>Status</div></div>
          <div className="flex items-center gap-2">
            {primary === 'ollama'
              ? (checkingAI
                  ? <Loader2 size={13} className="animate-spin text-aihub-muted" />
                  : ollamaStatus?.running
                    ? <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle2 size={12} /> Connected</span>
                    : <span className="text-xs text-amber-400">Not detected</span>)
              : (hasCloud
                  ? <span className="flex items-center gap-1 text-xs text-blue-400"><CheckCircle2 size={12} /> Configured</span>
                  : <span className="text-xs text-amber-400">No API key</span>)}
            <button onClick={checkAI} disabled={checkingAI} title="Re-check Ollama status"
              className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-aihub-card transition-all">
              <RefreshCw size={11} className={checkingAI ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* ── Fallback ────────────────────────────────────────────── */}
        <div className="text-[11px] font-semibold tracking-wider text-aihub-muted uppercase mt-6 mb-2">Fallback AI</div>
        <div className={ROW}>
          <div>
            <div className={LBL}>Automatic fallback</div>
            <div className="text-xs text-aihub-muted">Switch providers when the primary genuinely fails</div>
          </div>
          <BibleToggle on={fallbackOn} onClick={() => updateAI({ fallbackEnabled: !fallbackOn })} />
        </div>
        {fallbackOn && (
          <>
            <div className={ROW}>
              <div><div className={LBL}>Provider</div></div>
              <select
                value={aiCfg?.fallbackProvider || 'openrouter'}
                onChange={e => updateAI({ fallbackProvider: e.target.value })}
                className="bg-aihub-card border border-aihub-border/40 rounded-lg px-3 py-1.5 text-sm text-aihub-text outline-none">
                <option value="openrouter">OpenRouter</option>
                <option value="ollama">Local Ollama</option>
                <option value="none">None</option>
              </select>
            </div>
            {aiCfg?.fallbackProvider !== 'ollama' && aiCfg?.fallbackProvider !== 'none' && (
              <div className={ROW}>
                <div><div className={LBL}>Model</div></div>
                <ModelPicker value={aiModelInput} models={filteredOr} all={orModels}
                  onChange={id => { setAiModelInput(id); updateAI({ openrouterModel: id }) }} />
              </div>
            )}
            <div className={ROW}>
              <div><div className={LBL}>Status</div></div>
              {aiCfg?.fallbackProvider === 'ollama'
                ? (ollamaStatus?.running
                    ? <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle2 size={12} /> Connected</span>
                    : <span className="text-xs text-amber-400">Not detected</span>)
                : hasCloud
                  ? <span className="flex items-center gap-1 text-xs text-blue-400"><CheckCircle2 size={12} /> Configured</span>
                  : <span className="text-xs text-amber-400">No API key</span>}
            </div>
          </>
        )}

        {/* ── OpenRouter catalog ──────────────────────────────────── */}
        <div className="text-[11px] font-semibold tracking-wider text-aihub-muted uppercase mt-6 mb-2">OpenRouter Models</div>
        <div className={ROW}>
          <div>
            <div className={LBL}>Model filter</div>
            <div className="text-xs text-aihub-muted">
              {orMeta?.stale
                ? 'Unable to refresh OpenRouter models — your saved selection is unchanged.'
                : `${orMeta?.total || 0} models · ${orMeta?.freeCount || 0} free`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select value={orFilter} onChange={e => setOrFilter(e.target.value)}
              className="bg-aihub-card border border-aihub-border/40 rounded-lg px-3 py-1.5 text-sm text-aihub-text outline-none">
              {OR_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <button onClick={() => loadOrModels(true)} disabled={orLoading}
              title="Refresh OpenRouter models"
              className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-aihub-card transition-all">
              <RefreshCw size={11} className={orLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        {orMeta?.selectedDeprecated && (
          <div className="mt-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
            "{orMeta.selected}" is marked deprecated by OpenRouter. Please select another model.
          </div>
        )}
        {orMeta?.selectedMissing && !orMeta?.stale && (
          <div className="mt-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
            "{orMeta.selected}" is no longer in the OpenRouter catalog. Requests will use OpenRouter Free Auto until you pick a replacement.
          </div>
        )}
        <div className="mt-2 text-[11px] text-aihub-muted">
          Free models are subject to OpenRouter's current rate limits and availability.
        </div>

        {/* ── Credentials ─────────────────────────────────────────── */}
        <div className="text-[11px] font-semibold tracking-wider text-aihub-muted uppercase mt-6 mb-2">Credentials</div>
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
              placeholder={aiCfg?.resolvedKey ? `Current: ${aiCfg.resolvedKey} — type a new key to replace` : 'sk-or-v1-…'}
              className="w-full bg-aihub-card border border-aihub-border/40 rounded-xl px-3 py-2 text-sm text-aihub-text placeholder:text-aihub-muted/40 outline-none mt-1"
              style={{ userSelect: 'text' }}
            />
            <div className="text-[11px] text-aihub-muted mt-1">
              Stored by the app's background process and never sent to any page. Get a free key at openrouter.ai.
            </div>
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
          {/* ── Direct provider keys (used as last-tier fallback) ── */}
          <div>
            <div className={LBL}>Claude API Key</div>
            <input
              type="password"
              value={claudeKeyInput}
              onChange={e => setClaudeKeyInput(e.target.value)}
              placeholder={aiCfg?.hasClaudeKey ? 'Key active — type a new key to replace' : 'sk-ant-api…'}
              className="w-full bg-aihub-card border border-aihub-border/40 rounded-xl px-3 py-2 text-sm text-aihub-text placeholder:text-aihub-muted/40 outline-none mt-1"
              style={{ userSelect: 'text' }}
            />
            <div className="text-[11px] text-aihub-muted mt-1">
              Used as a last-resort fallback when both Ollama and OpenRouter can't answer. Get a key at console.anthropic.com.
            </div>
          </div>
          <div>
            <div className={LBL}>ChatGPT API Key</div>
            <input
              type="password"
              value={chatGptKeyInput}
              onChange={e => setChatGptKeyInput(e.target.value)}
              placeholder={aiCfg?.hasChatGptKey ? 'Key active — type a new key to replace' : 'sk-…'}
              className="w-full bg-aihub-card border border-aihub-border/40 rounded-xl px-3 py-2 text-sm text-aihub-text placeholder:text-aihub-muted/40 outline-none mt-1"
              style={{ userSelect: 'text' }}
            />
            <div className="text-[11px] text-aihub-muted mt-1">
              Used as a final-tier fallback. Get a key at platform.openai.com/api-keys.
            </div>
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

        {/* ── Live routing summary (§23) ──────────────────────────── */}
        <div className="mt-6 rounded-xl border border-aihub-border/30 bg-aihub-card/40 px-4 py-3 text-xs space-y-1.5">
          <div className="font-semibold text-aihub-text">AI Routing</div>
          <div className="flex items-center gap-2">
            <span className={ollamaStatus?.running ? 'text-green-400' : 'text-aihub-muted'}>●</span>
            <span className="text-aihub-muted">{primary === 'ollama' ? 'Primary' : 'Fallback'}:</span>
            <span className="text-aihub-text">Local Ollama — {settings.aiModel || 'first available'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={hasCloud ? 'text-blue-400' : 'text-aihub-muted'}>●</span>
            <span className="text-aihub-muted">{primary === 'ollama' ? 'Fallback' : 'Primary'}:</span>
            <span className="text-aihub-text">OpenRouter — {orLabel(aiCfg?.resolvedModel || aiModelInput)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={aiCfg?.hasClaudeKey ? 'text-purple-400' : 'text-aihub-muted'}>●</span>
            <span className="text-aihub-muted">Claude:</span>
            <span className="text-aihub-text">{aiCfg?.hasClaudeKey ? 'Configured' : 'Not set'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={aiCfg?.hasChatGptKey ? 'text-green-400' : 'text-aihub-muted'}>●</span>
            <span className="text-aihub-muted">ChatGPT:</span>
            <span className="text-aihub-text">{aiCfg?.hasChatGptKey ? 'Configured' : 'Not set'}</span>
          </div>
          <div className="text-aihub-muted">Automatic fallback: {fallbackOn ? '✓ Enabled' : '✕ Disabled'}</div>
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
            <div className={LBL}>Version</div>
            <div className="text-xs text-aihub-muted">
              Which translation the reader, the search and the study room all work from
            </div>
          </div>
          <div className="flex gap-1.5">
            {TRANSLATIONS.map(t => (
              <button key={t.id} onClick={() => setBible({ translation: t.id })}
                title={`${t.name} — ${t.language}`}
                className="rounded-xl px-3 py-1.5 text-xs font-medium transition-all"
                style={bible.translation === t.id
                  ? { background: 'rgb(var(--ds-accent) / 0.9)', color: '#fff' }
                  : { background: 'var(--ds-glass-sm)', color: 'rgb(var(--ds-text-4))' }}>
                {t.short}
              </button>
            ))}
          </div>
        </div>

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
            <div className="text-xs text-aihub-muted">
              Aged parchment, or plain modern stock. Linen and midnight are earned in Bible Study.
            </div>
          </div>
          <div className="flex gap-1.5">
            {(['aged', 'clean', 'linen', 'midnight'] as const).map(p => {
              const locked = !['aged', 'clean'].includes(p) && !isUnlocked('paper', p, studyBadges)
              return (
                <button key={p} onClick={() => !locked && setBible({ paper: p })}
                  disabled={locked}
                  title={locked ? lockedHint('paper', p) : undefined}
                  className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-medium capitalize transition-all disabled:cursor-not-allowed disabled:opacity-40"
                  style={bible.paper === p
                    ? { background: 'rgb(var(--ds-accent) / 0.9)', color: '#fff' }
                    : { background: 'var(--ds-glass-sm)', color: 'rgb(var(--ds-text-4))' }}>
                  {locked && <Lock size={10} />}{p}
                </button>
              )
            })}
          </div>
        </div>

        <div className={ROW}>
          <div>
            <div className={LBL}>Binding</div>
            <div className="text-xs text-aihub-muted">The cover you open the book on</div>
          </div>
          <div className="flex gap-1.5">
            {(['oxblood', 'forest', 'midnight'] as const).map(c => {
              const locked = c !== 'oxblood' && !isUnlocked('cover', c, studyBadges)
              return (
                <button key={c} onClick={() => !locked && setBible({ cover: c })}
                  disabled={locked}
                  title={locked ? lockedHint('cover', c) : undefined}
                  className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-medium capitalize transition-all disabled:cursor-not-allowed disabled:opacity-40"
                  style={bible.cover === c
                    ? { background: 'rgb(var(--ds-accent) / 0.9)', color: '#fff' }
                    : { background: 'var(--ds-glass-sm)', color: 'rgb(var(--ds-text-4))' }}>
                  {locked && <Lock size={10} />}{c}
                </button>
              )
            })}
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
              await window.electronAPI.bible.setMarks({ highlights: {}, saved: [], notes: {}, lastRead: null }, { allowEmpty: true })
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
      <Section icon={<Download size={15} />} title="Backup & move to another computer">
        <div className="py-3">
          <div className={LBL}>One file with everything you have made</div>
          <div className="text-xs text-aihub-muted mb-3">
            Saved verses, highlights and Bible notes; every bookmark with its category and colour, so the
            sphere rebuilds exactly as it looks here; sticky notes, remembered sites, watches, custom
            extensions and themes. API keys, tokens and cookies are deliberately left out — a backup file
            is something you email to yourself.
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={exportBackup} disabled={!!backupBusy}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm bg-aihub-accent text-white hover:bg-aihub-accent-glow transition-all disabled:opacity-50">
              {backupBusy === 'export' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Export everything
            </button>
            <button onClick={chooseBackup} disabled={!!backupBusy}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm bg-aihub-card hover:bg-aihub-border/40 text-aihub-text transition-all disabled:opacity-50">
              {backupBusy === 'import' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Import from a file
            </button>
            {!!backupMsg && <span className="text-xs text-aihub-muted flex-1 min-w-[200px]">{backupMsg}</span>}
          </div>
        </div>

        {/* Nothing is written until this is confirmed against real numbers. */}
        {pendingImport && (
          <div className="py-3 px-4 mb-3 rounded-xl" style={{ background: 'rgb(var(--ds-accent) / 0.08)', border: '1px solid rgb(var(--ds-accent) / 0.25)' }}>
            <div className={LBL}>
              Backup from {pendingImport.device} · {new Date(pendingImport.createdAt).toLocaleDateString()}
            </div>
            <div className="text-xs text-aihub-muted mb-2">
              {pendingImport.summary.verses} saved verses · {pendingImport.summary.highlights} highlights ·{' '}
              {pendingImport.summary.bibleNotes} Bible notes · {pendingImport.summary.bookmarks} bookmarks ·{' '}
              {pendingImport.summary.notePages} note pages · {pendingImport.summary.themes} themes
            </div>
            <div className="text-xs text-aihub-muted mb-3">
              These are <span className="text-aihub-text">added to</span> what is already here. Nothing on this
              computer is deleted, and anything you have on both keeps this machine's version.
            </div>
            <div className="flex gap-2">
              <button onClick={applyBackup} disabled={!!backupBusy}
                className="px-4 py-2 rounded-xl text-sm bg-aihub-accent text-white hover:bg-aihub-accent-glow transition-all disabled:opacity-50">
                Import it
              </button>
              <button onClick={() => setPendingImport(null)}
                className="px-4 py-2 rounded-xl text-sm bg-aihub-card hover:bg-aihub-border/40 text-aihub-text transition-all">
                Cancel
              </button>
            </div>
          </div>
        )}
      </Section>

      <Section icon={<RefreshCw size={15} />} title="Sync">
        <div className="py-3">
          <div className={LBL}>Encrypted sync through your own Google Drive</div>
          <div className="text-xs text-aihub-muted mb-3">
            Bookmarks and preferences are encrypted on this machine before they are uploaded, into a hidden
            folder only this app can see. Google stores something it cannot read. API keys, your vault path and
            container cookies never leave the device.
          </div>
          <input
            type="password"
            value={syncPass}
            onChange={e => setSyncPass(e.target.value)}
            placeholder="Sync passphrase — the same one on every device"
            className="w-full px-3 py-2 rounded-xl text-sm bg-aihub-card border border-aihub-border/30 text-aihub-text outline-none focus:border-aihub-accent/60 mb-2"
          />
          <div className="text-[11px] text-amber-400/90 mb-3">
            Only you hold this passphrase. If you lose it, the synced copy cannot be recovered — by us or by Google.
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => runSync('push')} disabled={!syncPass || !!syncBusy}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm bg-aihub-accent text-white hover:bg-aihub-accent-glow transition-all disabled:opacity-50">
              {syncBusy === 'push' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Upload
            </button>
            <button onClick={() => runSync('pull')} disabled={!syncPass || !!syncBusy}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm bg-aihub-card hover:bg-aihub-border/40 text-aihub-text transition-all disabled:opacity-50">
              {syncBusy === 'pull' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Merge from cloud
            </button>
            {!!syncMsg && <span className="text-xs text-aihub-muted">{syncMsg}</span>}
          </div>
        </div>
        <div className={ROW}>
          <div>
            <div className={LBL}>Status</div>
            <div className="text-xs text-aihub-muted">
              {syncStatus?.error
                ? `${syncStatus.error} — connect your Google account in the Gmail section first`
                : syncStatus?.remote
                  ? `Cloud copy from ${syncStatus.remote.device}, ${new Date(syncStatus.remote.updatedAt).toLocaleString()}`
                  : 'Nothing synced yet'}
            </div>
          </div>
          <span className="text-sm text-aihub-muted">{syncStatus?.bookmarks ?? 0} local</span>
        </div>
      </Section>

      <Section icon={<BookMarked size={15} />} title="Obsidian">
        <div className={ROW}>
          <div className="min-w-0 pr-4">
            <div className={LBL}>Vault folder</div>
            <div className="text-xs text-aihub-muted truncate">
              {vault.vaultPath
                ? `${vault.vaultPath}${vault.isVault ? '' : vault.exists ? ' — folder found, but no .obsidian inside' : ' — folder is missing'}`
                : 'Pages, highlights and AI answers you save land here as plain markdown notes'}
            </div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button onClick={chooseVault}
              className="px-4 py-2 rounded-xl text-sm bg-aihub-card hover:bg-aihub-border/40 text-aihub-text transition-all">
              {vault.vaultPath ? 'Change' : 'Choose folder'}
            </button>
            {!!vault.vaultPath && (
              <button onClick={clearVault}
                className="px-3 py-2 rounded-xl text-sm bg-aihub-card hover:bg-aihub-border/40 text-aihub-muted transition-all">
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>
        <div className={ROW}>
          <div>
            <div className={LBL}>How to save</div>
            <div className="text-xs text-aihub-muted">
              Right-click a page → <span className="text-aihub-text">Save Page to Obsidian</span>, or select text first to save just that passage
            </div>
          </div>
          {vault.isVault && <span className="flex items-center gap-1.5 text-xs text-green-400 font-medium"><CheckCircle2 size={13} /> Vault ready</span>}
        </div>
      </Section>

      <Section icon={<Layers size={15} />} title="Startup">
        <div className={ROW}>
          <div>
            <div className={LBL}>Tab strip</div>
            <div className="text-xs text-aihub-muted">A left rail keeps titles readable with many tabs open, and can group them by site</div>
          </div>
          <div className="flex gap-1.5">
            {(['horizontal', 'vertical'] as const).map(opt => (
              <button key={opt} onClick={() => chooseTabLayout(opt)}
                className={`px-3 py-2 rounded-xl text-sm transition-all ${
                  tabLayout === opt ? 'bg-aihub-accent text-white' : 'bg-aihub-card hover:bg-aihub-border/40 text-aihub-text'}`}>
                {opt === 'horizontal' ? 'Top' : 'Left'}
              </button>
            ))}
          </div>
        </div>

        <div className={ROW}>
          <div>
            <div className={LBL}>Reopen my tabs</div>
            <div className="text-xs text-aihub-muted">Start where you left off instead of a blank home tab</div>
          </div>
          <BibleToggle on={restoreSession} onClick={toggleRestoreSession} />
        </div>
      </Section>

      <Section icon={<ShieldBan size={15} />} title="Ad & Tracker Blocking">
        <div className={ROW}>
          <div>
            <div className={LBL}>Block ads and trackers</div>
            <div className="text-xs text-aihub-muted">
              {adblockListSize} known ad, analytics and session-replay domains, blocked before the request leaves your machine
            </div>
          </div>
          <BibleToggle on={adblock?.enabled ?? true} onClick={toggleAdblock} />
        </div>

        <div className={ROW}>
          <div>
            <div className={LBL}>Blocked this session</div>
            <div className="text-xs text-aihub-muted">
              {Object.entries(adblockStats.topDomains)
                .sort((a, b) => b[1] - a[1]).slice(0, 3)
                .map(([d, n]) => `${d} (${n})`).join(' · ') || 'Nothing yet'}
            </div>
          </div>
          <span className="text-sm font-semibold text-aihub-accent">{adblockStats.total.toLocaleString()}</span>
        </div>

        {!!adblock?.allowlist.length && (
          <div className={ROW}>
            <div>
              <div className={LBL}>Allowed sites</div>
              <div className="text-xs text-aihub-muted">Blocking is off on these — click one to re-enable it</div>
            </div>
            <div className="flex flex-wrap gap-1.5 justify-end max-w-[60%]">
              {adblock.allowlist.map(host => (
                <button key={host}
                  onClick={async () => setAdblock(await window.electronAPI.adblock.toggleSite('https://' + host))}
                  className="px-2.5 py-1 rounded-lg text-xs bg-aihub-card hover:bg-aihub-border/40 text-aihub-text">
                  {host} ✕
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="py-3">
          <div className={LBL}>Also block these domains</div>
          <div className="text-xs text-aihub-muted mb-2">One per line or comma separated — subdomains are covered automatically</div>
          <textarea
            value={customDraft || (adblock?.custom || []).join('\n')}
            onChange={e => setCustomDraft(e.target.value)}
            onBlur={e => { saveCustomDomains(e.target.value); setCustomDraft('') }}
            rows={3}
            placeholder="ads.example.com"
            className="w-full px-3 py-2 rounded-xl text-sm bg-aihub-card border border-aihub-border/30 text-aihub-text outline-none focus:border-aihub-accent/60"
          />
        </div>
      </Section>

      <Section icon={<Shield size={15} />} title="Privacy & Data">
        <div className={ROW}>
          <div>
            <div className={LBL}>Encrypted DNS</div>
            <div className="text-xs text-aihub-muted">
              Plain DNS shows every site name to whoever runs the network. Resolving over HTTPS hides it.
            </div>
          </div>
          <div className="flex gap-1.5">
            {(['off', 'cloudflare', 'google', 'quad9'] as const).map(opt => (
              <button key={opt} onClick={() => chooseDoh(opt)}
                className={`px-3 py-2 rounded-xl text-xs capitalize transition-all ${
                  doh === opt ? 'bg-aihub-accent text-white' : 'bg-aihub-card hover:bg-aihub-border/40 text-aihub-text'}`}>
                {opt}
              </button>
            ))}
          </div>
        </div>

        <div className={ROW}>
          <div>
            <div className={LBL}>Sort downloads into folders</div>
            <div className="text-xs text-aihub-muted">Documents, Images, Video, Audio, Archives, Installers, Code — anything else stays put</div>
          </div>
          <BibleToggle on={sortDownloads} onClick={toggleSortDownloads} />
        </div>

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

// Reports how readable a theme actually is. Custom themes carry their own
// variables; built-ins live in globals.css, and their background swatch is the
// honest stand-in for what text will sit on.
function ContrastBadge({ theme }: { theme: any }) {
  const vars: Record<string, string> = theme?.vars || { '--ds-bg': theme?.swatch?.[0], '--ds-accent': theme?.swatch?.[1] }
  const audit = auditTheme(vars, theme?.base === 'light' ? 'light' : 'dark')
  if (!audit.textContrast) return null

  const tone = audit.level === 'fail'
    ? { fg: '#f87171', label: 'Low contrast' }
    : audit.level === 'AA-large'
      ? { fg: '#fbbf24', label: 'AA large only' }
      : { fg: '#34d399', label: audit.level }

  return (
    <div
      style={{ fontSize: 9.5, color: tone.fg, marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}
      title={`Body text contrast ${audit.textContrast.toFixed(1)}:1${audit.issues.length ? ' — ' + audit.issues[0].detail : ''}`}
    >
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: tone.fg, display: 'inline-block' }} />
      {tone.label} · {audit.textContrast.toFixed(1)}:1
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

/** Why a reader style is greyed out — the requirement in the reader's words. */
function lockedHint(kind: UnlockKind, value: string): string {
  const badge = BADGES.find(b => b.unlock?.kind === kind && b.unlock.value === value)
  return badge ? `Locked — ${badge.requirement.toLowerCase()} in Bible Study` : 'Locked'
}
