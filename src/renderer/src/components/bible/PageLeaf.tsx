import React from 'react'

interface Props {
  front: React.ReactNode          // the face of the leaf as it lies on the book
  back: React.ReactNode           // the face revealed as the leaf swings over
  direction: 'next' | 'prev'
  angle: number                   // 0 → 180 degrees, owned by the page
  animating: boolean              // true while easing to a resting angle
  durationMs: number
  paper?: 'aged' | 'clean' | 'linen' | 'midnight'
}

// One turning sheet, rendered from an angle the page hands it.
//
// This is deliberately a dumb view: the page owns the gesture and drives this
// component through `angle`, so the sheet follows the finger from the first pixel.
//
// The sheet stays a single, continuous page — no split panels, no duplicated
// text. The sense of a page bending comes entirely from LIGHT: the free edge
// darkens and curls into shadow as the sheet lifts, a soft sheen crosses it at
// the halfway point, and the whole leaf leans slightly out of plane. Faking the
// bend with real geometry (a hard crease down the middle) looked artificial;
// shading a flat sheet reads as paper without any seam.
//
// A dragged turn re-renders every frame, so the shading is driven inline from
// `angle`. A button/arrow turn animates purely in CSS with no per-frame render,
// so the same effects run as a CSS keyframe (globals.css) that peaks halfway.
export default function PageLeaf({ front, back, direction, angle, animating, durationMs, paper = 'aged' }: Props) {
  const paperClass = paper === 'aged' ? 'bible-paper' : `bible-paper bible-paper-${paper}`
  const t = angle / 180
  const arc = Math.sin(t * Math.PI)          // 0 at rest, 1 upright at the halfway point

  const easing = 'cubic-bezier(0.32, 0.10, 0.22, 1)'
  const peakAnim = animating ? `bible-page-peak-early ${durationMs}ms ${easing} both` : undefined

  // A turn driven by a button runs as a keyframe rather than a transition, so
  // the rotation can overshoot its resting angle by a couple of degrees and
  // settle back — the small flop a real sheet makes as it lands. An easing
  // curve cannot do that without dragging the shading overshoot along with it.
  const signed = direction === 'next' ? -angle : angle
  const settleAnim = animating
    ? `bible-page-settle ${durationMs}ms ${easing} both`
    : undefined

  // The whole sheet leans out of plane as it swings — pinned at the spine,
  // lifting at the free edge — so it never reads as a rigid board. Steeper
  // than a token tilt: at 6 degrees the lean is visible without the sheet
  // looking bent in half.
  const curl = arc * (direction === 'next' ? -6 : 6)
  // A bowed sheet is fractionally narrower on screen than a flat one held at
  // the same angle. Small, but it is most of what separates paper from card.
  const bow = 1 - arc * 0.03
  // And it comes off the book as it rises, rather than pivoting flush against
  // the page beneath it.
  const lift = arc * 26
  const cast = arc * 0.38                    // shadow the sheet throws on the page beneath

  // Light rakes from the spine: the gutter edge stays dark, the mid-page catches
  // the light (reversed on the verso).
  const frontShade = direction === 'next'
    ? 'linear-gradient(to left, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.1) 42%, rgba(0,0,0,0) 72%)'
    : 'linear-gradient(to right, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.1) 42%, rgba(0,0,0,0) 72%)'
  const backShade = direction === 'next'
    ? 'linear-gradient(to right, rgba(0,0,0,0.46) 0%, rgba(0,0,0,0.08) 48%, rgba(0,0,0,0) 78%)'
    : 'linear-gradient(to left, rgba(0,0,0,0.46) 0%, rgba(0,0,0,0.08) 48%, rgba(0,0,0,0) 78%)'
  // The free edge curls into shadow — a soft dark band hugging the outer edge
  // that deepens as the sheet stands up. This is what makes the flat page read
  // as gently bent rather than a rotating card.
  const curlDarkRight = 'linear-gradient(to right, rgba(0,0,0,0) 60%, rgba(0,0,0,0.22) 86%, rgba(0,0,0,0.34) 100%)'
  const curlDarkLeft = 'linear-gradient(to left, rgba(0,0,0,0) 60%, rgba(0,0,0,0.22) 86%, rgba(0,0,0,0.34) 100%)'
  const sheenBand = direction === 'next'
    ? 'linear-gradient(100deg, rgba(255,255,255,0) 32%, rgba(255,255,255,0.5) 50%, rgba(255,255,255,0) 68%)'
    : 'linear-gradient(260deg, rgba(255,255,255,0) 32%, rgba(255,255,255,0.5) 50%, rgba(255,255,255,0) 68%)'

  // A shading overlay: keyframe-driven (peaks mid-turn) on button turns, inline
  // (from the live arc) while dragging.
  const shadeLayer = (bg: string, peak: number, blend?: 'soft-light'): React.CSSProperties =>
    animating
      ? { background: bg, animation: peakAnim, ...( { ['--peak' as any]: peak } ), ...(blend ? { mixBlendMode: blend } : {}) }
      : { background: bg, opacity: arc * peak, ...(blend ? { mixBlendMode: blend } : {}) }

  const face = (content: React.ReactNode, isBack: boolean) => {
    // The free (outer) edge is on the right for a forward turn — mirrored on the
    // verso, which is itself flipped by rotateY(180).
    const freeRight = direction === 'next' ? !isBack : isBack
    return (
      <div
        className={`absolute inset-0 ${paperClass} overflow-hidden p-10`}
        style={{
          backfaceVisibility: 'hidden',
          transform: isBack ? 'rotateY(180deg)' : undefined,
          boxShadow: '0 14px 40px rgba(0,0,0,0.30)',
        }}
      >
        {content}
        {/* Rake shading from the spine */}
        <div className="pointer-events-none absolute inset-0" style={shadeLayer(isBack ? backShade : frontShade, isBack ? 0.42 : 0.5)} />
        {/* Free-edge curl shadow */}
        <div className="pointer-events-none absolute inset-0" style={shadeLayer(freeRight ? curlDarkRight : curlDarkLeft, 0.9)} />
        {/* Specular sheen sweeping across the standing sheet */}
        <div className="pointer-events-none absolute inset-0" style={shadeLayer(sheenBand, isBack ? 0.42 : 0.5, 'soft-light')} />
        {/* The thickness of the sheet itself. A page caught side-on catches
            the light along its cut edge, and that hairline is a surprisingly
            large part of reading the leaf as a physical object rather than a
            texture. It only shows while the sheet is off the page. */}
        <div
          className="pointer-events-none absolute inset-y-0"
          style={{
            ...shadeLayer(
              freeRight
                ? 'linear-gradient(to right, rgba(255,250,235,0) 0%, rgba(255,250,235,0.85) 100%)'
                : 'linear-gradient(to left,  rgba(255,250,235,0) 0%, rgba(255,250,235,0.85) 100%)',
              0.8,
            ),
            [freeRight ? 'right' : 'left']: 0,
            width: 2,
          } as React.CSSProperties}
        />
      </div>
    )
  }

  // The leaf is purely a picture of the turn — the page drives it, so it must
  // never swallow clicks meant for the text underneath.
  return (
    <div
      className="pointer-events-none absolute inset-0 z-30"
      style={{
        // Closer than it was, and looking from the spine rather than from
        // dead centre. A distant, centred perspective flattens the turn into
        // something that reads as a slide.
        perspective: 1400,
        perspectiveOrigin: direction === 'next' ? '0% 50%' : '100% 50%',
      }}
    >
      {/* Shadow the rising sheet throws onto the page beneath it. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: direction === 'next'
            ? 'linear-gradient(to right, rgba(0,0,0,0.5), rgba(0,0,0,0) 62%)'
            : 'linear-gradient(to left, rgba(0,0,0,0.5), rgba(0,0,0,0) 62%)',
          ...(animating
            ? { animation: peakAnim, ...( { ['--peak' as any]: 0.62 } ) }
            : { opacity: cast }),
          willChange: 'opacity',
        }}
      />
      {/* Two nested transforms rather than one. The inner element owns the
          rotation, so the settle keyframe can overshoot it alone; the outer
          owns the lean and the lift, which must not bounce with it. */}
      <div
        className={`absolute inset-0 ${direction === 'next' ? 'origin-left' : 'origin-right'}`}
        style={{
          transformStyle: 'preserve-3d',
          transform: `rotateZ(${curl}deg) translateZ(${lift}px)`,
          transition: animating ? `transform ${durationMs}ms ${easing}` : 'none',
          willChange: 'transform',
        }}
      >
      <div
        className={`absolute inset-0 ${direction === 'next' ? 'origin-left' : 'origin-right'}`}
        style={{
          transformStyle: 'preserve-3d',
          ...(animating
            ? {
                animation: settleAnim,
                ...({ ['--from' as any]: '0deg', ['--to' as any]: `${signed}deg` }),
              }
            : { transform: `rotateY(${signed}deg) scaleX(${bow})` }),
          willChange: 'transform',
        }}
      >
        {face(front, false)}
        {face(back, true)}
      </div>
      </div>
    </div>
  )
}
