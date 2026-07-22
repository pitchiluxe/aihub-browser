import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'

// Annotation overlay for the app's OWN pages (Bible, Notes, Settings, the
// homepage…). The regular AnnotationCanvas injects its canvas into a tab's
// BrowserView, which host React pages don't have — so those pages get this
// host-rendered overlay instead. Same tools, drawn on a real <canvas> that
// sits over the content area with an absolutely-positioned React toolbar.

type Tool = 'pen' | 'highlight' | 'arrow' | 'rect' | 'ellipse' | 'eraser'
interface Stroke { t: Tool; c: string; w: number; pts: [number, number][] }

const TOOLS: { id: Tool; icon: string; label: string }[] = [
  { id: 'pen', icon: '✏️', label: 'Pen' },
  { id: 'highlight', icon: '🖊', label: 'Highlighter' },
  { id: 'arrow', icon: '➜', label: 'Arrow' },
  { id: 'rect', icon: '▭', label: 'Rectangle' },
  { id: 'ellipse', icon: '◯', label: 'Ellipse' },
  { id: 'eraser', icon: '⌫', label: 'Eraser' },
]
const COLORS = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899', '#ffffff', '#0f172a']
const SIZES: { w: number; label: string }[] = [{ w: 2, label: 'S' }, { w: 5, label: 'M' }, { w: 10, label: 'L' }]

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  if (!s.pts.length) return
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = s.w
  ctx.strokeStyle = s.c
  ctx.globalCompositeOperation = s.t === 'eraser' ? 'destination-out' : 'source-over'
  ctx.globalAlpha = s.t === 'highlight' ? 0.38 : 1
  if (s.t === 'eraser') { ctx.lineWidth = s.w * 7; ctx.strokeStyle = 'rgba(0,0,0,1)' }
  if (s.t === 'highlight') ctx.lineWidth = s.w * 6
  const p = s.pts
  if (s.t === 'pen' || s.t === 'highlight' || s.t === 'eraser') {
    ctx.beginPath()
    ctx.moveTo(p[0][0], p[0][1])
    for (let i = 1; i < p.length - 1; i++) {
      const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2
      ctx.quadraticCurveTo(p[i][0], p[i][1], mx, my)
    }
    if (p.length > 1) ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1])
    ctx.stroke()
  } else if (s.t === 'arrow') {
    const [x1, y1] = p[0], [x2, y2] = p[p.length - 1]
    const a = Math.atan2(y2 - y1, x2 - x1), hl = Math.max(14, s.w * 3.5)
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x2, y2); ctx.lineTo(x2 - hl * Math.cos(a - Math.PI / 6), y2 - hl * Math.sin(a - Math.PI / 6))
    ctx.moveTo(x2, y2); ctx.lineTo(x2 - hl * Math.cos(a + Math.PI / 6), y2 - hl * Math.sin(a + Math.PI / 6))
    ctx.stroke()
  } else if (s.t === 'rect') {
    ctx.strokeRect(p[0][0], p[0][1], p[p.length - 1][0] - p[0][0], p[p.length - 1][1] - p[0][1])
  } else if (s.t === 'ellipse') {
    const cx = (p[0][0] + p[p.length - 1][0]) / 2, cy = (p[0][1] + p[p.length - 1][1]) / 2
    const rx = Math.abs(p[p.length - 1][0] - p[0][0]) / 2, ry = Math.abs(p[p.length - 1][1] - p[0][1]) / 2
    if (rx > 0 && ry > 0) { ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke() }
  }
  ctx.restore()
}

