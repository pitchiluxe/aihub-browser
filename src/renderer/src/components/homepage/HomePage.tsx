import React, { useEffect, useState, memo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Sparkles, LayoutGrid, Network, RefreshCw, Zap, Clock, X, ChevronLeft, ChevronRight, Trash2, Download, Upload, Eye, EyeOff } from 'lucide-react'
import { useBrowserStore } from '../../store/browserStore'
import { loadBookmarks, removeBookmark } from '../../services/bookmarkService'
import BookmarkSphere from './BookmarkSphere'
import SearchBar from './SearchBar'
import AddBookmarkModal from './AddBookmarkModal'
import { useTheme } from '../../hooks/useTheme'

interface Recommendation { url: string; title: string; reason: string; category: string; score: number; favicon: string }
interface Props { onNavigate: (url: string) => void }

const ITEMS_PER_PAGE = 16

function glassStyle(isLight: boolean): React.CSSProperties {
  return isLight
    ? { background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.08)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }
    : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }
}

export default function HomePage({ onNavigate }: Props) {
  const { isLight } = useTheme()
  const { bookmarks, setBookmarks, removeBookmark: storeRemove, setAddBookmarkOpen } = useBrowserStore()
  const [view,            setView]            = useState<'grid' | 'sphere'>('grid')
  const [time,            setTime]            = useState(new Date())
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [loadingRecs,     setLoadingRecs]     = useState(false)
  const [greeting,        setGreeting]        = useState('')
  const [bmPage,          setBmPage]          = useState(0)
  const [bmToast,         setBmToast]         = useState<{ msg: string; ok: boolean } | null>(null)

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const h = new Date().getHours()
    setGreeting(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening')
  }, [])

  useEffect(() => {
    loadBookmarks().then(setBookmarks)
    loadRecommendations()
  }, [])

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(bookmarks.length / ITEMS_PER_PAGE) - 1)
    setBmPage(p => Math.min(p, maxPage))
  }, [bookmarks.length])

  const loadRecommendations = async () => {
    try {
      const recs = await window.electronAPI.brain.getRecommendations()
      if (recs?.length) setRecommendations(recs)
    } catch {}
  }

  const refreshRecommendations = async () => {
    setLoadingRecs(true)
    try {
      const recs = await window.electronAPI.brain.refreshRecommendations()
      if (recs?.length) setRecommendations(recs)
    } catch {}
    setLoadingRecs(false)
  }

  const handleRemove = async (id: string) => {
    await removeBookmark(id)
    storeRemove(id)
  }

  const showToast = (msg: string, ok: boolean) => {
    setBmToast({ msg, ok })
    setTimeout(() => setBmToast(null), 3200)
  }

  const handleExport = async (fmt: 'json' | 'html') => {
    const r = await window.electronAPI.bookmarks.export(fmt)
    if (r.success) showToast(`Exported ${r.count} bookmarks`, true)
    else if (r.error) showToast(`Export failed: ${r.error}`, false)
  }

  const handleImport = async () => {
    const r = await window.electronAPI.bookmarks.import()
    if (!r.success && !r.imported) return
    if (r.success) {
      showToast(`Imported ${r.imported} bookmarks${r.skipped ? ` · ${r.skipped} skipped (duplicates)` : ''}`, true)
      const updated = await window.electronAPI.bookmarks.getAll()
      setBookmarks(updated)
    } else if (r.error) {
      showToast(`Import failed: ${r.error}`, false)
    }
  }

  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const dateStr = time.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })

  const totalPages = Math.ceil(bookmarks.length / ITEMS_PER_PAGE)
  const pageBms    = bookmarks.slice(bmPage * ITEMS_PER_PAGE, (bmPage + 1) * ITEMS_PER_PAGE)
  const isLastPage = bmPage === Math.max(0, totalPages - 1)

  const glass = glassStyle(isLight)

  if (view === 'sphere') {
    return (
      <div className="absolute inset-0 z-50">
        <BookmarkSphere bookmarks={bookmarks} onNavigate={onNavigate} onRemove={handleRemove} onClose={() => setView('grid')} />
      </div>
    )
  }

  return (
    <div className="relative flex flex-col h-full overflow-hidden"
      style={{ background: isLight ? 'linear-gradient(160deg,#f8fafc 0%,#f1f5f9 100%)' : 'linear-gradient(160deg,#070B14 0%,#060A12 100%)' }}>

      {/* Atmospheric blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[520px] h-[360px] rounded-full blur-[130px]"
          style={{ background: isLight ? 'rgba(37,99,235,0.06)' : 'rgba(59,130,246,0.055)' }} />
        <div className="absolute bottom-0 right-1/4 w-[420px] h-[260px] rounded-full blur-[110px]"
          style={{ background: isLight ? 'rgba(124,58,237,0.05)' : 'rgba(139,92,246,0.04)' }} />
      </div>

      <div className="relative z-10 flex flex-col h-full overflow-y-auto">

        {/* Clock */}
        <motion.div className="text-center pt-10 pb-2"
          initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
          <div className={`text-6xl font-extralight tracking-tight tabular-nums ${isLight ? 'text-slate-800' : 'text-slate-100'}`}>{timeStr}</div>
          <div className={`text-xs mt-1.5 font-medium tracking-wide ${isLight ? 'text-slate-500' : 'text-slate-600'}`}>{greeting} &nbsp;·&nbsp; {dateStr}</div>
        </motion.div>

        {/* Search */}
        <motion.div className="px-6 pb-5 max-w-3xl mx-auto w-full"
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.10 }}>
          <SearchBar onNavigate={onNavigate} />
        </motion.div>

        {/* Bookmarks */}
        <motion.div className="px-6 pb-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.16 }}>
          <div className="max-w-3xl mx-auto">

            {/* Header row */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_5px_#3b82f6]" />
                <span className={`text-[11px] font-bold uppercase tracking-widest ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>Bookmarks</span>
                {totalPages > 1 && (
                  <span className={`text-[10px] ml-1 ${isLight ? 'text-slate-400' : 'text-slate-700'}`}>{bmPage + 1}/{totalPages}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {totalPages > 1 && (
                  <div className="flex items-center gap-0.5 no-drag" style={glass}>
                    <button onClick={() => setBmPage(p => Math.max(0, p - 1))} disabled={bmPage === 0}
                      className={`w-6 h-6 flex items-center justify-center rounded-lg disabled:opacity-25 transition-all ${isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-500 hover:text-slate-200'}`}>
                      <ChevronLeft size={12} />
                    </button>
                    <button onClick={() => setBmPage(p => Math.min(totalPages - 1, p + 1))} disabled={isLastPage}
                      className={`w-6 h-6 flex items-center justify-center rounded-lg disabled:opacity-25 transition-all ${isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-500 hover:text-slate-200'}`}>
                      <ChevronRight size={12} />
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-0.5 no-drag" style={{ ...glass, borderRadius: 8 }}>
                  <ExportImportMenu isLight={isLight} onExport={handleExport} onImport={handleImport} />
                </div>

                <div className="flex items-center gap-0.5 p-0.5 rounded-xl no-drag" style={glass}>
                  <ViewBtn isLight={isLight} active={view === 'grid'} onClick={() => setView('grid')} label="Grid">
                    <LayoutGrid size={12} />
                  </ViewBtn>
                  <ViewBtn isLight={isLight} active={view === 'sphere'} onClick={() => setView('sphere')} label="Graph">
                    <Network size={12} />
                  </ViewBtn>
                </div>
              </div>
            </div>

            {/* Bookmark grid */}
            <div className="flex flex-wrap justify-center gap-5" style={{ minHeight: 172 }}>
              {pageBms.map((bm, i) => (
                <BookmarkTile key={bm.id} bm={bm} index={i} isLight={isLight} onNavigate={onNavigate} onRemove={handleRemove} />
              ))}

              {isLastPage && (
                <button onClick={() => setAddBookmarkOpen(true)} className="flex flex-col items-center gap-2 group no-drag" style={{ width: 76 }}>
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-200 group-hover:scale-110"
                    style={{
                      background: isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)',
                      border:     isLight ? '1px dashed rgba(0,0,0,0.12)' : '1px dashed rgba(255,255,255,0.12)',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.borderColor = 'rgba(59,130,246,0.4)'
                      ;(e.currentTarget as HTMLElement).style.background = 'rgba(59,130,246,0.07)'
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.borderColor = isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)'
                      ;(e.currentTarget as HTMLElement).style.background = isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)'
                    }}
                  >
                    <Plus size={20} className={`transition-colors group-hover:text-blue-400 ${isLight ? 'text-slate-400' : 'text-slate-600'}`} />
                  </div>
                  <span className={`text-[11px] text-center ${isLight ? 'text-slate-400' : 'text-slate-600'}`}>Add</span>
                </button>
              )}
            </div>

            {/* Dot pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center gap-1.5 mt-4">
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button key={i} onClick={() => setBmPage(i)}
                    className={`rounded-full transition-all duration-200 no-drag ${
                      i === bmPage ? 'w-4 h-1.5 bg-blue-500' : `w-1.5 h-1.5 ${isLight ? 'bg-slate-300 hover:bg-slate-400' : 'bg-slate-700 hover:bg-slate-500'}`
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        </motion.div>

        {/* AI Recommendations */}
        <motion.div className="px-6 pb-8 max-w-3xl mx-auto w-full"
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.26 }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Zap size={12} className="text-blue-400" />
              <span className={`text-[11px] font-bold uppercase tracking-widest ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>AI Picks For You</span>
            </div>
            <button onClick={refreshRecommendations} disabled={loadingRecs}
              className={`flex items-center gap-1 text-xs transition-colors disabled:opacity-40 no-drag ${isLight ? 'text-slate-500 hover:text-blue-500' : 'text-slate-600 hover:text-blue-400'}`}>
              <RefreshCw size={11} className={loadingRecs ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>

          {recommendations.length === 0 ? (
            <div className="flex items-center justify-center h-24 rounded-2xl gap-2 text-xs"
              style={{
                border: isLight ? '1px dashed rgba(0,0,0,0.1)' : '1px dashed rgba(255,255,255,0.07)',
                background: isLight ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.02)',
                color: isLight ? '#94a3b8' : '#475569',
              }}>
              <Sparkles size={13} className="text-blue-500/40" />
              Browse a few sites — AI will personalise recommendations
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {recommendations.slice(0, 6).map((rec, i) => (
                <RecCard key={rec.url} rec={rec} index={i} isLight={isLight} onNavigate={onNavigate} />
              ))}
            </div>
          )}
        </motion.div>

        {/* Recent Activity */}
        <RecentActivity isLight={isLight} onNavigate={onNavigate} />
        <div className="h-8" />
      </div>

      <AddBookmarkModal />

      {/* Toast */}
      <AnimatePresence>
        {bmToast && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.18 }}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-2xl text-xs font-medium no-drag pointer-events-none"
            style={{
              background: bmToast.ok ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
              border: `1px solid ${bmToast.ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
              backdropFilter: 'blur(16px)',
              color: bmToast.ok ? (isLight ? '#065f46' : '#6ee7b7') : (isLight ? '#991b1b' : '#fca5a5'),
              boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
            }}
          >
            <span>{bmToast.ok ? '✓' : '✕'}</span>
            {bmToast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Export / Import dropdown ─────────────────────────────────────────────────
function ExportImportMenu({ isLight, onExport, onImport }: {
  isLight: boolean
  onExport: (fmt: 'json' | 'html') => void
  onImport: () => void
}) {
  const [open, setOpen] = useState(false)
  const [dropPos, setDropPos] = useState({ top: 0, right: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setDropPos({ top: r.bottom + 6, right: window.innerWidth - r.right })
    }
    setOpen(o => !o)
  }

  const iconColor = isLight
    ? (open ? '#374151' : '#6b7280')
    : (open ? '#e2e8f0' : '#94a3b8')

  const menuBg     = isLight ? '#ffffff'  : '#0f1c2e'
  const menuBorder = isLight ? '1.5px solid rgba(37,99,235,0.35)' : '1.5px solid rgba(59,130,246,0.55)'
  const menuShadow = isLight
    ? '0 8px 32px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.12)'
    : '0 20px 60px rgba(0,0,0,0.95), 0 4px 16px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.08)'
  const dividerBg  = isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.14)'

  return (
    <div>
      <button ref={btnRef} onClick={toggle} title="Export / Import bookmarks"
        className="w-7 h-7 flex items-center justify-center rounded-lg transition-all"
        style={{ color: iconColor }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = isLight ? '#111827' : '#e2e8f0' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = iconColor }}
      >
        <Download size={12} />
      </button>

      {/* Portal always mounted — AnimatePresence lives INSIDE to avoid exit-animation deadlock */}
      {createPortal(
        <>
          {/* Backdrop — closes instantly, no animation needed */}
          {open && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 99997 }} onClick={() => setOpen(false)} />
          )}

          {/* Dropdown — animated by AnimatePresence inside the portal */}
          <AnimatePresence>
            {open && (
              <motion.div
                key="export-import-dropdown"
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                transition={{ duration: 0.12 }}
                style={{
                  position: 'fixed',
                  top: dropPos.top,
                  right: dropPos.right,
                  zIndex: 99998,
                  width: 210,
                  background: menuBg,
                  border: menuBorder,
                  borderRadius: 14,
                  overflow: 'hidden',
                  boxShadow: menuShadow,
                }}
              >
                <div style={{
                  padding: '8px 14px 7px',
                  borderBottom: isLight ? '1px solid rgba(0,0,0,0.1)' : '1px solid rgba(255,255,255,0.12)',
                  background: menuBg,
                }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: isLight ? '#94a3b8' : '#4a6080', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Bookmarks</span>
                </div>
                <MenuItem isLight={isLight} icon={<Download size={12} />} label="Export as JSON"   onClick={() => { onExport('json'); setOpen(false) }} />
                <MenuItem isLight={isLight} icon={<Download size={12} />} label="Export as HTML"   onClick={() => { onExport('html'); setOpen(false) }} sub="Chrome / Firefox compatible" />
                <div style={{ height: 1, background: dividerBg, margin: '2px 12px' }} />
                <MenuItem isLight={isLight} icon={<Upload size={12} />}   label="Import bookmarks" onClick={() => { onImport(); setOpen(false) }} sub="JSON or HTML (Chrome, Firefox…)" />
              </motion.div>
            )}
          </AnimatePresence>
        </>,
        document.body
      )}
    </div>
  )
}

