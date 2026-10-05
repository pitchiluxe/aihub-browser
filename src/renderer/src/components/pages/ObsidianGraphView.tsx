import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Simulation, SimulationLinkDatum, SimulationNodeDatum,
  forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation,
} from 'd3-force'
import { Search, ZoomIn, ZoomOut, Crosshair, X, Trash2, ExternalLink, Orbit, Loader2, Tag, Globe2 } from 'lucide-react'
import {
  fetchMarkdownNotes, deleteMarkdownNote, getMarkdownNote, buildMarkdownGraph,
  type MarkdownNote, type GraphNode,
} from '../../services/markdownGraphService'
import { drawGraphNode, graphNodeColor, hexToRgba, HUB_THRESHOLD, LABEL_ZOOM } from '../graph/nodeStyle'
import Markdown from '../ai/Markdown'

const MarkdownGlobe = lazy(() => import('../graph/MarkdownGlobe'))

// ── The Knowledge Graph — every page the Web Clipper saved, drawn as a
// drifting sphere of connected notes (Obsidian's graph view, reimagined). ──
//
// This reuses the same canvas + d3-force recipe as BookmarkSphere (and the
// shared node look in components/graph/nodeStyle.ts), but the nodes are
// markdown clippings instead of bookmarks, and they never sit still: a slow
// per-node sinusoidal drift is layered on top of the force layout so the
// sphere always looks alive, even once the simulation has settled.

interface SimNode extends SimulationNodeDatum {
  id: string
  node: GraphNode
  radius: number
  // Drift — a per-node phase/speed so every node floats on its own clock.
  phase: number
  speed: number
}
interface SimLink extends SimulationLinkDatum<SimNode> {
  source: SimNode | string
  target: SimNode | string
  strength: number
}

interface Props {
  onNavigate: (url: string) => void
}

const MIN_ZOOM = 0.15
const MAX_ZOOM = 6
const DEFAULT_ZOOM = 0.84
const nodeRadius = (size: number) => Math.max(5, Math.round(size * 0.4))

function readTheme() {
  const cs = getComputedStyle(document.body)
  const isLight = document.body.classList.contains('light-mode')
  const trip = (v: string, fb: string): string => {
    const t = cs.getPropertyValue(v).trim().split(/[ ,]+/).map(Number)
    return t.length === 3 && t.every(n => Number.isFinite(n)) ? `${t[0]},${t[1]},${t[2]}` : fb
  }
  const bgT = trip('--ds-bg', '23 24 43')
  const inkT = trip('--ds-text-3', isLight ? '72,76,112' : '148,163,184')
  const [r, g, b] = bgT.split(',').map(Number)
  return {
    bg: isLight ? `rgb(${r},${g},${b})` : `rgb(${Math.round(r * 0.35)},${Math.round(g * 0.35)},${Math.round(b * 0.35)})`,
    label: `rgb(${inkT})`,
    dimEdge: inkT,
  }
}

