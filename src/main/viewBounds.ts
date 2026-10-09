/**
 * Where a tab's native view goes, from the content area the renderer measured.
 *
 * The renderer measures in CSS pixels; views are placed in window pixels, so
 * the rectangle is scaled by the window's own zoom. Its edges are rounded
 * (not its size), so a view always ends where the content area ends.
 *
 * A view that reaches the window's right or bottom edge is run a few pixels
 * past it. Windows sizes a window in whole physical pixels, so at 125 % or
 * 150 % display scaling a view ending exactly at the content edge stopped
 * 1–2 physical pixels short — and the glass window background showed through
 * as a thin transparent border. The window clips the overshoot.
 */
export interface Rect { x: number; y: number; width: number; height: number }

/** How close (window px) to an edge counts as touching it. */
const EDGE_SNAP = 2
/** How far past a touched edge the view runs. */
export const EDGE_OVERSHOOT = 4

export function viewRect(css: Rect, zoom: number, content: [number, number]): Rect {
  const z = zoom > 0 && Number.isFinite(zoom) ? zoom : 1
  const x0 = Math.round(css.x * z)
  const y0 = Math.round(css.y * z)
  let x1 = Math.round((css.x + Math.max(0, css.width)) * z)
  let y1 = Math.round((css.y + Math.max(0, css.height)) * z)
  const [cw, ch] = content
  if (cw > 0 && cw - x1 <= EDGE_SNAP) x1 = cw + EDGE_OVERSHOOT
  if (ch > 0 && ch - y1 <= EDGE_SNAP) y1 = ch + EDGE_OVERSHOOT
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) }
}
