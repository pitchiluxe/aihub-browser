import { useEffect, useRef } from 'react'
import { playVoiceSound, rosterDelta } from './voiceSounds'

/**
 * Turn roster changes into sound.
 *
 * Kept apart from the dock so the dock stays a rendering component: this
 * watches a list and makes a noise, which is a side effect and does not
 * belong next to layout.
 *
 * Two rules do the work, and both exist because of how it sounds when they
 * are missing:
 *
 *   The first roster is silent. Walking into a room where four people are
 *   already talking must not fire four arrival chimes.
 *
 *   Leaving resets the memory. Otherwise rejoining a room compares against the
 *   roster from last time and announces everybody still in it as a fresh
 *   arrival.
 */
export function useVoiceSounds(opts: {
  live: boolean
  peerIds: string[]
  selfPeerId: string
}): void {
  const { live, peerIds, selfPeerId } = opts
  const previous = useRef<string[] | null>(null)

  // The roster as a single string, so the effect does not re-run on every
  // render merely because the array was rebuilt with the same contents.
  const key = peerIds.join('|')

  useEffect(() => {
    if (!live) {
      previous.current = null
      return
    }

    const next = key ? key.split('|') : []
    const { arrived, left } = rosterDelta(previous.current, next, selfPeerId)
    previous.current = next

    // One chime per event, not per person: three people arriving together
    // should sound like an arrival, not like a slot machine.
    if (arrived.length) playVoiceSound('join')
    if (left.length) playVoiceSound('leave')
  }, [live, key, selfPeerId])
}

/**
 * The click your own microphone makes.
 *
 * Separate from the roster because it is about you, and because it must not
 * fire on the first render — opening the dock while already muted is a state,
 * not an event.
 */
export function useMuteSound(muted: boolean, live: boolean): void {
  const previous = useRef<boolean | null>(null)

  useEffect(() => {
    if (!live) { previous.current = null; return }
    if (previous.current === null) { previous.current = muted; return }
    if (previous.current === muted) return

    previous.current = muted
    playVoiceSound(muted ? 'muted' : 'unmuted')
  }, [muted, live])
}
