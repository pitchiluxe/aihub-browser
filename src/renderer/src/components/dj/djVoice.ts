/**
 * The DJ voice: short spoken drops between songs ("Up next, Essence by
 * Wizkid"), read by the system's own text-to-speech. The music is dipped while
 * the voice speaks. Off until the DJ turns it on.
 *
 * The voice goes to the speakers, not into the master bus, so it is not part of
 * a recorded mix.
 */
import type { DjEngine } from './engine/DjEngine'

const KEY = 'aihub-dj-voice'
type Listener = () => void
const listeners = new Set<Listener>()
let on = (() => { try { return localStorage.getItem(KEY) === 'on' } catch { return false } })()

export const voiceEnabled = (): boolean => on
export function setVoiceEnabled(v: boolean): void {
  on = v
  try { localStorage.setItem(KEY, v ? 'on' : 'off') } catch { /* optional */ }
  if (!v) window.speechSynthesis?.cancel()
  for (const l of listeners) l()
}
export function subscribeVoice(l: Listener): () => void { listeners.add(l); return () => { listeners.delete(l) } }

function pickVoice(): SpeechSynthesisVoice | undefined {
  const all = window.speechSynthesis?.getVoices() ?? []
  const lang = (navigator.language || 'en').slice(0, 2)
  return all.find(v => v.lang.startsWith(lang) && /natural|online|neural/i.test(v.name))
    ?? all.find(v => v.lang.startsWith(lang) && v.localService)
    ?? all.find(v => v.lang.startsWith(lang))
    ?? all[0]
}

/** Say `text` over the mix, dipping the music for as long as it takes. Does nothing when the voice is off. */
export function announce(engine: DjEngine, text: string): void {
  if (!on || !text || !window.speechSynthesis) return
  const synth = window.speechSynthesis
  synth.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.voice = pickVoice() ?? null
  u.rate = 1.05
  u.pitch = 0.9
  u.volume = 1
  const secs = Math.max(1.5, text.length * 0.075 + 0.6)
  u.onstart = () => engine.duck(0.35, secs)
  u.onend = () => engine.duck(1, 0)
  u.onerror = () => engine.duck(1, 0)
  synth.speak(u)
}
