/**
 * Sampler — club one-shots played straight into the master bus. Every sound is
 * synthesised, so there are no sample files to ship, license or load, and each
 * one is built fresh per hit so they stack the way a real sampler's do.
 *
 * Each hit is modelled on the real thing it imitates: an air horn's two
 * beating reeds, a police siren's wail through a horn speaker, a drum's
 * inharmonic membrane. Every sound also carries energy between 600 Hz and
 * 5 kHz: laptop and phone speakers play almost nothing below ~200 Hz, so a
 * hit that was only sub (the old impact and toms) sounded like nothing at all.
 */

export type HitId = 'horn' | 'siren' | 'laser' | 'riser' | 'impact' | 'clap' | 'rewind' | 'tom'

export const HITS: { id: HitId; label: string; key: string; title: string }[] = [
  { id: 'horn', label: 'HORN', key: 'Z', title: 'Air horn (Z)' },
  { id: 'siren', label: 'SIREN', key: 'X', title: 'Siren (X)' },
  { id: 'laser', label: 'LASER', key: 'C', title: 'Laser zap (C)' },
  { id: 'riser', label: 'RISE', key: 'V', title: 'Riser — builds for 4 seconds, then cuts (V)' },
  { id: 'impact', label: 'HIT', key: 'B', title: 'Impact boom (B)' },
  { id: 'clap', label: 'CLAP', key: 'N', title: 'Clap (N)' },
  { id: 'rewind', label: 'REW', key: 'G', title: 'Rewind spin-back (G)' },
  { id: 'tom', label: 'TOM', key: 'H', title: 'Tom fill (H)' },
]

/** Soft-clip curve: rounds peaks off and adds the harmonics small speakers can play. */
function driveCurve(amount: number): Float32Array {
  const n = 1024
  const c = new Float32Array(n)
  const k = Math.max(0.01, amount)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    c[i] = Math.tanh(k * x) / Math.tanh(k)
  }
  return c
}

export class Sampler {
  private noise: AudioBuffer
  private out: GainNode
  /** A short room every hit can send to, so claps and drums have air around them. */
  private room: GainNode
  /** Sampler loudness, 0..1. */
  level = 0.8
  /** Pitch of every hit, in cents (the knob beside the pads). */
  cents = 0

