import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'
import { Play, Pause, X, BookOpen, Sparkles, RotateCcw } from 'lucide-react'
import { getChapter, parseRef, formatRef } from '../../services/bibleService'

interface Saved { ref: string; ts: number }

interface Props {
  open: boolean
  onClose: () => void
  saved: Saved[]
  notes: Record<string, string>
  onOpenRef: (ref: string) => void
}

// ── Graph data ──────────────────────────────────────────────────────────────
const CENTER_ID = '__bible__'

interface GNode extends d3.SimulationNodeDatum {
  id: string
  ref: string | null      // null = the central Bible node
  bookId: string | null
  label: string
  color: string
  ts: number
  reveal: number          // chronological reveal order (for the timelapse)
  hub: boolean            // book-anchor node
}
interface GLink extends d3.SimulationLinkDatum<GNode> {
  source: string | GNode
  target: string | GNode
}

// A vivid, evenly-spread ring — each book is hashed to a stable hue so the same
// book always wears the same color across sessions, and neighbours stay distinct.
const RING = [
  '#f43f5e', '#fb923c', '#fbbf24', '#a3e635', '#4ade80', '#2dd4bf',
  '#38bdf8', '#60a5fa', '#818cf8', '#a78bfa', '#e879f9', '#f472b6',
]
function bookColor(bookId: string): string {
  let h = 0
  for (let i = 0; i < bookId.length; i++) h = bookId.charCodeAt(i) + ((h << 5) - h)
  return RING[Math.abs(h) % RING.length]
}

function buildGraph(saved: Saved[]): { nodes: GNode[]; links: GLink[] } {
  const chron = [...saved].sort((a, b) => a.ts - b.ts)
  const nodes: GNode[] = [{
    id: CENTER_ID, ref: null, bookId: null, label: 'Holy Bible',
    color: '#e6c86e', ts: 0, reveal: -1, hub: true,
  }]
  const links: GLink[] = []
  const bookAnchor = new Map<string, string>()   // bookId → id of that book's hub node

  chron.forEach((s, i) => {
    const parsed = parseRef(s.ref)
    const bookId = parsed?.bookId ?? null
    const node: GNode = {
      id: s.ref, ref: s.ref, bookId,
      label: formatRef(s.ref),
      color: bookId ? bookColor(bookId) : '#94a3b8',
      ts: s.ts, reveal: i, hub: false,
    }
    nodes.push(node)

    // Cluster verses under a per-book hub so the graph reads as branches off
    // the Bible rather than one dense ball. The first saved verse of each book
    // becomes that book's hub and links straight to the centre; the rest hang
    // off the hub.
    if (bookId) {
      if (!bookAnchor.has(bookId)) {
        bookAnchor.set(bookId, s.ref)
        node.hub = true
        links.push({ source: CENTER_ID, target: s.ref })
      } else {
        links.push({ source: bookAnchor.get(bookId)!, target: s.ref })
      }
    } else {
      links.push({ source: CENTER_ID, target: s.ref })
    }
  })
  return { nodes, links }
}

