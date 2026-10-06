/**
 * AIHub DJ audio engine — two decks, a mixer and a master bus on Web Audio.
 *
 * Playback streams from an <audio> element per deck (so a 2-hour mix plays as
 * easily as a 3-minute single) and is routed through a MediaElementSource into
 * the processing graph. The decoded copy used for analysis is thrown away as
 * soon as the waveform envelope and tempo are known.
 *
 *  deck:  source → stems (mid/side + band kills) → trim → EQ → FX → channel fader → crossfader ┐
 *                                                               └→ PFL → cue bus            │
 *  master:                                                           master gain → limiter ←┘ → speakers / recorder
 */
import { analyze, ENV_RATE, type Analysis } from './analysis'
import { createEffect, type Effect, type FxType } from './effects'
import { rememberTrack } from './trackCache'
import { YouTubePlayer } from './youtubePlayer'

export interface DjTrack {
  token: string
  path: string
  name: string
  title: string
  artist: string
  album?: string
  cover?: string
  tagBpm?: number
  key?: string
  size: number
  /** Set for a YouTube stream instead of a local file. */
  youtubeId?: string
  /** Length known before loading (YouTube search results). */
  durationHint?: number
}

export type DeckId = 'A' | 'B'
export type StemKey = 'vocal' | 'instru' | 'bass' | 'kick' | 'hihat'
export type EqBand = 'high' | 'mid' | 'low'

export const PITCH_RANGES = [0.08, 0.12, 0.16, 0.5]
export const LOOP_SIZES = [1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 16, 32]

/** Decoding needs ~10× the file size in memory; past this we draw the waveform live instead. */
const MAX_ANALYZE_BYTES = 40 * 1024 * 1024
const SMOOTH = 0.02

type Listener = () => void

export class Emitter {
  private listeners = new Set<Listener>()
  version = 0
  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l)
    return () => { this.listeners.delete(l) }
  }
  getVersion = (): number => this.version
  protected emit(): void {
    this.version++
    for (const l of this.listeners) l()
  }
}

/** Knob 0..1 (0.5 = flat) → EQ gain in dB: full kill on the left, +6 dB on the right. */
export function eqKnobToDb(v: number): number {
  if (v >= 0.5) return ((v - 0.5) / 0.5) * 6
  const r = v / 0.5
  return r <= 0.001 ? -48 : Math.max(-48, 40 * Math.log10(r))
}

/** Channel fader 0..1 → linear gain with an audio taper. */
export function faderGain(v: number): number {
  return v <= 0 ? 0 : Math.pow(v, 2)
}

/** Constant-power crossfade. x: 0 = full A, 1 = full B. */
export function crossfadeGains(x: number): [number, number] {
  const t = Math.min(1, Math.max(0, x)) * Math.PI / 2
  return [Math.cos(t), Math.sin(t)]
}

function peakDb(an: AnalyserNode, buf: Float32Array): number {
  an.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>)
  let p = 0
  for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a }
  return p > 0 ? 20 * Math.log10(p) : -96
}

export class Deck extends Emitter {
  readonly audio: HTMLAudioElement
  track: DjTrack | null = null
  analysis: Analysis | null = null
  analyzing = false
  /** Waveform drawn while playing, for files too big to pre-analyse. */
  liveEnv: Float32Array | null = null
  duration = 0
  error: string | null = null

  cuePoint = 0
  hotCues: (number | null)[] = [null, null, null]
  loopIn: number | null = null
  loopOut: number | null = null
  loopActive = false
  loopBeats = 4

  pitch = 0
  pitchRange = PITCH_RANGES[0]
  keyLock = false
  private bend = 0

  stems: Record<StemKey, boolean> = { vocal: true, instru: true, bass: true, kick: true, hihat: true }
  fxType: FxType = 'flanger'
  fxOn = false
  fxStrength = 0.6
  fxSpeed = 0.4
  eq: Record<EqBand, number> = { high: 0.5, mid: 0.5, low: 0.5 }
  gainKnob = 0.5
  /** Quick filter: 0 = low-pass closed, 0.5 = off, 1 = high-pass closed. */
  filterKnob = 0.5
  volume = 0.8
  pfl = false

