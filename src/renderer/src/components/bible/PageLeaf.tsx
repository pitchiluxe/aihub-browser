import React from 'react'

interface Props {
  front: React.ReactNode          // the face of the leaf as it lies on the book
  back: React.ReactNode           // the face revealed as the leaf swings over
  direction: 'next' | 'prev'
  angle: number                   // 0 → 180 degrees, owned by the page
  animating: boolean              // true while easing to a resting angle
  durationMs: number
  paper?: 'aged' | 'clean'
}

// How far the free half of the sheet folds back at the peak of the turn. A real
// page bows as it lifts — the spine edge stays pinned while the free edge trails
// behind, creasing the paper. Keep it modest: enough to read as "folded," not so
// much that the text warps into unreadability.
const FOLD_PEAK_DEG = 26
// Where along the width the sheet creases (percent from the spine edge). The
// larger spine-side panel stays flat; the smaller free-side panel folds.
const CREASE_PCT = 62

// One turning sheet, rendered from an angle the page hands it.
//
// This is deliberately a dumb view: the page owns the gesture and drives this
// component through `angle`, so the sheet follows the finger from the first pixel.
//
// The sheet is NOT a flat card. Each face is built from two panels hinged at a
// crease — a fixed spine-side panel and a free-side panel that folds back — so
// the paper bends as it turns instead of pivoting like a rigid board. During a
// dragged turn every frame re-renders, so the fold and its shading are driven
// inline from `angle`. During a button/arrow turn the rotation animates purely
// in CSS with no per-frame render, so those same effects run as CSS keyframes
// (see globals.css) that peak at the halfway point.
export default function PageLeaf({ front, back, direction, angle, animating, durationMs, paper = 'aged' }: Props) {
  const paperClass = paper === 'clean' ? 'bible-paper bible-paper-clean' : 'bible-paper'
  const t = angle / 180
  const arc = Math.sin(t * Math.PI)          // 0 at rest, 1 upright at the halfway point

  const easing = 'cubic-bezier(0.32, 0.10, 0.22, 1)'
  const transition = animating ? `transform ${durationMs}ms ${easing}` : 'none'
  const foldAnim = animating ? `bible-page-fold ${durationMs}ms ${easing} both` : undefined
  const peakAnim = animating ? `bible-page-peak ${durationMs}ms ${easing} both` : undefined

  // Slight lean of the whole sheet out of plane (drag only; on button turns the
  // fold keyframe carries the bend).
  const curl = arc * (direction === 'next' ? -2.2 : 2.2)
  const cast = arc * 0.30                    // shadow the sheet throws on the page beneath

  // Light rakes from the spine: the gutter edge stays dark, the free edge catches
  // the light — reversed on the verso.
  const frontShade = direction === 'next'
    ? 'linear-gradient(to left, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.12) 45%, rgba(0,0,0,0) 78%)'
    : 'linear-gradient(to right, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.12) 45%, rgba(0,0,0,0) 78%)'
  const backShade = direction === 'next'
    ? 'linear-gradient(to right, rgba(0,0,0,0.50) 0%, rgba(0,0,0,0.10) 50%, rgba(0,0,0,0) 80%)'
    : 'linear-gradient(to left, rgba(0,0,0,0.50) 0%, rgba(0,0,0,0.10) 50%, rgba(0,0,0,0) 80%)'
  const sheenBand = direction === 'next'
    ? 'linear-gradient(100deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.6) 50%, rgba(255,255,255,0) 70%)'
    : 'linear-gradient(260deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.6) 50%, rgba(255,255,255,0) 70%)'

  // A shading overlay: keyframe-driven (peaks mid-turn) on button turns, inline
  // (from the live arc) while dragging.
  const shadeLayer = (bg: string, peak: number, blend?: 'soft-light'): React.CSSProperties =>
    animating
      ? { background: bg, animation: peakAnim, ...( { ['--peak' as any]: peak } ), ...(blend ? { mixBlendMode: blend } : {}) }
      : { background: bg, opacity: arc * peak, ...(blend ? { mixBlendMode: blend } : {}) }

  // Build one face from a fixed spine panel + a folding free-edge panel. The
  // content is drawn full-size in both panels (identical position), and each
  // panel simply clips to its half, so the text stays continuous across the
  // crease while only the free half tilts away.
  const face = (content: React.ReactNode, isBack: boolean) => {
    // On the back face the whole thing is mirrored (rotateY 180), so the free
    // edge sits on the opposite side in local coordinates.
    const freeRight = direction === 'next' ? !isBack : isBack
    const crease = freeRight ? CREASE_PCT : 100 - CREASE_PCT
    // clip-path insets: (top right bottom left)
    const fixedClip = freeRight ? `inset(0 ${100 - crease}% 0 0)` : `inset(0 0 0 ${crease}%)`
    const foldClip = freeRight ? `inset(0 0 0 ${crease}%)` : `inset(0 ${100 - crease}% 0 0)`
    const foldMax = `${freeRight ? -FOLD_PEAK_DEG : FOLD_PEAK_DEG}deg`

    const foldPanelStyle: React.CSSProperties = animating
      ? { clipPath: foldClip, transformOrigin: `${crease}% 50%`, transformStyle: 'preserve-3d', backfaceVisibility: 'hidden', animation: foldAnim, ...( { ['--fold-max' as any]: foldMax } ) }
      : { clipPath: foldClip, transformOrigin: `${crease}% 50%`, transformStyle: 'preserve-3d', backfaceVisibility: 'hidden', transform: `rotateY(${arc * (freeRight ? -FOLD_PEAK_DEG : FOLD_PEAK_DEG)}deg)` }

    return (
      <div
        className="absolute inset-0"
        style={{
          backfaceVisibility: 'hidden',
          transformStyle: 'preserve-3d',
          transform: isBack ? 'rotateY(180deg)' : undefined,
          boxShadow: '0 12px 34px rgba(0,0,0,0.28)',
        }}
      >
        {/* Fixed spine-side panel */}
        <div className={`absolute inset-0 ${paperClass} overflow-hidden`} style={{ clipPath: fixedClip, backfaceVisibility: 'hidden' }}>
          <div className="absolute inset-0 p-10">{content}</div>
        </div>
        {/* Folding free-edge panel */}
        <div className={`absolute inset-0 ${paperClass} overflow-hidden`} style={foldPanelStyle}>
          <div className="absolute inset-0 p-10">{content}</div>
        </div>
        {/* Crease shadow — a soft dark seam where the paper bends */}
        <div
          className="pointer-events-none absolute inset-y-0"
          style={{
            left: `calc(${crease}% - 14px)`, width: 28,
            background: 'linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,0.22) 50%, rgba(0,0,0,0) 100%)',
            ...shadeLayer('linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,0.22) 50%, rgba(0,0,0,0) 100%)', 0.9),
          }}
        />
        {/* Rake shading + specular sheen across the whole face */}
        <div className="pointer-events-none absolute inset-0" style={shadeLayer(isBack ? backShade : frontShade, isBack ? 0.5 : 0.6)} />
        <div className="pointer-events-none absolute inset-0" style={shadeLayer(sheenBand, isBack ? 0.42 : 0.5, 'soft-light')} />
      </div>
    )
  }

  // The leaf is purely a picture of the turn — the page drives it, so it must
  // never swallow clicks meant for the text underneath.
  return (
    <div className="pointer-events-none absolute inset-0 z-30" style={{ perspective: 1800 }}>
      {/* Shadow the rising sheet throws onto the page beneath it. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: direction === 'next'
            ? 'linear-gradient(to right, rgba(0,0,0,0.5), rgba(0,0,0,0) 62%)'
            : 'linear-gradient(to left, rgba(0,0,0,0.5), rgba(0,0,0,0) 62%)',
          ...(animating
            ? { animation: peakAnim, ...( { ['--peak' as any]: 0.6 } ) }
            : { opacity: cast }),
          willChange: 'opacity',
        }}
      />
      <div
        className={`absolute inset-0 ${direction === 'next' ? 'origin-left' : 'origin-right'}`}
        style={{
          transformStyle: 'preserve-3d',
          transform: `rotateY(${direction === 'next' ? -angle : angle}deg) rotateZ(${curl}deg)`,
          transition,
          willChange: 'transform',
        }}
      >
        {face(front, false)}
        {face(back, true)}
      </div>
    </div>
  )
}
