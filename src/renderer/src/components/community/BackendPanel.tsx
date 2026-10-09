import React, { useEffect, useState } from 'react'
import {
  Cloud, CloudOff, Loader2, AlertCircle, CheckCircle2, Plus, Trash2, ShieldAlert, X, Radio, FileKey,
} from 'lucide-react'

/**
 * Where the community lives.
 *
 * This panel exists because of a bug report that was not really a bug: five
 * devices, five people, and each one showing ONLINE — 1. Nothing was broken —
 * there was simply no server, and nothing on screen ever said so. A feature
 * that silently does half of what its name promises is worse than one that
 * refuses, so the first thing this panel does, before any field, is state
 * plainly what the current setup can and cannot do.
 *
 * The anon key is write-only from here. It is never read back out of the main
 * process, so a configured device shows "configured" and offers to replace it.
 */

interface IceServer {
  urls: string
  username?: string
  credential?: string
}

interface BackendState {
  configured: boolean
  url: string
  iceServers: IceServer[]
  insecureStorage: boolean
  livekit: { configured: boolean; url: string; apiKey: string }
  network: 'local' | 'connecting' | 'remote' | 'error'
  error: string | null
}

const EMPTY: BackendState = {
  configured: false, url: '', iceServers: [],
  insecureStorage: false,
  livekit: { configured: false, url: '', apiKey: '' },
  network: 'local', error: null,
}

