import React, { useEffect, useState } from 'react'

interface Props {
  onOpen: () => void            // fired once the cover has finished swinging open
  subtitle?: string             // e.g. "Continue — John 7"
}

const SWING_MS = 900

// The closed book you open to start reading.
//
// The cover is hinged on its spine and swings away from the reader, so opening
// it reads as opening a real volume rather than dismissing a splash screen.
// Everything is drawn in CSS — no image asset — so it stays crisp at any size
// and costs nothing to ship.
export default function BookCover({ onOpen, subtitle }: Props) {
  const [opening, setOpening] = useState(false)
  const [prefersReduced] = useState(() =>
    typeof window !== 'undefined'
      && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

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
      className="absolute inset-0 z-40 flex items-center justify-center"
      style={{ perspective: 2400, background: 'radial-gradient(circle at 50% 40%, rgba(0,0,0,0.35), rgba(0,0,0,0.65))' }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        aria-label="Open the Bible"
        className="relative cursor-pointer select-none"
        style={{
          width: 'min(340px, 34vw)',
          height: 'min(470px, 62vh)',
          transformStyle: 'preserve-3d',
          transformOrigin: 'left center',
          transform: opening && !prefersReduced ? 'rotateY(-118deg) translateZ(12px)' : 'rotateY(0deg)',
          opacity: opening && prefersReduced ? 0 : 1,
          transition: prefersReduced
            ? 'opacity 160ms linear'
            : `transform ${SWING_MS}ms cubic-bezier(0.53, 0.02, 0.24, 1)`,
          boxShadow: '0 30px 70px rgba(0,0,0,0.65), 0 4px 14px rgba(0,0,0,0.5)',
          borderRadius: '6px 12px 12px 6px',
          background: leather,
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
              letterSpacing: '0.20em', fontSize: 27, lineHeight: 1.25, textAlign: 'center',
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

        {/* Hint */}
        <div
          className="absolute inset-x-0 text-center"
          style={{
            bottom: -34, fontSize: 11.5, letterSpacing: '0.06em',
            color: 'rgba(255,255,255,0.66)',
            opacity: opening ? 0 : 1, transition: 'opacity 200ms linear',
          }}
        >
          {subtitle || 'Click to open'}
        </div>
      </div>
    </div>
  )
}