  constructor(private ctx: AudioContext | OfflineAudioContext, destination: AudioNode) {
    this.out = ctx.createGain()
    this.out.gain.value = 0.6
    this.out.connect(destination)
    const len = ctx.sampleRate * 2
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    let seed = 22695477
    for (let i = 0; i < len; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; d[i] = seed / 2147483648 - 1 }

    // Room: a 1.1 s decaying noise impulse — cheap, and it sounds like a real space.
    const verb = ctx.createConvolver()
    const irLen = Math.round(ctx.sampleRate * 1.1)
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const x = ir.getChannelData(ch)
      let s = 1234567 + ch * 7654321
      for (let i = 0; i < irLen; i++) {
        s = (s * 1664525 + 1013904223) >>> 0
        x[i] = (s / 2147483648 - 1) * Math.pow(1 - i / irLen, 3.2)
      }
    }
    verb.buffer = ir
    this.room = ctx.createGain()
    this.room.gain.value = 0.35
    this.room.connect(verb).connect(this.out)
  }

  setLevel(v: number): void {
    this.level = Math.min(1, Math.max(0, v))
    this.out.gain.setTargetAtTime(0.75 * this.level, this.ctx.currentTime, 0.01)
  }

  setCents(c: number): void { this.cents = Math.max(-1200, Math.min(1200, c)) }

  hit(id: HitId): void {
    // An offline render (tests, measurements) starts itself; only a live context needs waking.
    if (this.ctx.state === 'suspended' && !isOffline(this.ctx)) void (this.ctx as AudioContext).resume()
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

  // ── Building blocks ──────────────────────────────────────────────────────

  /** Attack / hold / release envelope into `to` (the sampler output by default). */
  private env(t: number, attack: number, hold: number, release: number, peak: number, to: AudioNode = this.out): GainNode {
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + attack)
    g.gain.setValueAtTime(peak, t + attack + hold)
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release)
    g.connect(to)
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
    // Start at a random point so stacked hits are not the identical noise.
    s.connect(to)
    s.start(t, Math.random() * 1.5)
    s.stop(stop)
    return s
  }

  private filter(type: BiquadFilterType, f: number, q = 0.7, gain = 0): BiquadFilterNode {
    const b = this.ctx.createBiquadFilter()
    b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = gain
    return b
  }

  private drive(amount: number): WaveShaperNode {
    const w = this.ctx.createWaveShaper()
    w.curve = driveCurve(amount) as Float32Array<ArrayBuffer>
    w.oversample = '2x'
    return w
  }

  /** Chain nodes left to right; returns the first so sources can connect to it. */
  private chain(...nodes: AudioNode[]): AudioNode {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1])
    return nodes[0]
  }

  /** Pitch in Hz after the sampler's pitch knob. */
  private hz(f: number): number { return f * Math.pow(2, this.cents / 1200) }

  // ── The sounds ───────────────────────────────────────────────────────────

  /**
   * Dancehall air horn — "bap, bap, baaaaap". A real air horn is two brass
   * reeds a few cents apart (the beating gives it its rasp), blown through a
   * flared bell that boosts ~1.4 kHz and ~2.8 kHz. Each blast scoops up into
   * pitch as the air pressure builds and wavers slightly while held.
   */
  private horn(t: number): void {
    const blasts: [number, number][] = [[0, 0.12], [0.17, 0.12], [0.34, 0.95]]
    const f = this.hz(466)
    for (const [at, len] of blasts) {
      const s = t + at
      const end = s + len + 0.12
      const g = this.env(s, 0.008, len, 0.09, 0.42)
      const bell = this.chain(this.drive(2.6), this.filter('highpass', 260), this.filter('peaking', 1400, 1.2, 7),
        this.filter('peaking', 2800, 1.5, 5), this.filter('lowpass', 6500), g)
      const vib = this.ctx.createOscillator()
      const vibDepth = this.ctx.createGain()
      vib.frequency.value = 5.5; vibDepth.gain.value = f * 0.004
      vib.connect(vibDepth)
      vib.start(s); vib.stop(end)
      for (const [ratio, type, level] of [[1, 'sawtooth', 0.5], [1.007, 'sawtooth', 0.45], [0.5, 'square', 0.18]] as const) {
        const lv = this.ctx.createGain()
        lv.gain.value = level
        lv.connect(bell)
        const o = this.ctx.createOscillator()
        o.type = type
        o.frequency.setValueAtTime(f * ratio * 0.88, s)
        o.frequency.exponentialRampToValueAtTime(f * ratio, s + 0.035)
        // The air runs out at the end of the long blast and the pitch sags.
        o.frequency.setValueAtTime(f * ratio, s + len * 0.7)
        o.frequency.exponentialRampToValueAtTime(f * ratio * 0.96, s + len + 0.09)
        vibDepth.connect(o.frequency)
        o.connect(lv)
        o.start(s); o.stop(end)
      }
      // Breath: air hissing through the reed.
      const breath = this.env(s, 0.01, len, 0.08, 0.05)
      this.noiseSrc(s, end, this.chain(this.filter('bandpass', 3200, 0.8), breath))
    }
  }

  /**
   * Police siren, "wail" pattern: the tone glides up from ~600 Hz to ~1.35 kHz
   * and back over about a second and a half, through a horn speaker that only
   * passes roughly 400 Hz – 4 kHz. Two wail cycles, then it winds down.
   */
  private siren(t: number): void {
    const dur = 3.4
    const steps = 340
    const curve = new Float32Array(steps)
    const lo = this.hz(600), hi = this.hz(1350)
    for (let i = 0; i < steps; i++) {
      const x = i / (steps - 1) * dur
      let v: number
      if (x < 2.9) {
        // Rise slower than it falls, like a motor spinning up and coasting.
        const p = (x % 1.45) / 1.45
        const shape = p < 0.62 ? Math.sin((p / 0.62) * Math.PI / 2) : Math.cos(((p - 0.62) / 0.38) * Math.PI / 2)
        v = lo + (hi - lo) * shape
      } else {
        v = lo * (1 - ((x - 2.9) / 0.5) * 0.35)
      }
      curve[i] = v
    }
    const g = this.env(t, 0.06, dur - 0.45, 0.4, 0.3)
    const speaker = this.chain(this.drive(1.8), this.filter('highpass', 420, 0.9), this.filter('peaking', 1800, 1, 5), this.filter('lowpass', 4200, 0.9), g)
    for (const [type, level, ratio] of [['triangle', 0.8, 1], ['square', 0.22, 1], ['sine', 0.3, 2]] as const) {
      const lv = this.ctx.createGain()
      lv.gain.value = level
      lv.connect(speaker)
      const o = this.ctx.createOscillator()
      o.type = type
      o.frequency.setValueCurveAtTime(ratio === 1 ? curve : curve.map(v => v * ratio), t, dur)
      o.connect(lv)
      o.start(t); o.stop(t + dur + 0.05)
    }
  }

  /**
   * Dancehall laser — "pew-pew-pew". Each zap is an FM tone diving from
   * ~2.6 kHz to ~200 Hz; the modulator makes it metallic and sci-fi.
   */
  private laser(t: number): void {
    ;[0, 0.12, 0.24].forEach((at, i) => {
      const s = t + at
      const top = this.hz(2600 - i * 180)
      const g = this.env(s, 0.003, 0.04, 0.24, 1)
      const tone = this.chain(this.filter('highpass', 180), g)
      const carrier = this.ctx.createOscillator()
      carrier.type = 'triangle'
      carrier.frequency.setValueAtTime(top, s)
      carrier.frequency.exponentialRampToValueAtTime(this.hz(190), s + 0.2)
      const mod = this.ctx.createOscillator()
      const index = this.ctx.createGain()
      mod.frequency.setValueAtTime(top * 1.5, s)
      mod.frequency.exponentialRampToValueAtTime(this.hz(285), s + 0.2)
      index.gain.setValueAtTime(top * 0.9, s)
      index.gain.exponentialRampToValueAtTime(80, s + 0.2)
      mod.connect(index).connect(carrier.frequency)
      carrier.connect(tone)
      for (const n of [carrier, mod]) { n.start(s); n.stop(s + 0.28) }
    })
    // A touch of room so the zaps ring out.
    const tail = this.env(t, 0.003, 0.3, 0.3, 0.12, this.room)
    this.noiseSrc(t, t + 0.6, this.chain(this.filter('bandpass', 2500, 2), tail))
  }

  /**
   * Riser: white noise swept up through a resonant band-pass under a detuned
   * saw stack climbing three octaves, pulsing faster as it builds. Audible from
   * the first beat, peaks at four seconds, then cuts dead for the drop.
   */
  private riser(t: number): void {
    const dur = 4
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.08, t)
    g.gain.linearRampToValueAtTime(0.9, t + dur)
    g.gain.setValueAtTime(0.0001, t + dur + 0.01)
    g.connect(this.out)
    // Pulse: a tremolo that speeds up from 4 to 16 per second.
    const pulse = this.ctx.createGain()
    pulse.gain.value = 0.75
    const lfo = this.ctx.createOscillator()
    const lfoDepth = this.ctx.createGain()
    lfo.frequency.setValueAtTime(4, t)
    lfo.frequency.exponentialRampToValueAtTime(16, t + dur)
    lfoDepth.gain.value = 0.25
    lfo.connect(lfoDepth).connect(pulse.gain)
    lfo.start(t); lfo.stop(t + dur + 0.05)
    pulse.connect(g)

    const bp = this.filter('bandpass', 400, 1.6)
    bp.frequency.exponentialRampToValueAtTime(9000, t + dur)
    this.noiseSrc(t, t + dur + 0.05, this.chain(bp, pulse))

    const lp = this.filter('lowpass', 900, 4)
    lp.frequency.exponentialRampToValueAtTime(12000, t + dur)
    const sawLevel = this.ctx.createGain()
    sawLevel.gain.value = 0.22
    this.chain(lp, sawLevel, pulse)
    for (const det of [-14, 0, 14]) {
      const o = this.osc('sawtooth', this.hz(110), t, t + dur + 0.05, lp)
      o.detune.value = this.cents + det
      o.frequency.exponentialRampToValueAtTime(this.hz(880), t + dur)
    }
  }

  /**
   * Impact: a cinematic boom. A sub drop gives the weight; the same tone
   * through saturation gives harmonics small speakers can play; a noise
   * crack is the hit itself, and a bright crash tail rings into the room.
   */
  private impact(t: number): void {
    // Sub + saturated body
    const sub = this.env(t, 0.002, 0.06, 1.1, 0.6)
    const body = this.env(t, 0.002, 0.06, 0.6, 0.5)
    const bodyChain = this.chain(this.drive(9), this.filter('peaking', 700, 1, 6), this.filter('lowpass', 3000), body)
    const o = this.ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(this.hz(130), t)
    o.frequency.exponentialRampToValueAtTime(this.hz(38), t + 0.45)
    o.connect(sub); o.connect(bodyChain)
    o.start(t); o.stop(t + 1.3)
    // Crack
    const crack = this.env(t, 0.001, 0.012, 0.16, 0.55)
    this.noiseSrc(t, t + 0.2, this.chain(this.filter('lowpass', 3500), this.filter('peaking', 1200, 1, 6), crack))
    // Crash tail, part of it into the room
    const crash = this.env(t, 0.004, 0.02, 1.2, 0.1)
    const crashRoom = this.env(t, 0.004, 0.02, 0.8, 0.25, this.room)
    const hp = this.filter('highpass', 3500)
    this.chain(hp, crash); hp.connect(crashRoom)
    this.noiseSrc(t, t + 1.4, hp)
  }

  /**
   * Hand clap: a real clap is several hands' worth of slaps a few
   * milliseconds apart, band-limited around 1–2.5 kHz, then the room.
   */
  private clap(t: number): void {
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    for (const at of [0, 0.009, 0.019, 0.031]) {
      g.gain.setValueAtTime(0.0001, t + at)
      g.gain.exponentialRampToValueAtTime(1, t + at + 0.0015)
      g.gain.exponentialRampToValueAtTime(0.12, t + at + 0.008)
    }
    g.gain.setValueAtTime(0.85, t + 0.042)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26)
    const voice = this.chain(this.filter('highpass', 700), this.filter('bandpass', 1500, 0.6), this.filter('peaking', 2400, 1, 4), g)
    const dry = this.ctx.createGain()
    dry.gain.value = 1.8
    const wet = this.ctx.createGain()
    wet.gain.value = 1.1
    g.connect(dry).connect(this.out)
    g.connect(wet).connect(this.room)
    this.noiseSrc(t, t + 0.3, voice)
  }

  /**
   * Rewind / spin-back: the record pulled backwards by hand — the pitch
   * whips up, then slows to a growl as the platter coasts, chopped by the
   * fingers' rhythm on the vinyl.
   */
  private rewind(t: number): void {
    const dur = 1.1
    const g = this.env(t, 0.01, 0.55, 0.5, 0.8)
    const chop = this.ctx.createGain()
    chop.gain.value = 0.7
    const lfo = this.ctx.createOscillator()
    const depth = this.ctx.createGain()
    lfo.type = 'square'
    lfo.frequency.setValueAtTime(22, t)
    lfo.frequency.exponentialRampToValueAtTime(5, t + dur)
    depth.gain.value = 0.3
    lfo.connect(depth).connect(chop.gain)
    lfo.start(t); lfo.stop(t + dur + 0.05)
    chop.connect(g)
    const bus = this.chain(this.drive(2.2), this.filter('highpass', 150), this.filter('lowpass', 7000), chop)
    const pitch = (p: AudioParam, base: number) => {
      p.setValueAtTime(this.hz(base), t)
      p.exponentialRampToValueAtTime(this.hz(base * 6), t + 0.22)
      p.exponentialRampToValueAtTime(this.hz(base * 0.35), t + dur)
    }
    for (const [type, base, level] of [['sawtooth', 220, 0.35], ['square', 331, 0.15]] as const) {
      const lv = this.ctx.createGain()
      lv.gain.value = level
      lv.connect(bus)
      const o = this.ctx.createOscillator()
      o.type = type
      pitch(o.frequency, base)
      o.connect(lv)
      o.start(t); o.stop(t + dur + 0.05)
    }
    const bp = this.filter('bandpass', 1000, 1.4)
    pitch(bp.frequency, 700)
    const nl = this.ctx.createGain()
    nl.gain.value = 0.6
    this.noiseSrc(t, t + dur + 0.05, this.chain(bp, nl, bus))
  }

  /**
   * Tom fill, high to low. A drumhead rings at inharmonic partials (about
   * 1, 1.59 and 2.14 × the fundamental), bends down as the skin settles, and
   * starts with the stick's click.
   */
  private tom(t: number): void {
    ;([[0, 240], [0.11, 190], [0.22, 150], [0.33, 112]] as const).forEach(([at, base]) => {
      const s = t + at
      const f = this.hz(base)
      const shell = this.chain(this.drive(4), this.filter('peaking', 1000, 0.9, 7))
      const g = this.env(s, 0.002, 0.02, 0.45, 0.75)
      shell.connect(g)
      const send = this.env(s, 0.002, 0.02, 0.3, 0.18, this.room)
      shell.connect(send)
      for (const [ratio, level, decay] of [[1, 1, 0.45], [1.59, 0.45, 0.22], [2.14, 0.3, 0.14]] as const) {
        const pg = this.env(s, 0.002, 0.005, decay, level, shell)
        const o = this.ctx.createOscillator()
        o.type = 'sine'
        o.frequency.setValueAtTime(f * ratio * 1.35, s)
        o.frequency.exponentialRampToValueAtTime(f * ratio, s + 0.07)
        o.connect(pg)
        o.start(s); o.stop(s + decay + 0.1)
      }
      const click = this.env(s, 0.0008, 0.003, 0.03, 0.8)
      this.noiseSrc(s, s + 0.05, this.chain(this.filter('highpass', 2500), click))
    })
  }
}

function isOffline(ctx: BaseAudioContext): boolean {
  return typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext
}