  private gen = 0
  private yt: YouTubePlayer | null = null
  private meterBuf = new Float32Array(1024)
  private liveBuf = new Float32Array(1024)

  // graph
  private fullGain: GainNode
  private sideGain: GainNode
  private midLowGain: GainNode
  private midHighGain: GainNode
  private midBandGain: GainNode
  private kickF: BiquadFilterNode
  private bassF: BiquadFilterNode
  private hatF: BiquadFilterNode
  private trim: GainNode
  private eqNodes: Record<EqBand, BiquadFilterNode>
  private quickFilter: BiquadFilterNode
  private preFx: GainNode
  private dry: GainNode
  private wet: GainNode
  private postFx: GainNode
  private effect: Effect
  private fader: GainNode
  readonly xfade: GainNode
  private pflGain: GainNode
  private preAnalyser: AnalyserNode
  private meter: AnalyserNode

  constructor(readonly id: DeckId, private engine: DjEngine) {
    super()
    const ctx = engine.ctx
    this.audio = new Audio()
    this.audio.crossOrigin = 'anonymous'
    this.audio.preload = 'auto'
    this.audio.preservesPitch = false

    const src = ctx.createMediaElementSource(this.audio)
    // Force stereo so mono files split into identical L/R instead of L + silence.
    const up = ctx.createGain()
    up.channelCount = 2
    up.channelCountMode = 'explicit'
    up.channelInterpretation = 'speakers'
    src.connect(up)

    // ── Stems: mid/side separation plus band filters ──
    const split = ctx.createChannelSplitter(2)
    up.connect(split)
    const mid = ctx.createGain()
    const side = ctx.createGain()
    const lMid = ctx.createGain(); lMid.gain.value = 0.5
    const rMid = ctx.createGain(); rMid.gain.value = 0.5
    const lSide = ctx.createGain(); lSide.gain.value = 0.5
    const rSide = ctx.createGain(); rSide.gain.value = -0.5
    split.connect(lMid, 0).connect(mid)
    split.connect(rMid, 1).connect(mid)
    split.connect(lSide, 0).connect(side)
    split.connect(rSide, 1).connect(side)

    const stemSum = ctx.createGain()
    stemSum.channelCount = 2
    stemSum.channelCountMode = 'explicit'
    stemSum.channelInterpretation = 'speakers'

    this.fullGain = ctx.createGain()
    up.connect(this.fullGain).connect(stemSum)

    // Instrumental: centre-panned vocals cancel in the side signal; keep the
    // centre's lows and highs so kick, bass and hats survive.
    this.sideGain = ctx.createGain(); this.sideGain.gain.value = 0
    side.connect(this.sideGain).connect(stemSum)
    const midLp = ctx.createBiquadFilter(); midLp.type = 'lowpass'; midLp.frequency.value = 160
    this.midLowGain = ctx.createGain(); this.midLowGain.gain.value = 0
    mid.connect(midLp).connect(this.midLowGain).connect(stemSum)
    const midHp = ctx.createBiquadFilter(); midHp.type = 'highpass'; midHp.frequency.value = 7500
    this.midHighGain = ctx.createGain(); this.midHighGain.gain.value = 0
    mid.connect(midHp).connect(this.midHighGain).connect(stemSum)
    // Acapella: the centre, band-limited to the vocal range.
    const bandHp = ctx.createBiquadFilter(); bandHp.type = 'highpass'; bandHp.frequency.value = 180
    const bandLp = ctx.createBiquadFilter(); bandLp.type = 'lowpass'; bandLp.frequency.value = 6500
    this.midBandGain = ctx.createGain(); this.midBandGain.gain.value = 0
    mid.connect(bandHp).connect(bandLp).connect(this.midBandGain).connect(stemSum)

    this.kickF = ctx.createBiquadFilter(); this.kickF.type = 'peaking'; this.kickF.frequency.value = 55; this.kickF.Q.value = 1.4
    this.bassF = ctx.createBiquadFilter(); this.bassF.type = 'peaking'; this.bassF.frequency.value = 130; this.bassF.Q.value = 0.9
    this.hatF = ctx.createBiquadFilter(); this.hatF.type = 'highshelf'; this.hatF.frequency.value = 6500

    // ── Channel strip ──
    this.trim = ctx.createGain()
    const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 220
    const midEq = ctx.createBiquadFilter(); midEq.type = 'peaking'; midEq.frequency.value = 1000; midEq.Q.value = 0.7
    const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 3800
    this.eqNodes = { low, mid: midEq, high }
    this.quickFilter = ctx.createBiquadFilter()
    this.quickFilter.type = 'allpass'
    this.quickFilter.Q.value = 1.2

    this.preFx = ctx.createGain()
    this.dry = ctx.createGain()
    this.wet = ctx.createGain(); this.wet.gain.value = 0
    this.postFx = ctx.createGain()
    this.effect = createEffect(ctx, this.fxType)

    stemSum.connect(this.kickF).connect(this.bassF).connect(this.hatF)
      .connect(this.trim).connect(low).connect(midEq).connect(high).connect(this.quickFilter).connect(this.preFx)
    this.preFx.connect(this.dry).connect(this.postFx)
    this.preFx.connect(this.effect.input)
    this.effect.output.connect(this.wet).connect(this.postFx)

    this.preAnalyser = ctx.createAnalyser(); this.preAnalyser.fftSize = 1024
    this.postFx.connect(this.preAnalyser)

    this.fader = ctx.createGain()
    this.xfade = ctx.createGain()
    this.meter = ctx.createAnalyser(); this.meter.fftSize = 1024
    this.postFx.connect(this.fader).connect(this.xfade).connect(engine.masterIn)
    this.fader.connect(this.meter)
    this.pflGain = ctx.createGain(); this.pflGain.gain.value = 0
    this.postFx.connect(this.pflGain).connect(engine.cueBus)

    this.audio.addEventListener('loadedmetadata', () => {
      this.duration = Number.isFinite(this.audio.duration) ? this.audio.duration : 0
      if (!this.analysis && this.duration) this.liveEnv = new Float32Array(Math.ceil(this.duration * ENV_RATE) + 1)
      if (this.track && this.duration) rememberTrack(this.track.path, { d: this.duration })
      this.emit()
    })
    this.audio.addEventListener('ended', () => { this.emit() })
    this.audio.addEventListener('pause', () => this.emit())
    this.audio.addEventListener('play', () => this.emit())
    this.audio.addEventListener('error', () => {
      if (!this.track || this.isYouTube) return
      this.error = 'This file could not be decoded'
      this.emit()
    })

    this.applyAll()
  }

