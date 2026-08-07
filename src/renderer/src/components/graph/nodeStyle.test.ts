import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { drawGraphNode, drawSpawnRipple, hexToRgba, NODE_STYLE, HUB_THRESHOLD, LABEL_ZOOM } from './nodeStyle'

/** Records what was painted, so a node's look can be asserted without a GPU. */
function fakeCtx() {
  const ops: { op: string; args: any[] }[] = []
  const rec = (op: string) => (...args: any[]) => { ops.push({ op, args }) }
  const ctx: any = {
    ops,
    arcs: [] as { x: number; y: number; r: number }[],
    stops: [] as { offset: number; color: string }[],
    save: rec('save'),
    restore: rec('restore'),
    beginPath: rec('beginPath'),
    fill: rec('fill'),
    stroke: rec('stroke'),
    arc(x: number, y: number, r: number, ...rest: any[]) {
      ctx.arcs.push({ x, y, r })
      ops.push({ op: 'arc', args: [x, y, r, ...rest] })
    },
    createRadialGradient: (..._a: any[]) => ({
      addColorStop: (offset: number, color: string) => { ctx.stops.push({ offset, color }) },
    }),
  }
  // Style setters are plain properties; record each assignment in order.
  for (const prop of ['fillStyle', 'strokeStyle', 'lineWidth', 'shadowColor', 'shadowBlur']) {
    let v: any
    Object.defineProperty(ctx, prop, {
      get: () => v,
      set: (next) => { v = next; ops.push({ op: `set:${prop}`, args: [next] }) },
    })
  }
  return ctx
}

const base = { x: 10, y: 20, radius: 8, color: '#38bdf8', zoom: 1 }
let ctx: any
beforeEach(() => { ctx = fakeCtx() })

const setsOf = (prop: string) => ctx.ops.filter((o: any) => o.op === `set:${prop}`).map((o: any) => o.args[0])

describe('hexToRgba', () => {
  it('converts six-digit hex', () => {
    expect(hexToRgba('#38bdf8', 0.5)).toBe('rgba(56,189,248,0.5)')
  })

  it('expands three-digit hex rather than reading garbage', () => {
    expect(hexToRgba('#f0a', 1)).toBe('rgba(255,0,170,1)')
  })

  it('falls back to slate for a colour it cannot parse', () => {
    // An unparseable colour used to produce "rgba(NaN,NaN,NaN,1)", which canvas
    // ignores — leaving the node painted in the PREVIOUS node's colour.
    for (const bad of ['', 'red', '#12', 'rgb(1,2,3)', undefined as any]) {
      expect(hexToRgba(bad, 1)).toBe('rgba(148,163,184,1)')
    }
  })
})

