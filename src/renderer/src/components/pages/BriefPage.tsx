import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Sunrise, RefreshCw, Loader2, ChevronRight, Calendar, BellRing, Mail, Brain, Download,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useBrowserStore } from '../../store/browserStore'
import { buildBrief, greeting, summarise, type BriefSection } from '../../../../shared/brief'
import { dueItems } from '../../services/recall'
import type { PageType } from '../../../../shared/pageTypes'

const SECTION_ICON: Record<string, React.ComponentType<any>> = {
  calendar: Calendar, watches: BellRing, mail: Mail, recall: Brain, downloads: Download,
}

/**
 * The Morning Brief.
 *
 * Watch, the calendar, the mailbox, Recall and Downloads each know something
 * worth saying first thing, and each of them requires you to go and look — so
 * in practice none of them get looked at. This is one page assembled from what
 * they already hold.
 *
 * Every source is optional and every failure is silent. A calendar that is not
 * connected simply contributes nothing, rather than turning the whole brief
 * into an error message about Google.
 */
export default function BriefPage({ onNavigate }: { onNavigate: (url: string) => void }) {
  const { downloads, focusOrOpenPage } = useBrowserStore(useShallow(s => ({
    downloads: s.downloads,
    focusOrOpenPage: s.focusOrOpenPage,
  })))
  const [sections, setSections] = useState<BriefSection[]>([])
  const [loading, setLoading] = useState(true)
  const [builtAt, setBuiltAt] = useState(Date.now())

  const load = async () => {
    setLoading(true)
    const now = Date.now()

    // Each source is asked for independently and allowed to fail on its own.
    // One unconfigured integration must not empty the whole page.
    const settle = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
      try { return (await p) ?? fallback } catch { return fallback }
    }

    const [watches, events, threads, recallBook] = await Promise.all([
      settle<any[]>(window.electronAPI.watch?.list?.(), []),
      settle<any>(window.electronAPI.calendar?.events?.({
        timeMin: new Date(now).toISOString(),
        timeMax: new Date(now + 86_400_000).toISOString(),
        maxResults: 10,
      }), null),
      settle<any>(window.electronAPI.gmail?.listThreads?.('is:unread -in:spam -in:promotions'), null),
      settle<any>(window.electronAPI.recall?.get?.(), {}),
    ])

    // Each bridge answers in its own shape, and an unconfigured one answers
    // with an error object rather than a list. Coerce before touching it: a
    // truthy non-array here used to throw and take the whole brief down.
    const asList = (v: any, ...keys: string[]): any[] => {
      if (Array.isArray(v)) return v
      for (const k of keys) {
        const inner = v?.[k] ?? v?.data?.[k]
        if (Array.isArray(inner)) return inner
      }
      return []
    }

    const eventList = asList(events, 'events')
      .map((e: any) => ({
        summary: e.summary || e.title || '',
        start: Date.parse(e.start?.dateTime || e.start?.date || e.start || '') || 0,
        location: e.location,
      }))
      .filter((e: any) => e.start > 0)

    const threadList = asList(threads, 'threads')
      .slice(0, 10)
      .map((t: any) => ({ subject: t.subject, from: t.from, date: t.date, unread: t.unread }))

    setSections(buildBrief({
      now,
      watches: asList(watches),
      events: eventList,
      threads: threadList,
      recallDue: dueItems(recallBook || {}, now).length,
      downloads: downloads.map(d => ({ filename: d.filename, completedAt: d.completedAt, state: d.state })),
    }))
    setBuiltAt(now)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const open = (item: { url?: string; page?: string }) => {
    if (item.url) onNavigate(item.url)
    else if (item.page) focusOrOpenPage(`aihub://${item.page}`, item.page as PageType)
  }

  return (
    <div className="flex flex-col h-full bg-aihub-bg text-aihub-text overflow-hidden">
      <div className="px-8 pt-8 pb-4 border-b border-aihub-border/30 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sunrise size={20} className="text-aihub-accent" /> {greeting(builtAt)}
          </h1>
          <p className="text-sm text-aihub-muted mt-0.5">{summarise(sections)}</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-aihub-card/60 border border-aihub-border/30 text-sm disabled:opacity-50">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {loading && !sections.length && (
          <div className="flex justify-center py-16 text-aihub-muted"><Loader2 size={20} className="animate-spin" /></div>
        )}

        {!loading && !sections.length && (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-aihub-muted text-center">
            <Sunrise size={40} className="opacity-20" />
            <p className="text-sm">Nothing needs you right now</p>
            <p className="text-xs max-w-sm opacity-70">
              The brief fills up from Watch, your calendar, unread mail, Recall
              and recent downloads. Anything not connected is simply left out.
            </p>
          </div>
        )}

        <div className="max-w-3xl mx-auto space-y-6">
          {sections.map((section, si) => {
            const Icon = SECTION_ICON[section.key] || ChevronRight
            return (
              <motion.div
                key={section.key}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: si * 0.05 }}
              >
                <div className="flex items-center gap-2 mb-2 text-xs uppercase tracking-wide text-aihub-muted">
                  <Icon size={12} /> {section.title}
                </div>
                <div className="rounded-2xl bg-aihub-card/60 border border-aihub-border/30 divide-y divide-aihub-border/20 overflow-hidden">
                  {section.items.map((item, i) => (
                    <button
                      key={i}
                      onClick={() => open(item)}
                      disabled={!item.url && !item.page}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-aihub-accent/5 transition-colors disabled:cursor-default"
                    >
                      {item.urgent && (
                        <span className="w-1.5 h-1.5 rounded-full bg-aihub-accent shrink-0"
                          title="Within the hour" />
                      )}
                      <span className={`flex-1 min-w-0 truncate text-sm ${item.urgent ? 'font-semibold' : ''}`}>
                        {item.text}
                      </span>
                      {item.meta && (
                        <span className="text-xs text-aihub-muted shrink-0">{item.meta}</span>
                      )}
                      {(item.url || item.page) && (
                        <ChevronRight size={13} className="text-aihub-muted shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