  // ── state ──
  get isYouTube(): boolean { return !!this.track?.youtubeId }
  get playing(): boolean {
    if (this.isYouTube) return !!this.yt?.playing
    return !this.audio.paused && !this.audio.ended
  }
  get time(): number { return this.isYouTube ? this.yt?.currentTime ?? 0 : this.audio.currentTime || 0 }
  get bpm(): number | null { return this.analysis?.bpm ?? this.track?.tagBpm ?? null }
  get rate(): number { return 1 + this.pitch }
  get effectiveBpm(): number | null { const b = this.bpm; return b ? b * this.rate : null }
  get beatLen(): number { const b = this.bpm; return b ? 60 / b : 0.5 }
  get firstBeat(): number { return this.analysis?.firstBeat ?? 0 }

  /** Peak level after the channel fader, in dBFS. */
  meterDb(): number { return peakDb(this.meter, this.meterBuf) }

  // ── loading ──
  async load(track: DjTrack): Promise<void> {
    const gen = ++this.gen
    this.audio.pause()
    this.track = track
    this.analysis = null
    this.liveEnv = null
    this.duration = 0
    this.error = null
    this.cuePoint = 0
    this.hotCues = [null, null, null]
    this.loopIn = this.loopOut = null
    this.loopActive = false
    if (track.youtubeId) {
      this.audio.removeAttribute('src')
      this.audio.load()
      if (!this.yt) this.yt = new YouTubePlayer(this.engine.ytHost, () => this.emit())
      this.yt.load(track.youtubeId)
      this.duration = track.durationHint ?? 0
      this.applyRate()
      this.emit()
      return
    }
    this.yt?.unload()
    this.audio.src = `aihub-media://${track.token}/`
    this.audio.load()
    this.emit()

    if (track.size > MAX_ANALYZE_BYTES) return
    this.analyzing = true
    this.emit()
    try {
      const res = await fetch(`aihub-media://${track.token}/`)
      const buf = await res.arrayBuffer()
      if (gen !== this.gen) return
      const decoded = await this.engine.ctx.decodeAudioData(buf)
      if (gen !== this.gen) return
      // Yield a frame so the deck paints "loaded" before the tempo scan.
      await new Promise(r => setTimeout(r, 16))
      const chans: Float32Array[] = []
      for (let c = 0; c < Math.min(2, decoded.numberOfChannels); c++) chans.push(decoded.getChannelData(c))
      const a = analyze(chans, decoded.sampleRate)
      if (gen !== this.gen) return
      this.analysis = a
      this.liveEnv = null
      if (!this.duration) this.duration = decoded.duration
      rememberTrack(track.path, { d: decoded.duration, bpm: a.bpm ?? undefined })
      this.applyRate()
    } catch {
      // Analysis is a nicety; playback still works without it.
    } finally {
      if (gen === this.gen) { this.analyzing = false; this.emit() }
    }
  }

