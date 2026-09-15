import React, { useCallback, useEffect, useState } from 'react'
import { Bot, AlertTriangle, Loader2, ShieldCheck, WifiOff, Tag } from 'lucide-react'
import '../../styles/community-guide.css'

/**
 * The guide's switch.
 *
 * Off until the owner turns it on, and the panel has to carry three things a
 * toggle alone cannot: that it runs on *this* machine, that it writes with
 * whichever Ollama model is chosen here, and that it reports rather than
 * removes. People reasonably assume "AI moderation" means the AI deletes
 * things, and saying otherwise in the interface is cheaper than answering it
 * afterwards.
 *
 * The header ring breathes only while the guide is actually running, so the
 * status is readable before any of the text is.
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

  if (!api?.guide) {
    return (
      <Wrap>
        <div className="cg-card" data-running="false">
          <p style={{ color: 'var(--cm-dim)' }}>The guide is unavailable in this build.</p>
        </div>
      </Wrap>
    )
  }
  if (!status) {
    return (
      <Wrap>
        <div className="cg-card" data-running="false">
          <p style={{ color: 'var(--cm-dim)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Loader2 size={14} className="animate-spin" /> Checking Ollama…
          </p>
        </div>
      </Wrap>
    )
  }

  const noModels = status.models.length === 0
  const running = String(status.running)

  return (
    <Wrap>
      <div className="cg-card" data-running={running}>
      <header className="cg-head">
        <div className="cg-orb" data-running={running}>
          <Bot size={20} />
        </div>
        <div>
          <h2 className="cg-title">The community guide</h2>
          <span className="cg-state" data-running={running}>
            {status.running ? 'Listening' : 'Not running'}
          </span>
        </div>
      </header>

      <p className="cg-lede">
        A local model that writes an opening prompt into a room once it has gone
        quiet, and reads new messages for anything a moderator should see. It
        runs on <strong>this machine only</strong>, through Ollama — nothing
        reaches a cloud provider, and no member’s own Ollama is involved.
      </p>

      <div className="cg-note">
        <ShieldCheck size={15} />
        <span>
          <strong>It reports, it never removes.</strong> Anything it flags lands
          in the moderation queue with its reasoning attached, for you to decide
          on. It cannot hide, delete or ban.
        </span>
      </div>
      <div className="cg-note">
        <WifiOff size={15} />
        <span>
          <strong>It has no internet access.</strong> Posts come from the model’s
          own knowledge and the room’s recent messages, so it cannot bring an
          article, a link or a statistic in from outside.
        </span>
      </div>
      <div className="cg-note">
        <Tag size={15} />
        <span>
          <strong>Everything it writes is labelled.</strong> An AI badge sits
          beside the name on every message, every time.
        </span>
      </div>

      <button
        type="button"
        className="cg-switch"
        data-on={String(status.enabled)}
        disabled={busy || noModels}
        aria-pressed={status.enabled}
        onClick={() => void save({ enabled: !status.enabled })}
      >
        <span className="cg-track"><span className="cg-knob" /></span>
        <span>
          <span className="cg-switch-label">Let the guide post and review here</span>
          <span className="cg-switch-hint" style={{ display: 'block' }}>
            {status.enabled ? 'On — it will speak into quiet rooms.' : 'Off — it writes nothing.'}
          </span>
        </span>
      </button>

      <label className="cg-label" htmlFor="cg-model">Model</label>
      {noModels ? (
        <p style={{ color: 'var(--cm-dim)', fontSize: 12.5, lineHeight: 1.6 }}>
          Ollama is not running, or has no models pulled. Install one with{' '}
          <code className="cg-code">ollama pull llama3.2:3b</code>, then reopen
          this page.
        </p>
      ) : (
        <select
          id="cg-model"
          className="cg-select"
          value={status.model}
          disabled={busy}
          onChange={e => void save({ model: e.target.value })}
        >
          <option value="">Choose a model…</option>
          {status.models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      )}

      {/* A switch that is off without saying why sends people to fix the wrong
          thing. The main process decides the reason; this only shows it. */}
      {status.blocker && !status.running && (
        <div className="cg-blocker">
          <AlertTriangle size={14} />
          <span>{status.blocker}</span>
        </div>
      )}

      {error && <p className="cg-error">{error}</p>}

      <p className="cg-foot">
        The guide posts at most twice a day in any one room, and only where
        nobody has spoken for six hours. It will not talk over a conversation.
      </p>
      </div>
    </Wrap>
  )
}

function Wrap({ children }: { children: React.ReactNode }) {
  // Centred with auto margins rather than align-items: centring an overflowing
  // child that way puts its top above the scroll origin, where it cannot be
  // reached — the same trap the welcome screen fell into.
  return (
    <div className="cg cm-scroll flex-1 overflow-y-auto flex justify-center px-6">
      <div className="cg-center">{children}</div>
    </div>
  )
}