export default function HostAnnotationCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const strokes = useRef<Stroke[]>([])
  const redo = useRef<Stroke[]>([])
  const cur = useRef<Stroke | null>(null)
  const drawing = useRef(false)
  const start = useRef<[number, number]>([0, 0])

  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState('#ef4444')
  const [width, setWidth] = useState(5)
  const [pointerMode, setPointerMode] = useState(false)
  const [tbPos, setTbPos] = useState({ x: 20, y: 20 })

  // Live refs so the canvas listeners (bound once) always read current tool state.
  const toolRef = useRef(tool); toolRef.current = tool
  const colorRef = useRef(color); colorRef.current = color
  const widthRef = useRef(width); widthRef.current = width
  const pointerRef = useRef(pointerMode); pointerRef.current = pointerMode

  const redraw = () => {
    const cv = canvasRef.current, ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    ctx.clearRect(0, 0, cv.width, cv.height)
    strokes.current.forEach(s => drawStroke(ctx, s))
    if (cur.current) drawStroke(ctx, cur.current)
  }

  // Match the backing store to the element's size (and DPR) so lines are crisp
  // and coordinates map 1:1 to page pixels.
  useLayoutEffect(() => {
    const fit = () => {
      const cv = canvasRef.current, wrap = wrapRef.current
      if (!cv || !wrap) return
      const r = wrap.getBoundingClientRect()
      cv.width = r.width
      cv.height = r.height
      redraw()
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  const undo = () => { const s = strokes.current.pop(); if (s) { redo.current.push(s); redraw() } }
  const redoFn = () => { const s = redo.current.pop(); if (s) { strokes.current.push(s); redraw() } }
  const clear = () => { strokes.current = []; redo.current = []; redraw() }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); return }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redoFn(); return }
      const map: Record<string, Tool> = { p: 'pen', h: 'highlight', a: 'arrow', r: 'rect', e: 'ellipse', x: 'eraser' }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && map[e.key]) setTool(map[e.key])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pt = (e: React.PointerEvent): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  const onDown = (e: React.PointerEvent) => {
    if (pointerRef.current || e.button !== 0) return
    e.preventDefault()
    canvasRef.current?.setPointerCapture(e.pointerId)
    drawing.current = true
    start.current = pt(e)
    cur.current = { t: toolRef.current, c: colorRef.current, w: widthRef.current, pts: [start.current] }
  }
  const onMove = (e: React.PointerEvent) => {
    if (!drawing.current || !cur.current) return
    const p = pt(e)
    const t = cur.current.t
    if (t === 'pen' || t === 'highlight' || t === 'eraser') cur.current.pts.push(p)
    else cur.current.pts = [start.current, p]
    redraw()
  }
  const onUp = () => {
    if (!drawing.current || !cur.current) return
    drawing.current = false
    strokes.current.push(cur.current)
    redo.current = []
    cur.current = null
    redraw()
  }

  // Drag the toolbar by its header.
  const tbDrag = useRef<{ dx: number; dy: number } | null>(null)
  const onTbDown = (e: React.MouseEvent) => {
    tbDrag.current = { dx: e.clientX - tbPos.x, dy: e.clientY - tbPos.y }
    const move = (ev: MouseEvent) => {
      if (!tbDrag.current) return
      setTbPos({ x: Math.max(4, ev.clientX - tbDrag.current.dx), y: Math.max(4, ev.clientY - tbDrag.current.dy) })
    }
    const up = () => { tbDrag.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const cursor = pointerMode ? 'default' : tool === 'eraser' ? 'cell' : 'crosshair'

  return (
    <div ref={wrapRef} className="absolute inset-0 z-[60]" style={{ pointerEvents: 'none' }}>
      <canvas
        ref={canvasRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor, pointerEvents: pointerMode ? 'none' : 'all', touchAction: 'none' }}
      />

      {/* Toolbar — draggable, always interactive even in pointer mode */}
      <div
        style={{
          position: 'absolute', left: tbPos.x, top: tbPos.y, zIndex: 2, pointerEvents: 'auto',
          background: 'rgba(10,15,30,0.97)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(59,130,246,0.3)', borderRadius: 16, boxShadow: '0 12px 48px rgba(0,0,0,0.7)',
          padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 236,
          fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', userSelect: 'none',
        }}
      >
        <div onMouseDown={onTbDown} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'grab' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', boxShadow: '0 0 6px rgba(59,130,246,0.6)' }} />
          <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Annotation</span>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => setPointerMode(m => !m)}
            style={{
              height: 28, padding: '0 10px', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
              border: `1px solid ${pointerMode ? 'rgba(59,130,246,0.35)' : 'rgba(255,255,255,0.1)'}`,
              background: pointerMode ? 'rgba(59,130,246,0.18)' : 'rgba(255,255,255,0.05)',
              color: pointerMode ? '#60a5fa' : '#64748b',
            }}
          >
            {pointerMode ? '🖱 Pointer' : '✏️ Draw'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 5, opacity: pointerMode ? 0.35 : 1, pointerEvents: pointerMode ? 'none' : 'auto' }}>
          {TOOLS.map(t => (
            <button key={t.id} type="button" title={t.label} onClick={() => setTool(t.id)}
              style={{
                width: 32, height: 32, borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: tool === t.id ? '1.5px solid #3b82f6' : '1px solid rgba(255,255,255,0.08)',
                background: tool === t.id ? 'rgba(59,130,246,0.22)' : 'rgba(255,255,255,0.05)',
                color: tool === t.id ? '#93c5fd' : '#94a3b8',
              }}>{t.icon}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', opacity: pointerMode ? 0.35 : 1, pointerEvents: pointerMode ? 'none' : 'auto' }}>
          {COLORS.map(c => (
            <div key={c} title={c} onClick={() => setColor(c)}
              style={{
                width: 22, height: 22, borderRadius: 6, cursor: 'pointer', background: c,
                border: color === c ? '2px solid #fff' : '2px solid transparent',
                outline: color === c ? '1.5px solid #3b82f6' : 'none', outlineOffset: 2,
              }} />
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5, opacity: pointerMode ? 0.35 : 1, pointerEvents: pointerMode ? 'none' : 'auto' }}>
          <span style={{ fontSize: 10, color: '#475569', marginRight: 2 }}>Size</span>
          {SIZES.map(s => (
            <button key={s.w} type="button" onClick={() => setWidth(s.w)}
              style={{
                width: 28, height: 28, borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                border: width === s.w ? '1.5px solid #3b82f6' : '1px solid rgba(255,255,255,0.1)',
                background: width === s.w ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.04)',
                color: width === s.w ? '#93c5fd' : '#64748b',
              }}>{s.label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 5 }}>
          {[['↩ Undo', undo], ['↪ Redo', redoFn], ['🗑 Clear', clear]].map(([label, fn]) => (
            <button key={label as string} type="button" onClick={fn as () => void}
              style={{
                height: 28, padding: '0 10px', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#64748b',
              }}>{label as string}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