export default function ObsidianGraphView({ onNavigate }: Props) {
  const mountRef  = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simRef    = useRef<Simulation<SimNode, SimLink> | null>(null)
  const nodesRef  = useRef<SimNode[]>([])
  const linksRef  = useRef<SimLink[]>([])
  const rafRef    = useRef<number>(0)
  const txRef     = useRef({ x: 0, y: 0, k: DEFAULT_ZOOM })
  const viewInitializedRef = useRef(false)
  const hoveredRef = useRef<SimNode | null>(null)
  const draggingRef = useRef<SimNode | null>(null)
  const dragMovedRef = useRef(false)
  const queryRef  = useRef('')
  const themeRef  = useRef(readTheme())
  const modeRef = useRef<'sphere' | 'globe'>('sphere')

  const [notes,    setNotes]    = useState<MarkdownNote[]>([])
  const [loading,  setLoading]  = useState(true)
  const [query,    setQuery]    = useState('')
  const [zoom,     setZoom]     = useState(DEFAULT_ZOOM)
  const [mode,     setMode]     = useState<'sphere' | 'globe'>('sphere')
  const [tooltip,  setTooltip]  = useState<{ node: SimNode; x: number; y: number } | null>(null)
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [content,  setContent]  = useState<string | null>(null)
  const [contentLoading, setContentLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const zoomLabel = `${Math.round(zoom * 100)}%`
  const vaultCount = notes.filter(n => n.origin === 'vault').length
  const clipCount = notes.length - vaultCount
  const noteSummary = [
    `${clipCount} clipped ${clipCount === 1 ? 'page' : 'pages'}`,
    ...(vaultCount ? [`${vaultCount} vault ${vaultCount === 1 ? 'note' : 'notes'}`] : []),
  ].join(' · ')
  const selectedHost = selected?.url ? (() => {
    try { return new URL(selected.url).hostname.replace(/^www\./, '') } catch { return selected.url }
  })() : ''

  useEffect(() => { queryRef.current = query }, [query])
  useEffect(() => { modeRef.current = mode }, [mode])

  const load = useCallback(async () => {
    const n = await fetchMarkdownNotes()
    // Same set as before → keep the old array so the simulation isn't rebuilt
    // (and every node re-scattered) just because the window regained focus.
    setNotes(prev => prev.length === n.length && prev.every((p, i) => p.id === n[i].id && p.title === n[i].title) ? prev : n)
    setLoading(false)
  }, [])
  // Pages are clipped from other tabs (right-click → Save Page to Obsidian)
  // and vault notes change in Obsidian itself, so re-read on focus.
  useEffect(() => {
    load()
    const onFocus = () => { void load() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [load])

  // Live theme switching, same bridge BookmarkSphere uses.
  useEffect(() => {
    const update = () => { themeRef.current = readTheme() }
    const obs = new MutationObserver(update)
    obs.observe(document.body, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })
    return () => obs.disconnect()
  }, [])

  const graphData = useMemo(() => buildMarkdownGraph(notes), [notes])

  // Give every saved page a stable color independent of its category.
  const coloredNodes = useMemo(() => {
    return graphData.nodes.map(node => ({ ...node, color: graphNodeColor(node.id) }))
  }, [graphData])

  // ── Build / rebuild the simulation whenever the note set changes ──────────
  useEffect(() => {
    const canvas = canvasRef.current
    const mount = mountRef.current
    if (!canvas || !mount) return
    const w = mount.clientWidth, h = mount.clientHeight

    const simNodes: SimNode[] = coloredNodes.map(n => ({
      id: n.id, node: n, radius: nodeRadius(n.size),
      phase: Math.random() * Math.PI * 2, speed: 0.4 + Math.random() * 0.5,
      x: w / 2 + (Math.random() - 0.5) * 200, y: h / 2 + (Math.random() - 0.5) * 200,
    }))
    const byId = new Map(simNodes.map(n => [n.id, n]))
    const simLinks: SimLink[] = graphData.links
      .filter(l => byId.has(l.source as string) && byId.has(l.target as string))
      .map(l => ({ source: l.source, target: l.target, strength: l.strength }))

    const sim = forceSimulation(simNodes)
      .force('link', forceLink<SimNode, SimLink>(simLinks).id(d => d.id)
        .distance(d => 70 / Math.max(0.2, (d as SimLink).strength)).strength(d => (d as SimLink).strength * 0.5))
      .force('charge', forceManyBody().strength(-160))
      .force('center', forceCenter(w / 2, h / 2))
      .force('collide', forceCollide<SimNode>().radius(d => d.radius + 14))
      // Kept warm forever (never settles to zero alpha) — this is the
      // "physics-based movement" the floating sphere is built on; the
      // per-node sine wobble in the draw loop is layered on top of it.
      .alphaTarget(0.02).alphaDecay(0.01)

    simRef.current = sim
    nodesRef.current = simNodes
    linksRef.current = simLinks

    return () => { sim.stop() }
  }, [coloredNodes, graphData.links])

  // ── Draw loop ──────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { x: tx, y: ty, k } = txRef.current
    const theme = themeRef.current
    const nodes = nodesRef.current
    const links = linksRef.current
    const t = performance.now() / 1000
    const q = queryRef.current.trim().toLowerCase()
    const hovered = hoveredRef.current

    const dpr = window.devicePixelRatio || 1
    const w = canvas.width / dpr, h = canvas.height / dpr

    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.fillStyle = theme.bg
    ctx.fillRect(0, 0, w, h)

    ctx.translate(tx, ty)
    ctx.scale(k, k)

    // Resolve each node's drifting (x,y) once per frame so links and nodes
    // read the same wobbled position.
    const posOf = (n: SimNode) => ({
      x: (n.x || 0) + Math.sin(t * n.speed + n.phase) * 7,
      y: (n.y || 0) + Math.cos(t * n.speed * 0.8 + n.phase * 1.3) * 7,
      depth: Math.sin(t * n.speed * 0.5 + n.phase * 0.7), // -1..1, pure visual parallax
    })
    const drifted = new Map(nodes.map(n => [n.id, posOf(n)]))

    // Edges
    for (const l of links) {
      const s = typeof l.source === 'string' ? undefined : l.source as SimNode
      const tgt = typeof l.target === 'string' ? undefined : l.target as SimNode
      if (!s || !tgt) continue
      const sp = drifted.get(s.id), tp = drifted.get(tgt.id)
      if (!sp || !tp) continue
      ctx.beginPath()
      ctx.moveTo(sp.x, sp.y)
      ctx.lineTo(tp.x, tp.y)
      ctx.strokeStyle = `rgba(${theme.dimEdge},${0.10 + l.strength * 0.12})`
      ctx.lineWidth = Math.max(0.5, l.strength * 1.2) / k
      ctx.stroke()
    }

    // Nodes
    for (const n of nodes) {
      const p = drifted.get(n.id)!
      const matches = !q || n.node.title.toLowerCase().includes(q) || n.node.tags.some(tg => tg.includes(q))
      const scale = 1 + p.depth * 0.12
      drawGraphNode(ctx, {
        x: p.x, y: p.y, radius: n.radius * scale, color: n.node.color, zoom: k,
        hovered: hovered?.id === n.id, hub: n.node.connections >= HUB_THRESHOLD,
        pulse: 0.5 + p.depth * 0.3, dimmed: !matches,
      })
      if (k > LABEL_ZOOM || hovered?.id === n.id) {
        ctx.save()
        ctx.font = `${hovered?.id === n.id ? 700 : 500} ${11 / k}px ui-sans-serif, system-ui`
        ctx.textAlign = 'center'
        ctx.fillStyle = matches ? theme.label : `rgba(${theme.dimEdge},0.25)`
        ctx.shadowColor = theme.bg
        ctx.shadowBlur = 4 / k
        const label = n.node.title.length > 28 ? n.node.title.slice(0, 27) + '…' : n.node.title
        ctx.fillText(label, p.x, p.y + n.radius * scale + 13 / k)
        ctx.restore()
      }
    }
    ctx.restore()
  }, [])

  useEffect(() => {
    let active = true
    const tick = () => {
      if (!active) return
      if (modeRef.current === 'sphere') {
        simRef.current?.tick()
        draw()
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { active = false; cancelAnimationFrame(rafRef.current) }
  }, [draw])

  // ── Sizing ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current, mount = mountRef.current
    if (!canvas || !mount) return
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = mount.clientWidth * dpr
      canvas.height = mount.clientHeight * dpr
      canvas.style.width = `${mount.clientWidth}px`
      canvas.style.height = `${mount.clientHeight}px`
      if (!viewInitializedRef.current) {
        txRef.current = {
          k: DEFAULT_ZOOM,
          x: mount.clientWidth * (1 - DEFAULT_ZOOM) / 2,
          y: mount.clientHeight * (1 - DEFAULT_ZOOM) / 2,
        }
        viewInitializedRef.current = true
      }
      simRef.current?.force('center', forceCenter(mount.clientWidth / 2, mount.clientHeight / 2))
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(mount)
    return () => ro.disconnect()
  }, [])

  // ── Pointer interaction — pan, zoom, drag, click, hover ──────────────────
  const screenToWorld = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const { x: tx, y: ty, k } = txRef.current
    return { x: (clientX - rect.left - tx) / k, y: (clientY - rect.top - ty) / k }
  }
  const nodeAt = (wx: number, wy: number) => {
    for (let i = nodesRef.current.length - 1; i >= 0; i--) {
      const n = nodesRef.current[i]
      const dx = wx - (n.x || 0), dy = wy - (n.y || 0)
      if (dx * dx + dy * dy <= (n.radius + 6) * (n.radius + 6)) return n
    }
    return null
  }

  const panRef = useRef<{ x: number; y: number } | null>(null)

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const rect = canvasRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left, my = e.clientY - rect.top
    const { x, y, k } = txRef.current
    const factor = Math.pow(1.0015, -e.deltaY)
    const nk = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k * factor))
    txRef.current = { k: nk, x: mx - ((mx - x) / k) * nk, y: my - ((my - y) / k) * nk }
    setZoom(nk)
  }

  const onMouseDown = (e: React.MouseEvent) => {
    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY)
    const hit = nodeAt(wx, wy)
    dragMovedRef.current = false
    if (hit) {
      draggingRef.current = hit
      hit.fx = hit.x; hit.fy = hit.y
      simRef.current?.alphaTarget(0.3).restart()
    } else {
      panRef.current = { x: e.clientX - txRef.current.x, y: e.clientY - txRef.current.y }
    }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (draggingRef.current) {
      dragMovedRef.current = true
      const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY)
      draggingRef.current.fx = wx
      draggingRef.current.fy = wy
      return
    }
    if (panRef.current) {
      txRef.current = { ...txRef.current, x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y }
      return
    }
    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY)
    const hit = nodeAt(wx, wy)
    hoveredRef.current = hit
    setTooltip(hit ? { node: hit, x: e.clientX, y: e.clientY } : null)
  }
  const onMouseUp = () => {
    if (draggingRef.current) {
      const n = draggingRef.current
      if (!dragMovedRef.current) openNote(n.node)
      n.fx = null; n.fy = null
      simRef.current?.alphaTarget(0.02)
      draggingRef.current = null
    }
    panRef.current = null
  }

  const zoomBy = (factor: number) => {
    const mount = mountRef.current
    if (!mount) return
    const cx = mount.clientWidth / 2, cy = mount.clientHeight / 2
    const { x, y, k } = txRef.current
    const nk = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k * factor))
    txRef.current = { k: nk, x: cx - ((cx - x) / k) * nk, y: cy - ((cy - y) / k) * nk }
    setZoom(nk)
  }
  const resetView = () => {
    const mount = mountRef.current
    if (!mount) return
    txRef.current = {
      k: DEFAULT_ZOOM,
      x: mount.clientWidth * (1 - DEFAULT_ZOOM) / 2,
      y: mount.clientHeight * (1 - DEFAULT_ZOOM) / 2,
    }
    setZoom(DEFAULT_ZOOM)
  }

  // ── Note detail panel ────────────────────────────────────────────────────
  const openNote = async (node: GraphNode) => {
    setSelected(node)
    setContent(null)
    setContentLoading(true)
    const raw = await getMarkdownNote(node.id)
    setContent(raw ? raw.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n)*/, '') : '*Could not load this note.*')
    setContentLoading(false)
  }

  const removeNote = async (node: GraphNode) => {
    if (!confirm(`Delete "${node.title}"? This removes the saved Markdown file — it can't be undone.`)) return
    setDeleting(true)
    const ok = await deleteMarkdownNote(node.id)
    setDeleting(false)
    if (ok) {
      setNotes(prev => prev.filter(n => n.id !== node.id))
      setSelected(null)
    }
  }

  return (
    <div className="relative flex flex-col h-full" style={{ background: 'rgb(var(--ds-bg))' }}>
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 flex-shrink-0" style={{ borderBottom: '1px solid rgb(var(--ds-glass-sm))' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{
            background: 'linear-gradient(135deg, rgb(var(--ds-accent) / 0.28), rgb(var(--ds-accent-2) / 0.18))',
            border: '1px solid rgb(var(--ds-accent) / 0.28)',
          }}>
            <Orbit size={15} style={{ color: 'rgb(var(--ds-accent-soft))' }} />
          </div>
          <div>
            <div className="text-sm font-bold" style={{ color: 'rgb(var(--ds-text-1))' }}>Knowledge Graph</div>
            <div className="text-[11px]" style={{ color: 'rgb(var(--ds-text-4))' }}>
              {noteSummary}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Graph view" className="flex items-center rounded-lg p-0.5"
            style={{ background: 'rgb(var(--ds-glass-sm))', border: '1px solid rgb(var(--ds-glass-md))' }}>
            <button onClick={() => setMode('sphere')} aria-pressed={mode === 'sphere'} title="2D sphere view"
              className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[11px] font-semibold transition-colors"
              style={{ color: mode === 'sphere' ? 'rgb(var(--ds-text-1))' : 'rgb(var(--ds-text-4))', background: mode === 'sphere' ? 'rgb(var(--ds-glass-md))' : 'transparent' }}>
              <Orbit size={13} /> Sphere
            </button>
            <button onClick={() => setMode('globe')} aria-pressed={mode === 'globe'} title="3D globe view"
              className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[11px] font-semibold transition-colors"
              style={{ color: mode === 'globe' ? 'rgb(var(--ds-text-1))' : 'rgb(var(--ds-text-4))', background: mode === 'globe' ? 'rgb(var(--ds-glass-md))' : 'transparent' }}>
              <Globe2 size={13} /> Globe
            </button>
          </div>
          <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ background: 'rgb(var(--ds-glass-sm))', border: '1px solid rgb(var(--ds-glass-md))' }}>
            <Search size={12} style={{ color: 'rgb(var(--ds-text-4))' }} />
            <input
              value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search clipped pages…"
              className="bg-transparent outline-none text-[12px]"
              style={{ color: 'rgb(var(--ds-text-2))', width: 'clamp(90px, 16vw, 180px)' }}
            />
          </div>
          {mode === 'sphere' && <>
            <div className="flex h-8 min-w-[42px] items-center justify-center rounded-lg px-1.5 text-[11px] font-semibold"
              style={{ background: 'rgb(var(--ds-glass-sm))', border: '1px solid rgb(var(--ds-glass-md))', color: 'rgb(var(--ds-text-3))' }}>
              {zoomLabel}
            </div>
            <button onClick={() => zoomBy(1.3)} title="Zoom in" aria-label="Zoom in" className="w-8 h-8 rounded-lg flex items-center justify-center" style={btnStyle}><ZoomIn size={14} /></button>
            <button onClick={() => zoomBy(1 / 1.3)} title="Zoom out" aria-label="Zoom out" className="w-8 h-8 rounded-lg flex items-center justify-center" style={btnStyle}><ZoomOut size={14} /></button>
            <button onClick={resetView} title="Reset view" aria-label="Reset view" className="w-8 h-8 rounded-lg flex items-center justify-center" style={btnStyle}><Crosshair size={14} /></button>
          </>}
        </div>
      </div>

      {/* ── Graph canvas ── */}
      <div ref={mountRef} className="relative flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          style={{ display: mode === 'sphere' ? 'block' : 'none', cursor: draggingRef.current ? 'grabbing' : 'grab' }}
        />

        {mode === 'globe' && (
          <Suspense fallback={(
            <div className="absolute inset-0 flex items-center justify-center" style={{ color: 'rgb(var(--ds-text-4))' }}>
              <Loader2 size={20} className="animate-spin" />
            </div>
          )}>
            <MarkdownGlobe
              nodes={coloredNodes}
              links={graphData.links}
              query={query}
              selectedId={selected?.id || null}
              onSelect={openNote}
            />
          </Suspense>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ color: 'rgb(var(--ds-text-4))' }}>
            <Loader2 size={20} className="animate-spin" />
          </div>
        )}

        {!loading && notes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <Orbit size={28} style={{ color: 'rgb(var(--ds-text-4))' }} />
            <div className="text-sm font-semibold" style={{ color: 'rgb(var(--ds-text-2))' }}>Your knowledge graph is empty</div>
            <div className="text-[12px] max-w-sm" style={{ color: 'rgb(var(--ds-text-4))' }}>
              Right-click any web page and choose <b>Save Page to Obsidian</b> — it becomes a Markdown note here.
              Already use Obsidian? Connect your vault and its notes appear as nodes.
            </div>
            <button onClick={() => onNavigate('aihub://settings')}
              className="mt-1 flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold"
              style={{ background: 'rgb(var(--ds-accent) / 0.18)', color: 'rgb(var(--ds-accent-soft))', border: '1px solid rgb(var(--ds-accent) / 0.3)' }}>
              Connect Obsidian vault
            </button>
          </div>
        )}

        {tooltip && !selected && (
          <div className="absolute pointer-events-none rounded-lg px-2.5 py-1.5 text-[11px] font-semibold"
            style={{
              left: tooltip.x + 14, top: tooltip.y + 14, background: 'rgba(6,10,19,0.92)',
              color: '#fff', border: '1px solid rgba(255,255,255,0.1)', zIndex: 20, maxWidth: 220,
            }}>
            {tooltip.node.node.title}
            <div className="font-normal opacity-70 mt-0.5">{tooltip.node.node.category} · {tooltip.node.node.tags.slice(0, 3).join(', ')}</div>
          </div>
        )}
        {/* The inspector is constrained to the graph viewport, below the fixed toolbar. */}
        {selected && (
          <section className="absolute right-3 top-3 bottom-3 flex flex-col overflow-hidden rounded-xl"
            aria-label={`Saved page details: ${selected.title}`}
            style={{
              width: 'min(420px, calc(100% - 24px))',
              background: 'rgb(var(--ds-bg-2, var(--ds-bg)))',
              border: '1px solid rgb(var(--ds-glass-md))',
              boxShadow: '-12px 0 40px rgba(0,0,0,0.35)', zIndex: 10,
            }}>
            <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4 flex-shrink-0" style={{ borderBottom: '1px solid rgb(var(--ds-glass-sm))' }}>
              <div className="min-w-0">
                <div className="text-sm font-bold leading-snug" style={{ color: 'rgb(var(--ds-text-1))' }}>{selected.title}</div>
                {selected.url && <div className="mt-1 truncate text-[11px]" title={selected.url} style={{ color: 'rgb(var(--ds-text-4))' }}>{selectedHost}</div>}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                    style={{ background: hexToRgba(selected.color, 0.18), color: selected.color }}>{selected.category}</span>
                  {selected.tags.slice(0, 6).map(tag => (
                    <span key={tag} className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px]"
                      style={{ background: 'rgb(var(--ds-glass-sm))', color: 'rgb(var(--ds-text-3))' }}>
                      <Tag size={8} />{tag}
                    </span>
                  ))}
                </div>
                <div className="mt-2 text-[10px]" style={{ color: 'rgb(var(--ds-text-4))' }}>
                  Saved {Number.isFinite(selected.createdAt) ? new Date(selected.createdAt).toLocaleDateString() : 'date unknown'}
                  <span aria-hidden="true"> · </span>{selected.connections} related {selected.connections === 1 ? 'page' : 'pages'}
                </div>
              </div>
              <button onClick={() => setSelected(null)} title="Close details" aria-label="Close details"
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg" style={btnStyle}>
                <X size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              {contentLoading ? (
                <div className="flex items-center justify-center py-10" style={{ color: 'rgb(var(--ds-text-4))' }}><Loader2 size={18} className="animate-spin" /></div>
              ) : content ? (
                <Markdown content={content} onNavigate={onNavigate} />
              ) : (
                <div className="text-[12px]" style={{ color: 'rgb(var(--ds-text-4))' }}>The saved Markdown content could not be loaded.</div>
              )}
            </div>

            <div className="flex flex-shrink-0 items-center gap-2 px-4 py-3" style={{ borderTop: '1px solid rgb(var(--ds-glass-sm))' }}>
              {selected.url && (
                <button onClick={() => onNavigate(selected.url)}
                  className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold"
                  style={{ background: 'rgb(var(--ds-accent) / 0.16)', color: 'rgb(var(--ds-accent-soft))', border: '1px solid rgb(var(--ds-accent) / 0.3)' }}>
                  <ExternalLink size={13} /> Open source
                </button>
              )}
              {/* Vault notes belong to the user's Obsidian — read-only here. */}
              {selected.origin !== 'vault' && (
                <button onClick={() => removeNote(selected)} disabled={deleting}
                  className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold"
                  style={{ background: 'rgba(239,68,68,0.14)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>
                  {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Delete
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  background: 'rgb(var(--ds-glass-sm))', border: '1px solid rgb(var(--ds-glass-md))',
  color: 'rgb(var(--ds-text-3))', cursor: 'pointer',
}
