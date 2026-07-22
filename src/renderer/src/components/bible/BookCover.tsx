import React, { useEffect, useState } from 'react'

interface Props {
  onOpen: () => void            // fired once the cover has finished swinging open
  subtitle?: string             // e.g. "Continue — John 7"
}

// The closed cover occupies the same box as the open spread, so opening the
// book doesn't jump the reader's eye — the volume simply opens in place.
// Mirrors BookSpread's own `mx-auto h-full w-full max-w-6xl`; the cover is one
// board, so it is half that width and sits over the right-hand half.
const COVER_WRAP = 'relative mx-auto h-full w-full max-w-6xl'

const SWING_MS = 900

// The closed book you open to start reading.
//
// The cover is hinged on its spine and swings away from the reader, so opening
// it reads as opening a real volume rather than dismissing a splash screen.
// Everything is drawn in CSS — no image asset — so it stays crisp at any size
// and costs nothing to ship.
export default function BookCover({ onOpen, subtitle }: Props) {
  const [opening, setOpening] = useState(false)
  // The book settles onto the table on first paint rather than being there
  // already — a short entrance is what makes it read as a real object arriving
  // rather than a static splash. `entered` flips one frame after mount so the
  // CSS transition from the pre-entrance state actually runs.
  const [entered, setEntered] = useState(false)
  const [prefersReduced] = useState(() =>
    typeof window !== 'undefined'
      && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)))
    return () => cancelAnimationFrame(id)
  }, [])

  const open = () => {
    if (opening) return
    setOpening(true)
    window.setTimeout(onOpen, prefersReduced ? 0 : SWING_MS)
  }

  // The whole cover is one big button, so Enter and Space open it too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const leather = `
    radial-gradient(120% 90% at 30% 10%, rgba(255,255,255,0.10), transparent 60%),
    radial-gradient(100% 120% at 80% 100%, rgba(0,0,0,0.45), transparent 55%),
    linear-gradient(145deg, #5b1d1d 0%, #3f1212 45%, #2c0c0c 100%)
  `

  return (
    <div
      className="absolute inset-0 z-40 p-8"
      style={{ perspective: 2400, background: 'radial-gradient(circle at 50% 40%, rgba(0,0,0,0.30), rgba(0,0,0,0.62))' }}
    >
     <div className={COVER_WRAP}>
      {/* Cream page-block sitting under the cover, so swinging the board open
          reveals real pages rather than empty space — the illusion breaks
          without something printed beneath the lid. It brightens as the cover
          lifts off it. */}
      <div
        className="pointer-events-none absolute bottom-9 left-1/4 top-0 w-1/2"
        style={{
          borderRadius: '6px 12px 12px 6px',
          background: 'linear-gradient(105deg, #b9a888 0%, #efe6d0 10%, #fbf6e9 55%, #f1e8d3 100%)',
          boxShadow: 'inset 14px 0 22px rgba(0,0,0,0.22), 0 24px 50px rgba(0,0,0,0.45)',
          opacity: opening && !prefersReduced ? 1 : 0,
          transition: `opacity ${SWING_MS * 0.6}ms ease-out ${SWING_MS * 0.25}ms`,
        }}
      >
        {/* Fore-edge page striations, revealed as the lid rises */}
        <div className="absolute inset-y-3 right-1" style={{ width: 10,
          background: 'repeating-linear-gradient(180deg,#d8c9a4 0px,#efe4c6 1px,#c7b788 2px,#e2d4ab 3px)',
          borderRadius: '0 4px 4px 0' }} />
      </div>
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        aria-label="Open the Bible"
        // Centred rather than pinned to the right half: a closed book sits on
        // the table in the middle of the space it will open into, and the board
        // still hinges on its own left edge exactly where the spine will be.
        // `bottom-9` leaves a clear strip beneath the board for the hint, so
        // the caption never sits on top of the cover itself.
        className="absolute bottom-9 left-1/4 top-0 w-1/2 cursor-pointer select-none"
        style={{
          transformStyle: 'preserve-3d',
          // Hinge slightly behind the spine and above centre — a hardcover
          // pivots on its joint, not its dead centre, so the far edge dips as
          // it swings. This is what separates a book opening from a flat card
          // flipping.
          transformOrigin: 'left 42%',
          transform: prefersReduced
            ? 'none'
            : opening
              ? 'rotateY(-152deg) rotateX(3deg) translateZ(18px)'
              : entered
                ? 'rotateY(0deg)'
                // Pre-entrance: dropped slightly back and down, so it settles
                // onto the table.
                : 'rotateY(-6deg) rotateX(6deg) translateY(26px) scale(0.95)',
          opacity: prefersReduced ? (opening ? 0 : 1) : entered ? 1 : 0,
          transition: prefersReduced
            ? 'opacity 160ms linear'
            : opening
              ? `transform ${SWING_MS}ms cubic-bezier(0.45, 0.03, 0.24, 1), box-shadow ${SWING_MS}ms ease-out, filter ${SWING_MS}ms ease-out`
              : `transform 720ms cubic-bezier(0.22, 1, 0.36, 1), opacity 520ms ease-out`,
          // Shadow throws further and softer as the raised lid climbs.
          boxShadow: opening
            ? '38px 60px 120px rgba(0,0,0,0.72), 0 4px 14px rgba(0,0,0,0.5)'
            : '0 30px 70px rgba(0,0,0,0.65), 0 4px 14px rgba(0,0,0,0.5)',
          // Catch the light on the raised face mid-swing.
          filter: opening ? 'brightness(1.14)' : 'brightness(1)',
          borderRadius: '6px 12px 12px 6px',
          background: leather,
          backfaceVisibility: 'hidden',
        }}
      >
        {/* Gilt page block peeking out along the fore-edge */}
        <div
          className="pointer-events-none absolute"
          style={{
            top: 8, bottom: 8, right: -7, width: 8,
            borderRadius: '0 3px 3px 0',
            background: 'repeating-linear-gradient(180deg, #e8d8a8 0px, #f6ecc9 1px, #cbb479 2px, #e8d8a8 3px)',
            boxShadow: 'inset -2px 0 4px rgba(0,0,0,0.35)',
          }}
        />

        {/* Raised spine bands */}
        <div className="pointer-events-none absolute inset-y-0 left-0" style={{ width: 34 }}>
          <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(0,0,0,0.55), rgba(0,0,0,0.05))' }} />
          {[0.22, 0.42, 0.62, 0.82].map(t => (
            <div key={t} className="absolute left-0 right-0" style={{
              top: `${t * 100}%`, height: 7,
              background: 'linear-gradient(180deg, rgba(255,255,255,0.14), rgba(0,0,0,0.35))',
            }} />
          ))}
        </div>

        {/* Gold foil frame */}
        <div
          className="pointer-events-none absolute"
          style={{
            top: 20, bottom: 20, left: 48, right: 22,
            border: '1.5px solid rgba(214,182,106,0.55)',
            borderRadius: 4,
            boxShadow: 'inset 0 0 0 4px rgba(0,0,0,0.18), inset 0 0 22px rgba(0,0,0,0.30)',
          }}
        />

        {/* Title block */}
        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ paddingLeft: 26 }}>
          <div
            style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              letterSpacing: '0.20em', fontSize: 'clamp(26px, 4.4vh, 44px)', lineHeight: 1.25, textAlign: 'center',
              background: 'linear-gradient(180deg, #f4e3ad 0%, #d4af62 45%, #9d7a34 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              textShadow: '0 1px 0 rgba(0,0,0,0.4)',
            }}
          >
            HOLY<br />BIBLE
          </div>

          <div className="my-5" style={{
            width: 74, height: 1,
            background: 'linear-gradient(90deg, transparent, rgba(214,182,106,0.8), transparent)',
          }} />

          {/* Simple embossed cross */}
          <div className="relative" style={{ width: 26, height: 38, opacity: 0.85 }}>
            <div className="absolute" style={{
              left: 11, top: 0, width: 4, height: 38, borderRadius: 1,
              background: 'linear-gradient(180deg, #e6cf92, #9d7a34)',
            }} />
            <div className="absolute" style={{
              left: 2, top: 10, width: 22, height: 4, borderRadius: 1,
              background: 'linear-gradient(90deg, #9d7a34, #e6cf92, #9d7a34)',
            }} />
          </div>

          <div style={{
            marginTop: 26, fontSize: 9.5, letterSpacing: '0.30em',
            color: 'rgba(226,199,140,0.72)', fontFamily: 'Georgia, serif',
          }}>
            WORLD ENGLISH BIBLE
          </div>
        </div>

        {/* Ribbon marker */}
        <div className="pointer-events-none absolute" style={{
          right: 52, top: -4, width: 13, height: 96,
          background: 'linear-gradient(180deg, #8d1b2d, #6d1322)',
          boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
          clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 84%, 0 100%)',
        }} />

      </div>

      {/* Hint sits in the strip below the board, never over the cover art, and
          stays put while the cover swings away. */}
      <div
        className="pointer-events-none absolute inset-x-0 text-center"
        style={{
          bottom: 6, fontSize: 11.5, letterSpacing: '0.06em',
          color: 'rgba(255,255,255,0.72)',
          textShadow: '0 1px 3px rgba(0,0,0,0.6)',
          opacity: opening ? 0 : 1, transition: 'opacity 200ms linear',
        }}
      >
        {subtitle || 'Click to open'}
      </div>
     </div>
    </div>
  )
}