function MenuItem({ isLight, icon, label, sub, onClick }: { isLight: boolean; icon: React.ReactNode; label: string; sub?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-start gap-2.5 w-full px-3 py-2.5 text-left transition-all"
      style={{ color: isLight ? '#6b7280' : '#94a3b8' }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.background = isLight ? 'rgba(37,99,235,0.06)' : 'rgba(59,130,246,0.1)'
        ;(e.currentTarget as HTMLElement).style.color = isLight ? '#111827' : '#e2e8f0'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.background = 'transparent'
        ;(e.currentTarget as HTMLElement).style.color = isLight ? '#6b7280' : '#94a3b8'
      }}
    >
      <span className="mt-0.5 shrink-0 text-blue-500">{icon}</span>
      <div>
        <div className="text-xs font-medium leading-tight">{label}</div>
        {sub && <div className={`text-[10px] mt-0.5 leading-tight ${isLight ? 'text-slate-400' : 'text-slate-600'}`}>{sub}</div>}
      </div>
    </button>
  )
}

// ── Bookmark tile ────────────────────────────────────────────────────────────
function BookmarkTile({ bm, index, isLight, onNavigate, onRemove }: {
  bm: any; index: number; isLight: boolean; onNavigate: (u: string) => void; onRemove: (id: string) => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <motion.div
      key={bm.id}
      initial={{ opacity: 0, scale: 0.88 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.02, duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
      className="flex flex-col items-center gap-2 group no-drag relative"
      style={{ width: 76 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <AnimatePresence>
        {hovered && (
          <motion.button
            initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.12 }}
            onClick={e => { e.stopPropagation(); onRemove(bm.id) }}
            className="absolute -top-1.5 -right-1.5 z-10 w-5 h-5 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(239,68,68,0.9)', border: '1.5px solid rgba(255,255,255,0.2)' }}
            title="Remove bookmark"
          >
            <X size={9} className="text-white" />
          </motion.button>
        )}
      </AnimatePresence>

      <button
        onClick={() => onNavigate(bm.url)}
        className="w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-200 group-hover:scale-110 relative overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${bm.color}28, ${bm.color}12)`,
          border:     `1px solid ${bm.color}35`,
          boxShadow:  `0 4px 16px ${bm.color}18`,
        }}
      >
        <img
          src={`https://www.google.com/s2/favicons?domain=${bm.url}&sz=48`}
          className="w-8 h-8 object-contain"
          onError={e => {
            const t = e.target as HTMLImageElement
            t.style.display = 'none'
            const p = t.parentElement!
            p.innerHTML = `<span style="font-size:24px;line-height:1">${bm.title.charAt(0)}</span>`
          }}
        />
        <div className="absolute inset-0 bg-white/0 group-hover:bg-white/[0.06] transition-all duration-200 rounded-2xl" />
      </button>

      <button onClick={() => onNavigate(bm.url)} className="w-full text-center">
        <span className={`text-[11px] text-center leading-tight line-clamp-1 block transition-colors ${
          isLight ? 'text-slate-500 group-hover:text-slate-800' : 'text-slate-500 group-hover:text-slate-300'
        }`}>
          {bm.title}
        </span>
      </button>
    </motion.div>
  )
}

