import React from 'react'

interface Props {
  front: React.ReactNode          // the face of the leaf as it lies on the book
  back: React.ReactNode           // the face revealed as the leaf swings over
  direction: 'next' | 'prev'
  angle: number                   // 0 → 180 degrees, owned by the page
  animating: boolean              // true while easing to a resting angle
  durationMs: number
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
export default function PageLeaf({ front, back, direction, angle, animating, durationMs }: Props) {
  // Deepest at the halfway point, where the sheet stands upright to the light.
  const shadow = Math.sin((angle / 180) * Math.PI) * 0.45
  const easing = 'cubic-bezier(0.22, 0.61, 0.36, 1)'
  const transition = animating ? `transform ${durationMs}ms ${easing}` : 'none'
  const shadeTransition = animating ? `opacity ${durationMs}ms ${easing}` : 'none'

  // The leaf is purely a picture of the turn — the page drives it, so it must
  // never swallow clicks meant for the text underneath.
  return (
    <div className="pointer-events-none absolute inset-0 z-30" style={{ perspective: 2200 }}>
      <div
        className={`absolute inset-0 ${direction === 'next' ? 'origin-left' : 'origin-right'}`}
        style={{
          transformStyle: 'preserve-3d',
          transform: `rotateY(${direction === 'next' ? -angle : angle}deg)`,
          transition,
          willChange: 'transform',
        }}
      >
        <div className="absolute inset-0 bible-paper overflow-hidden p-10" style={{ backfaceVisibility: 'hidden' }}>
          {front}
          {/* Opacity-only so the shading rides the compositor with the rotation. */}
          <div
            className="pointer-events-none absolute inset-0 bg-black"
            style={{ opacity: shadow * 0.5, transition: shadeTransition, willChange: 'opacity' }}
          />
        </div>
        <div
          className="absolute inset-0 bible-paper overflow-hidden p-10"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        >
          {back}
          <div
            className="pointer-events-none absolute inset-0 bg-black"
            style={{ opacity: shadow * 0.35, transition: shadeTransition, willChange: 'opacity' }}
          />
        </div>
      </div>
    </div>
  )
}