  eject(): void {
    if (this.playing) return
    this.gen++
    this.audio.removeAttribute('src')
    this.audio.load()
    this.yt?.unload()
    this.track = null
    this.analysis = null
    this.liveEnv = null
    this.duration = 0
    this.emit()
  }

  // ── transport ──
  async play(): Promise<void> {
    if (!this.track) return
    await this.engine.resume()
    if (this.isYouTube) { this.syncYouTubeVolume(); this.yt?.play(); this.emit(); return }
    try { await this.audio.play() } catch { /* interrupted by a new load */ }
    this.emit()
  }
  pause(): void {
    if (this.isYouTube) this.yt?.pause()
    else this.audio.pause()
    this.emit()
  }
  toggle(): void { this.playing ? this.pause() : void this.play() }

  /** Stop: pause and return to the cue point. */
  stop(): void {
    this.pause()
    this.seek(this.cuePoint)
  }

  /** CUE: while playing, jump back to the cue and stop; while stopped, set it here. */
  cue(): void {
    if (!this.track) return
    if (this.playing) { this.pause(); this.seek(this.cuePoint) }
    else { this.cuePoint = this.snap(this.time); this.seek(this.cuePoint) }
    this.emit()
  }

  seek(t: number): void {
    if (!this.track) return
    const max = this.duration || (this.isYouTube ? 0 : this.audio.duration) || 0
    const at = Math.max(0, max ? Math.min(t, max - 0.01) : t)
    if (this.isYouTube) this.yt?.seek(at)
    else this.audio.currentTime = at
    this.emit()
  }

  seekFraction(f: number): void { this.seek(f * (this.duration || 0)) }

  hotCue(i: number): void {
    if (!this.track) return
    const at = this.hotCues[i]
    if (at == null) { this.hotCues[i] = this.snap(this.time); this.emit() }
    else this.seek(at)
  }
  clearHotCue(i: number): void { this.hotCues[i] = null; this.emit() }

  /** Snap to the nearest beat when the grid is known (within a 1/8 beat). */
  private snap(t: number): number {
    if (!this.analysis?.bpm) return t
    const bl = this.beatLen
    const n = Math.round((t - this.firstBeat) / bl)
    const s = this.firstBeat + n * bl
    return Math.abs(s - t) < bl / 8 && s >= 0 ? s : t
  }

