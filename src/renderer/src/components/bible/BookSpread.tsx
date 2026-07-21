import React from 'react'

interface Props {
  left: React.ReactNode
  right: React.ReactNode
  leaf?: React.ReactNode          // the turning PageLeaf, when a turn is in flight
  leafSide?: 'left' | 'right'     // which half the turning sheet lifts off
}

// Two bound pages with a centre gutter. The turning leaf is layered over one
// half so it appears to lift off the book: forward turns lift the right-hand
// page, backward turns lift the left-hand one, exactly as a real volume does.
//
// The leaf is a sibling of the halves, not a child of one. `overflow: hidden`
// clips descendants to the ancestor's padding box even under a 3D transform,
// and past 90 degrees the sheet lies entirely on the far side of its hinge —
// outside the half it lifted off — so nesting it would clip the whole back
// half of the sweep. The halves therefore do not clip either; each page body
// carries its own `overflow-y-auto` scroller, and the outer wrapper still
// keeps content inside the rounded corners.
export default function BookSpread({ left, right, leaf, leafSide = 'right' }: Props) {
  return (
    <div className="relative mx-auto flex h-full w-full max-w-6xl overflow-hidden rounded-2xl shadow-2xl">
      <div className="relative w-1/2 bible-paper p-10">{left}</div>
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-10 -translate-x-1/2 bible-gutter z-20" />
      <div className="relative w-1/2 bible-paper p-10">{right}</div>
      {leaf ? (
        // Covers exactly the half the sheet lifts off, so the leaf's own hinge
        // (origin-left for forward, origin-right for backward) sits on the gutter.
        <div className={`pointer-events-none absolute inset-y-0 w-1/2 z-30 ${leafSide === 'left' ? 'left-0' : 'left-1/2'}`}>
          {leaf}
        </div>
      ) : null}
    </div>
  )
}
