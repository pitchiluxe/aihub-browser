import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ShieldAlert, ShieldCheck, Check, Trash2, Gavel, AlertCircle, EyeOff } from 'lucide-react'
import type { Message } from '../../../../shared/community'
import { Avatar, timeOf, dayOf } from './bits'
import '../../styles/community-reports.css'

/**
 * The moderator's review queue.
 *
 * Reported messages are hidden from the room but shown here in full — a
 * moderator cannot judge what they cannot read. Each case offers the three
 * verdicts the store understands and nothing else, so the UI cannot invent a
 * state the rules do not have.
 *
 * The design carries the one thing this panel means: severity. A moderator
 * with ten minutes needs to know where to spend them before reading anything,
 * so each case wears a coloured spine that thickens and warms with the report
 * count. The queue is legible as a shape.
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

/** Severity from the report count. Three is the store's auto-hide threshold. */
export function severityOf(count: number): 'low' | 'mid' | 'high' {
  if (count >= 5) return 'high'
  if (count >= 3) return 'mid'
  return 'low'
}

/**
 * Identical complaints collapsed and counted.
 *
 * Five people writing "spam" is one fact about the message, not five things to
 * read. Grouping is case- and space-insensitive because the reasons are typed
 * by hand.
 */
export function groupReasons(reports: { reason: string }[]): { reason: string; count: number }[] {
  const byKey = new Map<string, { reason: string; count: number }>()
  for (const r of reports || []) {
    const reason = String(r?.reason || '').trim()
    if (!reason) continue
    const key = reason.toLowerCase().replace(/\s+/g, ' ')
    const found = byKey.get(key)
    if (found) found.count++
    else byKey.set(key, { reason, count: 1 })
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
}

/** The oldest report still waiting, so the header can say how stale the queue is. */
export function oldestReportAt(queue: QueueRow[]): number | null {
  let oldest: number | null = null
  for (const row of queue || []) {
    for (const r of row.reports || []) {
      if (typeof r?.createdAt !== 'number') continue
      if (oldest === null || r.createdAt < oldest) oldest = r.createdAt
    }
  }
  return oldest
}

const VERDICT_WORD: Record<'keep' | 'remove' | 'ban', string> = {
  keep: 'Kept — the message stays and the reports are cleared.',
  remove: 'Removed from the room.',
  ban: 'Removed, and the author is banned.',
}

export default function ModerationPanel() {
  const [queue, setQueue] = useState<QueueRow[] | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
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
      if (!out?.ok) { setError(out?.error || 'That did not work.'); return }
      // Say what happened before the case disappears. A verdict that removes
      // the row instantly gives a mis-click nothing to notice.
      setDone(VERDICT_WORD[action])
      setTimeout(() => setDone(''), 3200)
      await load()
    } catch (e: any) {
      setError(e?.message || 'That did not work.')
    } finally { setBusy('') }
  }

  const stats = useMemo(() => {
    const rows = queue || []
    const oldest = oldestReportAt(rows)
    return {
      cases: rows.length,
      hidden: rows.filter(r => r.hidden).length,
      reports: rows.reduce((n, r) => n + r.count, 0),
      oldest,
    }
  }, [queue])

  return (
    <div className="cr">
     <div className="cr-inner">
      <div className="cr-head">
        <div className="cr-badge">
          {stats.cases ? <ShieldAlert size={18} /> : <ShieldCheck size={18} />}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="cr-title">
            {queue === null ? 'Reports'
              : stats.cases === 0 ? 'Nothing to review'
              : `${stats.cases} ${stats.cases === 1 ? 'case' : 'cases'} to review`}
          </div>
          <p className="cr-sub">
            Messages the room has flagged. Anything reported three times is
            already hidden from everyone else while it waits here.
          </p>
        </div>
      </div>

      {!!stats.cases && (
        <div className="cr-stats">
          <div className="cr-stat">
            <div className="cr-stat-n">{stats.reports}</div>
            <div className="cr-stat-l">reports filed</div>
          </div>
          <div className="cr-stat">
            <div className="cr-stat-n">{stats.hidden}</div>
            <div className="cr-stat-l">hidden from room</div>
          </div>
          <div className="cr-stat">
            <div className="cr-stat-n" style={{ fontSize: 14, paddingTop: 4 }}>
              {stats.oldest ? dayOf(stats.oldest) : '—'}
            </div>
            <div className="cr-stat-l">oldest waiting</div>
          </div>
        </div>
      )}

      {error && (
        <div className="cr-error"><AlertCircle size={14} /> {error}</div>
      )}

      {done && (
        <div className="cr-done" role="status"><Check size={14} /> {done}</div>
      )}

      {queue === null && (
        <>
          <div className="cr-skel" />
          <div className="cr-skel" />
          <div className="cr-skel" />
        </>
      )}

      {queue !== null && queue.length === 0 && !error && (
        <div className="cr-empty">
          <div className="cr-empty-ring"><ShieldCheck size={24} /></div>
          <div className="cr-empty-t">The queue is clear</div>
          <div className="cr-empty-d">
            Reported messages arrive here automatically. Nothing is hidden from
            the room until three separate people have flagged it.
          </div>
        </div>
      )}

      {(queue || []).map(row => {
        const reasons = groupReasons(row.reports)
        const isBusy = busy === row.message.id
        return (
          <div
            key={row.message.id}
            className="cr-case"
            data-sev={severityOf(row.count)}
            data-busy={isBusy ? 'true' : 'false'}
          >
            <div className="cr-case-head">
              <Avatar seed={row.message.authorSeed} size={26} />
              <div style={{ minWidth: 0 }}>
                <div className="cr-who">{row.message.authorHandle}</div>
                <div className="cr-where">
                  #{row.message.channel} · {dayOf(row.message.createdAt)} at {timeOf(row.message.createdAt)}
                </div>
              </div>
              <div className="cr-spacer" />
              {row.hidden && (
                <span className="cr-chip" data-tone="hidden">
                  <EyeOff size={10} /> hidden
                </span>
              )}
              <span className="cr-chip" data-tone="count">
                {row.count} {row.count === 1 ? 'report' : 'reports'}
              </span>
            </div>

            {/* The reported text in full. A verdict on a truncated message is a
                guess, so this is one of the few places nothing is elided. */}
            <div className="cr-quote">{row.message.body}</div>

            {reasons.length > 0 && (
              <div className="cr-reasons">
                {reasons.map(r => (
                  <span key={r.reason} className="cr-reason" title={r.reason}>
                    {r.reason}{r.count > 1 && <> <b>×{r.count}</b></>}
                  </span>
                ))}
              </div>
            )}

            <div className="cr-actions">
              <button className="cr-btn" data-kind="keep" disabled={isBusy}
                onClick={() => act(row.message.id, 'keep')}>
                <Check size={13} /> Keep
              </button>
              <button className="cr-btn" data-kind="remove" disabled={isBusy}
                onClick={() => act(row.message.id, 'remove')}>
                <Trash2 size={13} /> Remove
              </button>
              {/* Pushed away from the reversible verdicts on purpose. */}
              <div className="cr-spacer" />
              <button className="cr-btn" data-kind="ban" disabled={isBusy}
                onClick={() => act(row.message.id, 'ban')}>
                <Gavel size={13} /> Remove &amp; ban
              </button>
            </div>
          </div>
        )
      })}
     </div>
    </div>
  )
}
