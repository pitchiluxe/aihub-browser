import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { StickyNote, Trash2, ExternalLink, RefreshCw, Search, Loader2, Globe, X } from 'lucide-react'

// Same pastel pairs as the in-page notes — n.color indexes this.
const NOTE_COLORS: [string, string][] = [
  ['#fef08a', '#fde047'], ['#bbf7d0', '#86efac'], ['#bfdbfe', '#93c5fd'],
  ['#fbcfe8', '#f9a8d4'], ['#fed7aa', '#fdba74'], ['#e9d5ff', '#d8b4fe'],
]

interface Note { id: string; x: number; y: number; text?: string; title?: string; color?: number; min?: boolean }
interface PageEntry { url: string; pageTitle: string; updatedAt: number; notes: Note[] }

export default function NotesPage({ onNavigate }: { onNavigate: (url: string) => void }) {
  const [store, setStore] = useState<Record<string, PageEntry>>({})
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  const load = async () => {
    setLoading(true)
    try { setStore(await window.electronAPI.notes.getAll() || {}) } catch {}
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const deletePage = async (key: string, url: string) => {
    try {
      await window.electronAPI.notes.deleteUrl(url)
      setStore(s => { const n = { ...s }; delete n[key]; return n })
    } catch {}
  }

  const deleteNote = async (key: string, url: string, noteId: string) => {
    try {
      await window.electronAPI.notes.deleteNote(url, noteId)
      setStore(s => {
        const n = { ...s }
        const entry = { ...n[key], notes: n[key].notes.filter(x => x.id !== noteId) }
        if (entry.notes.length === 0) delete n[key]
        else n[key] = entry
        return n
      })
    } catch {}
  }

  const q = query.trim().toLowerCase()
  const entries = Object.entries(store)
    .filter(([, e]) => !q
      || (e.pageTitle || '').toLowerCase().includes(q)
      || e.url.toLowerCase().includes(q)
      || e.notes.some(n => (n.text || '').toLowerCase().includes(q) || (n.title || '').toLowerCase().includes(q)))
    .sort(([, a], [, b]) => (b.updatedAt || 0) - (a.updatedAt || 0))

  const totalNotes = Object.values(store).reduce((sum, e) => sum + e.notes.length, 0)

  return (
    <div className="flex flex-col h-full bg-aihub-bg text-aihub-text overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-4 border-b border-aihub-border/30">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-aihub-text flex items-center gap-3">
              <StickyNote size={22} className="text-yellow-400" /> Sticky Notes
            </h1>
            <p className="text-sm text-aihub-muted mt-0.5">
              {totalNotes} note{totalNotes === 1 ? '' : 's'} across {Object.keys(store).length} page{Object.keys(store).length === 1 ? '' : 's'} — open a page to see them pinned where you left them
            </p>
          </div>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-aihub-accent/20 hover:bg-aihub-accent/30 text-aihub-accent text-sm font-medium transition-all disabled:opacity-40 shrink-0">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {/* Search */}
        <div className="relative mt-4 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-aihub-muted" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search notes, titles, pages…"
            className="w-full rounded-xl pl-9 pr-8 py-2 text-sm bg-aihub-surface/60 border border-aihub-border/40 text-aihub-text placeholder:text-aihub-muted/60 outline-none focus:border-aihub-accent/50 transition-all"
            style={{ userSelect: 'text' }}
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-aihub-muted hover:text-aihub-text">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-5">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-aihub-muted">
            <Loader2 size={32} className="animate-spin text-aihub-accent" />
            <p className="text-sm">Loading notes…</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-aihub-muted">
            <StickyNote size={40} className="opacity-20" />
            <p className="text-sm">{q ? 'No notes match your search.' : 'No sticky notes yet.'}</p>
            {!q && <p className="text-xs opacity-70 max-w-sm text-center">Open any website, turn on Annotation mode, and click "New Note" — your notes are saved automatically and show up here.</p>}
          </div>
        ) : (
          <div className="space-y-6">
            {entries.map(([key, entry]) => (
              <motion.div key={key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-aihub-border/30 bg-aihub-card/50 overflow-hidden">
                {/* Page header */}
                <div className="flex items-center gap-3 px-5 py-3.5 border-b border-aihub-border/20 bg-aihub-surface/30">
                  <Globe size={15} className="text-aihub-accent shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-aihub-text truncate">
                      {entry.pageTitle || entry.url}
                    </div>
                    <div className="text-xs text-aihub-muted truncate">{entry.url}</div>
                  </div>
                  <span className="text-xs text-aihub-muted shrink-0">
                    {entry.notes.length} note{entry.notes.length === 1 ? '' : 's'} · {entry.updatedAt ? new Date(entry.updatedAt).toLocaleDateString() : ''}
                  </span>
                  <button onClick={() => onNavigate(entry.url)}
                    title="Open page — turn on Annotation mode to see notes pinned in place"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-aihub-accent/15 hover:bg-aihub-accent/30 text-aihub-accent text-xs font-medium transition-all shrink-0">
                    <ExternalLink size={12} /> Open Page
                  </button>
                  <button onClick={() => deletePage(key, entry.url)} title="Delete all notes for this page"
                    className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-all shrink-0">
                    <Trash2 size={13} />
                  </button>
                </div>

                {/* Notes grid */}
                <div className="p-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))' }}>
                  {entry.notes.map(n => {
                    const c = NOTE_COLORS[(typeof n.color === 'number' && NOTE_COLORS[n.color]) ? n.color : 0]
                    return (
                      <div key={n.id}
                        className="rounded-xl overflow-hidden shadow-lg"
                        style={{ background: `linear-gradient(180deg,${c[0]},${c[1]})` }}>
                        <div className="flex items-center gap-2 px-3 py-2" style={{ background: 'rgba(0,0,0,0.07)' }}>
                          <span className="flex-1 text-[11px] font-bold truncate" style={{ color: '#422006' }}>
                            {n.title || 'Untitled note'}
                          </span>
                          <button onClick={() => deleteNote(key, entry.url, n.id)} title="Delete note"
                            className="w-5 h-5 rounded flex items-center justify-center hover:bg-black/15 transition-all"
                            style={{ color: '#3b2405' }}>
                            <X size={11} />
                          </button>
                        </div>
                        <div className="px-3 py-2.5 text-xs leading-relaxed whitespace-pre-wrap break-words"
                          style={{ color: '#422006', minHeight: 44, maxHeight: 180, overflowY: 'auto', userSelect: 'text' }}>
                          {n.text || <span style={{ opacity: 0.5 }}>Empty note</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
