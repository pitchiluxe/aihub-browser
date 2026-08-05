export interface Rect { x: number; y: number; width: number; height: number }

/**
 * Geometry for split view: two panes sharing the content area with a gutter
 * between them, so the window background reads as a divider between two live
 * pages.
 *
 * Pulled out of the window code because it is the part that can actually be
 * wrong — an off-by-one here leaves a seam of desktop showing through, or a
 * pane one pixel wider than the window. Rounding is done once, at the end, and
 * the right pane is derived from the left so the two always add up to exactly
 * the available width.
 */
export function splitPanes(bounds: Rect, ratio = 0.5, gutter = 6): [Rect, Rect] {
  const clamped = Math.min(0.8, Math.max(0.2, Number.isFinite(ratio) ? ratio : 0.5))
  const total = Math.max(0, Math.round(bounds.width))
  // A window too narrow for a gutter gets none rather than negative widths.
  const gap = Math.min(Math.max(0, Math.round(gutter)), total)
  const usable = total - gap
  const leftWidth = Math.round(usable * clamped)
  const rightWidth = usable - leftWidth

  const x = Math.round(bounds.x)
  const y = Math.round(bounds.y)
  const height = Math.max(0, Math.round(bounds.height))
  return [
    { x, y, width: Math.max(0, leftWidth), height },
    { x: x + leftWidth + gap, y, width: Math.max(0, rightWidth), height },
  ]
}
