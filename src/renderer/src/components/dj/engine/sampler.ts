/**
 * Sampler — club one-shots played straight into the master bus. Every sound is
 * synthesised, so there are no sample files to ship, license or load, and each
 * one is built fresh per hit so they stack the way a real sampler's do.
 */

export type HitId = 'horn' | 'siren' | 'laser' | 'riser' | 'impact' | 'clap' | 'rewind' | 'tom'

export const HITS: { id: HitId; label: string; key: string; title: string }[] = [
  { id: 'horn', label: 'HORN', key: 'Z', title: 'Air horn (Z)' },
  { id: 'siren', label: 'SIREN', key: 'X', title: 'Siren (X)' },
  { id: 'laser', label: 'LASER', key: 'C', title: 'Laser zap (C)' },
  { id: 'riser', label: 'RISE', key: 'V', title: 'Riser — builds for 4 seconds, then cuts (V)' },
  { id: 'impact', label: 'HIT', key: 'B', title: 'Sub impact (B)' },
  { id: 'clap', label: 'CLAP', key: 'N', title: 'Clap (N)' },
  { id: 'rewind', label: 'REW', key: 'G', title: 'Rewind whoosh (G)' },
  { id: 'tom', label: 'TOM', key: 'H', title: 'Tom fill (H)' },
]

export class Sampler {
  private noise: AudioBuffer
  private out: GainNode
  /** Sampler loudness, 0..1. */
  level = 0.8
  /** Pitch of every hit, in cents (the knob beside the pads). */
  cents = 0

  constructor(private ctx: AudioContext, destination: AudioNode) {
    this.out = ctx.createGain()
    this.out.gain.value = 0.6
    this.out.connect(destination)
    const len = ctx.sampleRate * 2
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    let seed = 22695477
    for (let i = 0; i < len; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; d[i] = seed / 2147483648 - 1 }
  }

  setLevel(v: number): void {
    this.level = Math.min(1, Math.max(0, v))
    this.out.gain.setTargetAtTime(0.75 * this.level, this.ctx.currentTime, 0.01)
  }

  setCents(c: number): void { this.cents = Math.max(-1200, Math.min(1200, c)) }

