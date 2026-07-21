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

// One turning sheet, rendered from an angle the page hands it.
//
// This is deliberately a dumb view. An earlier version owned the gesture
// itself and bound its own pointer listeners in an effect — but an effect runs
// after React commits and paints, and a real drag is over in a couple of
// hundred milliseconds, so the whole gesture routinely finished before the
// listeners existed and the page simply never moved. The page now tracks the
// pointer it already captured on pointerdown and drives this component, so the
// sheet follows the finger from the very first pixel.
//
// Only `transform` and `opacity` animate, so the turn stays on the compositor.
export default function PageLeaf({ front, back, direction, angle, animating, durationMs, paper = 'aged' }: Props) {
  const paperClass = paper === 'clean' ? 'bible-paper bible-paper-clean' : 'bible-paper'
  const t = angle / 180
  // Deepest at the halfway point, where the sheet stands upright to the light.
  const shadow = Math.sin(t * Math.PI) * 0.45
  // Paper is not a flat card: it lifts most at the free edge and stays pinned
  // at the spine, so the sheet leans slightly out of plane as it swings. A few
  // degrees is all it takes to stop the turn reading as a rotating rectangle.
  const curl = Math.sin(t * Math.PI) * (direction === 'next' ? -2.6 : 2.6)
  // The turning sheet drops a shadow onto the page underneath, sweeping across
  // it as the leaf rises and fading out as the leaf lands.
  const cast = Math.sin(t * Math.PI) * 0.30
  const easing = 'cubic-bezier(0.32, 0.10, 0.22, 1)'
  const transition = animating ? `transform ${durationMs}ms ${easing}` : 'none'
  const shadeTransition = animating ? `opacity ${durationMs}ms ${easing}` : 'none'
  // Light rakes from the spine, so the gutter edge stays darkest on the recto
  // and the free edge catches the light — reversed on the verso.
  const frontShade = direction === 'next'
    ? 'linear-gradient(to left, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.12) 45%, rgba(0,0,0,0) 78%)'
    : 'linear-gradient(to right, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.12) 45%, rgba(0,0,0,0) 78%)'
  const backShade = direction === 'next'
    ? 'linear-gradient(to right, rgba(0,0,0,0.50) 0%, rgba(0,0,0,0.10) 50%, rgba(0,0,0,0) 80%)'
    : 'linear-gradient(to left, rgba(0,0,0,0.50) 0%, rgba(0,0,0,0.10) 50%, rgba(0,0,0,0) 80%)'

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
          opacity: cast, transition: shadeTransition, willChange: 'opacity',
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
        <div
          className={`absolute inset-0 ${paperClass} overflow-hidden p-10`}
          style={{ backfaceVisibility: 'hidden', boxShadow: '0 12px 34px rgba(0,0,0,0.28)' }}
        >
          {front}
          {/* Opacity-only so the shading rides the compositor with the rotation. */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: frontShade, opacity: shadow * 1.15, transition: shadeTransition, willChange: 'opacity' }}
          />
        </div>
        <div
          className={`absolute inset-0 ${paperClass} overflow-hidden p-10`}
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', boxShadow: '0 12px 34px rgba(0,0,0,0.28)' }}
        >
          {back}
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: backShade, opacity: shadow * 1.0, transition: shadeTransition, willChange: 'opacity' }}
          />
        </div>
      </div>
    </div>
  )
}