  // ── loops ──
  loopSetIn(): void { this.loopIn = this.snap(this.time); this.loopOut = null; this.loopActive = false; this.emit() }
  loopSetOut(): void {
    if (this.loopIn == null) return
    const t = this.snap(this.time)
    if (t <= this.loopIn + 0.05) return
    this.loopOut = t
    this.loopActive = true
    this.emit()
  }
  loopToggle(): void {
    if (this.loopActive) { this.loopActive = false; this.emit(); return }
    if (this.loopIn != null && this.loopOut != null) { this.loopActive = true; this.seek(this.loopIn); return }
    this.autoLoop()
  }
  autoLoop(): void {
    if (!this.track) return
    const start = this.snap(this.time)
    this.loopIn = start
    this.loopOut = start + this.loopBeats * this.beatLen
    this.loopActive = true
    this.emit()
  }
  loopResize(dir: -1 | 1): void {
    const i = LOOP_SIZES.indexOf(this.loopBeats)
    const next = LOOP_SIZES[Math.max(0, Math.min(LOOP_SIZES.length - 1, i + dir))]
    this.loopBeats = next
    if (this.loopActive && this.loopIn != null) this.loopOut = this.loopIn + next * this.beatLen
    this.emit()
  }

  // ── tempo ──
  setPitch(p: number): void {
    this.pitch = Math.max(-this.pitchRange, Math.min(this.pitchRange, p))
    this.applyRate()
    this.emit()
  }
  cyclePitchRange(): void {
    const i = PITCH_RANGES.indexOf(this.pitchRange)
    this.pitchRange = PITCH_RANGES[(i + 1) % PITCH_RANGES.length]
    this.setPitch(this.pitch)
  }
  setKeyLock(on: boolean): void { this.keyLock = on; this.applyRate(); this.emit() }
  /** Temporary speed push/pull from the jog wheel. */
  setBend(b: number): void { this.bend = Math.max(-0.5, Math.min(0.5, b)); this.applyRate() }

  /** Match this deck's tempo — and beat phase, when both grids are known — to `master`. */
  sync(master: Deck): boolean {
    const mine = this.bpm
    const target = master.effectiveBpm
    if (!mine || !target) return false
    let ratio = target / mine
    if (ratio > 1.5) ratio /= 2
    else if (ratio < 0.67) ratio *= 2
    const p = ratio - 1
    while (Math.abs(p) > this.pitchRange && this.pitchRange < PITCH_RANGES[PITCH_RANGES.length - 1]) {
      this.pitchRange = PITCH_RANGES[PITCH_RANGES.indexOf(this.pitchRange) + 1]
    }
    this.setPitch(p)
    if (this.analysis?.bpm && master.analysis?.bpm && master.playing) {
      const phase = (d: Deck) => { const x = (d.time - d.firstBeat) / d.beatLen; return x - Math.floor(x) }
      let delta = phase(master) - phase(this)
      if (delta > 0.5) delta -= 1
      if (delta < -0.5) delta += 1
      this.seek(this.time + delta * this.beatLen)
    }
    return true
  }

  private applyRate(): void {
    const r = Math.max(0.25, Math.min(4, this.rate + this.bend))
    this.audio.playbackRate = r
    this.audio.preservesPitch = this.keyLock
    if (this.isYouTube) this.yt?.setRate(r)
    const eb = this.effectiveBpm
    this.effect.setBeat(eb ? 60 / eb : 0.5)
  }

  // ── stems ──
  setStem(k: StemKey, on: boolean): void { this.stems[k] = on; this.applyStems(); this.emit() }
  /** The (Acapella)/(Instrumental) shortcuts. */
  soloStem(which: 'acapella' | 'instrumental'): void {
    const vocal = which === 'acapella'
    const already = this.stems.vocal === vocal && this.stems.instru === !vocal
    // Pressing the lit shortcut again brings the full track back.
    this.stems.vocal = already || vocal
    this.stems.instru = already || !vocal
    this.applyStems()
    this.emit()
  }
  private applyStems(): void {
    const ctx = this.engine.ctx
    const s = this.stems
    const set = (g: GainNode, v: number) => g.gain.setTargetAtTime(v, ctx.currentTime, SMOOTH)
    const full = s.vocal && s.instru
    const instrumental = !s.vocal && s.instru
    const acapella = s.vocal && !s.instru
    set(this.fullGain, full ? 1 : 0)
    set(this.sideGain, instrumental ? 1.4 : 0)
    set(this.midLowGain, instrumental ? 1 : 0)
    set(this.midHighGain, instrumental ? 1 : 0)
    set(this.midBandGain, acapella ? 1.2 : 0)
    this.kickF.gain.setTargetAtTime(s.kick ? 0 : -30, ctx.currentTime, SMOOTH)
    this.bassF.gain.setTargetAtTime(s.bass ? 0 : -24, ctx.currentTime, SMOOTH)
    this.hatF.gain.setTargetAtTime(s.hihat ? 0 : -36, ctx.currentTime, SMOOTH)
  }

