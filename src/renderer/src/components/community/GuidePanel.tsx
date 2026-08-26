import React, { useCallback, useEffect, useState } from 'react'
import { Bot, AlertTriangle, Loader2 } from 'lucide-react'

/**
 * The guide's switch.
 *
 * Off until the owner turns it on, and the panel has to explain three things
 * a toggle alone cannot: that it runs on *this* machine, that it writes with
 * whichever Ollama model is chosen here, and that it reports rather than
 * removes. People reasonably assume "AI moderation" means the AI deletes
 * things; saying otherwise in the interface is cheaper than answering it
 * later.
 */

interface Status {
  enabled: boolean
  model: string
  models: string[]
  running: boolean
  blocker: string | null
}

export default function GuidePanel() {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const api = (window as any).electronAPI?.community

  const load = useCallback(async () => {
    if (!api?.guide) return
    try { setStatus(await api.guide.status()) } catch { setStatus(null) }
  }, [api])

  useEffect(() => { void load() }, [load])

  const save = async (patch: { enabled?: boolean; model?: string }) => {
    setBusy(true); setError('')
    try {
      const out = await api.guide.set(patch)
      if (!out?.ok) setError(out?.error || 'Could not save that.')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Could not save that.')
    } finally { setBusy(false) }
  }

  if (!api?.guide) return <Wrap><p style={dim}>The guide is unavailable in this build.</p></Wrap>
  if (!status) {
    return <Wrap><p style={dim}><Loader2 size={14} className="inline animate-spin" /> Checking Ollama…</p></Wrap>
  }

  const noModels = status.models.length === 0

  return (
    <Wrap>
      <div className="flex items-center gap-2.5 mb-1">
        <Bot size={18} style={{ color: '#33d6c8' }} />
        <h2 style={{ fontSize: 17, fontWeight: 600 }}>The community guide</h2>
        {status.running && (
          <span className="rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide"
                style={{ background: '#33d6c822', color: '#33d6c8' }}>
            running
          </span>
        )}
      </div>

      <p style={{ ...dim, lineHeight: 1.6, marginBottom: 16 }}>
        A local model that writes an opening prompt into a room once it has gone
        quiet, and reads new messages for anything a moderator should see. It
        runs on <strong>this machine only</strong>, using Ollama — nothing is
        sent to a cloud provider, and no member’s own Ollama is involved.
      </p>

      <Note>
        It reports, it never removes. Anything it flags lands in the moderation
        queue with its reasoning attached, for you to decide on. It cannot hide,
        delete or ban.
      </Note>
      <Note>
        It has no internet access. Posts are written from the model’s own
        knowledge and the room’s recent messages, so it cannot bring an article,
        a link or a statistic in from outside.
      </Note>
      <Note>
        Everything it writes is labelled <strong>AI</strong> beside the name,
        every time.
      </Note>

      <label className="flex items-start gap-2.5 mt-5" style={{ cursor: noModels ? 'not-allowed' : 'pointer' }}>
        <input
          type="checkbox"
          checked={status.enabled}
          disabled={busy || noModels}
          onChange={e => void save({ enabled: e.target.checked })}
          style={{ marginTop: 3, accentColor: '#33d6c8' }}
        />
        <span style={{ fontSize: 13.5 }}>
          Let the guide post and review in this community.
        </span>
      </label>

      <label style={{ ...label, marginTop: 18 }}>Model</label>
      {noModels ? (
        <p style={{ ...dim, fontSize: 12.5 }}>
          Ollama is not running, or has no models pulled. Install a model with{' '}
          <code style={code}>ollama pull llama3.2:3b</code> and reopen this page.
        </p>
      ) : (
        <select
          value={status.model}
          disabled={busy}
          onChange={e => void save({ model: e.target.value })}
          className="w-full rounded-lg px-3 py-2"
          style={{
            background: 'var(--cm-stage)', color: 'var(--cm-ink)',
            border: '1px solid var(--cm-line)', fontSize: 13.5,
          }}
        >
          <option value="">Choose a model…</option>
          {status.models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      )}

      {/* A switch that is off without saying why sends people to fix the wrong
          thing. The main process decides the reason; this only shows it. */}
      {status.blocker && !status.running && (
        <p className="mt-3 flex items-start gap-2" style={{ ...dim, fontSize: 12.5 }}>
          <AlertTriangle size={13} style={{ color: 'var(--cm-warn)', marginTop: 2, flexShrink: 0 }} />
          <span>{status.blocker}</span>
        </p>
      )}

      {error && <p className="mt-3" style={{ color: 'var(--cm-danger)', fontSize: 12.5 }}>{error}</p>}

      <p className="mt-5" style={{ ...dim, fontSize: 12 }}>
        The guide posts at most twice a day per room, and only where nobody has
        spoken for six hours. It will not talk over a conversation.
      </p>
    </Wrap>
  )
}

const dim: React.CSSProperties = { color: 'var(--cm-dim)' }
const label: React.CSSProperties = {
  display: 'block', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.18em',
  textTransform: 'uppercase', color: 'var(--cm-faint)', marginBottom: 7,
}
const code: React.CSSProperties = {
  background: 'var(--cm-stage)', padding: '1px 5px', borderRadius: 4, fontSize: 12,
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="cm-scroll flex-1 overflow-y-auto p-6">
      <div style={{ maxWidth: 560 }}>{children}</div>
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg px-3.5 py-2.5 mb-2"
      style={{
        background: 'var(--cm-stage)', border: '1px solid var(--cm-line)',
        fontSize: 12.5, lineHeight: 1.55, color: 'var(--cm-dim)',
      }}
    >
      {children}
    </div>
  )
}
