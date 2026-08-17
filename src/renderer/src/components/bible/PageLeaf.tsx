import React from 'react'

interface Props {
  front: React.ReactNode          // the face of the leaf as it lies on the book
  back: React.ReactNode           // the face revealed as the sheet folds over
  direction: 'next' | 'prev'
  angle: number                   // 0 → 180 degrees, owned by the page
  animating: boolean              // true while easing to a resting angle
  durationMs: number
  paper?: 'aged' | 'clean' | 'linen' | 'midnight'
}

// One turning sheet, as a FOLD rather than a hinge — the Kindle page-curl
// model instead of the swinging-board model.
//
// The difference is where the crease is. A hinge rotates the whole sheet about
// the spine, so the page leaves the book as one rigid panel. A real reader —
// and Kindle's curl — creases the paper somewhere out in the middle of the
// page: the part beyond the crease flips over and lies back across the part
// before it, the crease travels toward the spine as the turn progresses, and
// the page underneath is revealed in the widening gap.
//
// That is what this draws, in two layers:
//
//   • the FRONT, clipped to the part of the sheet that has not folded yet;
//   • the FLAP, which is the back of the sheet, mirrored about the crease so
//     it lands exactly where the folded paper would be.
//
// The double mirror is the fiddly part and is worth spelling out. The flap
// wrapper is mirrored about the crease (that is the fold itself). Its child is
// mirrored again about its own centre, which pre-flips the text so that after
// the fold it reads the right way round — the same trick the old 3D version
// got for free from `rotateY(180deg)` on its backface. The net effect is that
// the back's left-hand portion appears, readable, lying across the front.
//
// Everything is CSS: two clip-paths, two transforms and some gradients. No
// per-frame JavaScript, so a dragged turn and a button turn use the same code
// path — the drag drives `angle` directly, and a button turn transitions the
// same properties.
export default function PageLeaf({ front, back, direction, angle, animating, durationMs, paper = 'aged' }: Props) {
  const paperClass = paper === 'aged' ? 'bible-paper' : `bible-paper bible-paper-${paper}`

  const t = Math.max(0, Math.min(1, angle / 180))
  const forward = direction === 'next'

  // Where the crease is, as a percentage across this half of the spread.
  // Forward turns crease at the outer (right) edge and travel to the gutter;
  // backward turns do the reverse.
  const crease = forward ? (1 - t) * 100 : t * 100

  // How far through the fold we are, peaking mid-turn. Used for the shading:
  // a sheet is at its most lifted, and throws its darkest shadow, halfway.
  const arc = Math.sin(t * Math.PI)

  const easing = 'cubic-bezier(0.25, 0.55, 0.25, 1)'
  const move = animating
    ? `clip-path ${durationMs}ms ${easing}, transform ${durationMs}ms ${easing}, opacity ${durationMs}ms ${easing}`
    : 'none'

  // The un-folded part of the front: everything on the spine side of the crease.
  const frontClip = forward
    ? `inset(0 ${100 - crease}% 0 0)`
    : `inset(0 0 0 ${crease}%)`

  // The folded part, taken from the back of the sheet. Clipped in the sheet's
  // own coordinates, then mirrored about the crease by the transform below.
  const flapClip = forward
    ? `inset(0 0 0 ${crease}%)`
    : `inset(0 ${100 - crease}% 0 0)`

  // A soft band of shadow hugging the crease on the page that is still flat —
  // the folded paper is standing over it.
  const creaseShadowOnFront = forward
    ? 'linear-gradient(to right, rgba(0,0,0,0) 55%, rgba(0,0,0,0.30) 92%, rgba(0,0,0,0.44) 100%)'
    : 'linear-gradient(to left,  rgba(0,0,0,0) 55%, rgba(0,0,0,0.30) 92%, rgba(0,0,0,0.44) 100%)'

  // The flap is lit from the crease outward: bright where the paper rolls over
  // and catches the light, falling into shade at its free edge.
  const flapShade = forward
    ? 'linear-gradient(to left, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.04) 14%, rgba(0,0,0,0.10) 55%, rgba(0,0,0,0.30) 100%)'
    : 'linear-gradient(to right, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.04) 14%, rgba(0,0,0,0.10) 55%, rgba(0,0,0,0.30) 100%)'

  return (
    // The leaf never swallows clicks meant for the text underneath it.
    <div className="pointer-events-none absolute inset-0 z-30">

      {/* The part of the sheet still lying flat on the book. */}
      <div
        className={`absolute inset-0 ${paperClass} overflow-hidden p-10`}
        style={{ clipPath: frontClip, transition: move, willChange: 'clip-path' }}
      >
        {front}
        <div className="pointer-events-none absolute inset-0"
          style={{ background: creaseShadowOnFront, opacity: arc, transition: move }} />
      </div>

      {/* The folded part, lying back across the page. */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{
          clipPath: flapClip,
          transformOrigin: `${crease}% 50%`,
          transform: 'scaleX(-1)',
          transition: move,
          willChange: 'clip-path, transform',
          // The paper has thickness and is off the page, so it casts.
          filter: `drop-shadow(${forward ? '-' : ''}10px 6px 14px rgba(0,0,0,${0.20 + arc * 0.22}))`,
        }}
      >
        {/* Mirrored again, so the text on the back reads the right way round
            once the fold has flipped it. */}
        <div className={`absolute inset-0 ${paperClass} overflow-hidden p-10`} style={{ transform: 'scaleX(-1)' }}>
          {back}
        </div>
        {/* Shading sits OUTSIDE the counter-mirror, so its bright edge stays
            pinned to the crease rather than travelling with the text. */}
        <div className="pointer-events-none absolute inset-0" style={{ background: flapShade }} />
      </div>
    </div>
  )
}