  // ── FX ──
  setFxType(t: FxType): void {
    if (t === this.fxType) return
    this.preFx.disconnect(this.effect.input)
    this.effect.output.disconnect()
    this.effect.dispose()
    this.fxType = t
    this.effect = createEffect(this.engine.ctx, t)
    this.preFx.connect(this.effect.input)
    this.effect.output.connect(this.wet)
    this.applyFx()
    this.emit()
  }
  setFxOn(on: boolean): void { this.fxOn = on; this.applyFx(); this.emit() }
  setFxStrength(v: number): void { this.fxStrength = v; this.effect.setStrength(v); this.emit() }
  setFxSpeed(v: number): void { this.fxSpeed = v; this.effect.setSpeed(v); this.emit() }
  private applyFx(): void {
    const ctx = this.engine.ctx
    this.effect.setStrength(this.fxStrength)
    this.effect.setSpeed(this.fxSpeed)
    const eb = this.effectiveBpm
    this.effect.setBeat(eb ? 60 / eb : 0.5)
    this.wet.gain.setTargetAtTime(this.fxOn ? 1 : 0, ctx.currentTime, SMOOTH)
    this.dry.gain.setTargetAtTime(this.fxOn && this.effect.insert ? 0 : 1, ctx.currentTime, SMOOTH)
  }

  // ── channel strip ──
  setEq(b: EqBand, v: number): void {
    this.eq[b] = v
    this.eqNodes[b].gain.setTargetAtTime(eqKnobToDb(v), this.engine.ctx.currentTime, SMOOTH)
    this.emit()
  }
  setGainKnob(v: number): void {
    this.gainKnob = v
    this.trim.gain.setTargetAtTime(Math.pow(10, ((v - 0.5) * 24) / 20), this.engine.ctx.currentTime, SMOOTH)
    this.emit()
  }
  setFilterKnob(v: number): void {
    this.filterKnob = v
    const f = this.quickFilter
    const t = this.engine.ctx.currentTime
    if (Math.abs(v - 0.5) < 0.03) f.type = 'allpass'
    else if (v < 0.5) { f.type = 'lowpass'; f.frequency.setTargetAtTime(80 * Math.pow(20000 / 80, v / 0.5), t, SMOOTH) }
    else { f.type = 'highpass'; f.frequency.setTargetAtTime(20 * Math.pow(8000 / 20, (v - 0.5) / 0.5), t, SMOOTH) }
    this.emit()
  }
  setVolume(v: number): void {
    this.volume = v
    this.fader.gain.setTargetAtTime(faderGain(v), this.engine.ctx.currentTime, SMOOTH)
    this.emit()
  }
  setPfl(on: boolean): void {
    this.pfl = on
    this.pflGain.gain.setTargetAtTime(on ? 1 : 0, this.engine.ctx.currentTime, SMOOTH)
    this.emit()
  }

  private applyAll(): void {
    this.applyStems()
    this.applyFx()
    for (const b of ['high', 'mid', 'low'] as EqBand[]) this.eqNodes[b].gain.value = eqKnobToDb(this.eq[b])
    this.trim.gain.value = 1
    this.fader.gain.value = faderGain(this.volume)
    this.applyRate()
  }