export default function BackendPanel({ onClose }: { onClose: () => void }) {
  const api = (window as any).electronAPI?.community

  const [state, setState] = useState<BackendState>(EMPTY)
  const [url, setUrl] = useState('')
  const [anonKey, setAnonKey] = useState('')
  const [ice, setIce] = useState<IceServer[]>([])
  const [lkUrl, setLkUrl] = useState('')
  const [lkKey, setLkKey] = useState('')
  const [lkSecret, setLkSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** Variable NAMES from the last import. The main process never returns
   *  values, so there is nothing secret to leak onto the screen here. */
  const [imported, setImported] = useState<{
    found: string[]; missing: string[]; refused: string[]
  } | null>(null)

  const load = async () => {
    const next = await api?.backend?.get?.()
    if (!next) return
    setState(next)
    setUrl(next.url ?? '')
    setIce(next.iceServers ?? [])
    setLkUrl(next.livekit?.url ?? '')
    setLkKey(next.livekit?.apiKey ?? '')
  }

  useEffect(() => { void load() }, [])

  // The main process announces connection changes; without this the panel
  // would sit on "Connecting…" until someone closed and reopened it.
  useEffect(() => {
    const off = api?.onBackendStatus?.((next: { network: BackendState['network']; error: string | null }) => {
      setState(prev => ({ ...prev, ...next }))
    })
    return () => off?.()
  }, [api])

  const save = async () => {
    setBusy(true)
    setError('')
    const result = await api?.backend?.set?.({
      url,
      anonKey,
      iceServers: ice.filter(server => server.urls.trim()),
      // Blank secret means keep the stored one — the main process merges it.
      livekit: { url: lkUrl, apiKey: lkKey, apiSecret: lkSecret },
    })
    setBusy(false)
    if (result?.ok === false) { setError(result.error); return }
    setAnonKey('')
    setLkSecret('')
    await load()
  }

  const importEnv = async () => {
    setBusy(true)
    setError('')
    const result = await api?.backend?.importEnv?.()
    setBusy(false)

    if (!result || result.cancelled) return
    if (result.ok === false) {
      setError(result.error)
      setImported(result.missing || result.refused
        ? { found: [], missing: result.missing ?? [], refused: result.refused ?? [] }
        : null)
      return
    }
    setImported({
      found: result.found ?? [],
      missing: result.missing ?? [],
      refused: result.refused ?? [],
    })
    await load()
  }

  const disconnect = async () => {
    setBusy(true)
    await api?.backend?.clear?.()
    setBusy(false)
    setAnonKey('')
    await load()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: 'rgb(0 0 0 / .55)' }} role="dialog" aria-modal="true">
      <div className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl"
           style={{ background: 'var(--cm-shell)', border: '1px solid var(--cm-line)' }}>

        <header className="flex items-center gap-2 px-5 py-4"
                style={{ borderBottom: '1px solid var(--cm-line)' }}>
          <Cloud className="h-4 w-4" style={{ color: 'var(--cm-accent)' }} />
          <h2 className="flex-1 text-sm font-semibold" style={{ color: 'var(--cm-ink)' }}>
            Community backend
          </h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-[var(--cm-hover)]">
            <X className="h-4 w-4" style={{ color: 'var(--cm-dim)' }} />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <ConnectionLine network={state.network} error={state.error} />

          <p className="text-xs leading-relaxed" style={{ color: 'var(--cm-dim)' }}>
            {state.configured
              ? 'Every device signed in to this project shares one community: the same members, '
                + 'the same messages, and the same voice rooms.'
              : 'Until a project is connected, this community exists only on this computer. '
                + 'Your messages reach nobody else, and nobody else appears in the member list — '
                + 'even if they are running AIHub on the same network.'}
          </p>

          {/*
            Five devices times five fields is twenty-five hand-copied values,
            two of them a JWT and a signing secret. A dropped character there
            produces a connection that reads fine and silently refuses every
            write, so the fastest path is not to type them at all.
          */}
          <div className="flex items-center gap-2 rounded-lg p-2.5"
               style={{ background: 'var(--cm-void)', border: '1px dashed var(--cm-line)' }}>
            <FileKey className="h-4 w-4 shrink-0" style={{ color: 'var(--cm-dim)' }} />
            <p className="min-w-0 flex-1 text-[11px] leading-relaxed" style={{ color: 'var(--cm-dim)' }}>
              Already have these in a <code>.env</code> file? Import it instead of
              retyping. Nothing is shown back to the screen.
            </p>
            <button
              onClick={importEnv}
              disabled={busy}
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--cm-hover)]"
              style={{ color: 'var(--cm-accent)', border: '1px solid var(--cm-line)' }}
            >
              Import…
            </button>
          </div>

          {imported && (
            <div className="space-y-1 rounded-lg p-2.5 text-[11px]"
                 style={{ background: 'color-mix(in srgb, var(--cm-accent) 10%, transparent)' }}>
              <p style={{ color: 'var(--cm-accent)' }}>
                Imported {imported.found.length} value{imported.found.length === 1 ? '' : 's'}:{' '}
                {imported.found.join(', ')}
              </p>
              {imported.missing.length > 0 && (
                <p style={{ color: 'var(--cm-warn)' }}>
                  Not in that file: {imported.missing.join(', ')} — fill those in below.
                </p>
              )}
              {imported.refused.length > 0 && (
                <p style={{ color: 'var(--cm-warn)' }}>
                  Skipped {imported.refused.join(', ')} on purpose: a service-role key
                  bypasses every access rule and must not live in a desktop app.
                </p>
              )}
            </div>
          )}

          <Field label="Project URL" hint="Supabase → Settings → API → Project URL">
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://yourproject.supabase.co"
              spellCheck={false}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--cm-void)', border: '1px solid var(--cm-line)', color: 'var(--cm-ink)' }}
            />
          </Field>

          <Field
            label="Anon key"
            hint="Supabase → Settings → API → Project API keys → anon public"
          >
            <input
              value={anonKey}
              onChange={e => setAnonKey(e.target.value)}
              type="password"
              spellCheck={false}
              placeholder={state.configured ? 'Configured — paste a new key to replace it' : 'eyJhbGciOi…'}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--cm-void)', border: '1px solid var(--cm-line)', color: 'var(--cm-ink)' }}
            />
          </Field>

          {state.insecureStorage && (
            <p className="flex items-start gap-2 rounded-lg p-2.5 text-xs"
               style={{ background: 'color-mix(in srgb, var(--cm-warn) 14%, transparent)', color: 'var(--cm-warn)' }}>
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                This computer has no keychain available, so the key is stored readable on disk.
                It still works; you should know it is not encrypted.
              </span>
            </p>
          )}

          <section className="space-y-3 rounded-lg p-3"
                   style={{ background: 'var(--cm-void)', border: '1px solid var(--cm-line)' }}>
            <div className="flex items-center gap-2">
              <Radio className="h-3.5 w-3.5" style={{ color: 'var(--cm-accent)' }} />
              <p className="flex-1 text-xs font-semibold" style={{ color: 'var(--cm-ink)' }}>
                LiveKit — voice, video and screen share
              </p>
              {state.livekit.configured && (
                <span className="text-[11px]" style={{ color: 'var(--cm-accent)' }}>Configured</span>
              )}
            </div>

            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--cm-faint)' }}>
              Without this, calls connect device-to-device and only reach the
              windows of this app. With it, a media server relays them — screen
              share works between every device, on any network, with nothing else
              to configure.
            </p>

            <Field label="LiveKit URL" hint="LiveKit Cloud → Project → Settings → Project URL">
              <input
                value={lkUrl}
                onChange={e => setLkUrl(e.target.value)}
                placeholder="wss://yourproject.livekit.cloud"
                spellCheck={false}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: 'var(--cm-shell)', border: '1px solid var(--cm-line)', color: 'var(--cm-ink)' }}
              />
            </Field>

            <Field label="API key" hint="LiveKit → Settings → Keys">
              <input
                value={lkKey}
                onChange={e => setLkKey(e.target.value)}
                placeholder="APIxxxxxxxx"
                spellCheck={false}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: 'var(--cm-shell)', border: '1px solid var(--cm-line)', color: 'var(--cm-ink)' }}
              />
            </Field>

            <Field
              label="API secret"
              hint="Stays on this computer. It signs your join tokens and is never sent to the page."
            >
              <input
                value={lkSecret}
                onChange={e => setLkSecret(e.target.value)}
                type="password"
                spellCheck={false}
                placeholder={state.livekit.configured ? 'Configured — paste a new secret to replace it' : ''}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: 'var(--cm-shell)', border: '1px solid var(--cm-line)', color: 'var(--cm-ink)' }}
              />
            </Field>
          </section>

          <Field
            label="STUN and TURN servers"
            hint={state.livekit.configured
              ? 'Not used while LiveKit is configured — the media server handles traversal itself.'
              : 'Leave empty on one network. Add a server when someone joins from elsewhere.'}
          >
            <div className="space-y-2">
              {ice.map((server, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    value={server.urls}
                    onChange={e => setIce(list => list.map((s, i) =>
                      i === index ? { ...s, urls: e.target.value } : s))}
                    placeholder="stun:stun.l.google.com:19302"
                    spellCheck={false}
                    className="min-w-0 flex-1 rounded-lg px-3 py-2 text-xs outline-none"
                    style={{ background: 'var(--cm-void)', border: '1px solid var(--cm-line)', color: 'var(--cm-ink)' }}
                  />
                  <button
                    onClick={() => setIce(list => list.filter((_, i) => i !== index))}
                    aria-label="Remove this server"
                    className="rounded-lg p-2 hover:bg-[var(--cm-hover)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" style={{ color: 'var(--cm-danger)' }} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => setIce(list => [...list, { urls: '' }])}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs hover:bg-[var(--cm-hover)]"
                style={{ color: 'var(--cm-dim)' }}
              >
                <Plus className="h-3.5 w-3.5" /> Add a server
              </button>
            </div>
          </Field>

          {error && (
            <p className="flex items-start gap-2 text-xs" style={{ color: 'var(--cm-danger)' }} role="alert">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </p>
          )}
        </div>

        <footer className="flex items-center gap-2 px-5 py-4"
                style={{ borderTop: '1px solid var(--cm-line)' }}>
          {state.configured && (
            <button
              onClick={disconnect}
              disabled={busy}
              className="rounded-lg px-3 py-2 text-sm"
              style={{ color: 'var(--cm-danger)' }}
            >
              Disconnect
            </button>
          )}
          <span className="flex-1" />
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm" style={{ color: 'var(--cm-dim)' }}>
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy || !url.trim() || (!state.configured && !anonKey.trim())}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40"
            style={{ background: 'var(--cm-accent)', color: '#08131a' }}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {state.configured ? 'Save and reconnect' : 'Connect'}
          </button>
        </footer>
      </div>
    </div>
  )
}