  hit(id: HitId): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    const t = this.ctx.currentTime + 0.005
    switch (id) {
      case 'horn': this.horn(t); break
      case 'siren': this.siren(t); break
      case 'laser': this.laser(t); break
      case 'riser': this.riser(t); break
      case 'impact': this.impact(t); break
      case 'clap': this.clap(t); break
      case 'rewind': this.rewind(t); break
      case 'tom': this.tom(t); break
    }
  }

  private env(t: number, attack: number, hold: number, release: number, peak: number): GainNode {
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + attack)
    g.gain.setValueAtTime(peak, t + attack + hold)
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release)
    g.connect(this.out)
    return g
  }

  private osc(type: OscillatorType, f: number, t: number, stop: number, to: AudioNode): OscillatorNode {
    const o = this.ctx.createOscillator()
    o.type = type
    o.detune.value = this.cents
    o.frequency.setValueAtTime(f, t)
    o.connect(to)
    o.start(t)
    o.stop(stop)
    return o
  }

  private noiseSrc(t: number, stop: number, to: AudioNode): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource()
    s.buffer = this.noise
    s.loop = true
    s.connect(to)
    s.start(t)
    s.stop(stop)
    return s
  }

  /** "pa-pa-paaaa": three blasts of a detuned sawtooth chord through a bandpass. */
  private horn(t: number): void {
    const bursts: [number, number][] = [[0, 0.16], [0.22, 0.16], [0.44, 0.95]]
    for (const [at, len] of bursts) {
      const g = this.env(t + at, 0.012, len, 0.1, 0.55)
      const bp = this.ctx.createBiquadFilter()
      bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.8
      bp.connect(g)
      for (const f of [392, 494, 587, 784]) {
        for (const detune of [-9, 9]) {
          const o = this.osc('sawtooth', f, t + at, t + at + len + 0.25, bp)
          o.detune.value = detune + this.cents
          // The pitch sags a little as the air runs out.
          o.frequency.setValueAtTime(f, t + at + len * 0.6)
          o.frequency.exponentialRampToValueAtTime(f * 0.97, t + at + len + 0.1)
        }
      }
    }
  }

  private siren(t: number): void {
    const dur = 2.4
    const g = this.env(t, 0.05, dur - 0.5, 0.45, 0.4)
    const o = this.osc('square', 700, t, t + dur + 0.1, g)
    const lfo = this.ctx.createOscillator()
    const depth = this.ctx.createGain()
    lfo.frequency.value = 1.4
    depth.gain.value = 380
    lfo.connect(depth).connect(o.frequency)
    lfo.start(t); lfo.stop(t + dur + 0.1)
    const lp = this.ctx.createBiquadFilter()
    lp.type = 'lowpass'; lp.frequency.value = 2600
    g.disconnect(); g.connect(lp).connect(this.out)
  }

  private laser(t: number): void {
    const g = this.env(t, 0.004, 0.05, 0.32, 0.5)
    const o = this.osc('sawtooth', 3200, t, t + 0.5, g)
    o.frequency.exponentialRampToValueAtTime(70, t + 0.34)
    const o2 = this.osc('square', 1600, t, t + 0.5, g)
    o2.frequency.exponentialRampToValueAtTime(35, t + 0.34)
  }

  /** White noise swept up through a bandpass while a sine climbs beneath it. */
  private riser(t: number): void {
    const dur = 4
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.6, t + dur)
    g.gain.setValueAtTime(0.0001, t + dur + 0.02)
    g.connect(this.out)
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'; bp.Q.value = 3
    bp.frequency.setValueAtTime(250, t)
    bp.frequency.exponentialRampToValueAtTime(9000, t + dur)
    bp.connect(g)
    this.noiseSrc(t, t + dur + 0.05, bp)
    const o = this.osc('sine', 110, t, t + dur + 0.05, g)
    o.frequency.exponentialRampToValueAtTime(1760, t + dur)
  }

  /** A sine dropping through the floor with a noise thump on top. */
  private impact(t: number): void {
    const g = this.env(t, 0.003, 0.05, 0.9, 0.95)
    const o = this.osc('sine', 150, t, t + 1.1, g)
    o.frequency.exponentialRampToValueAtTime(34, t + 0.5)
    const lp = this.ctx.createBiquadFilter()
    lp.type = 'lowpass'; lp.frequency.value = 900
    const ng = this.env(t, 0.002, 0.01, 0.18, 0.5)
    lp.connect(ng)
    this.noiseSrc(t, t + 0.3, lp)
  }

  /** Three quick noise bursts, then a longer tail — the classic clap. */
  private clap(t: number): void {
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.9
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    for (const at of [0, 0.012, 0.026]) {
      g.gain.setValueAtTime(0.0001, t + at)
      g.gain.exponentialRampToValueAtTime(0.8, t + at + 0.002)
      g.gain.exponentialRampToValueAtTime(0.05, t + at + 0.011)
    }
    g.gain.setValueAtTime(0.7, t + 0.04)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28)
    bp.connect(g).connect(this.out)
    this.noiseSrc(t, t + 0.3, bp)
  }

  /** A tape-style rewind: filtered noise sweeping down while a tone falls. */
  private rewind(t: number): void {
    const dur = 0.9
    const g = this.env(t, 0.01, 0.35, 0.5, 0.6)
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'; bp.Q.value = 2
    bp.frequency.setValueAtTime(7000, t)
    bp.frequency.exponentialRampToValueAtTime(300, t + dur)
    bp.connect(g)
    this.noiseSrc(t, t + dur + 0.1, bp)
    const o = this.osc('sawtooth', 1800, t, t + dur + 0.1, g)
    o.frequency.exponentialRampToValueAtTime(90, t + dur)
  }

  /** Three falling toms. */
  private tom(t: number): void {
    ;[[0, 220], [0.14, 170], [0.28, 120]].forEach(([at, f]) => {
      const g = this.env(t + at, 0.003, 0.02, 0.28, 0.8)
      const o = this.osc('sine', f * 1.6, t + at, t + at + 0.4, g)
      o.frequency.exponentialRampToValueAtTime(f, t + at + 0.12)
    })
  }
}
