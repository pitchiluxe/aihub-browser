import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Cpu, Cloud, Loader2, Play, Settings2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useBrowserStore } from '../../store/browserStore'

// Toolbar view of the local AI: is Ollama up, what model is in memory, is it
// generating right now, and — the question users actually have — did the
// last answer come from Ollama or from the cloud? State is pushed from main
// on every AI request ('ai:status'); a slow poll catches Ollama being started
// or quit outside the app.

interface LoadedModel { name: string; size: number; sizeVram: number; expiresAt: string }
interface AiStatus {
  running: boolean
  starting: boolean
  installed: boolean
  base: string
  modelCount: number
  configuredModel: string
  loaded: LoadedModel[]
  generating: boolean
  primaryProvider: 'ollama' | 'openrouter'
  fallbackEnabled: boolean
  fallbackProvider: string
  autoStart: boolean
  lastRoute: { provider: string; model: string; fallbackUsed: boolean; notice?: string; at: number } | null
}

const POLL_MS = 10_000
const GREEN = '#4ade80'
const AMBER = '#fbbf24'
const GREY = '#64748b'

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`
const ago = (at: number) => {
  const s = Math.round((Date.now() - at) / 1000)
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`
}
const providerName = (p: string) => p === 'ollama' ? 'Ollama (local)' : p === 'openrouter' ? 'OpenRouter (cloud)'
  : p === 'claude' ? 'Claude (cloud)' : p === 'chatgpt' ? 'ChatGPT (cloud)' : 'No provider'

