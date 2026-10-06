/**
 * The browser under the decks: a folder tree of the user's system, the track
 * list with tags/length/BPM, a cover-flow of the selection, and the sidelist
 * that feeds Automix.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRight, ChevronDown, Folder as FolderIcon, FolderOpen, HardDrive, Music, Monitor, Download,
  FileText, Video, Home, Plus, Search, X, ListMusic, Shuffle, Trash2, Loader2, FolderPlus, Youtube, Sparkles,
} from 'lucide-react'
import AiDjPanel from './AiDjPanel'
import type { DeckId, DjTrack } from './engine/DjEngine'
import { cachedTrack, onTrackCacheChange } from './engine/trackCache'
import { fmtTime } from './controls'
import { TRACK_MIME } from './DeckUI'
import {
  djApi, toTrack, loadMeta, knownMeta, probeDuration, cancelPendingProbes, savedFolders, saveFolders,
  trackByToken, searchYouTube, type Folder, type RawTrack,
} from './libraryData'

const MAX_ROWS = 1500
const PROBE_LIMIT = 400

type SortKey = 'title' | 'artist' | 'album' | 'length' | 'bpm' | 'key'

const PLACE_ICONS: Record<string, React.ReactNode> = {
  Music: <Music size={13} className="dj-ic-music" />, Desktop: <Monitor size={13} />, Downloads: <Download size={13} />,
  Documents: <FileText size={13} />, Videos: <Video size={13} className="dj-ic-video" />, Home: <Home size={13} />,
}

interface Props {
  onLoad: (track: DjTrack, deck?: DeckId) => void
  sidelist: DjTrack[]
  setSidelist: (fn: (s: DjTrack[]) => DjTrack[]) => void
  automix: boolean
  setAutomix: (on: boolean) => void
}

export default function Library({ onLoad, sidelist, setSidelist, automix, setAutomix }: Props) {
  const [roots, setRoots] = useState<{ places: Folder[]; drives: Folder[] }>({ places: [], drives: [] })
  const [mine, setMine] = useState<Folder[]>(savedFolders)
  const [current, setCurrent] = useState<Folder | null>(null)
  const [raws, setRaws] = useState<RawTrack[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ q: string; truncated: boolean } | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [source, setSource] = useState<'local' | 'youtube'>('local')
  const [ytTracks, setYtTracks] = useState<DjTrack[]>([])
  const [ytQuery, setYtQuery] = useState('')
  const [sideTab, setSideTab] = useState<'list' | 'ai'>('list')
  // Bumped as tags / lengths arrive so the rows recompute.
  const [tick, setTick] = useState(0)
  const bump = useRafBatch(() => setTick(n => n + 1))

  useEffect(() => {
    djApi().roots().then(r => {
      setRoots(r)
      const music = r.places.find(p => p.name === 'Music') ?? r.places[0]
      if (music) void open(music)
    }).catch(() => {})
    return onTrackCacheChange(bump)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const open = useCallback(async (f: Folder) => {
    cancelPendingProbes()
    setSource('local')
    setCurrent(f)
    setLoading(true)
    setError(null)
    setSearchResults(null)
    setQuery('')
    try {
      const r = await djApi().list(f.path)
      setRaws(r.tracks)
      setSelected(r.tracks[0]?.token ?? null)
    } catch (e: any) {
      setRaws([])
      setError(/EPERM|EACCES/.test(String(e?.message)) ? 'This folder is protected — pick another one.' : 'Could not open this folder.')
    } finally {
      setLoading(false)
    }
  }, [])

  const runYouTube = async (q: string) => {
    if (!q.trim()) return
    setLoading(true)
    setError(null)
    setYtQuery(q.trim())
    try {
      const list = await searchYouTube(q.trim(), 30)
      setYtTracks(list)
      setSelected(list[0]?.token ?? null)
      if (!list.length) setError('No YouTube results for that search.')
    } catch (e: any) {
      setYtTracks([])
      setError(e?.message || 'YouTube could not be reached.')
    } finally {
      setLoading(false)
    }
  }

  const openYouTube = () => {
    cancelPendingProbes()
    setSource('youtube')
    setCurrent(null)
    setQuery('')
    setError(null)
    setSelected(ytTracks[0]?.token ?? null)
  }

  const runSearch = async () => {
    const q = query.trim()
    if (source === 'youtube') { await runYouTube(q); return }
    if (!q || !current) return
    cancelPendingProbes()
    setLoading(true)
    try {
      const r = await djApi().search(current.path, q)
      setRaws(r.tracks)
      setSearchResults({ q, truncated: r.truncated })
      setSelected(r.tracks[0]?.token ?? null)
    } finally {
      setLoading(false)
    }
  }

  // Tags and lengths, fetched in the background for what is on screen.
  useEffect(() => {
    let alive = true
    for (const raw of raws.slice(0, PROBE_LIMIT)) {
      if (!knownMeta(raw.token)) void loadMeta(raw).then(m => {
        if (!alive) return
        bump()
        if (!m.durationSec && !cachedTrack(raw.path)?.d) void probeDuration(raw).then(() => alive && bump())
      })
      else if (!cachedTrack(raw.path)?.d && !knownMeta(raw.token)?.durationSec) void probeDuration(raw).then(() => alive && bump())
    }
    return () => { alive = false }
  }, [raws, bump])

  const rows = useMemo(() => {
    if (source === 'youtube') return ytTracks.map(t => ({ t, length: t.durationHint ?? null, bpm: null as number | null }))
    const q = searchResults ? '' : query.trim().toLowerCase()
    let list = raws.map(raw => {
      const t = toTrack(raw, knownMeta(raw.token))
      const c = cachedTrack(raw.path)
      return { t, length: c?.d ?? knownMeta(raw.token)?.durationSec ?? null, bpm: t.tagBpm ?? c?.bpm ?? null }
    })
    if (q) {
      const words = q.split(/\s+/)
      list = list.filter(r => {
        const hay = `${r.t.title} ${r.t.artist} ${r.t.album ?? ''} ${r.t.name}`.toLowerCase()
        return words.every(w => hay.includes(w))
      })
    }
    if (sort) {
      const val = (r: typeof list[number]): string | number => {
        switch (sort.key) {
          case 'length': return r.length ?? -1
          case 'bpm': return r.bpm ?? -1
          case 'title': return r.t.title.toLowerCase()
          case 'artist': return r.t.artist.toLowerCase()
          case 'album': return (r.t.album ?? '').toLowerCase()
          case 'key': return (r.t.key ?? '').toLowerCase()
        }
      }
      list = [...list].sort((a, b) => {
        const x = val(a), y = val(b)
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
      })
    }
    return list
  }, [raws, query, sort, searchResults, tick, source, ytTracks])

  const selIndex = Math.max(0, rows.findIndex(r => r.t.token === selected))

  const addFolder = async () => {
    const f = await djApi().pickFolder()
    if (!f) return
    const next = [...mine.filter(m => m.path !== f.path), f]
    setMine(next)
    saveFolders(next)
    void open(f)
  }
  const removeFolder = (f: Folder) => {
    const next = mine.filter(m => m.path !== f.path)
    setMine(next)
    saveFolders(next)
  }

  const toggleSort = (key: SortKey) =>
    setSort(s => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }))

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!rows.length) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const i = Math.min(rows.length - 1, Math.max(0, selIndex + (e.key === 'ArrowDown' ? 1 : -1)))
      setSelected(rows[i].t.token)
      document.getElementById(`dj-row-${rows[i].t.token}`)?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter') {
      onLoad(rows[selIndex].t)
    }
  }

  return (
    <div className="dj-library dj-panel">
      {/* Folder tree */}
      <div className="dj-tree">
        <div className="dj-tree-scroll">
          <TreeGroup title="Computer">
            {roots.places.map(f => (
              <TreeNode key={f.path} folder={f} icon={PLACE_ICONS[f.name]} current={current} onOpen={open} />
            ))}
          </TreeGroup>
          <TreeGroup title="Drives">
            {roots.drives.map(f => <TreeNode key={f.path} folder={f} icon={<HardDrive size={13} />} current={current} onOpen={open} />)}
          </TreeGroup>
          <TreeGroup title="Online">
            <div className={`dj-node ${source === 'youtube' ? 'dj-node-on' : ''}`} style={{ paddingLeft: 6 }} onClick={openYouTube}>
              <span style={{ width: 14 }} />
              <Youtube size={13} className="dj-ic-yt" />
              <span className="dj-node-name">YouTube</span>
            </div>
          </TreeGroup>
          <TreeGroup title="My Folders" action={<button type="button" className="dj-icon-btn" onClick={addFolder} title="Add a music folder"><FolderPlus size={13} /></button>}>
            {mine.length === 0 && <div className="dj-tree-hint">Add any folder with music in it</div>}
            {mine.map(f => (
              <TreeNode key={f.path} folder={f} icon={<FolderOpen size={13} className="dj-ic-fav" />} current={current} onOpen={open}
                onRemove={() => removeFolder(f)} />
            ))}
          </TreeGroup>
        </div>
      </div>

      {/* Tracks */}
      <div className="dj-browser" tabIndex={0} onKeyDown={onKeyDown}>
        <div className="dj-search">
          <Search size={13} />
          <input value={query} onChange={e => { setQuery(e.target.value); if (searchResults) setSearchResults(null) }}
            onKeyDown={e => { if (e.key === 'Enter') void runSearch(); e.stopPropagation() }}
            placeholder={source === 'youtube'
              ? 'Search YouTube — artist, song or mix, then Enter'
              : current ? `Filter ${current.name} — Enter searches all sub-folders` : 'Search'} spellCheck={false} />
          {query && <button type="button" className="dj-icon-btn" onClick={() => { setQuery(''); if (searchResults && current) void open(current) }}><X size={12} /></button>}
          <span className="dj-count">
            {loading ? <Loader2 size={12} className="dj-spin" /> : null}
            {source === 'youtube'
              ? (ytQuery ? `${rows.length} on YouTube` : 'YouTube')
              : searchResults ? `${rows.length}${searchResults.truncated ? '+' : ''} found` : `${rows.length} files`}
          </span>
        </div>

        <CoverFlow rows={rows.map(r => r.t)} index={selIndex} onSelect={t => setSelected(t.token)} onLoad={onLoad} />

        <div className="dj-table">
          <div className="dj-thead">
            {([['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['length', 'Length'], ['bpm', 'Bpm'], ['key', 'Key']] as [SortKey, string][]).map(([k, label]) => (
              <button type="button" key={k} className={`dj-th dj-c-${k}`} onClick={() => toggleSort(k)}>
                {label}{sort?.key === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
              </button>
            ))}
            <span className="dj-th dj-c-act" />
          </div>
          <div className="dj-tbody">
            {error && <div className="dj-empty">{error}</div>}
            {source === 'youtube' && !error && !loading && rows.length === 0 && (
              <div className="dj-empty">
                Search YouTube above and drag any result onto a deck. YouTube songs play in YouTube&apos;s own player, so the
                crossfader, volume, tempo steps, cues and Automix work on them; EQ, effects, stems and waveforms are for local files.
              </div>
            )}
            {source === 'local' && !error && !loading && rows.length === 0 && (
              <div className="dj-empty">
                {current ? `No music in ${current.name}${query ? ' matching your filter' : ''}.` : 'Pick a folder on the left.'}
                {current && !searchResults && <span> Press <b>Enter</b> in the search box to look through sub-folders too.</span>}
              </div>
            )}
            {rows.slice(0, MAX_ROWS).map(({ t, length, bpm }) => (
              <div key={t.token} id={`dj-row-${t.token}`} className={`dj-tr ${t.token === selected ? 'dj-sel' : ''}`}
                draggable
                onDragStart={e => { e.dataTransfer.setData(TRACK_MIME, t.token); e.dataTransfer.effectAllowed = 'copy'; setSelected(t.token) }}
                onClick={() => setSelected(t.token)}
                onDoubleClick={() => onLoad(t)}
                title={t.path}>
                <span className="dj-td dj-c-title">{t.youtubeId ? <Youtube size={11} className="dj-note dj-ic-yt" /> : <Music size={11} className="dj-note" />}{t.title}</span>
                <span className="dj-td dj-c-artist">{t.artist}</span>
                <span className="dj-td dj-c-album">{t.album ?? ''}</span>
                <span className="dj-td dj-c-length">{length ? fmtTime(length, false) : ''}</span>
                <span className="dj-td dj-c-bpm">{bpm ? bpm.toFixed(1) : ''}</span>
                <span className="dj-td dj-c-key">{t.key ?? ''}</span>
                <span className="dj-td dj-c-act">
                  <button type="button" onClick={e => { e.stopPropagation(); onLoad(t, 'A') }} title="Load on deck A">A</button>
                  <button type="button" onClick={e => { e.stopPropagation(); onLoad(t, 'B') }} title="Load on deck B">B</button>
                  <button type="button" onClick={e => { e.stopPropagation(); setSidelist(s => [...s, t]) }} title="Add to sidelist"><Plus size={11} /></button>
                </span>
              </div>
            ))}
            {rows.length > MAX_ROWS && <div className="dj-empty">Showing the first {MAX_ROWS} of {rows.length} — filter to narrow it down.</div>}
          </div>
        </div>
      </div>

      {/* Sidelist / Automix */}
      <div className="dj-side"
        onDragOver={e => { if (e.dataTransfer.types.includes(TRACK_MIME)) e.preventDefault() }}
        onDrop={e => { const t = trackByToken(e.dataTransfer.getData(TRACK_MIME)); if (t) setSidelist(s => [...s, t]) }}>
        <div className="dj-side-head">
          <button type="button" className={`dj-side-tab ${sideTab === 'list' ? 'on' : ''}`} onClick={() => setSideTab('list')}>
            <ListMusic size={12} /> SIDELIST <span className="dj-side-n">{sidelist.length}</span>
          </button>
          <button type="button" className={`dj-side-tab ${sideTab === 'ai' ? 'on' : ''}`} onClick={() => setSideTab('ai')}>
            <Sparkles size={12} /> AI DJ
          </button>
          {sidelist.length > 0 && sideTab === 'list' && (
            <button type="button" className="dj-icon-btn" onClick={() => setSidelist(() => [])} title="Clear"><Trash2 size={12} /></button>
          )}
        </div>
        <AiDjPanel visible={sideTab === 'ai'} sidelistCount={sidelist.length} addTracks={ts => setSidelist(s => [...s, ...ts])}
          automix={automix} setAutomix={setAutomix} />
        <div className="dj-side-body" style={{ display: sideTab === 'list' ? 'flex' : 'none' }}>
        <button type="button" className={`dj-automix ${automix ? 'dj-on dj-on-green' : ''}`} onClick={() => setAutomix(!automix)}
          title="Automatically mix through the sidelist">
          <Shuffle size={13} /> {automix ? 'AUTOMIX ON' : 'AUTOMIX'}
        </button>
        <div className="dj-side-list">
          {sidelist.length === 0 && (
            <div className="dj-side-empty">
              <ListMusic size={26} />
              <p>Drag songs here or press <b>+</b> on a row to build a set. Turn on Automix and AIHub DJ beat-matches and crossfades through it.</p>
            </div>
          )}
          {sidelist.map((t, i) => (
            <div key={`${t.token}-${i}`} className="dj-side-item" draggable
              onDragStart={e => e.dataTransfer.setData(TRACK_MIME, t.token)}
              onDoubleClick={() => onLoad(t)}>
              <span className="dj-side-i">{i + 1}</span>
              <div className="dj-side-t"><b>{t.title}</b><small>{t.artist}</small></div>
              <button type="button" className="dj-icon-btn" onClick={() => setSidelist(s => s.filter((_, j) => j !== i))} title="Remove"><X size={11} /></button>
            </div>
          ))}
        </div>
        </div>
      </div>
    </div>
  )
}