describe('drawGraphNode', () => {
  it('paints core and ring at the node radius', () => {
    drawGraphNode(ctx, base)
    expect(ctx.arcs).toEqual([{ x: 10, y: 20, r: 8 }, { x: 10, y: 20, r: 8 }])
    expect(setsOf('fillStyle')).toEqual(['rgba(56,189,248,1)'])
    expect(setsOf('strokeStyle')).toEqual([`rgba(56,189,248,${NODE_STYLE.ringAlpha.rest})`])
  })

  it('draws nothing at all for a node that has not grown yet', () => {
    // Entrance animation starts every node at scale 0.
    drawGraphNode(ctx, { ...base, radius: 0 })
    drawGraphNode(ctx, { ...base, radius: -1 })
    expect(ctx.ops).toHaveLength(0)
  })

  it('keeps the ring hairline as the canvas zooms in', () => {
    drawGraphNode(ctx, { ...base, zoom: 4 })
    expect(setsOf('lineWidth')).toEqual([NODE_STYLE.ringWidth.rest / 4])
  })

  it('grows the disc and thickens the ring when selected', () => {
    drawGraphNode(ctx, { ...base, selected: true })
    expect(ctx.arcs[ctx.arcs.length - 1].r).toBe(8 * NODE_STYLE.selectedScale)
    expect(setsOf('lineWidth')).toEqual([NODE_STYLE.ringWidth.selected])
    expect(setsOf('strokeStyle')).toEqual(['rgba(56,189,248,1)'])
  })

  it('fades only the core of a dimmed node, so the graph keeps its shape', () => {
    drawGraphNode(ctx, { ...base, dimmed: true })
    expect(setsOf('fillStyle')).toEqual([`rgba(56,189,248,${NODE_STYLE.dimFill})`])
  })

  it('haloes selection above hover above hub, and never two at once', () => {
    for (const [state, node] of [
      ['selected', { selected: true, hovered: true, hub: true }],
      ['hovered', { hovered: true, hub: true }],
      ['hub', { hub: true }],
    ] as const) {
      const c = fakeCtx()
      drawGraphNode(c, { ...base, ...node })
      const blurs = c.ops.filter((o: any) => o.op === 'set:shadowBlur').map((o: any) => o.args[0])
      expect(blurs, state).toEqual([NODE_STYLE.haloBlur[state]])
    }
  })

  it('gives a plain node no halo and no shadow leak', () => {
    drawGraphNode(ctx, base)
    expect(setsOf('shadowBlur')).toEqual([])
    expect(ctx.ops.filter((o: any) => o.op === 'save')).toHaveLength(0)
  })

  it('restores the shadow state it set, or every later node smears', () => {
    drawGraphNode(ctx, { ...base, selected: true })
    const saves = ctx.ops.filter((o: any) => o.op === 'save').length
    const restores = ctx.ops.filter((o: any) => o.op === 'restore').length
    expect(saves).toBe(restores)
  })

  it('breathes an aura only when given a pulse, hubs harder than leaves', () => {
    drawGraphNode(ctx, { ...base, pulse: null })
    expect(ctx.stops).toHaveLength(0)

    const leaf = fakeCtx(); drawGraphNode(leaf, { ...base, pulse: 1 })
    const hub = fakeCtx(); drawGraphNode(hub, { ...base, pulse: 1, hub: true })
    expect(leaf.stops[0].color).toBe(hexToRgba(base.color, NODE_STYLE.auraAlpha.leaf))
    expect(hub.stops[0].color).toBe(hexToRgba(base.color, NODE_STYLE.auraAlpha.hub))
    // Both fade to fully transparent, so the aura has no visible edge.
    expect(leaf.stops[1].color).toBe(hexToRgba(base.color, 0))
  })

  it('lets an anchor node override its ring without touching its fill', () => {
    drawGraphNode(ctx, { ...base, ringColor: '#fff7e0' })
    expect(setsOf('fillStyle')).toEqual(['rgba(56,189,248,1)'])
    expect(setsOf('strokeStyle')).toEqual([`rgba(255,247,224,${NODE_STYLE.ringAlpha.rest})`])
  })
})

describe('drawSpawnRipple', () => {
  it('expands and fades across its progress', () => {
    const early = fakeCtx(); drawSpawnRipple(early, 0, 0, 10, '#38bdf8', 1, 0.1)
    const late = fakeCtx(); drawSpawnRipple(late, 0, 0, 10, '#38bdf8', 1, 0.9)
    expect(late.arcs[0].r).toBeGreaterThan(early.arcs[0].r)
    const alpha = (c: any) => Number(/,([\d.]+)\)$/.exec(c.ops.find((o: any) => o.op === 'set:strokeStyle').args[0])![1])
    expect(alpha(late)).toBeLessThan(alpha(early))
  })

  it('draws nothing outside its window', () => {
    for (const p of [0, -0.5, 1, 2, NaN]) {
      const c = fakeCtx()
      drawSpawnRipple(c, 0, 0, 10, '#38bdf8', 1, p)
      expect(c.ops, `progress ${p}`).toHaveLength(0)
    }
  })
})

describe('both graphs share one design', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
  const sphere = read('homepage/BookmarkSphere.tsx')
  const verses = read('bible/VerseGraph.tsx')

  it('draws its nodes through the shared painter, not a private copy', () => {
    for (const [name, src] of [['sphere', sphere], ['verses', verses]] as const) {
      expect(src, name).toMatch(/drawGraphNode\(ctx, \{/)
      expect(src, name).toContain("from '../graph/nodeStyle'")
    }
  })

  it('keeps no second opinion on the numbers that define a node', () => {
    // The values that had drifted: halo blur, ring width, dim fill, aura alpha.
    for (const [name, src] of [['sphere', sphere], ['verses', verses]] as const) {
      const draw = src.slice(0, src.indexOf('// ── Labels') + 1 || undefined)
      expect(draw, name).not.toMatch(/shadowBlur\s*=\s*(isSel|3[24]|2[02]|1[24])/)
      expect(draw, name).not.toMatch(/lineWidth\s*=\s*\(isSel \? 2\.[56]/)
    }
  })

  it('agrees on when a node is a hub and when labels appear', () => {
    // Both files import these rather than declaring their own.
    for (const [name, src] of [['sphere', sphere], ['verses', verses]] as const) {
      expect(src, name).not.toMatch(/const HUB_THRESHOLD\s*=/)
      expect(src, name).not.toMatch(/const LABEL_ZOOM\s*=/)
    }
    expect(HUB_THRESHOLD).toBe(2)
    expect(LABEL_ZOOM).toBeGreaterThan(0)
  })
})