export default function OllamaStatusButton({ onOpenSettings }: { onOpenSettings: () => void }) {
  const pushHostOverlay = useBrowserStore(s => s.pushHostOverlay)
  const popHostOverlay = useBrowserStore(s => s.popHostOverlay)
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const btnRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState({ top: 52, right: 14 })

  const refresh = useCallback(() => {
    window.electronAPI.ollama.live().then(setStatus).catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
    const off = window.electronAPI.ollama.onStatus(setStatus)
    const id = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, POLL_MS)
    return () => { off?.(); clearInterval(id) }
  }, [refresh])

  // The tab's BrowserView paints over host HTML; hide it while the panel is open.
  useEffect(() => {
    if (!open) return
    pushHostOverlay()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => { popHostOverlay(); window.removeEventListener('keydown', onKey) }
  }, [open, pushHostOverlay, popHostOverlay])

  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setAnchor({ top: Math.round(r.bottom + 8), right: Math.round(window.innerWidth - r.right) })
    setError('')
    if (!open) refresh()
    setOpen(o => !o)
  }

  const run = async (fn: () => Promise<any>) => {
    setBusy(true); setError('')
    try {
      const r = await fn()
      if (r && r.ok === false) setError(r.error || 'Failed')
    } catch (e: any) { setError(e?.message || String(e)) }
    setBusy(false)
    refresh()
  }

  if (!status) return null

  const cloudPrimary = status.primaryProvider !== 'ollama'
  const lastWasCloud = !!status.lastRoute && status.lastRoute.provider !== 'ollama'
  const loadedName = status.loaded[0]?.name
  const shortModel = (loadedName || status.configuredModel || '').replace(/:latest$/, '')

  const dot = status.starting ? AMBER
    : cloudPrimary || lastWasCloud ? AMBER
    : status.running ? GREEN : GREY
  const label = status.starting ? 'Starting…'
    : cloudPrimary ? 'Cloud AI'
    : !status.running ? 'Ollama off'
    : status.generating ? 'Thinking…'
    : shortModel || 'Ollama'
  const title = cloudPrimary
    ? 'AI is set to OpenRouter (cloud) first. Click to switch to local Ollama.'
    : status.running
      ? `Ollama running${loadedName ? ` · ${loadedName} in memory` : ''}${lastWasCloud ? ' · last answer came from the cloud' : ''}`
      : 'Ollama is not running. Click to start it.'

  return (
    <>
      <button ref={btnRef} onClick={toggle} title={title} aria-label={title}
        className="no-drag flex items-center gap-1.5 rounded-xl"
        style={{
          height: 32, padding: '0 10px', cursor: 'pointer', maxWidth: 160,
          background: 'rgb(var(--ds-glass-sm))', border: `1px solid ${dot}40`, color: 'rgb(var(--ds-text-2))',
        }}>
        {status.starting
          ? <Loader2 size={12} className="animate-spin" style={{ color: AMBER }} />
          : <span className="relative flex h-2 w-2 flex-shrink-0">
              {status.generating && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: dot }} />}
              <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: dot }} />
            </span>}
        {cloudPrimary ? <Cloud size={12} /> : <Cpu size={12} />}
        <span className="truncate" style={{ fontSize: 11, fontWeight: 600 }}>{label}</span>
      </button>

      {open && createPortal(
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 2147483000 }} />
          <div role="dialog" aria-label="Local AI status"
            style={{
              position: 'fixed', top: anchor.top, right: anchor.right, zIndex: 2147483001, width: 320,
              background: 'rgb(var(--ds-bg-2, var(--ds-bg)))', border: '1px solid rgb(var(--ds-glass-md))',
              borderRadius: 14, boxShadow: '0 18px 50px rgba(0,0,0,0.45)', padding: 14, color: 'rgb(var(--ds-text-2))',
            }}>
            <div className="flex items-center gap-2 mb-3">
              <Cpu size={15} style={{ color: dot }} />
              <div className="text-sm font-bold" style={{ color: 'rgb(var(--ds-text-1))' }}>Local AI — Ollama</div>
              <span className="ml-auto text-[10px] font-semibold rounded px-1.5 py-0.5"
                style={{ background: `${status.running ? GREEN : GREY}22`, color: status.running ? GREEN : GREY }}>
                {status.starting ? 'STARTING' : status.running ? (status.generating ? 'GENERATING' : 'RUNNING') : 'STOPPED'}
              </span>
            </div>

            {cloudPrimary && (
              <div className="mb-3 rounded-lg p-2.5 text-[12px]" style={{ background: `${AMBER}14`, border: `1px solid ${AMBER}40` }}>
                <div className="flex items-center gap-1.5 font-semibold" style={{ color: AMBER }}>
                  <AlertTriangle size={12} /> OpenRouter is your primary AI
                </div>
                <div className="mt-1" style={{ color: 'rgb(var(--ds-text-3))' }}>
                  Every request goes to the cloud first; Ollama is only used if it fails.
                </div>
                <button disabled={busy} onClick={() => run(() => window.electronAPI.ollama.usePrimary())}
                  className="mt-2 w-full h-8 rounded-lg text-[12px] font-semibold flex items-center justify-center gap-1.5"
                  style={{ background: GREEN, color: '#05210f' }}>
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Use Ollama first
                </button>
              </div>
            )}

            <dl className="grid grid-cols-[96px_1fr] gap-y-1.5 text-[12px]">
              <dt style={{ color: 'rgb(var(--ds-text-4))' }}>Server</dt>
              <dd className="truncate" title={status.base}>{status.running ? status.base : 'Not running'}</dd>
              <dt style={{ color: 'rgb(var(--ds-text-4))' }}>Model</dt>
              <dd className="truncate">{status.configuredModel || '—'} <span style={{ color: 'rgb(var(--ds-text-4))' }}>({status.modelCount} installed)</span></dd>
              <dt style={{ color: 'rgb(var(--ds-text-4))' }}>In memory</dt>
              <dd>
                {status.loaded.length
                  ? status.loaded.map(m => (
                      <div key={m.name} className="truncate">
                        {m.name} · {gb(m.size)} · {m.sizeVram > 0 ? 'GPU' : 'CPU'}
                      </div>
                    ))
                  : <span style={{ color: 'rgb(var(--ds-text-4))' }}>Nothing loaded (loads on first request)</span>}
              </dd>
              <dt style={{ color: 'rgb(var(--ds-text-4))' }}>Last answer</dt>
              <dd>
                {status.lastRoute
                  ? <span style={{ color: status.lastRoute.provider === 'ollama' ? GREEN : AMBER }}>
                      {providerName(status.lastRoute.provider)}
                      <span style={{ color: 'rgb(var(--ds-text-4))' }}> · {ago(status.lastRoute.at)}</span>
                    </span>
                  : <span style={{ color: 'rgb(var(--ds-text-4))' }}>No AI request yet</span>}
              </dd>
              <dt style={{ color: 'rgb(var(--ds-text-4))' }}>Fallback</dt>
              <dd>{status.fallbackEnabled && status.fallbackProvider !== 'none' ? providerName(status.fallbackProvider) : 'Off'}</dd>
            </dl>

            {status.lastRoute?.fallbackUsed && status.lastRoute.notice && (
              <div className="mt-2 text-[11px] whitespace-pre-line rounded-lg p-2" style={{ background: 'rgb(var(--ds-glass-sm))', color: 'rgb(var(--ds-text-3))' }}>
                {status.lastRoute.notice}
              </div>
            )}
            {error && <div className="mt-2 text-[11px]" style={{ color: '#f87171' }}>{error}</div>}

            <div className="mt-3 flex gap-2">
              {!status.running && (
                <button disabled={busy || status.starting || !status.installed} onClick={() => run(() => window.electronAPI.ollama.start())}
                  title={status.installed ? 'Launch Ollama (its icon appears in the system tray)' : 'Ollama is not installed — get it from ollama.com'}
                  className="flex-1 h-8 rounded-lg text-[12px] font-semibold flex items-center justify-center gap-1.5"
                  style={{ background: status.installed ? GREEN : GREY, color: '#05210f' }}>
                  {busy || status.starting ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                  {status.installed ? 'Start Ollama' : 'Not installed'}
                </button>
              )}
              <button onClick={() => { setOpen(false); onOpenSettings() }}
                className="flex-1 h-8 rounded-lg text-[12px] font-semibold flex items-center justify-center gap-1.5"
                style={{ background: 'rgb(var(--ds-glass-md))', color: 'rgb(var(--ds-text-2))' }}>
                <Settings2 size={12} /> AI settings
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}