// ── View toggle button ───────────────────────────────────────────────────────
function ViewBtn({ isLight, active, onClick, label, children }: {
  isLight: boolean; active: boolean; onClick: () => void; label: string; children: React.ReactNode
}) {
  return (
    <button onClick={onClick} title={label}
      className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-150 no-drag ${
        active
          ? 'bg-blue-600 text-white'
          : isLight
            ? 'text-slate-500 hover:text-slate-800 hover:bg-black/[0.06]'
            : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.06]'
      }`}>
      {children}
    </button>
  )
}

// ── Recommendation card ──────────────────────────────────────────────────────
function RecCard({ rec, index, isLight, onNavigate }: { rec: Recommendation; index: number; isLight: boolean; onNavigate: (u: string) => void }) {
  const glass = glassStyle(isLight)
  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.26 + index * 0.05 }}
      onClick={() => onNavigate(rec.url)}
      className="flex items-start gap-2.5 p-3 rounded-xl text-left group no-drag transition-all duration-150"
      style={{ ...glass, boxShadow: isLight ? '0 2px 8px rgba(0,0,0,0.06)' : '0 2px 12px rgba(0,0,0,0.25)' }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.background = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)'
        ;(e.currentTarget as HTMLElement).style.borderColor = isLight ? 'rgba(37,99,235,0.25)' : 'rgba(59,130,246,0.25)'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.background = isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)'
        ;(e.currentTarget as HTMLElement).style.borderColor = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
      }}
    >
      <img src={rec.favicon} className="w-7 h-7 rounded-xl shrink-0 mt-0.5"
        onError={e => { (e.target as HTMLImageElement).src = `https://www.google.com/s2/favicons?domain=${rec.url}&sz=32` }} />
      <div className="min-w-0">
        <div className={`text-xs font-semibold truncate transition-colors group-hover:text-blue-500 ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>{rec.title}</div>
        <div className={`text-[10px] truncate mt-0.5 ${isLight ? 'text-slate-400' : 'text-slate-600'}`}>{rec.reason}</div>
      </div>
    </motion.button>
  )
}

// ── Recent Activity ──────────────────────────────────────────────────────────
const RecentActivity = memo(function RecentActivity({ isLight, onNavigate }: { isLight: boolean; onNavigate: (url: string) => void }) {
  const [recent,  setRecent]  = useState<any[]>([])
  const [visible, setVisible] = useState(() => localStorage.getItem('hideRecent') !== '1')
  const glass = glassStyle(isLight)

  useEffect(() => {
    window.electronAPI.history.getAll().then((h: any[]) => setRecent(h.slice(0, 8)))
  }, [])

  const toggleVisible = () => {
    setVisible(v => {
      const next = !v
      localStorage.setItem('hideRecent', next ? '0' : '1')
      return next
    })
  }

  if (recent.length === 0) return null

  return (
    <div className="px-6 pb-4 max-w-3xl mx-auto w-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Clock size={12} className={isLight ? 'text-slate-400' : 'text-slate-600'} />
          <span className={`text-[11px] font-bold uppercase tracking-widest ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>Recent</span>
        </div>
        <button onClick={toggleVisible} title={visible ? 'Hide recent visits' : 'Show recent visits'}
          className={`flex items-center gap-1 text-[10px] transition-colors no-drag ${isLight ? 'text-slate-400 hover:text-slate-600' : 'text-slate-600 hover:text-slate-400'}`}>
          {visible ? <EyeOff size={11} /> : <Eye size={11} />}
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="flex gap-2.5 overflow-x-auto pb-1 no-scrollbar"
            style={{ overflow: 'hidden' }}
          >
            {recent.map((h, i) => (
              <motion.button key={h.id}
                initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => onNavigate(h.url)}
                className="flex items-center gap-2 shrink-0 px-3 py-2 rounded-xl transition-all duration-150 max-w-[160px] no-drag"
                style={glass}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.08)'
                  ;(e.currentTarget as HTMLElement).style.borderColor = isLight ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.14)'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)'
                  ;(e.currentTarget as HTMLElement).style.borderColor = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
                }}
              >
                <img src={`https://www.google.com/s2/favicons?domain=${h.url}&sz=16`} className="w-3.5 h-3.5 rounded shrink-0"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                <span className={`text-xs truncate ${isLight ? 'text-slate-600' : 'text-slate-500'}`}>
                  {h.title || (() => { try { return new URL(h.url).hostname.replace('www.','') } catch { return h.url } })()}
                </span>
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})
