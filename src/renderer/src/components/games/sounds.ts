// Game room sound effects, synthesized with Web Audio: nothing is downloaded
// and nothing is recorded. One shared context, created on the first sound.
export type GameSound = 'dice' | 'step' | 'coin' | 'pay' | 'card' | 'knock' | 'capture' | 'win' | 'lose' | 'click' | 'error' | 'clack' | 'pocket' | 'tile' | 'clear' | 'bite' | 'buzz' | 'launch' | 'burst' | 'snap'
const MUTE_KEY = 'aihub-game-room-muted-v1'
let context: AudioContext | null = null, master: GainNode | null = null
let muted = (() => { try { return localStorage.getItem(MUTE_KEY) === '1' } catch { return false } })()
const listeners = new Set<(muted: boolean) => void>()
export const isMuted = () => muted
export function setMuted(value: boolean) {
  muted = value
  try { localStorage.setItem(MUTE_KEY, value ? '1' : '0') } catch { /* The setting lasts for this session. */ }
  listeners.forEach(listener => listener(value))
}
export function onMuteChange(listener: (muted: boolean) => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
function audio(): { ctx: AudioContext; out: GainNode } | null {
  if (muted) return null
  try {
    if (!context) { context = new AudioContext(); master = context.createGain(); master.gain.value = 0.35; master.connect(context.destination) }
    if (context.state === 'suspended') void context.resume()
    return { ctx: context, out: master! }
  } catch { return null }
}
function tone(frequency: number, start: number, length: number, type: OscillatorType = 'sine', volume = 0.5, slideTo?: number) {
  const a = audio(); if (!a) return
  const at = a.ctx.currentTime + start, osc = a.ctx.createOscillator(), gain = a.ctx.createGain()
  osc.type = type; osc.frequency.setValueAtTime(frequency, at)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + length)
  gain.gain.setValueAtTime(0.0001, at); gain.gain.exponentialRampToValueAtTime(volume, at + 0.008); gain.gain.exponentialRampToValueAtTime(0.0001, at + length)
  osc.connect(gain).connect(a.out); osc.start(at); osc.stop(at + length + 0.02)
}
function noise(start: number, length: number, volume = 0.4, filter = 2000, q = 1) {
  const a = audio(); if (!a) return
  const at = a.ctx.currentTime + start, samples = Math.max(1, Math.floor(a.ctx.sampleRate * length))
  const buffer = a.ctx.createBuffer(1, samples, a.ctx.sampleRate), data = buffer.getChannelData(0)
  for (let i = 0; i < samples; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / samples) ** 2
  const source = a.ctx.createBufferSource(), band = a.ctx.createBiquadFilter(), gain = a.ctx.createGain()
  source.buffer = buffer; band.type = 'bandpass'; band.frequency.value = filter; band.Q.value = q; gain.gain.value = volume
  source.connect(band).connect(gain).connect(a.out); source.start(at)
}
export function playSound(sound: GameSound) {
  if (muted) return
  switch (sound) {
    // Dice rattle in the hand, then bounce twice on the felt.
    case 'dice': for (let i = 0; i < 7; i++) noise(i * 0.06 + Math.random() * 0.02, 0.04, 0.5, 2600 + Math.random() * 1600, 3); noise(0.5, 0.06, 0.6, 1400, 2); noise(0.66, 0.05, 0.35, 1600, 2); break
    case 'step': tone(520 + Math.random() * 60, 0, 0.07, 'triangle', 0.25, 380); break
    case 'coin': tone(988, 0, 0.09, 'square', 0.18); tone(1319, 0.08, 0.28, 'square', 0.18); break
    case 'pay': tone(660, 0, 0.1, 'triangle', 0.3); tone(440, 0.09, 0.22, 'triangle', 0.3); break
    case 'card': noise(0, 0.09, 0.45, 5200, 0.8); break
    case 'knock': tone(180, 0, 0.09, 'sine', 0.7, 90); noise(0, 0.03, 0.35, 900, 2); break
    case 'capture': tone(300, 0, 0.12, 'sawtooth', 0.25, 120); noise(0.02, 0.08, 0.4, 700, 1.5); break
    case 'win': [523, 659, 784, 1047].forEach((frequency, i) => tone(frequency, i * 0.12, 0.35, 'triangle', 0.35)); tone(1319, 0.5, 0.6, 'sine', 0.25); break
    case 'lose': [392, 330, 262].forEach((frequency, i) => tone(frequency, i * 0.18, 0.4, 'triangle', 0.3)); break
    case 'click': tone(1200, 0, 0.03, 'square', 0.12); break
    case 'error': tone(160, 0, 0.18, 'square', 0.18); break
    case 'clack': tone(2200, 0, 0.04, 'sine', 0.5); noise(0, 0.025, 0.5, 3500, 4); break
    case 'pocket': tone(140, 0, 0.25, 'sine', 0.6, 70); noise(0.03, 0.2, 0.25, 500, 1); break
    case 'tile': tone(820, 0, 0.05, 'triangle', 0.3); noise(0, 0.03, 0.3, 4000, 3); break
    case 'clear': tone(523, 0, 0.12, 'square', 0.15, 1047); tone(784, 0.08, 0.2, 'square', 0.15, 1568); break
    case 'bite': tone(700, 0, 0.06, 'square', 0.18, 1100); break
    case 'buzz': tone(110, 0, 0.3, 'sawtooth', 0.2); break
    // Fireworks: a rising whistle, then a low thump with crackle trailing off.
    case 'launch': tone(500, 0, 0.5, 'sine', 0.08, 1700); noise(0, 0.45, 0.12, 3000, 0.7); break
    case 'burst': tone(90, 0, 0.35, 'sine', 0.7, 40); noise(0, 0.5, 0.5, 900, 0.6); for (let i = 0; i < 9; i++) noise(0.15 + Math.random() * 0.6, 0.02, 0.25, 5000 + Math.random() * 3000, 3); break
    // A magnet pulling a piece home: a short rising zip and a firm click.
    case 'snap': tone(380, 0, 0.09, 'sine', 0.25, 900); tone(1400, 0.08, 0.05, 'square', 0.14); noise(0.08, 0.03, 0.45, 2600, 3); break
  }
}