/** Coalesce many async completions into one re-render per frame. */
function useRafBatch(fn: () => void): () => void {
  const pending = useRef(false)
  const ref = useRef(fn)
  ref.current = fn
  return useCallback(() => {
    if (pending.current) return
    pending.current = true
    requestAnimationFrame(() => { pending.current = false; ref.current() })
  }, [])
}

function TreeGroup({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="dj-tree-group">
      <div className="dj-tree-title">{title}{action}</div>
      {children}
    </div>
  )
}

function TreeNode({ folder, icon, current, onOpen, depth = 0, onRemove }: {
  folder: Folder
  icon?: React.ReactNode
  current: Folder | null
  onOpen: (f: Folder) => void
  depth?: number
  onRemove?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [kids, setKids] = useState<Folder[] | null>(null)
  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!open && kids === null) {
      try { setKids((await djApi().list(folder.path)).folders) } catch { setKids([]) }
    }
    setOpen(o => !o)
  }
  const active = current?.path === folder.path
  return (
    <>
      <div className={`dj-node ${active ? 'dj-node-on' : ''}`} style={{ paddingLeft: 6 + depth * 12 }} onClick={() => onOpen(folder)} title={folder.path}>
        <button type="button" className="dj-caret" onClick={toggle} aria-label={open ? 'Collapse' : 'Expand'}>
          {kids && kids.length === 0 ? <span style={{ width: 11 }} /> : open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        {icon ?? (active ? <FolderOpen size={13} className="dj-ic-folder" /> : <FolderIcon size={13} className="dj-ic-folder" />)}
        <span className="dj-node-name">{folder.name}</span>
        {onRemove && <button type="button" className="dj-icon-btn dj-node-x" onClick={e => { e.stopPropagation(); onRemove() }} title="Remove from My Folders"><X size={10} /></button>}
      </div>
      {open && kids?.map(k => <TreeNode key={k.path} folder={k} current={current} onOpen={onOpen} depth={depth + 1} />)}
    </>
  )
}

