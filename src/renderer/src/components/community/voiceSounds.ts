/**
 * The small sounds a voice room makes.
 *
 * Synthesised rather than shipped. Two reasons, and neither is cleverness:
 * this is an offline-first browser, so a chime that needs a file to have
 * downloaded is a chime that fails on a plane; and four audio assets is
 * roughly a megabyte in the installer for about a second of sound in total.
 * A pair of oscillators costs nothing and cannot 404.
 *
 * ── Why these particular sounds ───────────────────────────────────────────
 *
 * A voice room needs you to know who arrived without looking at it, because
 * the entire point is that you are doing something else. So the vocabulary is
 * deliberately narrow and directional:
 *
 *   arriving   two notes rising     — someone came in
 *   leaving    two notes falling    — someone went out
 *   muted      one short low note   — you, and only you
 *   unmuted    one short high note  — you, and only you
 *
 * Rising and falling is the part that carries meaning: you can tell an
 * arrival from a departure across a room, with headphones off, without
 * learning anything. Pitch alone would need to be memorised.
 */

export type VoiceSound = 'join' | 'leave' | 'muted' | 'unmuted'

const STORAGE_KEY = 'aihub.community.voiceSounds'

/** Kept low. These play while somebody is talking, and a chime that competes
 *  with a voice is a chime people turn off. */
const GAIN = 0.055

interface Note { hz: number; at: number; ms: number }

/** Frequencies are a major sixth apart — consonant enough not to sound like an
 *  error tone, wide enough to read as movement rather than a wobble. */
const VOICES: Record<VoiceSound, Note[]> = {
  join:    [{ hz: 523.25, at: 0,    ms: 90 }, { hz: 880.0,  at: 0.075, ms: 130 }],
  leave:   [{ hz: 880.0,  at: 0,    ms: 90 }, { hz: 523.25, at: 0.075, ms: 150 }],
  muted:   [{ hz: 392.0,  at: 0,    ms: 70 }],
  unmuted: [{ hz: 659.25, at: 0,    ms: 70 }],
}

export function soundsEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    // A blocked or unavailable localStorage must not silence the room, and
    // must not throw on the way to not silencing it.
    return true
  }
}

export function setSoundsEnabled(on: boolean): void {
  try { window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off') } catch { /* not fatal */ }
}

/**
 * One AudioContext for the window.
 *
 * Created lazily: constructing one before any user gesture leaves it
 * suspended in Chromium, and a suspended context that nothing resumes is a
 * room that is silently mute. Joining a voice channel *is* a gesture, which
 * is the only place these are triggered from.
 */
let context: AudioContext | null = null

function audio(): AudioContext | null {
  try {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctor) return null
    if (!context) context = new Ctor()
    if (context.state === 'suspended') void context.resume()
    return context
  } catch {
    return null
  }
}

/**
 * Play one of the room's sounds.
 *
 * Every failure path is a silent no-op. A missing Web Audio implementation, a
 * context the browser refuses to resume, a device with no output — none of
 * them are worth an error in a chat window, and all of them are survivable by
 * simply not making a noise.
 */
export function playVoiceSound(sound: VoiceSound): void {
  if (!soundsEnabled()) return

  const ctx = audio()
  if (!ctx) return

  try {
    const now = ctx.currentTime
    for (const note of VOICES[sound]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      // A sine with a short ramp. A square or a hard start clicks, and a click
      // is what makes a notification sound feel cheap.
      osc.type = 'sine'
      osc.frequency.setValueAtTime(note.hz, now + note.at)

      const start = now + note.at
      const end = start + note.ms / 1000
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(GAIN, start + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, end)

      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(end + 0.02)
    }
  } catch { /* never let a chime take the room down */ }
}

/**
 * Which peers arrived and which left, between two rosters.
 *
 * Pulled out as a pure function because the interesting rule is not the audio
 * — it is that the FIRST roster must be silent. Joining a room with four
 * people in it should not fire four arrival chimes at once, which is exactly
 * what a naive diff against an empty array does.
 */
export function rosterDelta(
  previous: string[] | null,
  next: string[],
  selfId: string,
): { arrived: string[]; left: string[] } {
  if (previous === null) return { arrived: [], left: [] }

  const before = new Set(previous)
  const after = new Set(next)
  return {
    arrived: next.filter(id => id !== selfId && !before.has(id)),
    left: previous.filter(id => id !== selfId && !after.has(id)),
  }
}
