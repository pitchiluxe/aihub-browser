import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronRight, Clock, ExternalLink, Loader2, Music, Play, Search,
  Shuffle, WifiOff, X,
} from 'lucide-react'
import { useBrowserStore } from '../../store/browserStore'

// Built to the same shape as the tutorials page in the user's QuickBooks app:
// a sticky header with a shuffle and a search, the player expanding inline
// above the listing, and a thumbnail grid underneath. The difference is the
// room it is dressed as — this one is a picture house, so the screen sits in
// the dark behind a curtain and the listing reads like what is showing.

interface GospelVideo {
  id: string
  title: string
  channel: string
  duration: string
  views: string
  thumbnail: string
  url: string
}

interface SearchResult {
  ok: boolean
  query: string
  videos: GospelVideo[]
  error?: string
}

// The rows across the top. Each is a search, so the room is never one
// artist's back catalogue.
const SHELVES: { label: string; query: string }[] = [
  { label: 'Now showing',   query: '' },
  { label: 'Choir',         query: 'black gospel choir performance' },
  { label: 'Worship',       query: 'contemporary christian worship live' },
  { label: 'Hymns',         query: 'traditional hymns choir' },
  { label: 'Quartet',       query: 'southern gospel quartet' },
  { label: 'Instrumental',  query: 'gospel piano instrumental worship' },
  { label: 'African',       query: 'african gospel music' },
  { label: 'En español',    query: 'musica cristiana adoracion en vivo' },
  { label: 'A cappella',    query: 'acapella gospel choir' },
]

