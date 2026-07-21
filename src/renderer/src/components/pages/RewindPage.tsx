import React, { useEffect, useState, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { History, Search, X, Trash2, ExternalLink, Clock, Loader2, Rewind } from 'lucide-react'

interface RewindItem { id: string; url: string; title: string; favicon: string; ts: number; snippet: string }

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}

export default function RewindPage({ onNavigate }: { onNavigate: (url: string) => void }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<RewindItem[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<{ count: number; oldest: number }>({ count: 0, oldest: 0 })
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const run = useCallback(async (q: string) => {
    setLoading(true)
    try { setItems(await window.electronAPI.rewind.search(q) || []) } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    window.electronAPI.rewind.stats().then(setStats).catch(() => {})
    run('')
  }, [run])

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => run(query), 180)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [query, run])

  const remove = async (id: string) => {
    await window.electronAPI.rewind.remove(id).catch(() => {})
    setItems(prev => prev.filter(i => i.id !== id))
    setStats(s => ({ ...s, count: Math.max(0, s.count - 1) }))
  }
  const clearAll = async () => {
    if (!confirm('Clear your entire Rewind history? This cannot be undone.')) return
    await window.electronAPI.rewind.clear().catch(() => {})
    setItems([]); setStats({ count: 0, oldest: 0 })
  }

  const highlight = (text: string) => {
    const q = query.trim()
    if (!q) return text
    try {
      const re = new RegExp(`(${q.split(/\s+/).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig')
      return text.split(re).map((part, i) =>
        re.test(part)
          ? <mark key={i} style={{ background: 'rgb(var(--ds-accent) / 0.3)', color: 'inherit', borderRadius: 3, padding: '0 2px' }}>{part}</mark>
          : <React.Fragment key={i}>{part}</React.Fragment>)
    } catch { return text }
  }

  return (
    <div className="flex flex-col h-full bg-aihub-bg text-aihub-text overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-4 border-b border-aihub-border/30">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <Rewind size={22} className="text-aihub-accent" /> Rewind
            </h1>
            <p className="text-sm text-aihub-muted mt-0.5">
              Search everything you've read by what it said — {stats.count.toLocaleString()} page{stats.count === 1 ? '' : 's'} remembered
              {stats.oldest ? `, back to ${new Date(stats.oldest).toLocaleDateString()}` : ''}
            </p>
          </div>
          {stats.count > 0 && (
            <button onClick={clearAll} title="Clear all Rewind history"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-all shrink-0">
              <Trash2 size={13} /> Clear
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative mt-4 max-w-xl">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-aihub-muted" />
          <input
            autoFocus value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search what you've read… (e.g. that VPN pricing article)"
            className="w-full rounded-2xl pl-11 pr-9 py-3 text-sm bg-aihub-surface/60 border border-aihub-border/40 text-aihub-text placeholder:text-aihub-muted/60 outline-none focus:border-aihub-accent/50 transition-all"
            style={{ userSelect: 'text' }}
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-aihub-muted hover:text-aihub-text">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-8 py-5">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-aihub-muted">
            <Loader2 size={30} className="animate-spin text-aihub-accent" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-aihub-muted text-center">
            <History size={40} className="opacity-20" />
            <p className="text-sm">{query ? `Nothing you've read matches “${query}”.` : 'Your Rewind is empty.'}</p>
            {!query && <p className="text-xs opacity-70 max-w-sm">Browse the web normally — pages you spend a few seconds on are quietly saved here so you can find them later by their content.</p>}
          </div>
        ) : (
          <div className="max-w-3xl mx-auto flex flex-col gap-2.5">
            {!query && <div className="text-xs font-bold text-aihub-muted uppercase tracking-wider mb-1">Recent</div>}
            {items.map(it => (
              <motion.div key={it.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
                className="group rounded-2xl border border-aihub-border/30 bg-aihub-card/50 hover:border-aihub-accent/40 transition-all p-4 cursor-pointer"
                onClick={() => onNavigate(it.url)}>
                <div className="flex items-start gap-3">
                  {it.favicon
                    ? <img src={it.favicon} className="w-4 h-4 rounded mt-0.5 shrink-0" onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden' }} />
                    : <History size={14} className="text-aihub-muted mt-0.5 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-aihub-text truncate">{highlight(it.title)}</span>
                    </div>
                    <div className="text-xs text-aihub-muted truncate mt-0.5">{it.url}</div>
                    {it.snippet && (
                      <div className="text-xs text-aihub-muted/90 mt-1.5 leading-relaxed line-clamp-2">{highlight(it.snippet)}</div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span className="text-[11px] text-aihub-muted flex items-center gap-1"><Clock size={10} /> {timeAgo(it.ts)}</span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={e => { e.stopPropagation(); onNavigate(it.url) }} title="Open"
                        className="w-7 h-7 rounded-lg flex items-center justify-center bg-aihub-accent/15 hover:bg-aihub-accent/30 text-aihub-accent">
                        <ExternalLink size={12} />
                      </button>
                      <button onClick={e => { e.stopPropagation(); remove(it.id) }} title="Forget this page"
                        className="w-7 h-7 rounded-lg flex items-center justify-center bg-red-500/10 hover:bg-red-500/20 text-red-400">
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
