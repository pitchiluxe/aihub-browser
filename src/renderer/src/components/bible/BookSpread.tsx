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
export default function BookSpread({ left, right, leaf, leafSide = 'right' }: Props) {
  return (
    <div className="relative mx-auto flex h-full w-full max-w-6xl overflow-hidden rounded-2xl shadow-2xl">
      <div className="relative w-1/2 bible-paper overflow-hidden p-10">
        {left}
        {leafSide === 'left' ? leaf : null}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-10 -translate-x-1/2 bible-gutter z-20" />
      <div className="relative w-1/2 bible-paper overflow-hidden p-10">
        {right}
        {leafSide === 'right' ? leaf : null}
      </div>
    </div>
  )
}
