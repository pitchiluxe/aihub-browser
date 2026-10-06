/**
 * Deck effects. Each one is a small Web Audio sub-graph with an input and an
 * output and two controls, matching the STR (strength) and SPD (speed) knobs.
 *
 * `insert` effects (the filter) replace the dry signal; the others are mixed
 * on top of it, which is how a DJ effect unit behaves.
 */

export type FxType = 'flanger' | 'echo' | 'filter' | 'reverb' | 'phaser'

export const FX_LABELS: Record<FxType, string> = {
  flanger: 'Flanger', echo: 'Echo', filter: 'Filter', reverb: 'Reverb', phaser: 'Phaser',
}

export interface Effect {
  readonly input: AudioNode
  readonly output: AudioNode
  readonly insert: boolean
  /** 0..1 */
  setStrength(v: number): void
  /** 0..1 */
  setSpeed(v: number): void
  /** Beat length in seconds, for tempo-synced effects. */
  setBeat(sec: number): void
  dispose(): void
}

const SMOOTH = 0.03

function ramp(p: AudioParam, v: number, ctx: BaseAudioContext): void {
  p.setTargetAtTime(v, ctx.currentTime, SMOOTH)
}

class Flanger implements Effect {
  readonly insert = false
  readonly input: GainNode
  readonly output: GainNode
  private delay: DelayNode
  private fb: GainNode
  private lfo: OscillatorNode
  private depth: GainNode
  constructor(private ctx: AudioContext) {
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.delay = ctx.createDelay(0.05)
    this.delay.delayTime.value = 0.004
    this.fb = ctx.createGain()
    this.fb.gain.value = 0.55
    this.lfo = ctx.createOscillator()
    this.lfo.frequency.value = 0.25
    this.depth = ctx.createGain()
    this.depth.gain.value = 0.0028
    this.lfo.connect(this.depth).connect(this.delay.delayTime)
    this.input.connect(this.delay)
    this.delay.connect(this.fb).connect(this.delay)
    this.delay.connect(this.output)
    this.lfo.start()
  }
  setStrength(v: number) { ramp(this.output.gain, v, this.ctx); ramp(this.fb.gain, 0.3 + v * 0.5, this.ctx) }
  setSpeed(v: number) { ramp(this.lfo.frequency, 0.05 + v * v * 2.5, this.ctx) }
  setBeat() {}
  dispose() { this.lfo.stop(); this.input.disconnect(); this.delay.disconnect(); this.fb.disconnect(); this.output.disconnect() }
}

const ECHO_BEATS = [1 / 8, 1 / 4, 3 / 8, 1 / 2, 3 / 4, 1, 2]

class Echo implements Effect {
  readonly insert = false
  readonly input: GainNode
  readonly output: GainNode
  private delay: DelayNode
  private fb: GainNode
  private tone: BiquadFilterNode
  private beat = 0.5
  private fraction = 0.5
  constructor(private ctx: AudioContext) {
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.delay = ctx.createDelay(4)
    this.fb = ctx.createGain()
    this.tone = ctx.createBiquadFilter()
    this.tone.type = 'lowpass'
    this.tone.frequency.value = 5000
    this.input.connect(this.delay)
    this.delay.connect(this.tone).connect(this.fb).connect(this.delay)
    this.delay.connect(this.output)
    this.apply()
  }
  private apply() { ramp(this.delay.delayTime, Math.min(3.9, this.beat * this.fraction), this.ctx) }
  setStrength(v: number) { ramp(this.output.gain, v, this.ctx); ramp(this.fb.gain, 0.25 + v * 0.5, this.ctx) }
  setSpeed(v: number) {
    this.fraction = ECHO_BEATS[Math.min(ECHO_BEATS.length - 1, Math.floor(v * ECHO_BEATS.length))]
    this.apply()
  }
  setBeat(sec: number) { if (sec > 0) { this.beat = sec; this.apply() } }
  dispose() { this.input.disconnect(); this.delay.disconnect(); this.tone.disconnect(); this.fb.disconnect(); this.output.disconnect() }
}

