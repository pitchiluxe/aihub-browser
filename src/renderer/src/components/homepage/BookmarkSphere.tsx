import React, { useRef, useEffect, useCallback, useState, memo } from 'react'
import * as d3 from 'd3'
import { Search, X, ZoomIn, ZoomOut, ChevronLeft, Maximize2 } from 'lucide-react'
import { Bookmark } from '../../store/browserStore'

// ── Types ─────────────────────────────────────────────────────────────────────
interface ExtNode extends d3.SimulationNodeDatum {
  id: string
  bookmark: Bookmark
  size: number
  color: string
  connections: number
}

interface ExtLink extends d3.SimulationLinkDatum<ExtNode> {
  source: ExtNode | string
  target: ExtNode | string
  strength: number
}

interface Props {
  bookmarks: Bookmark[]
  onNavigate: (url: string) => void
  onRemove: (id: string) => void
  onClose?: () => void
}

// ── Multi-color palette — each category gets a visually distinct vivid hue ───
const CATEGORY_COLORS: Record<string, string> = {
  AI:            '#a78bfa',  // violet
  Development:   '#38bdf8',  // sky blue
  Finance:       '#4ade80',  // green
  Trading:       '#fb923c',  // orange
  Education:     '#fbbf24',  // amber
  Business:      '#e879f9',  // fuchsia
  Entertainment: '#f43f5e',  // rose
  Personal:      '#f87171',  // red
  News:          '#34d399',  // emerald
  Tools:         '#60a5fa',  // blue
  Search:        '#4285F4',  // google blue
  Social:        '#f472b6',  // pink
  Shopping:      '#fb7185',  // rose-pink
  Travel:        '#2dd4bf',  // teal
  Health:        '#86efac',  // light green
  Science:       '#c4b5fd',  // lavender
  Sports:        '#fdba74',  // peach
  Gaming:        '#a3e635',  // lime
  Music:         '#f9a8d4',  // pink
  Art:           '#fcd34d',  // yellow
  default:       '#94a3b8',  // slate (neutral fallback)
}

// Hash any unknown category string to a stable vivid color
const VIVID_RING = [
  '#f43f5e','#fb923c','#fbbf24','#4ade80','#2dd4bf',
  '#38bdf8','#818cf8','#e879f9','#f472b6','#a3e635',
]
function resolveColor(bm: { color?: string; category?: string }): string {
  if (bm.color && bm.color !== '#60a5fa' && bm.color !== '#a78bfa') return bm.color
  const cat = bm.category || ''
  if (CATEGORY_COLORS[cat]) return CATEGORY_COLORS[cat]
  if (!cat) return CATEGORY_COLORS.default
  let h = 0
  for (let i = 0; i < cat.length; i++) h = cat.charCodeAt(i) + ((h << 5) - h)
  return VIVID_RING[Math.abs(h) % VIVID_RING.length]
}

const GRAPH_BG     = '#060A13'
const MIN_ZOOM     = 0.04
const MAX_ZOOM     = 10
const LABEL_ZOOM   = 0.60
const HUB_THRESHOLD = 3

// ── Utilities ─────────────────────────────────────────────────────────────────
function nodeRadius(size: number) { return Math.max(4, Math.round(size * 0.42)) }

function hexToRgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${a})`
}

function easeBackOut(t: number, s = 1.7): number {
  const c = s + 1
  return 1 + c * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2)
}

function buildGraphData(bookmarks: Bookmark[]): { nodes: ExtNode[]; links: ExtLink[] } {
  const counts: Record<string, number> = {}
  const links: ExtLink[] = []
  const seen  = new Set<string>()

  const addLink = (a: Bookmark, b: Bookmark, strength: number) => {
    const key = [a.id, b.id].sort().join('|')
    if (seen.has(key)) return
    seen.add(key)
    links.push({ source: a.id, target: b.id, strength })
    counts[a.id] = (counts[a.id] ?? 0) + 1
    counts[b.id] = (counts[b.id] ?? 0) + 1
  }

  // Phase 1 — same-category connections (strong cluster bonds)
  for (let i = 0; i < bookmarks.length; i++) {
    for (let j = i + 1; j < bookmarks.length; j++) {
      const a = bookmarks[i], b = bookmarks[j]
      if (a.category === b.category) addLink(a, b, 0.65)
    }
  }

  // Phase 2 — ring connection across ALL bookmarks regardless of type.
  // Every bookmark is part of the same family (bookmarks), so every node
  // gets a weak link to its ring-neighbour, guaranteeing full connectivity
  // and a single interconnected graph even for unique-category bookmarks.
  if (bookmarks.length > 1) {
    for (let i = 0; i < bookmarks.length; i++) {
      const a = bookmarks[i]
      const b = bookmarks[(i + 1) % bookmarks.length]
      addLink(a, b, 0.20)
    }
  }

  const maxConn = Math.max(1, ...Object.values(counts))

  const nodes: ExtNode[] = bookmarks.map(bm => {
    const conn = counts[bm.id] ?? 0
    return {
      id:          bm.id,
      bookmark:    bm,
      size:        18 + (conn / maxConn) * 34,
      color:       resolveColor(bm),
      connections: conn,
    }
  })

  return { nodes, links }
}

// ── Component ─────────────────────────────────────────────────────────────────
function BookmarkSphere({ bookmarks, onNavigate, onRemove, onClose }: Props) {
  const mountRef      = useRef<HTMLDivElement>(null)
  const canvasRef     = useRef<HTMLCanvasElement>(null)
  const simRef        = useRef<d3.Simulation<ExtNode, ExtLink> | null>(null)
  const nodesRef      = useRef<ExtNode[]>([])
  const linksRef      = useRef<ExtLink[]>([])
  const rafRef        = useRef<number>(0)
  const txRef         = useRef({ x: 0, y: 0, k: 1 })
  const hoveredRef    = useRef<ExtNode | null>(null)
  const selIdRef      = useRef<string | null>(null)
  const draggingRef   = useRef<ExtNode | null>(null)
  const eActiveRef    = useRef(false)
  const eStartRef     = useRef(0)
  const eMapRef       = useRef<Map<string, { delay: number; dur: number }>>(new Map())
  const animMapRef    = useRef<Map<string, { t0: number; dur: number }>>(new Map())
  const cleanupRef    = useRef<(() => void) | null>(null)
  const queryRef      = useRef('')

  const [zoom,          setZoom]          = useState(1)
  const [tooltip,       setTooltip]       = useState<{ node: ExtNode; x: number; y: number } | null>(null)
  const [ctxMenu,       setCtxMenu]       = useState<{ node: ExtNode; x: number; y: number } | null>(null)
  const [selNode,       setSelNode]       = useState<ExtNode | null>(null)
  const [searchQuery,   setSearchQuery]   = useState('')
  const [searchOpen,    setSearchOpen]    = useState(false)

  useEffect(() => { queryRef.current = searchQuery }, [searchQuery])

  // ── Draw ─────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { x: tx, y: ty, k } = txRef.current
    const nodes   = nodesRef.current
    const links   = linksRef.current
    const selId   = selIdRef.current
    const query   = queryRef.current.toLowerCase().trim()
    const now     = performance.now()
    const W       = canvas.width
    const H       = canvas.height

    // Entrance timing
    const eActive  = eActiveRef.current
    const elapsed  = eActive ? now - eStartRef.current : Infinity
    if (eActive && elapsed > 2000) eActiveRef.current = false
    const edgeA    = eActive ? Math.min(1, elapsed / 1100) : 1

    // Background
    ctx.fillStyle = GRAPH_BG
    ctx.fillRect(0, 0, W, H)

    // Per-category atmosphere glows — each cluster emits its own color
    for (const node of nodesRef.current) {
      if (node.x == null || node.connections < HUB_THRESHOLD) continue
      const sx = node.x * k + tx
      const sy = node.y * k + ty
      const aura = ctx.createRadialGradient(sx, sy, 0, sx, sy, 80 * k)
      aura.addColorStop(0, hexToRgba(node.color, 0.045))
      aura.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = aura
      ctx.fillRect(0, 0, W, H)
    }

    ctx.save()
    ctx.translate(tx, ty)
    ctx.scale(k, k)

    // Connected set (for selection dimming)
    let connSet: Set<string> | null = null
    if (selId) {
      connSet = new Set([selId])
      for (const l of links) {
        const s = typeof l.source === 'string' ? l.source : (l.source as ExtNode).id
        const t = typeof l.target === 'string' ? l.target : (l.target as ExtNode).id
        if (s === selId) connSet.add(t)
        if (t === selId) connSet.add(s)
      }
    }

    // Match set (for search dimming)
    let matchSet: Set<string> | null = null
    if (query) {
      matchSet = new Set()
      for (const n of nodes) {
        const bm = n.bookmark
        if (
          bm.title.toLowerCase().includes(query) ||
          bm.url.toLowerCase().includes(query) ||
          bm.category.toLowerCase().includes(query)
        ) matchSet.add(n.id)
      }
    }

    // ── Edges — gradient between node colors for multi-color feel ───────
    for (const l of links) {
      const src = l.source as ExtNode
      const tgt = l.target as ExtNode
      if (src.x == null || tgt.x == null) continue

      const touching  = selId && (src.id === selId || tgt.id === selId)
      const srcMatch  = !matchSet || matchSet.has(src.id)
      const tgtMatch  = !matchSet || matchSet.has(tgt.id)
      const bothMatch = srcMatch && tgtMatch

      const dimmed = (selId && !touching) || (matchSet && !bothMatch)

      if (dimmed) {
        ctx.strokeStyle = `rgba(148,163,184,${(selId ? 0.04 : 0.025) * edgeA})`
        ctx.lineWidth   = 0.5 / k
      } else {
        // Gradient edge from src color → tgt color
        const grd = ctx.createLinearGradient(src.x!, src.y!, tgt.x!, tgt.y!)
        const alpha = touching ? 0.9 : (bothMatch && matchSet ? 0.35 : 0.22)
        grd.addColorStop(0, hexToRgba(src.color, alpha * edgeA))
        grd.addColorStop(1, hexToRgba(tgt.color, alpha * edgeA))
        ctx.strokeStyle = grd
        ctx.lineWidth   = (touching ? 1.8 : bothMatch && matchSet ? 1.1 : 1) / k
      }

      ctx.beginPath()
      ctx.moveTo(src.x!, src.y!)
      ctx.lineTo(tgt.x!, tgt.y!)
      ctx.stroke()
    }

    // ── Nodes ────────────────────────────────────────────────────────────
    for (let ni = 0; ni < nodes.length; ni++) {
      const node    = nodes[ni]
      const nx      = node.x ?? 0
      const ny      = node.y ?? 0
      const r       = nodeRadius(node.size)
      const col     = node.color
      const isSel   = node.id === selId
      const isConn  = connSet ? connSet.has(node.id) : true
      const isMatch = !matchSet || matchSet.has(node.id)
      const isHub   = node.connections >= HUB_THRESHOLD

      const ga = !isConn ? 0.07 : !isMatch ? 0.04 : 1
      ctx.globalAlpha = ga

      // Entrance scale animation
      let scale = 1
      if (eActive) {
        const info = eMapRef.current.get(node.id)
        if (info) {
          const el = elapsed - info.delay
          if (el < 0) scale = 0
          else if (el < info.dur) scale = Math.max(0, easeBackOut(el / info.dur))
        }
      }
      const anim = animMapRef.current.get(node.id)
      if (anim) {
        const el = now - anim.t0
        if (el < anim.dur) scale = Math.max(0, easeBackOut(el / anim.dur))
        else animMapRef.current.delete(node.id)
      }

      const drawR = r * scale
      if (drawR <= 0) { ctx.globalAlpha = 1; continue }

      // Pulsing aura — all nodes breathe, hubs breathe more
      let hubBoost = 0
      if (!eActive && isConn && isMatch) {
        const amplitude = isHub ? 0.10 : 0.055
        hubBoost = Math.sin(now * 0.0013 + ni * 0.4) * amplitude
      }
      const finalR = drawR * (1 + hubBoost)

      const isHov = hoveredRef.current?.id === node.id

      // Per-node colored aura ring (small arc, NOT fullscreen fillRect)
      if (!eActive && isConn && isMatch && ga > 0.3) {
        const pulse    = 0.5 + Math.sin(now * 0.0013 + ni * 0.4) * 0.5
        const auraR    = finalR * (1.5 + pulse * 0.35)
        const auraGrd  = ctx.createRadialGradient(nx, ny, finalR * 0.8, nx, ny, auraR)
        auraGrd.addColorStop(0, hexToRgba(col, (isHub ? 0.22 : 0.12) * pulse))
        auraGrd.addColorStop(1, hexToRgba(col, 0))
        ctx.fillStyle = auraGrd
        ctx.beginPath()
        ctx.arc(nx, ny, auraR, 0, Math.PI * 2)
        ctx.fill()
      }

      // Outer glow halo
      if ((isSel || isHov || (isHub && ga > 0.5)) && ga > 0.1) {
        ctx.save()
        ctx.shadowColor = col
        ctx.shadowBlur  = isSel ? 32 : isHov ? 20 : 12
        ctx.beginPath()
        ctx.arc(nx, ny, isSel ? finalR * 1.55 : isHov ? finalR * 1.3 : finalR * 1.15, 0, Math.PI * 2)
        ctx.fillStyle = hexToRgba(col, isSel ? 0.30 : isHov ? 0.20 : 0.10)
        ctx.fill()
        ctx.restore()
      }

      // Core filled circle
      ctx.beginPath()
      ctx.arc(nx, ny, isSel ? finalR * 1.22 : finalR, 0, Math.PI * 2)
      ctx.fillStyle = hexToRgba(col, isSel ? 1 : (isConn && isMatch) ? 0.88 : 0.12)
      ctx.fill()

      // Ring stroke
      ctx.beginPath()
      ctx.arc(nx, ny, isSel ? finalR * 1.22 : finalR, 0, Math.PI * 2)
      ctx.strokeStyle = hexToRgba(col, isSel ? 1 : 0.65)
      ctx.lineWidth   = (isSel ? 2.5 : 1.5) / k
      ctx.stroke()

      ctx.globalAlpha = 1
    }

    // ── Labels — hubs always, others when zoomed in ──────────────────────
    {
      const fs = Math.max(8, Math.min(13, 10.5 / k))
      ctx.font      = `${fs}px Inter, system-ui, sans-serif`
      ctx.textAlign = 'center'

      for (const node of nodes) {
        const isHub   = node.connections >= HUB_THRESHOLD
        if (k < LABEL_ZOOM && !isHub) continue
        const isConn  = connSet  ? connSet.has(node.id)  : true
        const isMatch = matchSet ? matchSet.has(node.id) : true
        if ((selId && !isConn) || (matchSet && !isMatch)) continue

        const la = node.id === selId ? 1 : (isConn && isMatch) ? 0.78 : 0.12
        ctx.globalAlpha = la

        const label = node.bookmark.title.length > 22
          ? node.bookmark.title.slice(0, 22) + '…'
          : node.bookmark.title
        const r = nodeRadius(node.size)

        ctx.save()
        ctx.shadowColor = GRAPH_BG
        ctx.shadowBlur  = 5
        ctx.fillStyle   = node.id === selId ? node.color : '#94a3b8'
        ctx.fillText(label, node.x ?? 0, (node.y ?? 0) + r + 13 / k)
        ctx.restore()
        ctx.globalAlpha = 1
      }
    }

    ctx.restore()
  }, [])  // draw is stable; refs hold mutable state

  // ── RAF loop ─────────────────────────────────────────────────────────────
  const startLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    const loop = () => { draw(); rafRef.current = requestAnimationFrame(loop) }
    rafRef.current = requestAnimationFrame(loop)
  }, [draw])

  const stopLoop = useCallback(() => cancelAnimationFrame(rafRef.current), [])

  // ── Hit test ─────────────────────────────────────────────────────────────
  const getNodeAt = useCallback((cx: number, cy: number): ExtNode | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const { x: tx, y: ty, k } = txRef.current
    const gx = (cx - rect.left - tx) / k
    const gy = (cy - rect.top  - ty) / k
    for (let i = nodesRef.current.length - 1; i >= 0; i--) {
      const n  = nodesRef.current[i]
      const r  = nodeRadius(n.size) + 7
      const dx = (n.x ?? 0) - gx
      const dy = (n.y ?? 0) - gy
      if (dx * dx + dy * dy <= r * r) return n
    }
    return null
  }, [])

  // ── Zoom helpers ─────────────────────────────────────────────────────────
  const applyZoom = useCallback((factor: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { x: tx, y: ty, k } = txRef.current
    const cx = canvas.width / 2, cy = canvas.height / 2
    const newK = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k * factor))
    txRef.current = { k: newK, x: cx - ((cx - tx) * newK) / k, y: cy - ((cy - ty) * newK) / k }
    setZoom(newK)
  }, [])

  const fitView = useCallback(() => {
    const canvas = canvasRef.current
    const nodes  = nodesRef.current
    if (!canvas || nodes.length === 0) return
    const W = canvas.width, H = canvas.height
    const xs = nodes.map(d => d.x ?? 0)
    const ys = nodes.map(d => d.y ?? 0)
    const pad = 80
    const fitK = Math.min(
      (W - pad * 2) / Math.max(Math.max(...xs) - Math.min(...xs), 1),
      (H - pad * 2) / Math.max(Math.max(...ys) - Math.min(...ys), 1),
      1.6
    )
    const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitK))
    txRef.current = {
      k,
      x: W / 2 - k * ((Math.min(...xs) + Math.max(...xs)) / 2),
      y: H / 2 - k * ((Math.min(...ys) + Math.max(...ys)) / 2),
    }
    setZoom(k)
  }, [])

  // ── Build graph ───────────────────────────────────────────────────────────
  const buildGraph = useCallback(() => {
    const mount  = mountRef.current
    const canvas = canvasRef.current
    if (!mount || !canvas) return

    cleanupRef.current?.()
    stopLoop()
    simRef.current?.stop()
    setSelNode(null)
    selIdRef.current   = null
    hoveredRef.current = null
    draggingRef.current = null
    animMapRef.current  = new Map()

    const W = mount.clientWidth
    const H = mount.clientHeight
    canvas.width  = W
    canvas.height = H

    if (bookmarks.length === 0) { startLoop(); return }

    const { nodes, links } = buildGraphData(bookmarks)
    const n = nodes.length
    const charge   = -Math.max(120, Math.min(560, 120 + n * 11))
    const linkDist = Math.max(90, Math.min(220, 65 + n * 4))

    const sim = d3.forceSimulation<ExtNode>(nodes)
      .alphaDecay(0.024)
      .velocityDecay(0.46)
      .force('link', d3.forceLink<ExtNode, ExtLink>(links)
        .id(d => d.id)
        .distance(linkDist)
        .strength(l => (l as ExtLink).strength))
      .force('charge', d3.forceManyBody<ExtNode>()
        .strength(charge)
        .distanceMax(600))
      .force('center', d3.forceCenter(W / 2, H / 2).strength(0.038))
      .force('collision', d3.forceCollide<ExtNode>()
        .radius(d => nodeRadius(d.size) + 9)
        .strength(0.88))

    simRef.current  = sim
    nodesRef.current = nodes
    linksRef.current = (sim.force('link') as d3.ForceLink<ExtNode, ExtLink>).links()

    // Pre-tick for initial spread — more ticks = nodes arrive already spread
    const ticks = Math.min(300, Math.max(120, n * 6))
    for (let i = 0; i < ticks; i++) sim.tick()

    fitView()

    // Hub-first entrance cascade
    const sorted = [...nodes].sort((a, b) => b.connections - a.connections)
    const eMap   = new Map<string, { delay: number; dur: number }>()
    sorted.forEach((nd, i) => {
      const pct = i / Math.max(sorted.length - 1, 1)
      eMap.set(nd.id, {
        delay: pct < 0.12 ? 0 : pct < 0.38 ? 190 : pct < 0.65 ? 400 : 590,
        dur:   pct < 0.12 ? 680 : pct < 0.38 ? 580 : pct < 0.65 ? 480 : 400,
      })
    })
    eMapRef.current  = eMap
    eStartRef.current = performance.now()
    eActiveRef.current = true

    // ── Event listeners ───────────────────────────────────────────────
    let panning = false
    let panStart    = { x: 0, y: 0 }
    let panStartTx  = { x: 0, y: 0, k: 1 }
    let downPos     = { x: 0, y: 0 }
    let didDrag     = false

    const onDown = (e: MouseEvent) => {
      if (e.button === 2) return
      setCtxMenu(null)
      downPos = { x: e.clientX, y: e.clientY }
      didDrag  = false
      const node = getNodeAt(e.clientX, e.clientY)
      if (node) {
        draggingRef.current = node
        node.fx = node.x; node.fy = node.y
        sim.alphaTarget(0.3).restart()
      } else {
        panning = true
        panStart   = { x: e.clientX, y: e.clientY }
        panStartTx = { ...txRef.current }
        canvas.style.cursor = 'grabbing'
      }
    }

    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - downPos.x
      const dy = e.clientY - downPos.y
      if (Math.sqrt(dx * dx + dy * dy) > 4) didDrag = true

      if (draggingRef.current) {
        const rect = canvas.getBoundingClientRect()
        const { x: tx, y: ty, k } = txRef.current
        draggingRef.current.fx = (e.clientX - rect.left - tx) / k
        draggingRef.current.fy = (e.clientY - rect.top  - ty) / k
      } else if (panning) {
        txRef.current = {
          k: panStartTx.k,
          x: panStartTx.x + (e.clientX - panStart.x),
          y: panStartTx.y + (e.clientY - panStart.y),
        }
      } else {
        const node = getNodeAt(e.clientX, e.clientY)
        if (node !== hoveredRef.current) {
          hoveredRef.current = node
          if (node) {
            const rect = canvas.getBoundingClientRect()
            setTooltip({ node, x: e.clientX - rect.left, y: e.clientY - rect.top })
            canvas.style.cursor = 'pointer'
          } else {
            setTooltip(null)
            canvas.style.cursor = 'grab'
          }
        } else if (node) {
          const rect = canvas.getBoundingClientRect()
          setTooltip(prev => prev ? { ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top } : null)
        }
      }
    }

    const onUp = () => {
      if (draggingRef.current) {
        draggingRef.current.fx = null
        draggingRef.current.fy = null
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
      if (node) {
        if (node.id === selIdRef.current) {
          setSelNode(null)
          selIdRef.current = null
        } else {
          setSelNode(node)
          selIdRef.current = node.id
        }
      } else {
        setSelNode(null)
        selIdRef.current = null
      }
    }

    const onCtx = (e: MouseEvent) => {
      e.preventDefault()
      const node = getNodeAt(e.clientX, e.clientY)
      if (node) {
        const rect = canvas.getBoundingClientRect()
        setCtxMenu({ node, x: e.clientX - rect.left, y: e.clientY - rect.top })
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const factor = e.deltaY > 0 ? 0.80 : 1.25
      const { x: tx, y: ty, k } = txRef.current
      const newK = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k * factor))
      txRef.current = { k: newK, x: mx - ((mx - tx) * newK) / k, y: my - ((my - ty) * newK) / k }
      setZoom(newK)
    }

    canvas.addEventListener('mousedown',   onDown)
    canvas.addEventListener('mousemove',   onMove)
    canvas.addEventListener('mouseup',     onUp)
    canvas.addEventListener('click',       onClick)
    canvas.addEventListener('contextmenu', onCtx)
    canvas.addEventListener('wheel',       onWheel, { passive: false })

    cleanupRef.current = () => {
      canvas.removeEventListener('mousedown',   onDown)
      canvas.removeEventListener('mousemove',   onMove)
      canvas.removeEventListener('mouseup',     onUp)
      canvas.removeEventListener('click',       onClick)
      canvas.removeEventListener('contextmenu', onCtx)
      canvas.removeEventListener('wheel',       onWheel)
    }

    startLoop()
  }, [bookmarks, getNodeAt, startLoop, stopLoop, fitView])

  useEffect(() => {
    buildGraph()
    return () => { cleanupRef.current?.(); stopLoop(); simRef.current?.stop() }
  }, [bookmarks])

  useEffect(() => {
    const ro = new ResizeObserver(() => buildGraph())
    if (mountRef.current) ro.observe(mountRef.current)
    return () => ro.disconnect()
  }, [bookmarks])

  const activeCategories = Array.from(new Set(bookmarks.map(b => b.category)))

  const PANEL: React.CSSProperties = {
    background:      'rgba(6,10,19,0.88)',
    border:          '1px solid rgba(255,255,255,0.09)',
    backdropFilter:  'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
  }

  return (
    <div ref={mountRef} className="relative w-full h-full overflow-hidden" style={{ background: GRAPH_BG }}>

      {/* Canvas */}
      <canvas ref={canvasRef} className="block w-full h-full" style={{ cursor: 'grab' }} />

      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <div className="absolute top-4 left-4 right-4 flex items-center gap-2.5 pointer-events-none">

        {/* Back / Graph label */}
        <div className="flex items-center gap-2 pointer-events-auto no-drag">
          {onClose && (
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-medium text-slate-300 hover:text-white transition-all duration-150"
              style={PANEL}
            >
              <ChevronLeft size={13} />
              Back
            </button>
          )}
          <div className="flex items-center gap-1.5 h-8 px-3 rounded-xl" style={PANEL}>
            <div className="w-1.5 h-1.5 rounded-full bg-violet-500 shadow-[0_0_6px_#8b5cf6]" />
            <span className="text-xs font-semibold text-slate-400 tracking-widest uppercase">Knowledge Graph</span>
            <span className="text-xs text-slate-600 ml-1">{bookmarks.length} nodes</span>
          </div>
        </div>

        <div className="flex-1" />

        {/* Right controls */}
        <div className="flex items-center gap-2 pointer-events-auto no-drag">

          {/* Search */}
          <div
            className="flex items-center gap-2 h-8 rounded-xl overflow-hidden transition-all duration-200"
            style={{
              ...PANEL,
              width: searchOpen ? 200 : 32,
              borderColor: searchOpen ? 'rgba(59,130,246,0.45)' : 'rgba(255,255,255,0.09)',
            }}
          >
            <button
              onClick={() => setSearchOpen(o => !o)}
              className="w-8 h-8 flex items-center justify-center shrink-0 text-slate-400 hover:text-blue-400 transition-colors"
            >
              <Search size={13} />
            </button>
            {searchOpen && (
              <>
                <input
                  autoFocus
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onBlur={() => { if (!searchQuery) setSearchOpen(false) }}
                  placeholder="Search nodes…"
                  className="flex-1 bg-transparent outline-none text-xs text-slate-200 placeholder:text-slate-600 min-w-0"
                  style={{ userSelect: 'text' }}
                />
                {searchQuery && (
                  <button
                    onClick={() => { setSearchQuery(''); setSearchOpen(false) }}
                    className="w-6 h-6 flex items-center justify-center mr-1 shrink-0 text-slate-600 hover:text-slate-400 transition-colors"
                  >
                    <X size={11} />
                  </button>
                )}
              </>
            )}
          </div>

          {/* Zoom controls */}
          <div className="flex items-center h-8 rounded-xl overflow-hidden" style={PANEL}>
            <button
              onClick={() => applyZoom(0.77)}
              className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/8 transition-all"
            >
              <ZoomOut size={13} />
            </button>
            <button
              onClick={fitView}
              className="h-8 px-2.5 text-xs text-slate-500 hover:text-slate-300 transition-colors border-x border-white/[0.08] tabular-nums"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={() => applyZoom(1.30)}
              className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/8 transition-all"
            >
              <ZoomIn size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Controls hint */}
      <div className="absolute top-[4.5rem] left-1/2 -translate-x-1/2 text-[10px] text-slate-700 pointer-events-none select-none whitespace-nowrap tracking-wide">
        Scroll to zoom · Drag to pan · Click a node to inspect · Right-click for options
      </div>

      {/* ── Tooltip ─────────────────────────────────────────────────── */}
      {tooltip && !ctxMenu && (
        <div className="absolute z-40 pointer-events-none" style={{ left: tooltip.x + 16, top: tooltip.y - 68 }}>
          <div className="rounded-xl px-3 py-2.5 shadow-panel-lg min-w-[170px]" style={PANEL}>
            <div className="flex items-center gap-2 mb-1">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0 block"
                style={{ background: tooltip.node.color, boxShadow: `0 0 7px ${tooltip.node.color}` }}
              />
              <span className="text-sm font-semibold text-slate-100 truncate max-w-[200px]">
                {tooltip.node.bookmark.title}
              </span>
            </div>
            <div className="text-xs text-slate-500 truncate max-w-[240px] mb-1.5">
              {tooltip.node.bookmark.url.replace(/^https?:\/\/(www\.)?/, '')}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium" style={{ color: tooltip.node.color }}>
                {tooltip.node.bookmark.category}
              </span>
              <span className="text-xs text-slate-600">
                {tooltip.node.connections} link{tooltip.node.connections !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Context menu ─────────────────────────────────────────────── */}
      {ctxMenu && (
        <div
          className="absolute z-50 rounded-xl shadow-panel-lg py-1 min-w-[168px]"
          style={{ left: ctxMenu.x + 4, top: ctxMenu.y + 4, ...PANEL }}
        >
          <div className="px-3 py-2 border-b border-white/[0.07] mb-1">
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full block shrink-0"
                style={{ background: ctxMenu.node.color }}
              />
              <span className="text-xs font-semibold text-slate-200 truncate">{ctxMenu.node.bookmark.title}</span>
            </div>
          </div>
          <button
            className="w-full text-left px-3.5 py-2 text-xs text-slate-300 hover:bg-white/[0.07] transition-colors"
            onClick={() => { onNavigate(ctxMenu.node.bookmark.url); setCtxMenu(null) }}
          >
            Open Site
          </button>
          <button
            className="w-full text-left px-3.5 py-2 text-xs text-slate-300 hover:bg-white/[0.07] transition-colors"
            onClick={() => { navigator.clipboard.writeText(ctxMenu.node.bookmark.url); setCtxMenu(null) }}
          >
            Copy URL
          </button>
          <div className="h-px bg-white/[0.07] my-1" />
          <button
            className="w-full text-left px-3.5 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
            onClick={() => { onRemove(ctxMenu.node.id); setCtxMenu(null) }}
          >
            Remove Bookmark
          </button>
        </div>
      )}

      {/* ── Selected node card ───────────────────────────────────────── */}
      {selNode && (
        <div
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-4 px-5 py-3.5 rounded-2xl shadow-panel-lg min-w-[300px] max-w-[440px]"
          style={{
            ...PANEL,
            borderColor: `${selNode.color}38`,
            boxShadow: `0 8px 48px rgba(0,0,0,0.65), 0 0 35px ${selNode.color}1a`,
          }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: `${selNode.color}18` }}
          >
            <img
              src={`https://www.google.com/s2/favicons?domain=${selNode.bookmark.url}&sz=32`}
              className="w-5 h-5"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-100 truncate">{selNode.bookmark.title}</div>
            <div className="text-xs mt-0.5 truncate" style={{ color: selNode.color }}>
              {selNode.bookmark.category} · {selNode.connections} connection{selNode.connections !== 1 ? 's' : ''}
            </div>
          </div>
          <button
            onClick={() => onNavigate(selNode.bookmark.url)}
            className="shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition-all hover:brightness-110 no-drag"
            style={{ background: selNode.color }}
          >
            Open
          </button>
          <button
            onClick={() => { setSelNode(null); selIdRef.current = null }}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/[0.07] transition-all no-drag"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* ── Category legend ──────────────────────────────────────────── */}
      {activeCategories.length > 0 && (
        <div className="absolute bottom-6 left-4 rounded-xl px-3 py-2.5" style={PANEL}>
          <div className="text-[10px] text-slate-600 font-bold mb-2 uppercase tracking-widest">Categories</div>
          <div className="space-y-1.5">
            {activeCategories.map(cat => (
              <div key={cat} className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full shrink-0 block"
                  style={{
                    background:  CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.default,
                    boxShadow:   `0 0 5px ${CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.default}`,
                  }}
                />
                <span className="text-xs text-slate-400">{cat}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {bookmarks.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-2" style={PANEL}>
            <Maximize2 size={24} className="text-slate-600" />
          </div>
          <div className="text-slate-500 text-sm font-medium">No bookmarks yet</div>
          <div className="text-slate-700 text-xs">Add bookmarks to build your knowledge graph</div>
        </div>
      )}
    </div>
  )
}

export default memo(BookmarkSphere)
