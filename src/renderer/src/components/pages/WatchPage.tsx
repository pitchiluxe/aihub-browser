import React, { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Bell, BellRing, Plus, Trash2, RefreshCw, Play, Pause, Loader2, Check } from 'lucide-react'

interface Watch {
  id: string; url: string; title: string; mode: 'change' | 'contains'; keyword?: string
  intervalMin: number; active: boolean; lastChecked?: number; lastChanged?: number; triggered?: boolean
}

const INTERVALS = [15, 30, 60, 180, 720]

function ago(ts?: number) {
  if (!ts) return 'never'
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
function intervalLabel(m: number) { return m < 60 ? `${m} min` : m < 1440 ? `${m / 60} hr` : `${m / 1440} day` }

export default function WatchPage() {
  const [watches, setWatches] = useState<Watch[]>([])
  const [adding, setAdding] = useState(false)
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState<'change' | 'contains'>('change')
  const [keyword, setKeyword] = useState('')
  const [interval, setIntervalM] = useState(30)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try { setWatches(await window.electronAPI.watch.list() || []) } catch {}
  }, [])

  useEffect(() => {
    load()
    const off1 = window.electronAPI.watch.onChanged?.(load)
    const off2 = window.electronAPI.watch.onTriggered?.(load)
    return () => { try { off1?.(); off2?.() } catch {} }
  }, [load])

  const add = async () => {
    let u = url.trim()
    if (!u) return
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`
    if (mode === 'contains' && !keyword.trim()) { setError('Enter the word or phrase to watch for.'); return }
    setBusy(true); setError('')
    const r = await window.electronAPI.watch.add({ url: u, mode, keyword: keyword.trim() || undefined, intervalMin: interval })
    setBusy(false)
    if (!r?.ok) { setError(r?.error || 'Could not add watch'); return }
    setUrl(''); setKeyword(''); setAdding(false)
    load()
  }

  const remove = async (id: string) => { await window.electronAPI.watch.remove(id); load() }
  const toggle = async (id: string) => { await window.electronAPI.watch.toggle(id); load() }
  const rearm = async (id: string) => { await window.electronAPI.watch.rearm(id); load() }
  const checkNow = async (id: string) => { await window.electronAPI.watch.checkNow(id); load() }

  return (
    <div className="flex flex-col h-full bg-aihub-bg text-aihub-text overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-4 border-b border-aihub-border/30">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <BellRing size={22} className="text-aihub-accent" /> Watch &amp; Ping
            </h1>
            <p className="text-sm text-aihub-muted mt-0.5">
              Get a desktop notification when a page changes or a word appears — {watches.length} watch{watches.length === 1 ? '' : 'es'}
            </p>
          </div>
          <button onClick={() => setAdding(a => !a)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-aihub-accent hover:bg-aihub-accent-glow text-white transition-all shrink-0">
            <Plus size={14} /> New watch
          </button>
        </div>

        {adding && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            className="mt-4 p-4 rounded-2xl bg-aihub-surface/40 border border-aihub-border/40 overflow-hidden">
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Page URL to watch, e.g. store.com/product/123"
              className="w-full rounded-xl px-3.5 py-2.5 text-sm bg-aihub-surface/60 border border-aihub-border/40 text-aihub-text placeholder:text-aihub-muted/60 outline-none focus:border-aihub-accent/50 mb-3"
              style={{ userSelect: 'text' }} />
            <div className="flex gap-2 mb-3">
              <button onClick={() => setMode('change')}
                className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${mode === 'change' ? 'bg-aihub-accent/15 border-aihub-accent/40 text-aihub-accent' : 'border-aihub-border/40 text-aihub-muted'}`}>
                When it changes at all
              </button>
              <button onClick={() => setMode('contains')}
                className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${mode === 'contains' ? 'bg-aihub-accent/15 border-aihub-accent/40 text-aihub-accent' : 'border-aihub-border/40 text-aihub-muted'}`}>
                When a word appears
              </button>
            </div>
            {mode === 'contains' && (
              <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="Word or phrase, e.g. In stock · Sold · Closed"
                className="w-full rounded-xl px-3.5 py-2.5 text-sm bg-aihub-surface/60 border border-aihub-border/40 text-aihub-text placeholder:text-aihub-muted/60 outline-none focus:border-aihub-accent/50 mb-3"
                style={{ userSelect: 'text' }} />
            )}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-aihub-muted">Check every</span>
              {INTERVALS.map(m => (
                <button key={m} onClick={() => setIntervalM(m)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${interval === m ? 'bg-aihub-accent/15 border-aihub-accent/40 text-aihub-accent' : 'border-aihub-border/40 text-aihub-muted'}`}>
                  {intervalLabel(m)}
                </button>
              ))}
            </div>
            {error && <div className="text-xs text-red-400 mb-2">{error}</div>}
            <div className="flex gap-2">
              <button onClick={add} disabled={busy || !url.trim()}
                className="flex-1 py-2.5 rounded-xl bg-aihub-accent hover:bg-aihub-accent-glow text-white text-sm font-bold transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Bell size={14} />} Start watching
              </button>
              <button onClick={() => { setAdding(false); setError('') }} className="px-4 rounded-xl border border-aihub-border/40 text-aihub-muted text-sm">Cancel</button>
            </div>
          </motion.div>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-8 py-5">
        {watches.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-aihub-muted text-center">
            <Bell size={40} className="opacity-20" />
            <p className="text-sm">No watches yet.</p>
            <p className="text-xs opacity-70 max-w-sm">Watch a price, a job posting, a ticket status — anything on the web. AIHub re-checks in the background and pings you the moment it changes.</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto flex flex-col gap-2.5">
            {watches.map(w => (
              <motion.div key={w.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
                className={`rounded-2xl border p-4 transition-all ${w.triggered ? 'bg-aihub-accent/10 border-aihub-accent/40' : 'bg-aihub-card/50 border-aihub-border/30'}`}>
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${w.triggered ? 'bg-aihub-accent/20' : 'bg-aihub-border/20'}`}>
                    {w.triggered ? <BellRing size={16} className="text-aihub-accent" /> : w.active ? <Bell size={16} className="text-aihub-muted" /> : <Pause size={16} className="text-aihub-muted" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-aihub-text truncate flex items-center gap-2">
                      {w.title}
                      {w.triggered && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-aihub-accent/20 text-aihub-accent shrink-0">CHANGED</span>}
                      {!w.active && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-aihub-border/30 text-aihub-muted shrink-0">PAUSED</span>}
                    </div>
                    <div className="text-xs text-aihub-muted truncate mt-0.5">{w.url}</div>
                    <div className="text-[11px] text-aihub-muted/80 mt-1.5">
                      {w.mode === 'contains' ? `Watching for “${w.keyword}”` : 'Any change'} · every {intervalLabel(w.intervalMin)} · checked {ago(w.lastChecked)}
                      {w.lastChanged ? ` · last changed ${ago(w.lastChanged)}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {w.triggered && (
                      <button onClick={() => rearm(w.id)} title="Acknowledge & keep watching"
                        className="w-8 h-8 rounded-lg flex items-center justify-center bg-aihub-accent/15 hover:bg-aihub-accent/30 text-aihub-accent"><Check size={14} /></button>
                    )}
                    <button onClick={() => checkNow(w.id)} title="Check now"
                      className="w-8 h-8 rounded-lg flex items-center justify-center bg-aihub-border/20 hover:bg-aihub-border/30 text-aihub-muted"><RefreshCw size={13} /></button>
                    <button onClick={() => toggle(w.id)} title={w.active ? 'Pause' : 'Resume'}
                      className="w-8 h-8 rounded-lg flex items-center justify-center bg-aihub-border/20 hover:bg-aihub-border/30 text-aihub-muted">{w.active ? <Pause size={13} /> : <Play size={13} />}</button>
                    <button onClick={() => remove(w.id)} title="Delete"
                      className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-500/10 hover:bg-red-500/20 text-red-400"><Trash2 size={13} /></button>
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