export default function GospelRoom() {
  const addTab = useBrowserStore(s => s.addTab)
  const [shelf, setShelf]       = useState(0)
  const [search, setSearch]     = useState('')
  const [videos, setVideos]     = useState<GospelVideo[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [query, setQuery]       = useState('')
  const [playing, setPlaying]   = useState<GospelVideo | null>(null)
  const [nonce, setNonce]       = useState(0)

  const load = useCallback(async (q: string) => {
    setLoading(true)
    setError(null)
    try {
      const res: SearchResult = await (window as any).electronAPI?.gospel?.search?.(q || undefined)
      if (res?.ok && res.videos?.length) {
        setVideos(res.videos)
        setQuery(res.query)
      } else {
        setVideos([])
        // "no-results" means YouTube answered but the page shape changed —
        // a different problem from being offline, and worth saying so.
        setError(res?.error === 'no-results'
          ? "YouTube answered, but nothing could be read from the page. That usually means their layout changed and this needs updating."
          : 'Could not reach YouTube. Check the connection and try again.')
      }
    } catch {
      setVideos([])
      setError('Could not reach YouTube. Check the connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(SHELVES[shelf].query) }, [shelf, nonce, load])

  // Stop the player when the listing changes underneath it — an iframe still
  // singing over a screen that has moved on is the worst version of this.
  useEffect(() => { setPlaying(null) }, [shelf, nonce])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return videos
    return videos.filter(v =>
      v.title.toLowerCase().includes(q) || v.channel.toLowerCase().includes(q))
  }, [videos, search])

  return (
    <div className="mx-auto w-full max-w-6xl pb-10">

      {/* ── The marquee ── */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl"
          style={{ background: 'linear-gradient(135deg, rgba(207,111,126,0.30), rgba(230,200,110,0.18))', border: '1px solid rgba(207,111,126,0.35)' }}>
          <Music size={18} style={{ color: '#f0a5b0' }} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-black" style={{ color: 'rgb(var(--ds-text-1, var(--ds-text-2)))' }}>Gospel</h1>
          <p className="text-[11px] opacity-50">
            {loading ? 'Finding something to play…'
              : videos.length ? <>{videos.length} showing{query && <> · “{query}”</>}</>
              : 'Nothing playing yet'}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setNonce(n => n + 1)} disabled={loading}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all disabled:opacity-50"
            style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-3))' }}>
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Shuffle size={13} />} Shuffle
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter what is showing…"
          className="w-full rounded-xl py-2.5 pl-9 pr-9 text-sm outline-none"
          style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-2))', userSelect: 'text' }}
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100">
            <X size={15} />
          </button>
        )}
      </div>

      {/* Shelves */}
      <div className="mb-6 flex gap-1.5 overflow-x-auto pb-1">
        {SHELVES.map((s, i) => (
          <button key={s.label} onClick={() => setShelf(i)}
            className="flex-shrink-0 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold transition-all"
            style={i === shelf
              ? { background: 'rgba(207,111,126,0.20)', border: '1px solid rgba(207,111,126,0.42)', color: '#f0a5b0' }
              : { background: 'transparent', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-4))' }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* ── The screen ── */}
      <AnimatePresence>
        {playing && (
          <motion.div
            key={playing.id}
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 24 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="overflow-hidden rounded-2xl"
              style={{ background: '#07050a', border: '1px solid rgba(207,111,126,0.28)', boxShadow: '0 30px 90px rgba(207,111,126,0.10)' }}>
              <div className="flex items-start gap-3 p-4" style={{ borderBottom: '1px solid var(--ds-glass-sm)' }}>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full" style={{ background: '#f0a5b0' }} />
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#f0a5b0' }}>Now playing</span>
                  </div>
                  <h2 className="text-sm font-bold leading-snug" style={{ color: 'rgb(var(--ds-text-1, var(--ds-text-2)))' }}>{playing.title}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-3">
                    <span className="text-xs opacity-50">{playing.channel}</span>
                    {playing.duration && (
                      <span className="flex items-center gap-1 text-xs opacity-50"><Clock size={11} /> {playing.duration}</span>
                    )}
                  </div>
                </div>
                <button onClick={() => setPlaying(null)}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
                  style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)' }}>
                  <X size={15} />
                </button>
              </div>
              {/* The house lights go down around the screen itself. */}
              <div className="relative aspect-video w-full bg-black">
                <iframe
                  key={playing.id}
                  src={`https://www.youtube-nocookie.com/embed/${playing.id}?autoplay=1&rel=0&modestbranding=1&color=white`}
                  title={playing.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  className="absolute inset-0 h-full w-full"
                />
              </div>
              <div className="p-4">
                <button
                  onClick={() => addTab(playing.url, 'browser')}
                  className="inline-flex items-center gap-1 text-[10.5px] opacity-50 transition-opacity hover:opacity-100">
                  Open on YouTube <ChevronRight size={11} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── The listing ── */}
      {loading && videos.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="animate-pulse overflow-hidden rounded-2xl"
              style={{ background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)' }}>
              <div className="aspect-video" style={{ background: 'var(--ds-glass-sm)' }} />
              <div className="space-y-2 p-3">
                <div className="h-3 w-3/4 rounded" style={{ background: 'var(--ds-glass-md)' }} />
                <div className="h-2 w-1/3 rounded" style={{ background: 'var(--ds-glass-sm)' }} />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl px-6 py-12 text-center"
          style={{ background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)' }}>
          <WifiOff size={26} className="mx-auto mb-3 opacity-30" />
          <p className="mx-auto max-w-md text-[12.5px] leading-relaxed opacity-60">{error}</p>
          <div className="mt-4 flex justify-center gap-2">
            <button onClick={() => setNonce(n => n + 1)}
              className="rounded-xl px-3.5 py-2 text-xs font-semibold"
              style={{ background: 'rgba(207,111,126,0.16)', border: '1px solid rgba(207,111,126,0.34)', color: '#f0a5b0' }}>
              Try again
            </button>
            <button
              onClick={() => addTab('https://www.youtube.com/results?search_query=gospel+music', 'browser')}
              className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold"
              style={{ background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-3))' }}>
              <ExternalLink size={12} /> Search on YouTube
            </button>
          </div>
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl px-6 py-12 text-center"
          style={{ background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)' }}>
          <Music size={26} className="mx-auto mb-3 opacity-25" />
          <p className="text-[12.5px] opacity-55">Nothing here matches “{search}”.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((v, i) => (
            <VideoCard key={v.id} video={v} index={i}
              isPlaying={playing?.id === v.id}
              onPlay={() => setPlaying(p => (p?.id === v.id ? null : v))} />
          ))}
        </div>
      )}

      <p className="mt-6 text-[11px] leading-relaxed opacity-40">
        Played from YouTube in a privacy-preserving embed. Nothing about you is sent with the
        search — no account, no cookies — and nothing is stored.
      </p>
    </div>
  )
}

function VideoCard({ video, index, isPlaying, onPlay }: {
  video: GospelVideo; index: number; isPlaying: boolean; onPlay: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 12) * 0.015, duration: 0.2 }}
      onClick={onPlay}
      className="group cursor-pointer overflow-hidden rounded-2xl transition-all"
      style={isPlaying
        ? { background: 'rgba(207,111,126,0.08)', border: '1px solid rgba(207,111,126,0.55)', boxShadow: '0 0 0 1px rgba(207,111,126,0.20)' }
        : { background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)' }}
    >
      <div className="relative aspect-video overflow-hidden bg-black">
        <img
          src={video.thumbnail}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          onError={e => {
            // hqdefault is missing for a handful of videos; mqdefault always exists.
            const el = e.currentTarget
            if (!el.src.includes('mqdefault')) el.src = `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center transition-opacity duration-200"
          style={isPlaying
            ? { opacity: 1, background: 'rgba(207,111,126,0.20)' }
            : { opacity: 0, background: 'rgba(0,0,0,0.45)' }}
          onMouseEnter={e => { if (!isPlaying) (e.currentTarget as HTMLElement).style.opacity = '1' }}
          onMouseLeave={e => { if (!isPlaying) (e.currentTarget as HTMLElement).style.opacity = '0' }}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full shadow-xl"
            style={{ background: isPlaying ? '#cf6f7e' : 'rgba(255,255,255,0.92)' }}>
            <Play size={19} className="ml-0.5" fill="currentColor" style={{ color: isPlaying ? '#fff' : '#111' }} />
          </div>
        </div>
        {video.duration && (
          <div className="absolute bottom-2 right-2 rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
            style={{ background: 'rgba(0,0,0,0.80)' }}>
            {video.duration}
          </div>
        )}
        {isPlaying && (
          <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold text-white"
            style={{ background: '#cf6f7e' }}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> PLAYING
          </div>
        )}
      </div>
      <div className="p-3">
        <h3 className="mb-1.5 line-clamp-2 text-xs font-semibold leading-snug" style={{ color: 'rgb(var(--ds-text-2))' }}>
          {video.title}
        </h3>
        <p className="text-[10px] opacity-45">
          {video.channel}{video.views && <> · {video.views}</>}
        </p>
      </div>
    </motion.div>
  )
}
