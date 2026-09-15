import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  rectFromPoints, clampRect, isUsableRegion, toFraction,
  type Rect, type FractionRect,
} from '../../../../shared/captureRegion'

/**
 * Drag out the part of the page you actually want.
 *
 * The page lives in a BrowserView, which paints above every piece of host HTML
 * — so there is no way to draw a selection rectangle on top of the live page.
 * Instead the page is photographed first and the still is what you drag on.
 * That turns out to be the better behaviour anyway: the frame stops moving the
 * instant you start choosing, so a page that animates, autoplays or reflows
 * cannot change under the selection you are making.
 *
 * The same overlay serves both captures. For a screenshot the still IS the
 * source and the crop is exact; for a recording the still is only a ruler, and
 * the region it yields is mapped onto the live stream by shared/captureRegion.
 */
export default function CaptureOverlay({ image, mode, onSelect, onCancel }: {
  /** A data URL of the page as it looked when capture began. */
  image: string
  mode: 'screenshot' | 'recording'
  /** The chosen region, as a share of the page. */
  onSelect: (region: FractionRect, pixels: Rect) => void
  onCancel: () => void
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const pointIn = (e: React.MouseEvent) => {
    const box = imgRef.current?.getBoundingClientRect()
    if (!box) return { x: 0, y: 0 }
    return { x: e.clientX - box.left, y: e.clientY - box.top }
  }

  const finish = () => {
    const box = imgRef.current?.getBoundingClientRect()
    if (!rect || !box || !natural) { onCancel(); return }
    if (!isUsableRegion(rect)) { setStart(null); setRect(null); return }

    // The rectangle was drawn on the displayed image, which is scaled to fit;
    // the fraction is taken against the displayed size so the scaling cancels.
    const safe = clampRect(rect, box.width, box.height)
    const fraction = toFraction(safe, box.width, box.height)
    const pixels = {
      x: Math.round(fraction.x * natural.width),
      y: Math.round(fraction.y * natural.height),
      width: Math.round(fraction.width * natural.width),
      height: Math.round(fraction.height * natural.height),
    }
    onSelect(fraction, pixels)
  }

  const live = rect && isUsableRegion(rect)

  return createPortal(
    <div
      className="no-drag"
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(6,8,14,0.72)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        cursor: 'crosshair', userSelect: 'none',
      }}
      onMouseDown={e => { setStart(pointIn(e)); setRect(null) }}
      onMouseMove={e => { if (start) setRect(rectFromPoints(start, pointIn(e))) }}
      onMouseUp={finish}
    >
      <div style={{
        marginBottom: 12, padding: '7px 14px', borderRadius: 10,
        background: 'rgba(10,14,22,0.9)', border: '1px solid rgb(var(--ds-accent) / 0.35)',
        fontSize: 12, fontWeight: 600, color: 'rgb(var(--ds-text-2))',
        display: 'flex', alignItems: 'center', gap: 10, pointerEvents: 'none',
      }}>
        <span>
          Drag the area to {mode === 'screenshot' ? 'capture' : 'record'}
        </span>
        <span style={{ opacity: 0.55, fontWeight: 500 }}>Esc to cancel</span>
      </div>

      <div ref={frameRef} style={{ position: 'relative', maxWidth: '92vw', maxHeight: '82vh' }}>
        <img
          ref={imgRef}
          src={image}
          alt=""
          data-capture-still=""
          draggable={false}
          onLoad={e => setNatural({
            width: (e.target as HTMLImageElement).naturalWidth,
            height: (e.target as HTMLImageElement).naturalHeight,
          })}
          style={{
            display: 'block', maxWidth: '92vw', maxHeight: '82vh',
            borderRadius: 8, boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
            // Dimmed so the bright selection reads as the thing being chosen.
            filter: live ? 'brightness(0.45)' : 'brightness(0.7)',
            transition: 'filter 0.15s ease',
          }}
        />

        {/* The selection: the still at full brightness, showing through a
            window cut into the dimmed copy. */}
        {rect && (
          <>
            <div style={{
              position: 'absolute',
              left: rect.x, top: rect.y, width: rect.width, height: rect.height,
              overflow: 'hidden', pointerEvents: 'none',
              outline: '1px solid rgb(var(--ds-accent-soft))',
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.001), 0 0 22px rgb(var(--ds-accent) / 0.45)',
            }}>
              <img
                src={image}
                alt=""
                draggable={false}
                style={{
                  position: 'absolute', left: -rect.x, top: -rect.y,
                  width: imgRef.current?.clientWidth, height: imgRef.current?.clientHeight,
                  maxWidth: 'none', maxHeight: 'none',
                }}
              />
            </div>

            {live && (
              <div style={{
                position: 'absolute',
                left: rect.x, top: Math.max(0, rect.y - 24),
                padding: '2px 7px', borderRadius: 6, pointerEvents: 'none',
                background: 'rgb(var(--ds-accent))', color: '#fff',
                fontSize: 10.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
              }}>
                {Math.round(rect.width)} × {Math.round(rect.height)}
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