function CoverFlow({ rows, index, onSelect, onLoad }: {
  rows: DjTrack[]
  index: number
  onSelect: (t: DjTrack) => void
  onLoad: (t: DjTrack) => void
}) {
  if (!rows.length) return <div className="dj-coverflow" />
  const span = 3
  const items: { t: DjTrack; off: number }[] = []
  for (let o = -span; o <= span; o++) {
    const t = rows[index + o]
    if (t) items.push({ t, off: o })
  }
  return (
    <div className="dj-coverflow">
      {items.map(({ t, off }) => {
        const abs = Math.abs(off)
        const style: React.CSSProperties = {
          transform: off === 0
            ? 'translateX(-50%) translateZ(40px)'
            : `translateX(calc(-50% + ${off * 92 + Math.sign(off) * 60}px)) rotateY(${off < 0 ? 52 : -52}deg) scale(${1 - abs * 0.06})`,
          zIndex: 10 - abs,
          opacity: abs === span ? 0.5 : 1,
        }
        return (
          <div key={t.token} className={`dj-cf-item ${off === 0 ? 'dj-cf-center' : ''}`} style={style}
            onClick={() => onSelect(t)} onDoubleClick={() => onLoad(t)}
            draggable onDragStart={e => e.dataTransfer.setData(TRACK_MIME, t.token)}>
            {t.cover
              ? <img src={t.cover} alt="" draggable={false} />
              : <div className="dj-cf-ph" style={{ background: placeholderColor(t.title) }}>
                  <b>{t.title}</b><small>{t.artist}</small><Music size={40} />
                </div>}
          </div>
        )
      })}
    </div>
  )
}

function placeholderColor(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return `linear-gradient(145deg, hsl(${h} 70% 42%), hsl(${(h + 40) % 360} 75% 22%))`
}
