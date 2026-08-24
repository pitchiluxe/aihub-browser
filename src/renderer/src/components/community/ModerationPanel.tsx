import React, { useCallback, useEffect, useState } from 'react'
import { ShieldAlert, Check, Trash2, Gavel, Loader2 } from 'lucide-react'
import type { Message } from '../../../../shared/community'

/**
 * The moderator's review queue.
 *
 * Reported messages are hidden from the room but shown here in full — a
 * moderator cannot judge what they cannot read. Each row offers the three
 * verdicts the store understands and nothing else, so the UI cannot invent a
 * state the rules do not have.
 *
 * Every action is authorised in the main process against the caller's own
 * identity. This component decides which buttons to draw, never who may press
 * them; a renderer that lied about being a moderator would be refused.
 */

interface QueueRow {
  message: Message
  count: number
  hidden: boolean
  reports: { id: string; reason: string; createdAt: number }[]
}

export default function ModerationPanel() {
  const [queue, setQueue] = useState<QueueRow[] | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const api = (window as any).electronAPI?.community

  const load = useCallback(async () => {
    if (!api) return
    try {
      const out = await api.reports()
      if (!out?.ok) { setError(out?.error || 'Could not load reports.'); setQueue([]); return }
      setError('')
      setQueue(out.queue || [])
    } catch (e: any) {
      setError(e?.message || 'Could not load reports.')
      setQueue([])
    }
  }, [api])

  useEffect(() => { void load() }, [load])

  const act = async (messageId: string, action: 'keep' | 'remove' | 'ban') => {
    setBusy(messageId); setError('')
    try {
      const out = await api.resolveReport({ messageId, action })
      if (!out?.ok) setError(out?.error || 'That did not work.')
      await load()
    } catch (e: any) {
      setError(e?.message || 'That did not work.')
    } finally { setBusy('') }
  }

  if (queue === null) {
    return <Padded><Loader2 size={16} className="animate-spin" /> Loading reports…</Padded>
  }

  return (
    <div className="flex-1 overflow-y-auto" style={{ padding: '18px 22px' }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
        <ShieldAlert size={18} style={{ color: '#f87171' }} />
        <h2 style={{ fontSize: 17, fontWeight: 700 }}>Reports</h2>
      </div>
      <p style={{ color: 'rgb(var(--ds-muted))', fontSize: 12.5, marginBottom: 16 }}>
        Messages the room has flagged. Anything reported three times is already
        hidden from everyone else while it waits here.
      </p>

      {error && (
        <div style={{ color: '#f87171', fontSize: 13, marginBottom: 12 }}>{error}</div>
      )}

      {queue.length === 0 && !error && (
        <div style={{
          padding: '28px 20px', textAlign: 'center', borderRadius: 10,
          border: '1px dashed rgb(var(--ds-border))', color: 'rgb(var(--ds-muted))', fontSize: 13,
        }}>
          Nothing to review.
        </div>
      )}

      {queue.map(row => (
        <div key={row.message.id} style={{
          borderRadius: 10, padding: 14, marginBottom: 12,
          background: 'rgb(var(--ds-surface))',
          border: '1px solid rgb(var(--ds-border))',
        }}>
          <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
            <strong style={{ fontSize: 13 }}>{row.message.authorHandle}</strong>
            <span style={{ fontSize: 11, color: 'rgb(var(--ds-muted))' }}>
              in {row.message.channel}
            </span>
            <span style={{
              marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: '#f87171',
              padding: '2px 8px', borderRadius: 99, background: 'rgba(248,113,113,0.12)',
            }}>
              {row.count} {row.count === 1 ? 'report' : 'reports'}
              {row.hidden && ' · hidden'}
            </span>
          </div>

          {/* The reported text in full. A verdict on a truncated message is a
              guess, so this is one of the few places nothing is elided. */}
          <div style={{
            fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            padding: 10, borderRadius: 8, marginBottom: 10,
            background: 'rgb(var(--ds-bg))', border: '1px solid rgb(var(--ds-border))',
          }}>
            {row.message.body}
          </div>

          {row.reports.some(r => r.reason) && (
            <div style={{ fontSize: 11.5, color: 'rgb(var(--ds-muted))', marginBottom: 10 }}>
              Reasons given: {row.reports.map(r => r.reason).filter(Boolean).join(' · ')}
            </div>
          )}

          <div className="flex items-center gap-8" style={{ gap: 8 }}>
            <Verdict onClick={() => act(row.message.id, 'keep')} disabled={busy === row.message.id}
              color="#34d399" icon={<Check size={13} />}>
              Keep
            </Verdict>
            <Verdict onClick={() => act(row.message.id, 'remove')} disabled={busy === row.message.id}
              color="#fbbf24" icon={<Trash2 size={13} />}>
              Remove
            </Verdict>
            <Verdict onClick={() => act(row.message.id, 'ban')} disabled={busy === row.message.id}
              color="#f87171" icon={<Gavel size={13} />}>
              Remove &amp; ban
            </Verdict>
          </div>
        </div>
      ))}
    </div>
  )
}

function Verdict({ children, color, icon, ...rest }: {
  children: React.ReactNode; color: string; icon: React.ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className="flex items-center gap-1.5"
      style={{
        fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 7,
        color, background: `${color}14`, border: `1px solid ${color}38`,
        cursor: rest.disabled ? 'not-allowed' : 'pointer',
        opacity: rest.disabled ? 0.5 : 1,
      }}>
      {icon}{children}
    </button>
  )
}

function Padded({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex items-center justify-center gap-2"
         style={{ color: 'rgb(var(--ds-muted))', fontSize: 13 }}>
      {children}
    </div>
  )
}
