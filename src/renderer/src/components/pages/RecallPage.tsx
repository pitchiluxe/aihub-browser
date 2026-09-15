import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Brain, Trash2, ExternalLink, Check, X, Loader2, Sparkles, RotateCw,
} from 'lucide-react'
import {
  type RecallBook, type RecallItem,
  allItems, dueItems, removeItem, review, stats, whenNextDue, formatDue,
} from '../../services/recall'
import { formatWhen } from '../../services/downloadDisplay'
import { BOX_INTERVAL_DAYS, type Box } from '../../../../shared/leitner'

/**
 * Recall — the daily review of things worth keeping.
 *
 * Reading is not remembering. The browser already stores every page read and
 * already knows how to schedule a review; this is where the two meet. Right-
 * click any selection on any page and "Remember This" puts it here.
 *
 * The card shows the cue and hides the answer until asked for, because a
 * review that shows you the answer is a reading exercise with extra steps.
 */
export default function RecallPage({ onNavigate }: { onNavigate: (url: string) => void }) {
  const [book, setBook] = useState<RecallBook>({})
  const [loading, setLoading] = useState(true)
  const [revealed, setRevealed] = useState(false)
  const [mode, setMode] = useState<'review' | 'all'>('review')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    window.electronAPI.recall.get()
      .then((b: RecallBook) => setBook(b || {}))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Every write goes straight to disk: a review answered and then lost to a
  // crash is worse than no review, because the schedule silently drifts.
  const persist = (next: RecallBook) => {
    setBook(next)
    window.electronAPI.recall.set(next).catch(() => {})
  }

  const queue = useMemo(() => dueItems(book, now), [book, now])
  const list = useMemo(() => allItems(book), [book])
  const st = useMemo(() => stats(book, now), [book, now])
  const nextAt = useMemo(() => whenNextDue(book), [book])

  const current: RecallItem | undefined = queue[0]

  const answer = (correct: boolean) => {
    if (!current) return
    persist(review(book, current.id, correct, Date.now()))
    setRevealed(false)
    setNow(Date.now())
  }

  const drop = (id: string) => persist(removeItem(book, id))

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-aihub-bg text-aihub-muted">
        <Loader2 size={20} className="animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-aihub-bg text-aihub-text overflow-hidden">
      <div className="px-8 pt-8 pb-4 border-b border-aihub-border/30">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain size={20} className="text-aihub-accent" /> Recall
            </h1>
            <p className="text-sm text-aihub-muted mt-0.5">
              {st.total} kept · {st.due} due now · {st.mastered} mastered
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 rounded-xl bg-aihub-card/60 border border-aihub-border/30">
            {(['review', 'all'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  mode === m ? 'bg-aihub-accent/20 text-aihub-accent' : 'text-aihub-muted hover:text-aihub-text'
                }`}
              >
                {m === 'review' ? `Review${st.due ? ` (${st.due})` : ''}` : 'Everything'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {mode === 'review' ? (
          current ? (
            <motion.div
              key={current.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-2xl mx-auto"
            >
              <div className="rounded-2xl bg-aihub-card/60 border border-aihub-border/30 p-8">
                <div className="text-xs uppercase tracking-wide text-aihub-muted mb-3">
                  {current.prompt ? 'Your cue' : 'From'} · box {current.schedule.box} of 5
                </div>
                <div className="text-lg font-medium mb-6">
                  {current.prompt || current.title || current.url}
                </div>

                {revealed ? (
                  <>
                    <div className="rounded-xl bg-aihub-accent/10 border border-aihub-accent/25 p-5 text-[15px] leading-relaxed">
                      {current.text}
                    </div>
                    <div className="flex items-center gap-2 mt-6">
                      <button onClick={() => answer(true)}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-green-500/15 border border-green-500/30 text-green-400 text-sm font-semibold hover:bg-green-500/25 transition-all">
                        <Check size={15} /> I knew it
                        <span className="opacity-60 font-normal">
                          · back in {BOX_INTERVAL_DAYS[Math.min(5, current.schedule.box + 1) as Box]}d
                        </span>
                      </button>
                      <button onClick={() => answer(false)}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-sm font-semibold hover:bg-red-500/20 transition-all">
                        <X size={15} /> Missed it
                        <span className="opacity-60 font-normal">· back tomorrow</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <button onClick={() => setRevealed(true)}
                    className="w-full py-3 rounded-xl bg-aihub-accent/15 border border-aihub-accent/30 text-aihub-accent text-sm font-semibold hover:bg-aihub-accent/25 transition-all">
                    Show me
                  </button>
                )}

                <div className="flex items-center justify-between mt-6 pt-4 border-t border-aihub-border/20 text-xs text-aihub-muted">
                  <span className="truncate max-w-[60%]">Saved {formatWhen(current.createdAt)}</span>
                  <div className="flex items-center gap-3">
                    {current.url && (
                      <button onClick={() => onNavigate(current.url)} className="flex items-center gap-1 hover:text-aihub-text">
                        <ExternalLink size={11} /> Source
                      </button>
                    )}
                    <button onClick={() => drop(current.id)} className="flex items-center gap-1 hover:text-red-400">
                      <Trash2 size={11} /> Forget
                    </button>
                  </div>
                </div>
              </div>

              <p className="text-center text-xs text-aihub-muted mt-4">
                {queue.length - 1} more waiting
              </p>
            </motion.div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-aihub-muted text-center">
              {st.total ? (
                <>
                  <Sparkles size={36} className="opacity-30" />
                  <p className="text-sm">Nothing due — you are caught up</p>
                  {nextAt && <p className="text-xs opacity-70">Next review {formatDue(nextAt, now)}</p>}
                  <button onClick={() => setNow(Date.now())}
                    className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-aihub-card border border-aihub-border/30 hover:text-aihub-text">
                    <RotateCw size={11} /> Check again
                  </button>
                </>
              ) : (
                <>
                  <Brain size={36} className="opacity-20" />
                  <p className="text-sm">Nothing kept yet</p>
                  <p className="text-xs max-w-sm opacity-70">
                    Select any text on any page, right-click, and choose
                    “Remember This”. It comes back here on a schedule until you
                    know it.
                  </p>
                </>
              )}
            </div>
          )
        ) : (
          <div className="space-y-2 max-w-3xl mx-auto">
            {list.map(item => (
              <div key={item.id} className="flex items-start gap-4 p-4 rounded-2xl bg-aihub-card/60 border border-aihub-border/30">
                <div className="w-9 h-9 rounded-xl bg-aihub-accent/10 flex items-center justify-center shrink-0 text-xs font-bold text-aihub-accent">
                  {item.schedule.box}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm leading-relaxed">{item.text}</div>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-aihub-muted">
                    <span className="truncate max-w-[280px]">{item.title || item.url}</span>
                    <span>·</span>
                    <span>{item.schedule.reviews || 0} reviews</span>
                    <span>·</span>
                    <span>due {formatDue(item.schedule.dueAt, now)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {item.url && (
                    <button onClick={() => onNavigate(item.url)} title="Open the source page"
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-aihub-muted hover:text-aihub-text hover:bg-aihub-card">
                      <ExternalLink size={12} />
                    </button>
                  )}
                  <button onClick={() => drop(item.id)} title="Forget this"
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-aihub-muted hover:text-red-400 hover:bg-red-500/10">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
            {!list.length && (
              <p className="text-center text-sm text-aihub-muted py-16">Nothing kept yet</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