function ConnectionLine({ network, error }: { network: BackendState['network']; error: string | null }) {
  const look = {
    local:      { icon: CloudOff, tone: 'var(--cm-warn)',   text: 'This computer only' },
    connecting: { icon: Loader2,  tone: 'var(--cm-dim)',    text: 'Connecting…' },
    remote:     { icon: CheckCircle2, tone: 'var(--cm-accent)', text: 'Connected' },
    error:      { icon: AlertCircle, tone: 'var(--cm-danger)', text: 'Not connected' },
  }[network]

  const Icon = look.icon

  return (
    <div className="flex items-start gap-2 rounded-lg p-3"
         style={{ background: 'var(--cm-void)', border: '1px solid var(--cm-line)' }}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${network === 'connecting' ? 'animate-spin' : ''}`}
            style={{ color: look.tone }} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium" style={{ color: look.tone }}>{look.text}</p>
        {/* Verbatim from the main process. A translated or prettified error is
            an error the user cannot search for. */}
        {error && (
          <p className="mt-0.5 break-words text-xs" style={{ color: 'var(--cm-dim)' }}>{error}</p>
        )}
      </div>
    </div>
  )
}

function Field({ label, hint, children }: {
  label: string; hint: string; children: React.ReactNode
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs font-medium" style={{ color: 'var(--cm-ink)' }}>{label}</span>
      {children}
      <span className="block text-[11px]" style={{ color: 'var(--cm-faint)' }}>{hint}</span>
    </label>
  )
}