  /** Per-frame work: loop wrap and the live waveform. */
  tick(): void {
    if (!this.track) return
    const t = this.time
    if (this.loopActive && this.loopIn != null && this.loopOut != null && t >= this.loopOut) {
      const back = this.loopIn + ((t - this.loopOut) % (this.loopOut - this.loopIn))
      if (this.isYouTube) this.yt?.seek(back)
      else this.audio.currentTime = back
    }
    if (this.isYouTube && this.yt) {
      if (this.yt.duration && this.yt.duration !== this.duration) { this.duration = this.yt.duration; this.emit() }
      if (this.yt.error && this.yt.error !== this.error) { this.error = this.yt.error; this.emit() }
      this.syncYouTubeVolume()
      return
    }
    if (this.liveEnv && this.playing) {
      const i = Math.floor(t * ENV_RATE)
      if (i >= 0 && i < this.liveEnv.length) {
        this.preAnalyser.getFloatTimeDomainData(this.liveBuf)
        let p = 0
        for (let k = 0; k < this.liveBuf.length; k++) { const a = Math.abs(this.liveBuf[k]); if (a > p) p = a }
        if (p > this.liveEnv[i]) this.liveEnv[i] = Math.min(1, p)
      }
    }
  }

  /**
   * YouTube audio never enters the graph, so the mixer is applied to it as
   * plain volume: channel fader × crossfader × trim × master.
   */
  private syncYouTubeVolume(): void {
    if (!this.yt) return
    const [a, b] = crossfadeGains(this.engine.crossfader)
    const trim = Math.pow(10, ((this.gainKnob - 0.5) * 24) / 20)
    this.yt.setVolume(faderGain(this.volume) * (this.id === 'A' ? a : b) * faderGain(this.engine.masterVolume) * trim)
  }

  dispose(): void {
    this.gen++
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.yt?.dispose()
    this.effect.dispose()
  }
}

export class DjEngine extends Emitter {
  readonly ctx: AudioContext
  readonly masterIn: GainNode
  readonly cueBus: GainNode
  readonly decks: Record<DeckId, Deck>
  private master: GainNode
  private limiter: DynamicsCompressorNode
  private meterL: AnalyserNode
  private meterR: AnalyserNode
  private meterBuf = new Float32Array(1024)
  crossfader = 0.5
  masterVolume = 0.85

  // headphones
  private phonesMix: GainNode
  private phonesCue: GainNode
  private phonesMaster: GainNode
  private phonesDest: MediaStreamAudioDestinationNode
  private phonesEl: HTMLAudioElement | null = null
  phonesDevice: string | null = null
  phonesVolume = 0.8
  cueMix = 0.0

  // recording
  private recDest: MediaStreamAudioDestinationNode
  private recorder: MediaRecorder | null = null
  private recChunks: Blob[] = []
  recStartedAt = 0
  recBytes = 0

  private raf = 0
  /** Off-screen home for the YouTube deck players. */
  readonly ytHost: HTMLDivElement