class Filter implements Effect {
  readonly insert = true
  readonly input: BiquadFilterNode
  readonly output: BiquadFilterNode
  constructor(private ctx: AudioContext) {
    this.input = ctx.createBiquadFilter()
    this.output = this.input
    this.input.type = 'allpass'
  }
  /** 0 = low-pass closed, 0.5 = open, 1 = high-pass closed. */
  setStrength(v: number) {
    const f = this.input
    if (Math.abs(v - 0.5) < 0.03) { f.type = 'allpass'; return }
    if (v < 0.5) {
      f.type = 'lowpass'
      ramp(f.frequency, 60 * Math.pow(20000 / 60, v / 0.5), this.ctx)
    } else {
      f.type = 'highpass'
      ramp(f.frequency, 20 * Math.pow(9000 / 20, (v - 0.5) / 0.5), this.ctx)
    }
  }
  setSpeed(v: number) { ramp(this.input.Q, 0.7 + v * 14, this.ctx) }
  setBeat() {}
  dispose() { this.input.disconnect() }
}

function impulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds))
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6)
  }
  return buf
}

class Reverb implements Effect {
  readonly insert = false
  readonly input: GainNode
  readonly output: GainNode
  private conv: ConvolverNode
  private pending = 0
  private size = -1
  constructor(private ctx: AudioContext) {
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.conv = ctx.createConvolver()
    this.input.connect(this.conv).connect(this.output)
    this.setSpeed(0.4)
  }
  setStrength(v: number) { ramp(this.output.gain, v * 0.9, this.ctx) }
  /** Room size — rebuilding the impulse is not free, so debounce it. */
  setSpeed(v: number) {
    const secs = Math.round((0.6 + v * 4.4) * 10) / 10
    if (secs === this.size) return
    this.size = secs
    window.clearTimeout(this.pending)
    this.pending = window.setTimeout(() => { this.conv.buffer = impulse(this.ctx, secs) }, this.conv.buffer ? 120 : 0)
  }
  setBeat() {}
  dispose() { window.clearTimeout(this.pending); this.input.disconnect(); this.conv.disconnect(); this.output.disconnect() }
}

class Phaser implements Effect {
  readonly insert = false
  readonly input: GainNode
  readonly output: GainNode
  private stages: BiquadFilterNode[] = []
  private lfo: OscillatorNode
  private depth: GainNode
  private fb: GainNode
  constructor(private ctx: AudioContext) {
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.lfo = ctx.createOscillator()
    this.lfo.frequency.value = 0.4
    this.depth = ctx.createGain()
    this.depth.gain.value = 700
    this.fb = ctx.createGain()
    this.fb.gain.value = 0.4
    this.lfo.connect(this.depth)
    let prev: AudioNode = this.input
    for (let i = 0; i < 6; i++) {
      const ap = ctx.createBiquadFilter()
      ap.type = 'allpass'
      ap.frequency.value = 900 + i * 250
      ap.Q.value = 0.6
      this.depth.connect(ap.frequency)
      prev.connect(ap)
      prev = ap
      this.stages.push(ap)
    }
    prev.connect(this.fb).connect(this.stages[0])
    prev.connect(this.output)
    this.lfo.start()
  }
  setStrength(v: number) { ramp(this.output.gain, v, this.ctx); ramp(this.fb.gain, 0.2 + v * 0.5, this.ctx) }
  setSpeed(v: number) { ramp(this.lfo.frequency, 0.05 + v * v * 4, this.ctx) }
  setBeat() {}
  dispose() {
    this.lfo.stop()
    this.input.disconnect(); this.fb.disconnect(); this.output.disconnect(); this.depth.disconnect()
    for (const s of this.stages) s.disconnect()
  }
}

export function createEffect(ctx: AudioContext, type: FxType): Effect {
  switch (type) {
    case 'flanger': return new Flanger(ctx)
    case 'echo': return new Echo(ctx)
    case 'filter': return new Filter(ctx)
    case 'reverb': return new Reverb(ctx)
    case 'phaser': return new Phaser(ctx)
  }
}
