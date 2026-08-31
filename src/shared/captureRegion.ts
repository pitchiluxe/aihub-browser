/**
 * AIHub Browser — capturing part of a page rather than all of it.
 *
 * Screenshot and Record both used to mean "everything", which is the wrong
 * default surprisingly often: the useful thing is usually one chart, one
 * paragraph, one error dialog, and cropping afterwards in another application
 * is the step that stops people bothering.
 *
 * The arithmetic lives here because it is the part that goes wrong invisibly.
 * A region is selected over a still image of the page, but a recording is a
 * stream of the whole window at a different size and a different pixel ratio,
 * so the same rectangle has to be expressed three times: in the still's
 * pixels, as a fraction of the page, and in the stream's pixels. Getting the
 * middle step wrong produces a video that is cropped to almost the right
 * place, which is far harder to notice than one that is obviously broken.
 *
 * Fractions are the pivot on purpose. They survive a window resize, a display
 * with a different scale factor, and the difference between what capturePage
 * returns and what getUserMedia hands back.
 */

export interface Rect { x: number; y: number; width: number; height: number }

/** A region as a share of its page: every value 0..1. */
export interface FractionRect { x: number; y: number; width: number; height: number }

/**
 * The rectangle between two drag points, in any direction.
 *
 * Dragging up-and-left is as natural as down-and-right and produces negative
 * width if taken literally, which reads downstream as an empty selection.
 */
export function rectFromPoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
}

/** Keep a rectangle inside its container, trimming rather than shifting it. */
export function clampRect(rect: Rect, width: number, height: number): Rect {
  const x = Math.max(0, Math.min(rect.x, width))
  const y = Math.max(0, Math.min(rect.y, height))
  return {
    x,
    y,
    width: Math.max(0, Math.min(rect.width, width - x)),
    height: Math.max(0, Math.min(rect.height, height - y)),
  }
}

/**
 * Whether a drag was a selection or a slip of the hand.
 *
 * A click with a pixel of travel is a click. Without this the user gets a 3×2
 * screenshot and no explanation of what they did wrong.
 */
export const MIN_REGION_PX = 12

export function isUsableRegion(rect: Rect, min = MIN_REGION_PX): boolean {
  return rect.width >= min && rect.height >= min
}

/** A pixel rectangle expressed as a share of the image it was drawn on. */
export function toFraction(rect: Rect, imageWidth: number, imageHeight: number): FractionRect {
  if (imageWidth <= 0 || imageHeight <= 0) return { x: 0, y: 0, width: 1, height: 1 }
  const safe = clampRect(rect, imageWidth, imageHeight)
  return {
    x: safe.x / imageWidth,
    y: safe.y / imageHeight,
    width: safe.width / imageWidth,
    height: safe.height / imageHeight,
  }
}

/**
 * Back to whole pixels, for a canvas crop.
 *
 * Rounded outward: a half-pixel rounded in would shave the edge the user
 * deliberately included, and a screenshot missing the last row of a table is
 * worse than one with a stray pixel of background.
 */
export function toPixels(fraction: FractionRect, width: number, height: number): Rect {
  const x = Math.floor(fraction.x * width)
  const y = Math.floor(fraction.y * height)
  const right = Math.ceil((fraction.x + fraction.width) * width)
  const bottom = Math.ceil((fraction.y + fraction.height) * height)
  return clampRect({ x, y, width: right - x, height: bottom - y }, width, height)
}

/**
 * Where a page-relative region falls inside a recording of the whole window.
 *
 * The stream is the window, the selection was made on the page, and the page
 * occupies `view` within the window's `content` area. Everything is converted
 * through fractions of the window so the stream's own resolution — which is
 * neither the window's CSS size nor a round multiple of it — never has to be
 * assumed.
 *
 * Returns null when the geometry cannot be trusted, so a caller records the
 * whole window rather than a confidently wrong rectangle.
 */
export function regionInStream(
  fraction: FractionRect,
  view: Rect,
  content: { width: number; height: number },
  stream: { width: number; height: number },
): Rect | null {
  if (!view || view.width <= 0 || view.height <= 0) return null
  if (content.width <= 0 || content.height <= 0) return null
  if (stream.width <= 0 || stream.height <= 0) return null

  // The selection, in window coordinates.
  const inWindow: Rect = {
    x: view.x + fraction.x * view.width,
    y: view.y + fraction.y * view.height,
    width: fraction.width * view.width,
    height: fraction.height * view.height,
  }

  const scaleX = stream.width / content.width
  const scaleY = stream.height / content.height

  const scaled = clampRect({
    x: Math.round(inWindow.x * scaleX),
    y: Math.round(inWindow.y * scaleY),
    width: Math.round(inWindow.width * scaleX),
    height: Math.round(inWindow.height * scaleY),
  }, stream.width, stream.height)

  if (scaled.width < 2 || scaled.height < 2) return null
  return scaled
}

/**
 * Video dimensions have to be even.
 *
 * VP9 and H.264 both encode in macroblocks; an odd width produces a stream
 * some players show with a green edge and others refuse outright. Rounding
 * down by a pixel is invisible and always safe.
 */
export function toEvenSize(rect: Rect): Rect {
  return {
    ...rect,
    width: Math.max(2, rect.width - (rect.width % 2)),
    height: Math.max(2, rect.height - (rect.height % 2)),
  }
}

/** A label for the saved file, so a region shot is distinguishable at a glance. */
export function describeRegion(rect: Rect | null): string {
  if (!rect) return 'full'
  return `${Math.round(rect.width)}x${Math.round(rect.height)}`
}