  constructor() {
    super()
    this.ctx = new AudioContext({ latencyHint: 'interactive' })
    this.masterIn = this.ctx.createGain()
    this.master = this.ctx.createGain()
    this.master.gain.value = faderGain(this.masterVolume)
    this.limiter = this.ctx.createDynamicsCompressor()
    this.limiter.threshold.value = -1
    this.limiter.knee.value = 0
    this.limiter.ratio.value = 20
    this.limiter.attack.value = 0.002
    this.limiter.release.value = 0.12
    this.masterIn.connect(this.master).connect(this.limiter).connect(this.ctx.destination)

    const split = this.ctx.createChannelSplitter(2)
    this.meterL = this.ctx.createAnalyser(); this.meterL.fftSize = 1024
    this.meterR = this.ctx.createAnalyser(); this.meterR.fftSize = 1024
    this.limiter.connect(split)
    split.connect(this.meterL, 0)
    split.connect(this.meterR, 1)

    this.recDest = this.ctx.createMediaStreamDestination()
    this.limiter.connect(this.recDest)

    this.cueBus = this.ctx.createGain()
    this.phonesMix = this.ctx.createGain()
    this.phonesCue = this.ctx.createGain()
    this.phonesMaster = this.ctx.createGain()
    this.phonesDest = this.ctx.createMediaStreamDestination()
    this.cueBus.connect(this.phonesCue).connect(this.phonesMix)
    this.limiter.connect(this.phonesMaster).connect(this.phonesMix)
    this.phonesMix.connect(this.phonesDest)
    this.applyPhones()

    this.ytHost = document.createElement('div')
    this.ytHost.setAttribute('aria-hidden', 'true')
    this.ytHost.style.cssText = 'position:fixed;left:-10000px;top:0;width:200px;height:240px;overflow:hidden;pointer-events:none'
    document.body.appendChild(this.ytHost)

    this.decks = { A: new Deck('A', this), B: new Deck('B', this) }
    this.setCrossfader(0.5)

    const loop = () => {
      this.decks.A.tick()
      this.decks.B.tick()
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume()
  }

  setCrossfader(x: number): void {
    this.crossfader = Math.min(1, Math.max(0, x))
    const [a, b] = crossfadeGains(this.crossfader)
    this.decks.A.xfade.gain.setTargetAtTime(a, this.ctx.currentTime, SMOOTH)
    this.decks.B.xfade.gain.setTargetAtTime(b, this.ctx.currentTime, SMOOTH)
    this.emit()
  }

  setMasterVolume(v: number): void {
    this.masterVolume = v
    this.master.gain.setTargetAtTime(faderGain(v), this.ctx.currentTime, SMOOTH)
    this.emit()
  }

  masterDb(): [number, number] {
    return [peakDb(this.meterL, this.meterBuf), peakDb(this.meterR, this.meterBuf)]
  }

  // ── headphones ──
  async setPhonesDevice(deviceId: string | null): Promise<void> {
    this.phonesDevice = deviceId
    if (!deviceId) {
      this.phonesEl?.pause()
      if (this.phonesEl) this.phonesEl.srcObject = null
      this.phonesEl = null
      this.emit()
      return
    }
    if (!this.phonesEl) {
      this.phonesEl = new Audio()
      this.phonesEl.srcObject = this.phonesDest.stream
    }
    const el = this.phonesEl as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
    if (el.setSinkId) await el.setSinkId(deviceId)
    await this.resume()
    await el.play().catch(() => {})
    this.emit()
  }
  setPhonesVolume(v: number): void { this.phonesVolume = v; this.applyPhones(); this.emit() }
  setCueMix(v: number): void { this.cueMix = v; this.applyPhones(); this.emit() }
  private applyPhones(): void {
    const t = this.ctx.currentTime
    this.phonesMix.gain.setTargetAtTime(faderGain(this.phonesVolume), t, SMOOTH)
    this.phonesCue.gain.setTargetAtTime(Math.cos(this.cueMix * Math.PI / 2), t, SMOOTH)
    this.phonesMaster.gain.setTargetAtTime(Math.sin(this.cueMix * Math.PI / 2), t, SMOOTH)
  }

  // ── recording ──
  get recording(): boolean { return this.recorder?.state === 'recording' }
  startRecording(): void {
    if (this.recording) return
    void this.resume()
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
    this.recChunks = []
    this.recBytes = 0
    this.recorder = new MediaRecorder(this.recDest.stream, { mimeType: mime, audioBitsPerSecond: 256000 })
    this.recorder.ondataavailable = e => {
      if (e.data.size) { this.recChunks.push(e.data); this.recBytes += e.data.size }
    }
    this.recorder.start(1000)
    this.recStartedAt = performance.now()
  }
  /** Stop and hand back the recording, or null when nothing was captured. */
  stopRecording(): Promise<Blob | null> {
    const rec = this.recorder
    if (!rec || rec.state === 'inactive') return Promise.resolve(null)
    return new Promise(resolve => {
      rec.onstop = () => {
        const blob = this.recChunks.length ? new Blob(this.recChunks, { type: 'audio/webm' }) : null
        this.recChunks = []
        this.recorder = null
        resolve(blob)
      }
      rec.stop()
    })
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
    this.decks.A.dispose()
    this.decks.B.dispose()
    this.ytHost.remove()
    void this.setPhonesDevice(null)
    void this.ctx.close()
  }
}
