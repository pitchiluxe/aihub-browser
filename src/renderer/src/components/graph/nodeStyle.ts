// One node, drawn one way.
//
// The Bible verse graph and the bookmark sphere are two different graphs that
// are meant to look like the same product. They were each hand-rolling the
// same four passes — pulsing aura, glow halo, core disc, ring stroke — with
// values that had quietly diverged (glow blur 34 vs 32, dim alpha 0.08 vs
// 0.07, selected ring 2.6 vs 2.5, hub threshold 2 vs 3). Nothing had "a
// design"; each file had its own copy of one.
//
// This module owns the look. The numbers here are the verse graph's, which is
// the one that was signed off. Both canvases call drawGraphNode and neither
// keeps a second opinion.
//
// It deliberately owns only the STILL image of a node. Motion — entrance
// stagger, breathing scale, spawn ripple, force simulation — stays with each
// graph, because the two animate for different reasons and only the styling
// was meant to be shared.

/** Where a node stops being a leaf and starts being a hub worth glowing. */
export const HUB_THRESHOLD = 2

/** Below this zoom, only hubs keep their labels — otherwise it is soup. */
export const LABEL_ZOOM = 0.62

/** Default label ink for a dark canvas. */
export const LABEL_INK = 'rgba(226,232,240,0.9)'

export const NODE_STYLE = {
  /** Radius multipliers for the core disc. */
  selectedScale: 1.2,
  /** Halo radius, by state. */
  haloScale: { selected: 1.55, hovered: 1.3, hub: 1.15 },
  /** Halo shadow spread, by state. */
  haloBlur: { selected: 34, hovered: 22, hub: 14 },
  /** Halo fill alpha, by state. */
  haloAlpha: { selected: 0.3, hovered: 0.2, hub: 0.1 },
  /** Aura reach as a multiple of the core, and how far the pulse pushes it. */
  auraScale: 1.5,
  auraPulse: 0.35,
  /** Aura centre alpha, hubs glow harder. */
  auraAlpha: { hub: 0.22, leaf: 0.12 },
  /** Core fill alpha when the node is faded out of the current focus. */
  dimFill: 0.14,
  /** Ring stroke. */
  ringAlpha: { selected: 1, rest: 0.85 },
  ringWidth: { selected: 2.6, rest: 1.5 },
  /** Label alpha, by state. */
  labelAlpha: { selected: 1, connected: 0.82, dim: 0.12 },
  /** Label halo against the canvas background, so text stays legible on edges. */
  labelBlur: 6,
} as const

/** #rgb / #rrggbb → rgba(). Falls back to slate rather than emitting an
 *  invalid colour string, which canvas silently ignores — leaving a node
 *  painted in whatever colour happened to be set last. */
export function hexToRgba(hex: string, alpha: number): string {
  let h = (hex || '').trim()
  if (h.startsWith('#')) h = h.slice(1)
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  if (!/^[0-9a-f]{6}$/i.test(h)) return `rgba(148,163,184,${alpha})`
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${alpha})`
}

export interface GraphNodeVisual {
  x: number
  y: number
  /** Final radius, after whatever scaling the caller's animation applied. */
  radius: number
  color: string
  /** Current canvas zoom, so strokes stay hairline as the user zooms in. */
  zoom: number
  selected?: boolean
  hovered?: boolean
  hub?: boolean
  /** 0–1 breathing phase; omit (or null) to skip the aura entirely. */
  pulse?: number | null
  /** Fade the core — the node is outside the current selection or search. */
  dimmed?: boolean
  /** Ring override, for a node that anchors the graph (the Bible centre). */
  ringColor?: string
}

/**
 * Paints one node: aura, halo, core, ring.
 *
 * The caller owns globalAlpha (each graph fades unfocused nodes on its own
 * terms) and restores nothing here — every pass that touches shadow state
 * saves and restores itself.
 */
export function drawGraphNode(ctx: CanvasRenderingContext2D, n: GraphNodeVisual): void {
  const { x, y, color, zoom } = n
  const r = n.radius
  if (!(r > 0)) return

  const S = NODE_STYLE
  const coreR = n.selected ? r * S.selectedScale : r

  // Pulsing coloured aura — the graph breathes.
  if (n.pulse != null) {
    const auraR = r * (S.auraScale + n.pulse * S.auraPulse)
    const grd = ctx.createRadialGradient(x, y, r * 0.8, x, y, auraR)
    grd.addColorStop(0, hexToRgba(color, (n.hub ? S.auraAlpha.hub : S.auraAlpha.leaf) * n.pulse))
    grd.addColorStop(1, hexToRgba(color, 0))
    ctx.fillStyle = grd
    ctx.beginPath()
    ctx.arc(x, y, auraR, 0, Math.PI * 2)
    ctx.fill()
  }

  // Glow halo — selection, hover, and hubs announce themselves.
  if (n.selected || n.hovered || n.hub) {
    const state = n.selected ? 'selected' : n.hovered ? 'hovered' : 'hub'
    ctx.save()
    ctx.shadowColor = color
    ctx.shadowBlur = S.haloBlur[state]
    ctx.beginPath()
    ctx.arc(x, y, r * S.haloScale[state], 0, Math.PI * 2)
    ctx.fillStyle = hexToRgba(color, S.haloAlpha[state])
    ctx.fill()
    ctx.restore()
  }

  // Core disc.
  ctx.beginPath()
  ctx.arc(x, y, coreR, 0, Math.PI * 2)
  ctx.fillStyle = hexToRgba(color, n.dimmed ? S.dimFill : 1)
  ctx.fill()

  // Ring.
  ctx.beginPath()
  ctx.arc(x, y, coreR, 0, Math.PI * 2)
  ctx.strokeStyle = hexToRgba(n.ringColor || color, n.selected ? S.ringAlpha.selected : S.ringAlpha.rest)
  ctx.lineWidth = (n.selected ? S.ringWidth.selected : S.ringWidth.rest) / zoom
  ctx.stroke()
}

/**
 * The expanding ring a node emits as it pops in. Kept next to the node style
 * because it is drawn in the node's colour and sized off its radius, but it is
 * driven entirely by the caller's animation clock.
 *
 * @param progress 0–1 through the ripple; outside that range nothing draws.
 */
export function drawSpawnRipple(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, baseRadius: number, color: string, zoom: number, progress: number,
): void {
  if (!(progress > 0) || progress >= 1) return
  ctx.beginPath()
  ctx.arc(x, y, baseRadius * (1 + progress * 2.8), 0, Math.PI * 2)
  ctx.strokeStyle = hexToRgba(color, (1 - progress) * 0.55)
  ctx.lineWidth = ((1 - progress) * 1.6 + 0.4) / zoom
  ctx.stroke()
}
