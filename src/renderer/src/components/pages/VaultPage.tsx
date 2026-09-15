import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Archive, Trash2, FolderOpen, Search, Loader2, Globe, Clock, HardDrive, X,
} from 'lucide-react'
import { useBrowserStore } from '../../store/browserStore'
import { formatBytes, formatWhen } from '../../services/downloadDisplay'

interface Snapshot {
  id: string; url: string; key: string; title: string; favicon: string
  path: string; bytes: number; createdAt: number; origin: 'auto' | 'manual'
}

/**
 * The Page Vault — every page this browser kept a copy of.
 *
 * Bookmarking archives the page as a single .mhtml file, so a bookmark keeps
 * working after the site behind it stops. This page is where those copies are
 * read, counted and thrown away; the restore prompt on a dead tab is the other
 * way in, and the one most people will actually use.
 */
export default function VaultPage() {
  const activeTabId = useBrowserStore(s => s.activeTabId)
  const [snaps, setSnaps] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState('')

  const load = async () => {
    setLoading(true)
    try { setSnaps(await window.electronAPI.vault.list() || []) } catch {}
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return snaps
    return snaps.filter(s =>
      s.title.toLowerCase().includes(q) || s.url.toLowerCase().includes(q))
  }, [snaps, query])

  // Copies of one page belong together — the point of keeping three is to see
  // that the page changed, which a flat list by date hides.
  const groups = useMemo(() => {
    const byKey = new Map<string, Snapshot[]>()
    for (const s of filtered) {
      const list = byKey.get(s.key) || []
      list.push(s)
      byKey.set(s.key, list)
    }
    return [...byKey.values()]
      .map(list => list.sort((a, b) => b.createdAt - a.createdAt))
      .sort((a, b) => b[0].createdAt - a[0].createdAt)
  }, [filtered])

  const totalBytes = useMemo(() => snaps.reduce((n, s) => n + (s.bytes || 0), 0), [snaps])

  const openSnapshot = async (id: string) => {
    if (!activeTabId) return
    setBusy(id)
    const res = await window.electronAPI.vault.open({ tabId: activeTabId, id })
    setBusy('')
    if (res && res.success === false) { alert(res.error); load() }
  }

  const removeSnapshot = async (id: string) => {
    await window.electronAPI.vault.remove(id)
    setSnaps(prev => prev.filter(s => s.id !== id))
  }

  const clearAll = async () => {
    if (!confirm(`Delete all ${snaps.length} saved copies? The bookmarks stay; only the archived pages go.`)) return
    await window.electronAPI.vault.clear()
    setSnaps([])
  }

  return (
    <div className="flex flex-col h-full bg-aihub-bg text-aihub-text overflow-hidden">
      <div className="px-8 pt-8 pb-4 border-b border-aihub-border/30">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-aihub-text flex items-center gap-2">
              <Archive size={20} className="text-aihub-accent" /> Page Vault
            </h1>
            <p className="text-sm text-aihub-muted mt-0.5 flex items-center gap-3">
              <span>{snaps.length} saved {snaps.length === 1 ? 'copy' : 'copies'}</span>
              <span className="flex items-center gap-1"><HardDrive size={12} /> {formatBytes(totalBytes)}</span>
            </p>
          </div>
          {snaps.length > 0 && (
            <button onClick={clearAll}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium transition-all">
              <Trash2 size={14} /> Delete all copies
            </button>
          )}
        </div>

        <div className="relative mt-4">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-aihub-muted" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search saved pages…"
            className="w-full pl-9 pr-8 py-2 rounded-xl bg-aihub-card/60 border border-aihub-border/30 text-sm outline-none focus:border-aihub-accent/40"
          />
          {!!query && (
            <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-aihub-muted">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-aihub-muted">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : !groups.length ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-aihub-muted text-center">
            <Archive size={40} className="opacity-20" />
            {snaps.length ? (
              <p className="text-sm">Nothing matches that</p>
            ) : (
              <>
                <p className="text-sm">No pages saved yet</p>
                <p className="text-xs max-w-sm opacity-70">
                  Bookmark a page and a copy is kept here automatically. When the live
                  page goes missing, the copy is offered in its place.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((versions, i) => {
              const head = versions[0]
              return (
                <motion.div
                  key={head.key}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.3) }}
                  className="rounded-2xl bg-aihub-card/60 border border-aihub-border/30 overflow-hidden"
                >
                  <div className="flex items-center gap-4 p-4">
                    <div className="w-10 h-10 rounded-xl bg-aihub-accent/10 flex items-center justify-center shrink-0">
                      {head.favicon
                        ? <img src={head.favicon} alt="" className="w-5 h-5 rounded" />
                        : <Globe size={17} className="text-aihub-accent" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{head.title}</div>
                      <div className="text-xs text-aihub-muted truncate">{head.url}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => openSnapshot(head.id)}
                        disabled={!activeTabId || busy === head.id}
                        title="Open the saved copy in this tab"
                        className="px-3 py-1.5 rounded-lg text-xs bg-aihub-accent/20 hover:bg-aihub-accent/30 text-aihub-accent transition-all disabled:opacity-40"
                      >
                        {busy === head.id ? 'Opening…' : 'Open copy'}
                      </button>
                      <button onClick={() => window.electronAPI.vault.reveal(head.path)}
                        title="Show the file on disk"
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-aihub-muted hover:text-aihub-text hover:bg-aihub-card transition-all">
                        <FolderOpen size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Each kept version of this page. One is the common case, so
                      the list only earns its heading when there are more. */}
                  <div className="border-t border-aihub-border/20 divide-y divide-aihub-border/10">
                    {versions.map(v => (
                      <div key={v.id} className="flex items-center gap-3 px-4 py-2 text-xs text-aihub-muted">
                        <Clock size={11} className="shrink-0" />
                        <span className="w-28 shrink-0">{formatWhen(v.createdAt)}</span>
                        <span className="w-20 shrink-0">{formatBytes(v.bytes)}</span>
                        <span className="flex-1 truncate opacity-70">
                          {v.origin === 'manual' ? 'saved by hand' : 'saved with the bookmark'}
                        </span>
                        {versions.length > 1 && (
                          <button onClick={() => openSnapshot(v.id)}
                            className="px-2 py-0.5 rounded text-aihub-accent hover:bg-aihub-accent/10">
                            open
                          </button>
                        )}
                        <button onClick={() => removeSnapshot(v.id)}
                          title="Delete this copy"
                          className="w-6 h-6 rounded flex items-center justify-center hover:text-red-400 hover:bg-red-500/10">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
