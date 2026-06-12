import React, { useState, useEffect } from 'react'
import { Palette, Bot, Shield, Info, CheckCircle2, Loader2, RefreshCw, Download, Wifi, Brain, Globe } from 'lucide-react'
import { useBrowserStore } from '../../store/browserStore'

const S = 'px-8 py-6 border-b border-aihub-border/20'
const LBL = 'text-sm font-semibold text-aihub-text mb-0.5'
const DESC = 'text-xs text-aihub-muted mb-3'
const ROW = 'flex items-center justify-between py-3 border-b border-aihub-border/15 last:border-0'

const TRANSPARENCY = [
  { value: 'none',   label: 'Solid',   desc: 'Standard window' },
  { value: 'acrylic', label: 'Aero',   desc: 'Frosted glass blur (Win 10/11)' },
  { value: 'mica',   label: 'Mica',    desc: 'Tinted material (Win 11 only)' },
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

  useEffect(() => {
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
  }, [])

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
    const updated = { ...settings, [key]: value }
    setSettings(updated)
    await window.electronAPI.settings.set({ [key]: value })
  }

  const applyTransparency = async (mode: string) => {
    await update('transparency', mode)
    await window.electronAPI.window.setTransparency(mode)
  }

  const applyTheme = async (theme: string) => {
    await update('theme', theme)
    document.dispatchEvent(new CustomEvent('aihub-theme-change', { detail: theme }))
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
          <div className={LBL}>Color Theme</div>
          <div className={DESC}>Choose between dark and light interface</div>
          <div className="flex gap-2">
            {[
              { value: 'dark',  label: 'Dark',  icon: '🌙', desc: 'Deep navy, easy on eyes' },
              { value: 'light', label: 'Light', icon: '☀️', desc: 'Clean white, high contrast' },
            ].map(opt => {
              const active = (settings.theme || 'dark') === opt.value
              const isLight = settings.theme === 'light'
              return (
                <button key={opt.value} onClick={() => applyTheme(opt.value)}
                  style={{
                    flex: 1, padding: '10px 12px', borderRadius: 12, textAlign: 'left',
                    border: active
                      ? `1.5px solid ${isLight ? '#2563eb' : '#3b82f6'}`
                      : `1px solid ${isLight ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.1)'}`,
                    background: active
                      ? isLight
                        ? 'linear-gradient(135deg, rgba(37,99,235,0.1), rgba(124,58,237,0.07))'
                        : 'linear-gradient(135deg, rgba(59,130,246,0.18), rgba(99,102,241,0.1))'
                      : isLight ? 'rgba(15,23,42,0.04)' : 'rgba(255,255,255,0.03)',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6,
                    color: active ? (isLight ? '#2563eb' : '#60a5fa') : (isLight ? '#374151' : '#e2e8f0') }}>
                    <span>{opt.icon}</span>{opt.label}
                  </div>
                  <div style={{ fontSize: 11, color: active ? (isLight ? '#3b82f6' : '#93c5fd') : (isLight ? '#94a3b8' : '#475569') }}>{opt.desc}</div>
                </button>
              )
            })}
          </div>
        </div>
        <div className="mb-4">
          <div className={LBL}>Window Style</div>
          <div className={DESC}>Glass transparency effect — requires restart to fully apply</div>
          <div className="flex gap-2">
            {TRANSPARENCY.map(opt => {
              const active = settings.transparency === opt.value
              return (
                <button key={opt.value} onClick={() => applyTransparency(opt.value)}
                  style={{
                    flex: 1, padding: '10px 12px', borderRadius: 12, textAlign: 'left',
                    border: active ? '1.5px solid #3b82f6' : '1px solid rgba(255,255,255,0.1)',
                    background: active
                      ? 'linear-gradient(135deg, rgba(59,130,246,0.18), rgba(99,102,241,0.1))'
                      : 'rgba(255,255,255,0.03)',
                    cursor: 'pointer',
                    boxShadow: active ? '0 0 16px rgba(59,130,246,0.18)' : 'none',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'
                  }}
                  onMouseLeave={e => {
                    if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: active ? '#60a5fa' : '#e2e8f0', marginBottom: 2 }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: active ? '#93c5fd' : '#475569' }}>{opt.desc}</div>
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
        <div className={ROW}><div className={LBL}>AIHub Browser</div><span className="text-sm text-aihub-muted">v1.0.0</span></div>
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
