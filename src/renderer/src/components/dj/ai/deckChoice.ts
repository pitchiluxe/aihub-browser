// Small deck decisions the AI DJ makes, kept pure so they can be pinned by tests.

type Side = 'A' | 'B'

/** The deck the audience is hearing: mid-blend, the side the crossfader favours. */
export function liveSide(playing: Record<Side, boolean>, crossfader: number): Side | null {
  if (playing.A && playing.B) return crossfader <= 0.5 ? 'A' : 'B'
  return playing.A ? 'A' : playing.B ? 'B' : null
}

export type LoadTarget = { deck: Side; moved?: true } | { mixin: true } | { busy: true }

/**
 * Where "load/play X on deck N" goes. A playing song is never cut off: "play"
 * mixes the request in; "load" uses the other deck when it is free.
 */
export function loadTarget(want: Side, play: boolean, busy: Record<Side, boolean>): LoadTarget {
  if (!busy[want]) return { deck: want }
  if (play) return { mixin: true }
  const other: Side = want === 'A' ? 'B' : 'A'
  return busy[other] ? { busy: true } : { deck: other, moved: true }
}
