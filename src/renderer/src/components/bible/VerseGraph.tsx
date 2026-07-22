import React, { useCallback, useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { ChevronLeft, Play, Pause, RotateCcw, ZoomIn, ZoomOut, Crosshair, BookOpen } from 'lucide-react'
import { getBookMeta, getChapter, parseRef, formatRef } from '../../services/bibleService'

interface Saved { ref: string; ts: number }
interface Props {
  open: boolean
  onClose: () => void
  saved: Saved[]
  notes: Record<string, string>
  onOpenRef: (ref: string) => void
}

// ── Graph model ──────────────────────────────────────────────────────────────
const CENTER_ID = '__bible__'

interface GNode extends d3.SimulationNodeDatum {
  id: string
  ref: string | null       // null → Bible node or a book-hub with no verse of its own
  bookId: string | null
  label: string
  color: string
  size: number
  connections: number
  ts: number
  kind: 'bible' | 'hub' | 'verse'
}
interface GLink extends d3.SimulationLinkDatum<GNode> {
  source: GNode | string
  target: GNode | string
  strength: number
}

// One vivid, evenly spread hue per book — hashed so a book keeps its color.
const RING = [
  '#f43f5e', '#fb923c', '#fbbf24', '#a3e635', '#4ade80', '#2dd4bf',
  '#38bdf8', '#60a5fa', '#818cf8', '#a78bfa', '#e879f9', '#f472b6',
]
function bookColor(bookId: string): string {
  let h = 0
  for (let i = 0; i < bookId.length; i++) h = bookId.charCodeAt(i) + ((h << 5) - h)
  return RING[Math.abs(h) % RING.length]
}

const BG          = '#070912'
const LABEL_INK   = 'rgba(226,232,240,0.9)'
const MIN_ZOOM    = 0.1
const MAX_ZOOM    = 6
const LABEL_ZOOM  = 0.62
const HUB_THRESHOLD = 2

function nodeRadius(size: number) { return Math.max(4, Math.round(size * 0.42)) }
function hexToRgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${a})`
}
function easeBackOut(t: number, s = 1.7): number {
  const c = s + 1
  return 1 + c * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2)
}

function buildGraph(saved: Saved[]): { nodes: GNode[]; links: GLink[] } {
  const chron = [...saved].sort((a, b) => a.ts - b.ts)
  const counts: Record<string, number> = {}
  const links: GLink[] = []
  const bump = (a: string, b: string) => { counts[a] = (counts[a] || 0) + 1; counts[b] = (counts[b] || 0) + 1 }

  const bible: GNode = {
    id: CENTER_ID, ref: null, bookId: null, label: 'Holy Bible', color: '#e6c86e',
    size: 0, connections: 0, ts: 0, kind: 'bible',
  }
  const nodes: GNode[] = [bible]
  const hubOf = new Map<string, GNode>()   // bookId → its hub node

  for (const s of chron) {
    const parsed = parseRef(s.ref)
    const bookId = parsed?.bookId ?? null
    const color = bookId ? bookColor(bookId) : '#94a3b8'

    if (bookId && !hubOf.has(bookId)) {
      // First verse of a book seen so far → make a labelled book hub, then hang
      // the verse off it. The hub carries the book name; the verse carries the
      // reference. This is what gives the graph Obsidian's clustered look.
      const hub: GNode = {
        id: `hub:${bookId}`, ref: null, bookId,
        label: getBookMeta(bookId)?.name ?? bookId, color, size: 0, connections: 0, ts: s.ts, kind: 'hub',
      }
      hubOf.set(bookId, hub)
      nodes.push(hub)
      links.push({ source: CENTER_ID, target: hub.id, strength: 0.5 })
      bump(CENTER_ID, hub.id)
    }

    const verse: GNode = {
      id: s.ref, ref: s.ref, bookId, label: formatRef(s.ref), color, size: 0, connections: 0, ts: s.ts, kind: 'verse',
    }
    nodes.push(verse)
    const anchor = bookId ? hubOf.get(bookId)!.id : CENTER_ID
    links.push({ source: anchor, target: verse.id, strength: 0.35 })
    bump(anchor, verse.id)
  }

  const maxConn = Math.max(1, ...Object.values(counts))
  for (const n of nodes) {
    n.connections = counts[n.id] ?? 0
    if (n.kind === 'bible') n.size = 62
    else if (n.kind === 'hub') n.size = 30 + (n.connections / maxConn) * 24
    else n.size = 19
  }
  return { nodes, links }
}

export default function VerseGraph({ open, onClose, saved, notes, onOpenRef }: Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simRef = useRef<d3.Simulation<GNode, GLink> | null>(null)
  const nodesRef = useRef<GNode[]>([])
  const linksRef = useRef<GLink[]>([])
  const rafRef = useRef(0)
  const txRef = useRef({ x: 0, y: 0, k: 1 })
  const hoveredRef = useRef<GNode | null>(null)
  const selIdRef = useRef<string | null>(null)
  const draggingRef = useRef<GNode | null>(null)
  const eActiveRef = useRef(false)
  const eStartRef = useRef(0)
  const eMapRef = useRef<Map<string, { delay: number; dur: number }>>(new Map())
  const animMapRef = useRef<Map<string, { t0: number; dur: number }>>(new Map())
  const camAnimRef = useRef<{ from: { x: number; y: number; k: number }; to: { x: number; y: number; k: number }; t0: number; dur: number } | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  // Timelapse — reveals the saved verses in the order they were saved.
  const tlModeRef = useRef(false)
  const tlVisibleRef = useRef<Set<string>>(new Set())
  const tlOrderRef = useRef<string[]>([])
  const tlTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tlIdxRef = useRef(0)

  const [zoom, setZoom] = useState(1)
  const [selNode, setSelNode] = useState<GNode | null>(null)
  const [verseText, setVerseText] = useState('')
  const [tlPlaying, setTlPlaying] = useState(false)
  const [tlProgress, setTlProgress] = useState(0)

  const total = saved.length

  // ── Draw ────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const cam = camAnimRef.current
    if (cam) {
      const p = Math.min(1, (performance.now() - cam.t0) / cam.dur)
      const e = 1 - Math.pow(1 - p, 3)
      txRef.current = {
        k: cam.from.k + (cam.to.k - cam.from.k) * e,
        x: cam.from.x + (cam.to.x - cam.from.x) * e,
        y: cam.from.y + (cam.to.y - cam.from.y) * e,
      }
      if (p >= 1) { camAnimRef.current = null; setZoom(cam.to.k) }
    }

    const { x: tx, y: ty, k } = txRef.current
    const nodes = nodesRef.current
    const links = linksRef.current
    const selId = selIdRef.current
    const now = performance.now()
    const W = canvas.width, H = canvas.height

    const eActive = eActiveRef.current
    const elapsed = eActive ? now - eStartRef.current : Infinity
    if (eActive && elapsed > 2200) eActiveRef.current = false

    ctx.fillStyle = BG
    ctx.fillRect(0, 0, W, H)

    // Cluster atmosphere glows
    for (const node of nodes) {
      if (node.x == null || node.y == null || node.connections < HUB_THRESHOLD) continue
      if (tlModeRef.current && !tlVisibleRef.current.has(node.id)) continue
      const sx = node.x * k + tx, sy = node.y * k + ty, auraR = 90 * k
      if (sx + auraR < 0 || sx - auraR > W || sy + auraR < 0 || sy - auraR > H) continue
      const aura = ctx.createRadialGradient(sx, sy, 0, sx, sy, auraR)
      aura.addColorStop(0, hexToRgba(node.color, 0.05))
      aura.addColorStop(1, hexToRgba(node.color, 0))
      ctx.fillStyle = aura
      ctx.fillRect(sx - auraR, sy - auraR, auraR * 2, auraR * 2)
    }

    ctx.save()
    ctx.translate(tx, ty)
    ctx.scale(k, k)

    let connSet: Set<string> | null = null
    if (selId) {
      connSet = new Set([selId])
      for (const l of links) {
        const s = (l.source as GNode).id, t = (l.target as GNode).id
        if (s === selId) connSet.add(t)
        if (t === selId) connSet.add(s)
      }
    }

    // ── Edges ──────────────────────────────────────────────────────────
    for (const l of links) {
      const src = l.source as GNode, tgt = l.target as GNode
      if (src.x == null || tgt.x == null) continue
      if (tlModeRef.current && (!tlVisibleRef.current.has(src.id) || !tlVisibleRef.current.has(tgt.id))) continue

      const touching = selId && (src.id === selId || tgt.id === selId)
      const dimmed = selId && !touching

      let growth = 1
      if (eActive) {
        const s0 = eMapRef.current.get(src.id), t0 = eMapRef.current.get(tgt.id)
        const start = Math.max(s0?.delay ?? 0, t0?.delay ?? 0) + 140
        const p = (elapsed - start) / 430
        if (p <= 0) continue
        growth = p >= 1 ? 1 : 1 - Math.pow(1 - p, 3)
      }
      const ex = src.x! + (tgt.x! - src.x!) * growth
      const ey = src.y! + (tgt.y! - src.y!) * growth

      if (dimmed) {
        ctx.strokeStyle = 'rgba(148,163,184,0.05)'
        ctx.lineWidth = 0.6 / k
      } else {
        const grd = ctx.createLinearGradient(src.x!, src.y!, tgt.x!, tgt.y!)
        const alpha = touching ? 0.9 : 0.28
        const boost = growth < 1 ? 1.6 : 1
        grd.addColorStop(0, hexToRgba(src.color, Math.min(1, alpha * boost)))
        grd.addColorStop(1, hexToRgba(tgt.color, Math.min(1, alpha * boost)))
        ctx.strokeStyle = grd
        ctx.lineWidth = (touching ? 2 : 1.1) / k
      }
      ctx.beginPath()
      ctx.moveTo(src.x!, src.y!)
      ctx.lineTo(ex, ey)
      ctx.stroke()

      if (growth < 1 && !dimmed) {
        ctx.beginPath()
        ctx.arc(ex, ey, 1.8 / k, 0, Math.PI * 2)
        ctx.fillStyle = hexToRgba(tgt.color, 0.9)
        ctx.fill()
      }
    }

    // ── Nodes ──────────────────────────────────────────────────────────
    for (let ni = 0; ni < nodes.length; ni++) {
      const node = nodes[ni]
      if (tlModeRef.current && !tlVisibleRef.current.has(node.id)) continue
      const nx = node.x ?? 0, ny = node.y ?? 0
      const r = nodeRadius(node.size)
      const col = node.color
      const isSel = node.id === selId
      const isConn = connSet ? connSet.has(node.id) : true
      const isHub = node.connections >= HUB_THRESHOLD

      let scale = 1
      const eInfo = eActive ? eMapRef.current.get(node.id) : undefined
      if (eInfo) {
        const el = elapsed - eInfo.delay
        if (el < 0) scale = 0
        else if (el < eInfo.dur) scale = Math.max(0, easeBackOut(el / eInfo.dur))
      }
      const anim = animMapRef.current.get(node.id)
      if (anim) {
        const el = now - anim.t0
        if (el < anim.dur) scale = Math.max(0, easeBackOut(el / anim.dur))
        else animMapRef.current.delete(node.id)
      }
      const drawR = r * scale
      if (drawR <= 0) continue

      let hubBoost = 0
      if (!eActive && isConn) {
        const amp = isHub ? 0.10 : 0.055
        hubBoost = Math.sin(now * 0.0013 + ni * 0.4) * amp
      }
      const finalR = drawR * (1 + hubBoost)
      const isHov = hoveredRef.current?.id === node.id
      ctx.globalAlpha = isConn ? 1 : 0.08

      // Pulsing colored aura
      if (!eActive && isConn) {
        const pulse = 0.5 + Math.sin(now * 0.0013 + ni * 0.4) * 0.5
        const auraR = finalR * (1.5 + pulse * 0.35)
        const g = ctx.createRadialGradient(nx, ny, finalR * 0.8, nx, ny, auraR)
        g.addColorStop(0, hexToRgba(col, (isHub ? 0.22 : 0.12) * pulse))
        g.addColorStop(1, hexToRgba(col, 0))
        ctx.fillStyle = g
        ctx.beginPath(); ctx.arc(nx, ny, auraR, 0, Math.PI * 2); ctx.fill()
      }

      // Glow halo
      if ((isSel || isHov || isHub) && isConn) {
        ctx.save()
        ctx.shadowColor = col
        ctx.shadowBlur = isSel ? 34 : isHov ? 22 : 14
        ctx.beginPath()
        ctx.arc(nx, ny, isSel ? finalR * 1.55 : isHov ? finalR * 1.3 : finalR * 1.15, 0, Math.PI * 2)
        ctx.fillStyle = hexToRgba(col, isSel ? 0.3 : isHov ? 0.2 : 0.1)
        ctx.fill()
        ctx.restore()
      }

      // Core + ring
      ctx.beginPath(); ctx.arc(nx, ny, isSel ? finalR * 1.2 : finalR, 0, Math.PI * 2)
      ctx.fillStyle = hexToRgba(col, isConn ? 1 : 0.14); ctx.fill()
      ctx.beginPath(); ctx.arc(nx, ny, isSel ? finalR * 1.2 : finalR, 0, Math.PI * 2)
      ctx.strokeStyle = hexToRgba(node.kind === 'bible' ? '#fff7e0' : col, isSel ? 1 : 0.85)
      ctx.lineWidth = (isSel ? 2.6 : 1.5) / k; ctx.stroke()

      // Spawn ripple
      if (eInfo) {
        const rp = (elapsed - eInfo.delay) / (eInfo.dur * 1.7)
        if (rp > 0 && rp < 1) {
          ctx.beginPath(); ctx.arc(nx, ny, r * (1 + rp * 2.8), 0, Math.PI * 2)
          ctx.strokeStyle = hexToRgba(col, (1 - rp) * 0.55)
          ctx.lineWidth = ((1 - rp) * 1.6 + 0.4) / k; ctx.stroke()
        }
      }
      ctx.globalAlpha = 1
    }

    // ── Labels ─────────────────────────────────────────────────────────
    {
      for (const node of nodes) {
        if (tlModeRef.current && !tlVisibleRef.current.has(node.id)) continue
        const isHub = node.connections >= HUB_THRESHOLD || node.kind !== 'verse'
        if (k < LABEL_ZOOM && !isHub) continue
        const isConn = connSet ? connSet.has(node.id) : true
        if (selId && !isConn) continue

        const fs = node.kind === 'bible' ? Math.max(9, Math.min(15, 12 / k)) : Math.max(8, Math.min(13, 10.5 / k))
        ctx.font = `${node.kind === 'bible' ? '700 ' : ''}${fs}px Inter, system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.globalAlpha = node.id === selId ? 1 : isConn ? 0.82 : 0.12
        const r = nodeRadius(node.size)
        ctx.save()
        ctx.shadowColor = BG; ctx.shadowBlur = 6
        ctx.fillStyle = node.kind === 'bible' ? '#e6c86e' : node.id === selId ? node.color : LABEL_INK
        ctx.fillText(node.label, nx0(node), (node.y ?? 0) + r + 13 / k)
        ctx.restore()
        ctx.globalAlpha = 1
      }
    }

    ctx.restore()
  }, [])

  function nx0(n: GNode) { return n.x ?? 0 }

  const startLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    const loop = () => { draw(); rafRef.current = requestAnimationFrame(loop) }
    rafRef.current = requestAnimationFrame(loop)
  }, [draw])
  const stopLoop = useCallback(() => cancelAnimationFrame(rafRef.current), [])

  const getNodeAt = useCallback((cx: number, cy: number): GNode | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const { x: tx, y: ty, k } = txRef.current
    const gx = (cx - rect.left - tx) / k, gy = (cy - rect.top - ty) / k
    for (let i = nodesRef.current.length - 1; i >= 0; i--) {
      const n = nodesRef.current[i]
      if (tlModeRef.current && !tlVisibleRef.current.has(n.id)) continue
      const r = nodeRadius(n.size) + 7
      const dx = (n.x ?? 0) - gx, dy = (n.y ?? 0) - gy
      if (dx * dx + dy * dy <= r * r) return n
    }
    return null
  }, [])

  const applyZoom = useCallback((factor: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    camAnimRef.current = null
    const { x: tx, y: ty, k } = txRef.current
    const cx = canvas.width / 2, cy = canvas.height / 2
    const newK = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k * factor))
    txRef.current = { k: newK, x: cx - ((cx - tx) * newK) / k, y: cy - ((cy - ty) * newK) / k }
    setZoom(newK)
  }, [])

  const fitView = useCallback(() => {
    const canvas = canvasRef.current, nodes = nodesRef.current
    if (!canvas || nodes.length === 0) return
    camAnimRef.current = null
    const W = canvas.width, H = canvas.height
    const xs = nodes.map(d => d.x ?? 0), ys = nodes.map(d => d.y ?? 0)
    const pad = 90
    const fitK = Math.min(
      (W - pad * 2) / Math.max(Math.max(...xs) - Math.min(...xs), 1),
      (H - pad * 2) / Math.max(Math.max(...ys) - Math.min(...ys), 1),
      1.5,
    )
    const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitK))
    txRef.current = {
      k,
      x: W / 2 - k * ((Math.min(...xs) + Math.max(...xs)) / 2),
      y: H / 2 - k * ((Math.min(...ys) + Math.max(...ys)) / 2),
    }
    setZoom(k)
  }, [])

  // ── Timelapse ──────────────────────────────────────────────────────────
  const stopTimelapse = useCallback(() => {
    if (tlTimerRef.current) { clearInterval(tlTimerRef.current); tlTimerRef.current = null }
    setTlPlaying(false)
    tlModeRef.current = false
    tlVisibleRef.current = new Set()
    animMapRef.current = new Map()
    setTlProgress(100)
  }, [])

  const startTimelapse = useCallback(() => {
    const nodes = nodesRef.current
    if (!nodes.length) return
    if (tlTimerRef.current) clearInterval(tlTimerRef.current)
    setSelNode(null); selIdRef.current = null
    setTlPlaying(true)
    setTlProgress(0)
    tlIdxRef.current = 0
    tlModeRef.current = true
    eActiveRef.current = false
    animMapRef.current = new Map()

    // Reveal order: the Bible first, then each saved verse in the order it was
    // saved — pulling in that verse's book-hub the moment its first verse lands.
    const verses = nodes.filter(n => n.kind === 'verse').sort((a, b) => a.ts - b.ts)
    const order: string[] = [CENTER_ID]
    const seenHub = new Set<string>()
    for (const v of verses) {
      const hubId = v.bookId ? `hub:${v.bookId}` : null
      if (hubId && !seenHub.has(hubId)) { seenHub.add(hubId); order.push(hubId) }
      order.push(v.id)
    }
    tlOrderRef.current = order
    // Start with just the Bible visible; the interval reveals the rest.
    tlVisibleRef.current = new Set([CENTER_ID])
    animMapRef.current.set(CENTER_ID, { t0: performance.now(), dur: 420 })
    tlIdxRef.current = 1

    setTimeout(() => {
      tlTimerRef.current = setInterval(() => {
        const idx = tlIdxRef.current
        const ord = tlOrderRef.current
        if (idx >= ord.length) {
          if (tlTimerRef.current) { clearInterval(tlTimerRef.current); tlTimerRef.current = null }
          setTlPlaying(false)
          setTlProgress(100)
          setTimeout(() => { tlModeRef.current = false; tlVisibleRef.current = new Set() }, 400)
          return
        }
        tlVisibleRef.current.add(ord[idx])
        animMapRef.current.set(ord[idx], { t0: performance.now(), dur: 420 })
        tlIdxRef.current++
        // Progress tracks revealed verses, not hubs.
        const revealedVerses = Array.from(tlVisibleRef.current).filter(id => id.includes('.')).length
        setTlProgress(total ? Math.round((revealedVerses / total) * 100) : 100)
        simRef.current?.alpha(0.12).restart()
      }, 520)
    }, 250)
  }, [total])

  useEffect(() => () => { if (tlTimerRef.current) clearInterval(tlTimerRef.current) }, [])

  // ── Build (runs when the panel opens or the saved set changes) ──────────
  const build = useCallback(() => {
    const mount = mountRef.current, canvas = canvasRef.current
    if (!mount || !canvas) return
    cleanupRef.current?.()
    stopLoop()
    simRef.current?.stop()
    setSelNode(null); selIdRef.current = null
    hoveredRef.current = null; draggingRef.current = null
    animMapRef.current = new Map()
    if (tlTimerRef.current) { clearInterval(tlTimerRef.current); tlTimerRef.current = null }
    tlModeRef.current = false; tlVisibleRef.current = new Set()
    setTlPlaying(false); setTlProgress(0)

    const W = mount.clientWidth, H = mount.clientHeight
    canvas.width = W; canvas.height = H
    if (saved.length === 0) { startLoop(); return }

    const { nodes, links } = buildGraph(saved)
    const n = nodes.length
    const charge = -Math.max(160, Math.min(620, 160 + n * 12))
    const linkDist = Math.max(70, Math.min(200, 60 + n * 4))

    // Pin the Bible at centre so the whole graph orbits a fixed heart.
    const bible = nodes.find(nd => nd.id === CENTER_ID)!
    bible.fx = W / 2; bible.fy = H / 2

    const sim = d3.forceSimulation<GNode>(nodes)
      .alphaDecay(0.022)
      .velocityDecay(0.45)
      .force('link', d3.forceLink<GNode, GLink>(links).id(d => d.id).distance(l => {
        const t = l.target as GNode
        return t.kind === 'hub' ? linkDist * 1.4 : linkDist
      }).strength(l => (l as GLink).strength))
      .force('charge', d3.forceManyBody<GNode>().strength(charge).distanceMax(700))
      .force('collision', d3.forceCollide<GNode>().radius(d => nodeRadius(d.size) + 10).strength(0.9))

    simRef.current = sim
    nodesRef.current = nodes
    linksRef.current = (sim.force('link') as d3.ForceLink<GNode, GLink>).links()

    const ticks = Math.min(320, Math.max(140, n * 6))
    for (let i = 0; i < ticks; i++) sim.tick()
    fitView()

    // Entrance dolly-in camera
    {
      const to = { ...txRef.current }
      const f = 0.5, k2 = to.k * f, cx = W / 2, cy = H / 2
      camAnimRef.current = {
        from: { k: k2, x: cx - ((cx - to.x) * k2) / to.k, y: cy - ((cy - to.y) * k2) / to.k },
        to, t0: performance.now(), dur: 1100,
      }
      txRef.current = { ...camAnimRef.current.from }
    }

    // Hub-first entrance cascade — same spring/pop as Obsidian's graph open.
    const sorted = [...nodes].sort((a, b) => b.connections - a.connections)
    const eMap = new Map<string, { delay: number; dur: number }>()
    sorted.forEach((nd, i) => {
      const pct = i / Math.max(sorted.length - 1, 1)
      eMap.set(nd.id, {
        delay: pct < 0.12 ? 0 : pct < 0.38 ? 190 : pct < 0.65 ? 400 : 590,
        dur: pct < 0.12 ? 680 : pct < 0.38 ? 580 : pct < 0.65 ? 480 : 400,
      })
    })
    eMapRef.current = eMap
    eStartRef.current = performance.now()
    eActiveRef.current = true

    // ── Interaction: node-drag vs background-pan (this is what stops "drag
    // moves everything" — only a hit node is dragged; empty space pans). ──
    let panning = false
    let panStart = { x: 0, y: 0 }, panStartTx = { x: 0, y: 0, k: 1 }
    let downPos = { x: 0, y: 0 }, didDrag = false

    const onDown = (e: MouseEvent) => {
      if (e.button === 2) return
      camAnimRef.current = null
      downPos = { x: e.clientX, y: e.clientY }; didDrag = false
      const node = getNodeAt(e.clientX, e.clientY)
      if (node && node.kind !== 'bible') {
        draggingRef.current = node
        node.fx = node.x; node.fy = node.y
        sim.alphaTarget(0.3).restart()
      } else {
        panning = true
        panStart = { x: e.clientX, y: e.clientY }
        panStartTx = { ...txRef.current }
        canvas.style.cursor = 'grabbing'
      }
    }
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - downPos.x, dy = e.clientY - downPos.y
      if (Math.sqrt(dx * dx + dy * dy) > 4) didDrag = true
      if (draggingRef.current) {
        const rect = canvas.getBoundingClientRect()
        const { x: tx, y: ty, k } = txRef.current
        draggingRef.current.fx = (e.clientX - rect.left - tx) / k
        draggingRef.current.fy = (e.clientY - rect.top - ty) / k
      } else if (panning) {
        txRef.current = { k: panStartTx.k, x: panStartTx.x + (e.clientX - panStart.x), y: panStartTx.y + (e.clientY - panStart.y) }
      } else {
        const node = getNodeAt(e.clientX, e.clientY)
        hoveredRef.current = node
        canvas.style.cursor = node ? 'pointer' : 'grab'
      }
    }
    const onUp = () => {
      if (draggingRef.current) {
        // Release the node back to the simulation (Obsidian lets flung nodes
        // settle rather than freezing where you dropped them).
        draggingRef.current.fx = null; draggingRef.current.fy = null
        sim.alphaTarget(0.03)
        setTimeout(() => simRef.current?.alphaTarget(0), 900)
        draggingRef.current = null
      }
      panning = false
      canvas.style.cursor = 'grab'
    }
    const onClick = (e: MouseEvent) => {
      if (didDrag) return
      const node = getNodeAt(e.clientX, e.clientY)
      if (node && node.id === selIdRef.current) { setSelNode(null); selIdRef.current = null }
      else if (node) { setSelNode(node); selIdRef.current = node.id }
      else { setSelNode(null); selIdRef.current = null }
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      camAnimRef.current = null
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left, my = e.clientY - rect.top
      const factor = e.deltaY > 0 ? 0.82 : 1.22
      const { x: tx, y: ty, k } = txRef.current
      const newK = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k * factor))
      txRef.current = { k: newK, x: mx - ((mx - tx) * newK) / k, y: my - ((my - ty) * newK) / k }
      setZoom(newK)
    }

    canvas.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    canvas.addEventListener('click', onClick)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    cleanupRef.current = () => {
      canvas.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('wheel', onWheel)
    }
    startLoop()
  }, [saved, getNodeAt, startLoop, stopLoop, fitView])

  // Build when opened; tear everything down when closed so nothing runs in the
  // background and a reopen starts fresh.
  useEffect(() => {
    if (!open) return
    // Wait a frame so the mount has its full size before measuring.
    const id = requestAnimationFrame(() => build())
    return () => {
      cancelAnimationFrame(id)
      cleanupRef.current?.()
      stopLoop()
      simRef.current?.stop()
      if (tlTimerRef.current) { clearInterval(tlTimerRef.current); tlTimerRef.current = null }
    }
  }, [open, build, stopLoop])

  // Verse text for the selection card
  useEffect(() => {
    let cancelled = false
    setVerseText('')
    if (!selNode?.ref) return
    const p = parseRef(selNode.ref)
    if (!p) return
    getChapter(p.bookId, p.chapter)
      .then(vs => { if (!cancelled) setVerseText(vs.find(v => v.v === p.verse)?.t ?? '') })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selNode])

  // Escape: clear a selection first, otherwise leave the graph.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (selIdRef.current) { setSelNode(null); selIdRef.current = null }
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const openInBible = () => {
    if (!selNode?.ref) return
    onOpenRef(selNode.ref)
    onClose()
  }

  const PANEL: React.CSSProperties = {
    background: 'rgba(10,14,24,0.9)', border: '1px solid rgba(255,255,255,0.1)',
    backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
  }

  return (
    // `no-drag` is load-bearing: the graph overlays the tab bar's draggable
    // title strip, and Chromium computes -webkit-app-region regions document-
    // wide regardless of z-order — without carving the overlay out, clicks on
    // the top controls (timelapse, zoom, and the old close button — the
    // "can't exit the sphere" bug) become window-drags and never reach the DOM.
    <div ref={mountRef} className="no-drag fixed inset-0 z-[300] overflow-hidden" style={{ background: BG }}>
      <canvas ref={canvasRef} className="block h-full w-full" style={{ cursor: 'grab' }} />

      {/* Top-left: Back + title. Back always leaves the graph. */}
      <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2.5">
        <button
          onClick={onClose}
          className="pointer-events-auto flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-slate-200 hover:text-white"
          style={PANEL}
        >
          <ChevronLeft size={15} /> Back to Bible
        </button>
        <div className="pointer-events-none flex h-9 items-center gap-1.5 rounded-xl px-3" style={PANEL}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#e6c86e', boxShadow: '0 0 6px #e6c86e' }} />
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">Verse Constellation</span>
          <span className="ml-1 text-xs text-slate-600">{total} {total === 1 ? 'verse' : 'verses'}</span>
        </div>
      </div>

      {/* Top-right: timelapse + zoom */}
      <div className="pointer-events-none absolute right-4 top-4 flex items-center gap-2">
        {total > 0 && (
          <div className="pointer-events-auto flex h-9 items-center gap-2 rounded-xl px-2.5" style={PANEL}>
            <button
              onClick={() => (tlPlaying ? stopTimelapse() : startTimelapse())}
              title={tlPlaying ? 'Stop timelapse' : 'Play timelapse'}
              className="flex h-6 w-6 items-center justify-center rounded-lg"
              style={{ background: 'rgba(230,200,110,0.18)', color: '#e6c86e' }}
            >
              {tlPlaying ? <Pause size={13} /> : <Play size={13} />}
            </button>
            <div className="h-1.5 w-28 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }}>
              <div className="h-full rounded-full" style={{ width: `${tlProgress}%`, background: '#e6c86e', transition: 'width 0.2s' }} />
            </div>
            <button onClick={startTimelapse} title="Replay from the beginning"
              className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:text-white">
              <RotateCcw size={12} />
            </button>
          </div>
        )}
        <div className="pointer-events-auto flex h-9 items-center gap-1 rounded-xl px-1.5" style={PANEL}>
          <button onClick={() => applyZoom(1.25)} title="Zoom in" className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:text-white"><ZoomIn size={13} /></button>
          <button onClick={() => applyZoom(0.8)} title="Zoom out" className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:text-white"><ZoomOut size={13} /></button>
          <button onClick={fitView} title="Fit to view" className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:text-white"><Crosshair size={13} /></button>
          <span className="px-1 text-[10px] tabular-nums text-slate-500">{Math.round(zoom * 100)}%</span>
        </div>
      </div>

      {total === 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-center text-slate-400">
          <BookOpen size={40} style={{ color: '#e6c86e', opacity: 0.7 }} />
          <div className="text-sm">No saved verses yet.</div>
          <div className="max-w-xs text-xs text-slate-500">Tap a verse while reading and choose <b>Save</b> — it'll appear here, linked into your constellation.</div>
        </div>
      )}

      {/* Selected-verse card */}
      {selNode?.ref && (
        <div className="absolute bottom-5 left-1/2 w-[min(520px,92vw)] -translate-x-1/2 rounded-2xl p-4"
          style={{ ...PANEL, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: selNode.color }} />
            <span className="text-sm font-semibold text-white">{selNode.label}</span>
            {selNode.ts > 0 && <span className="ml-auto text-[11px] text-slate-500">Saved {new Date(selNode.ts).toLocaleDateString()}</span>}
          </div>
          <p className="mb-3 text-[13px] leading-relaxed text-slate-200">
            {verseText || <span className="text-slate-500">Loading…</span>}
          </p>
          {notes[selNode.ref] && (
            <p className="mb-3 rounded-lg px-3 py-2 text-[12px] italic text-slate-300" style={{ background: 'rgba(255,255,255,0.05)' }}>
              “{notes[selNode.ref]}”
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={openInBible}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-white"
              style={{ background: 'linear-gradient(135deg, #b8892e, #e6c86e)' }}>
              <BookOpen size={15} /> Open in Bible
            </button>
            <button onClick={() => { setSelNode(null); selIdRef.current = null }}
              className="rounded-xl px-4 py-2 text-sm text-slate-300" style={{ background: 'rgba(255,255,255,0.07)' }}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
