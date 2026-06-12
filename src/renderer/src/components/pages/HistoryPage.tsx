import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Search, Trash2, ExternalLink, Clock, X } from 'lucide-react'
import { HistoryItem } from '../../store/browserStore'

interface Props { onNavigate: (url: string) => void }

function groupByDate(items: HistoryItem[]): Record<string, HistoryItem[]> {
  const groups: Record<string, HistoryItem[]> = {}
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterday = today - 86400000

  for (const item of items) {
    let label: string
    if (item.timestamp >= today) label = 'Today'
    else if (item.timestamp >= yesterday) label = 'Yesterday'
    else {
      const d = new Date(item.timestamp)
      label = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
    }
    if (!groups[label]) groups[label] = []
    groups[label].push(item)
  }
  return groups
}

export default function HistoryPage({ onNavigate }: Props) {
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [search, setSearch] = useState('')
  const [clearing, setClearing] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    const h = await window.electronAPI.history.getAll()
    setHistory(h)
  }

  const clearAll = async () => {
    setClearing(true)
    await window.electronAPI.history.clear()
    setHistory([])
    setClearing(false)
  }

  const deleteItem = async (id: string) => {
    await window.electronAPI.history.deleteItem(id)
    setHistory(h => h.filter(x => x.id !== id))
  }

  const filtered = search
    ? history.filter(h => h.url.toLowerCase().includes(search.toLowerCase()) || h.title.toLowerCase().includes(search.toLowerCase()))
    : history

  const groups = groupByDate(filtered)

  return (
    <div className="flex flex-col h-full bg-aihub-bg text-aihub-text overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-4 border-b border-aihub-border/30 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-aihub-text">History</h1>
          <p className="text-sm text-aihub-muted mt-0.5">{history.length} pages visited</p>
        </div>
        <button
          onClick={clearAll}
          disabled={clearing || history.length === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium transition-all disabled:opacity-40"
        >
          <Trash2 size={14} /> Clear all
        </button>
      </div>

      {/* Search */}
      <div className="px-8 py-3">
        <div className="relative max-w-lg">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-aihub-muted" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search history…"
            className="w-full pl-9 pr-4 py-2 bg-aihub-card border border-aihub-border/40 rounded-xl text-sm text-aihub-text placeholder:text-aihub-muted/50 outline-none focus:border-aihub-accent/50 transition-colors"
            style={{ userSelect: 'text' }}
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {Object.keys(groups).length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-aihub-muted">
            <Clock size={40} className="opacity-20" />
            <p className="text-sm">{search ? 'No results found' : 'No browsing history'}</p>
          </div>
        ) : (
          Object.entries(groups).map(([date, items]) => (
            <div key={date} className="mb-6">
              <h3 className="text-xs font-semibold text-aihub-muted uppercase tracking-wider mb-2 sticky top-0 bg-aihub-bg py-1">{date}</h3>
              <div className="space-y-1">
                {items.map((item, i) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.01 }}
                    className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-aihub-card/60 group cursor-pointer"
                    onClick={() => onNavigate(item.url)}
                  >
                    <img src={`https://www.google.com/s2/favicons?domain=${item.url}&sz=16`} className="w-4 h-4 rounded shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-aihub-text truncate">{item.title || item.url}</div>
                      <div className="text-xs text-aihub-muted truncate">{item.url}</div>
                    </div>
                    <span className="text-xs text-aihub-muted/60 shrink-0 group-hover:hidden">
                      {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <button
                      onClick={e => { e.stopPropagation(); deleteItem(item.id) }}
                      className="hidden group-hover:flex w-6 h-6 items-center justify-center rounded-lg hover:bg-red-500/20 text-red-400 transition-all"
                    >
                      <X size={11} />
                    </button>
                    <ExternalLink size={11} className="hidden group-hover:block text-aihub-muted shrink-0" />
                  </motion.div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
