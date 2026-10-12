/** CPU-backed 2D canvases: the waveforms are rasterised with putImageData. */
export const CPU_CANVAS: CanvasRenderingContext2DSettings = { willReadFrequently: true }

/**
 * Start a frame on a canvas at its measured CSS size (see useCanvasBox); null
 * while it has none. A canvas that is not on screen (another tab in front, a
 * collapsed panel) was measured 0×0 by its ResizeObserver, so it is skipped
 * without reading layout: the old per-frame `offsetParent` check forced a
 * synchronous layout of the whole browser UI for every canvas, every frame
 * (1.8 s of a 60 s DJ profile on 2026-10-12).
 */
export function canvasFrame(cv: HTMLCanvasElement | null, box: { w: number; h: number; k: number }, settings: CanvasRenderingContext2DSettings = CPU_CANVAS) {
  if (!cv || !box.w || !box.h) return null
  const ctx = cv.getContext('2d', settings) as CanvasRenderingContext2D | null
  if (!ctx) return null
  ctx.setTransform(box.k, 0, 0, box.k, 0, 0)
  return { ctx, w: box.w, h: box.h }
}
