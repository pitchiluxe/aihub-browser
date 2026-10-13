// Where a deck's YouTube player is shown inside the app window. The page sends
// the rectangle of its video area in CSS pixels; the window wants its own
// units (CSS px × the page's zoom). The page is not trusted with window
// geometry: anything that is not a sane rectangle hides the player instead.

export interface Bounds { x: number; y: number; width: number; height: number }

const MAX = 16384
/** Smaller than this is not a picture anyone can see. */
const MIN_SIDE = 8

export function nativeBounds(rect: unknown, zoom: number): Bounds | null {
  if (!rect || typeof rect !== 'object') return null
  const r = rect as Record<string, unknown>
  const vals = [r.x, r.y, r.width, r.height].map(Number)
  if (vals.some(v => !Number.isFinite(v) || v < 0 || v > MAX)) return null
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const [x, y, width, height] = vals.map(v => Math.round(v * z))
  if (width < MIN_SIDE || height < MIN_SIDE) return null
  return { x, y, width, height }
}