export default function VerseGraph({ open, onClose, saved, notes, onOpenRef }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const gRef = useRef<SVGGElement>(null)
  const nodeEls = useRef(new Map<string, SVGGElement>())
  const linkEls = useRef(new Map<string, SVGLineElement>())
  const simRef = useRef<d3.Simulation<GNode, GLink> | null>(null)

  const { nodes, links } = useMemo(() => buildGraph(saved), [saved])
  const total = nodes.length - 1   // exclude the centre node

  const [selected, setSelected] = useState<GNode | null>(null)
  const [verseText, setVerseText] = useState<string>('')
  const [playing, setPlaying] = useState(false)
  // How many verses (in chronological order) are currently revealed. Starts at
  // full; the timelapse rewinds to 0 and plays forward.
  const [revealed, setRevealed] = useState(total)

  // Reset reveal to "all shown" whenever the saved set changes or we reopen.
  useEffect(() => { if (open) { setRevealed(total); setPlaying(false); setSelected(null) } }, [open, total])

  const linkKey = (l: GLink) => `${typeof l.source === 'string' ? l.source : l.source.id}->${typeof l.target === 'string' ? l.target : l.target.id}`

  // ── Simulation ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !svgRef.current) return
    const svg = svgRef.current
    const rect = svg.getBoundingClientRect()
    const w = rect.width || 900
    const h = rect.height || 600

    const sim = d3.forceSimulation<GNode>(nodes)
      .force('link', d3.forceLink<GNode, GLink>(links).id(d => d.id).distance(l => {
        const isHub = (typeof l.target === 'object' && (l.target as GNode).hub)
        return isHub ? 150 : 70
      }).strength(0.5))
      .force('charge', d3.forceManyBody().strength(d => (d as GNode).hub ? -520 : -160))
      .force('center', d3.forceCenter(w / 2, h / 2))
      .force('collide', d3.forceCollide<GNode>().radius(d => (d.id === CENTER_ID ? 44 : d.hub ? 26 : 16)))
      // A gentle radial pull gives the whole thing that spherical, orbiting feel.
      .force('radial', d3.forceRadial<GNode>(d => (d.id === CENTER_ID ? 0 : d.hub ? 190 : 300), w / 2, h / 2).strength(0.045))

    // Pin the centre node so the graph orbits a fixed heart.
    const center = nodes.find(n => n.id === CENTER_ID)
    if (center) { center.fx = w / 2; center.fy = h / 2 }

    sim.on('tick', () => {
      for (const l of links) {
        const el = linkEls.current.get(linkKey(l))
        if (!el) continue
        const s = l.source as GNode, t = l.target as GNode
        el.setAttribute('x1', String(s.x ?? 0)); el.setAttribute('y1', String(s.y ?? 0))
        el.setAttribute('x2', String(t.x ?? 0)); el.setAttribute('y2', String(t.y ?? 0))
      }
      for (const n of nodes) {
        const el = nodeEls.current.get(n.id)
        if (el) el.setAttribute('transform', `translate(${n.x ?? 0},${n.y ?? 0})`)
      }
    })

    simRef.current = sim

    // Zoom / pan.
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', e => { if (gRef.current) gRef.current.setAttribute('transform', e.transform.toString()) })
    d3.select(svg).call(zoom)

    return () => { sim.stop(); d3.select(svg).on('.zoom', null) }
  }, [open, nodes, links])

  // ── Timelapse driver ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing) return
    if (revealed >= total) { setPlaying(false); return }
    const id = window.setInterval(() => {
      setRevealed(r => {
        if (r >= total) { setPlaying(false); return r }
        return r + 1
      })
    }, 650)
    return () => window.clearInterval(id)
  }, [playing, total, revealed])

  // A node is visible if its chronological index is within the revealed count.
  const isVisible = useCallback((n: GNode) => n.id === CENTER_ID || n.reveal < revealed, [revealed])

  const startTimelapse = () => { setSelected(null); setRevealed(0); setPlaying(true) }

  // ── Verse text on selection ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setVerseText('')
    if (!selected?.ref) return
    const p = parseRef(selected.ref)
    if (!p) return
    getChapter(p.bookId, p.chapter)
      .then(vs => { if (!cancelled) setVerseText(vs.find(v => v.v === p.verse)?.t ?? '') })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selected])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { selected ? setSelected(null) : onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, selected])

  if (!open) return null

  const openInBible = () => {
    if (!selected?.ref) return
    onOpenRef(selected.ref)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[300] flex flex-col"
      style={{ background: 'radial-gradient(circle at 50% 38%, rgba(24,20,44,0.96), rgba(4,6,14,0.98))' }}>

      {/* Header / tools */}
      <div className="flex shrink-0 items-center gap-3 px-5 py-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <Sparkles size={18} style={{ color: '#e6c86e' }} />
        <div className="flex-1">
          <div className="text-sm font-semibold text-white">Verse Constellation</div>
          <div className="text-[11px] text-white/50">
            {total} saved {total === 1 ? 'verse' : 'verses'} orbiting scripture · drag to pan · scroll to zoom
          </div>
        </div>

        {/* Timelapse controls */}
        <div className="flex items-center gap-2 rounded-xl px-3 py-1.5"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <button
            onClick={() => (playing ? setPlaying(false) : revealed >= total ? startTimelapse() : setPlaying(true))}
            title={playing ? 'Pause' : 'Play timelapse'}
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ background: 'rgba(230,200,110,0.18)', color: '#e6c86e' }}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <input
            type="range" min={0} max={total} value={revealed}
            onChange={e => { setPlaying(false); setRevealed(Number(e.target.value)) }}
            style={{ width: 150, accentColor: '#e6c86e' }}
          />
          <span className="w-12 text-right text-[11px] tabular-nums text-white/60">{revealed}/{total}</span>
          <button onClick={startTimelapse} title="Replay from the beginning"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-white/60 hover:text-white">
            <RotateCcw size={13} />
          </button>
        </div>

        <button onClick={onClose} title="Close (Esc)"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white">
          <X size={17} />
        </button>
      </div>

      {/* Graph */}
      <div className="relative min-h-0 flex-1">
        {total === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-white/60">
            <BookOpen size={40} style={{ color: '#e6c86e', opacity: 0.7 }} />
            <div className="text-sm">No saved verses yet.</div>
            <div className="max-w-xs text-xs text-white/40">
              Tap a verse while reading and choose <b>Save</b> — it'll appear here, linked into your constellation.
            </div>
          </div>
        ) : (
          <svg ref={svgRef} className="h-full w-full" style={{ cursor: 'grab' }}>
            <defs>
              <filter id="vg-glow" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="3.2" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <style>{`
                @keyframes vgDash { to { stroke-dashoffset: -16; } }
                @keyframes vgPop { 0% { opacity:0; transform:scale(0.2);} 60%{opacity:1;transform:scale(1.15);} 100%{opacity:1;transform:scale(1);} }
                .vg-link { stroke-dasharray: 3 5; animation: vgDash 1.1s linear infinite; }
                .vg-node-inner { transform-box: fill-box; transform-origin: center; }
              `}</style>
            </defs>

            <g ref={gRef}>
              {/* Links */}
              {links.map(l => {
                const key = linkKey(l)
                const tgt = nodes.find(n => n.id === (typeof l.target === 'string' ? l.target : l.target.id))!
                const vis = isVisible(tgt)
                return (
                  <line
                    key={key}
                    ref={el => { if (el) linkEls.current.set(key, el); else linkEls.current.delete(key) }}
                    className="vg-link"
                    stroke={tgt.color}
                    strokeOpacity={vis ? 0.4 : 0}
                    strokeWidth={tgt.hub ? 1.8 : 1}
                    style={{ transition: 'stroke-opacity 0.4s' }}
                  />
                )
              })}

              {/* Nodes */}
              {nodes.map(n => {
                const vis = isVisible(n)
                const isCenter = n.id === CENTER_ID
                const r = isCenter ? 26 : n.hub ? 13 : 9
                const isSel = selected?.id === n.id
                return (
                  <g
                    key={n.id}
                    ref={el => { if (el) nodeEls.current.set(n.id, el); else nodeEls.current.delete(n.id) }}
                    style={{
                      cursor: n.ref ? 'pointer' : 'default',
                      opacity: vis ? 1 : 0,
                      transition: 'opacity 0.45s',
                      pointerEvents: vis ? 'all' : 'none',
                    }}
                    onClick={() => { if (n.ref) setSelected(cur => (cur?.id === n.id ? null : n)) }}
                  >
                    <circle
                      className="vg-node-inner"
                      r={r}
                      fill={n.color}
                      filter="url(#vg-glow)"
                      stroke={isSel ? '#fff' : 'rgba(255,255,255,0.35)'}
                      strokeWidth={isSel ? 2.5 : isCenter ? 1.5 : 1}
                      style={{ animation: vis ? `vgPop 0.5s ease-out` : undefined }}
                    />
                    {isCenter && (
                      <text textAnchor="middle" dy="0.32em" fontSize="10" fontWeight="700"
                        fill="#1a1207" style={{ pointerEvents: 'none', fontFamily: 'Georgia, serif' }}>
                        BIBLE
                      </text>
                    )}
                    {!isCenter && (
                      <text textAnchor="middle" y={r + 12} fontSize="9.5" fill="rgba(255,255,255,0.72)"
                        style={{ pointerEvents: 'none' }}>
                        {n.label}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          </svg>
        )}

        {/* Selected-verse card */}
        {selected?.ref && (
          <div className="absolute bottom-5 left-1/2 w-[min(520px,92vw)] -translate-x-1/2 rounded-2xl p-4"
            style={{
              background: 'rgba(16,14,28,0.94)', border: '1px solid rgba(255,255,255,0.12)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.6)', backdropFilter: 'blur(18px)',
            }}>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: selected.color }} />
              <span className="text-sm font-semibold text-white">{selected.label}</span>
              <span className="ml-auto text-[11px] text-white/40">
                Saved {new Date(selected.ts).toLocaleDateString()}
              </span>
            </div>
            <p className="mb-3 text-[13px] leading-relaxed text-white/85">
              {verseText || <span className="text-white/40">Loading…</span>}
            </p>
            {notes[selected.ref] && (
              <p className="mb-3 rounded-lg px-3 py-2 text-[12px] italic text-white/70"
                style={{ background: 'rgba(255,255,255,0.05)' }}>
                “{notes[selected.ref]}”
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={openInBible}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-white"
                style={{ background: 'linear-gradient(135deg, #b8892e, #e6c86e)' }}
              >
                <BookOpen size={15} /> Open in Bible
              </button>
              <button onClick={() => setSelected(null)}
                className="rounded-xl px-4 py-2 text-sm text-white/70"
                style={{ background: 'rgba(255,255,255,0.07)' }}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
