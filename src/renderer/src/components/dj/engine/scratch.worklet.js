/**
 * AIHub DJ scratch voice — an AudioWorklet that plays a deck's audio at
 * whatever speed and direction the hand moves the record.
 *
 * The playhead is pulled towards the hand's position with a short time
 * constant, so its speed follows the hand: a fast push is a fast, high
 * "zip", a slow drag is a low growl, a still hand is silence and pulling back
 * plays the record backwards — the way vinyl under a needle behaves.
 *
 * Sound comes from one of two places:
 *  - the whole song, decoded (local files), so any part can be scratched;
 *  - a rolling recording of what the deck just played (YouTube decks and
 *    files too long to decode), so the last ~30 s can be scratched.
 *
 * Positions are always in track seconds. Messages from the deck:
 *   buffer {data, rate}   whole-song mono audio; clearBuffer
 *   anchor {t, ctxT, rate, rec}   track time t at context time ctxT, for the recorder
 *   resetRing             forget the rolling recording (load / big jump)
 *   grab {t}  move {t}    hand down at t, hand moved to t
 *   release {rate, fade}  let go: spin up to `rate`, fade out after `fade` s
 *   stop                  fade out now
 *   dump {id}             reply with the newest unbroken recording (tempo detection)
 */
/* global sampleRate, currentTime, registerProcessor, AudioWorkletProcessor */

const RING_SECONDS = 32
const BLOCK = 128
const HAND_TAU = 0.012 // seconds for the playhead to catch the hand
const SPINUP_TAU = 0.06 // seconds for a released record to reach speed
const FADE_TAU = 0.012

class ScratchProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buf = null
    this.bufRate = 0
    const blocks = Math.ceil((RING_SECONDS * sampleRate) / BLOCK)
    this.ring = new Float32Array(blocks * BLOCK)
    this.blockT = new Float64Array(blocks).fill(NaN)
    this.blockRate = new Float32Array(blocks)
    this.blocks = blocks
    this.ringBlock = 0
    this.lastHit = 0
    this.missT = -1
    this.anchor = { t: 0, ctxT: 0, rate: 1, rec: false }

    this.mode = 'off' // 'hand' | 'free' | 'off'
    this.pos = 0
    this.target = 0
    this.speed = 0
    this.freeRate = 1
    this.fadeAt = Infinity
    this.gain = 0
    this.gainTarget = 0

    this.handK = 1 - Math.exp(-1 / (HAND_TAU * sampleRate))
    this.spinK = 1 - Math.exp(-1 / (SPINUP_TAU * sampleRate))
    this.fadeK = 1 - Math.exp(-1 / (FADE_TAU * sampleRate))

    this.port.onmessage = e => this.onMessage(e.data)
  }

  onMessage(m) {
    switch (m.type) {
      case 'buffer': this.buf = m.data; this.bufRate = m.rate; break
      case 'clearBuffer': this.buf = null; break
      case 'anchor': this.anchor = { t: m.t, ctxT: m.ctxT, rate: m.rate, rec: m.rec }; break
      case 'resetRing': this.blockT.fill(NaN); this.missT = -1; break
      case 'grab':
        this.mode = 'hand'
        this.pos = this.target = m.t
        this.speed = 0
        this.fadeAt = Infinity
        this.gainTarget = 1
        break
      case 'move': this.target = m.t; break
      case 'release':
        this.mode = 'free'
        this.freeRate = m.rate
        this.fadeAt = currentTime + m.fade
        if (m.rate === 0) this.gainTarget = 0
        break
      case 'stop': this.gainTarget = 0; this.fadeAt = currentTime; break
      case 'dump': this.port.postMessage(this.dump(m.id)); break
    }
  }

  /**
   * The newest unbroken stretch of the recording, oldest sample first —
   * used to find the tempo of songs that are never decoded up front.
   */
  dump(id) {
    const n = this.blocks
    const dur = BLOCK / sampleRate
    let b = (this.ringBlock - 1 + n) % n
    if (this.blockT[b] !== this.blockT[b]) return { type: 'dump', id, data: null }
    let count = 1
    while (count < n) {
      const prev = (b - 1 + n) % n
      const tp = this.blockT[prev]
      if (tp !== tp) break
      const expect = this.blockT[b] - dur * this.blockRate[prev]
      if (Math.abs(tp - expect) > dur * 2) break // a seek, loop or pause broke the run
      b = prev
      count++
    }
    const data = new Float32Array(count * BLOCK)
    for (let k = 0; k < count; k++) {
      const src = ((b + k) % n) * BLOCK
      data.set(this.ring.subarray(src, src + BLOCK), k * BLOCK)
    }
    return { type: 'dump', id, data, t0: this.blockT[b], rate: this.blockRate[b], sampleRate }
  }

  /** Record what the deck plays, stamping each block with its track time. */
  record(input) {
    const a = this.anchor
    if (!a.rec || !input || !input.length || !input[0]) return
    const b = this.ringBlock
    const off = b * BLOCK
    const ch0 = input[0]
    const ch1 = input[1]
    for (let i = 0; i < BLOCK; i++) this.ring[off + i] = ch1 ? (ch0[i] + ch1[i]) * 0.5 : ch0[i]
    this.blockT[b] = a.t + (currentTime - a.ctxT) * a.rate
    this.blockRate[b] = a.rate
    this.ringBlock = (b + 1) % this.blocks
  }

  /** Sample at track time t from the rolling recording, or 0 when it was not recorded. */
  readRing(t) {
    const n = this.blocks
    const dur = BLOCK / sampleRate
    // Just missed near here: unrecorded stretches stay silent without a search per sample.
    if (Math.abs(t - this.missT) < dur) return 0
    // Search outwards from the last block that matched — scratching stays local.
    for (let d = 0; d < n; d++) {
      for (const k of d === 0 ? [0] : [d, -d]) {
        const b = (((this.lastHit + k) % n) + n) % n
        const t0 = this.blockT[b]
        if (t0 !== t0) continue // NaN
        const span = dur * this.blockRate[b]
        if (t >= t0 && t < t0 + span) {
          this.lastHit = b
          const x = ((t - t0) / span) * BLOCK
          const i = Math.floor(x)
          const f = x - i
          const s0 = this.ring[b * BLOCK + i]
          const s1 = i + 1 < BLOCK ? this.ring[b * BLOCK + i + 1] : s0
          return s0 + (s1 - s0) * f
        }
      }
    }
    this.missT = t
    return 0
  }

  read(t) {
    if (t < 0) return 0
    const buf = this.buf
    if (buf) {
      const x = t * this.bufRate
      const i = Math.floor(x)
      if (i < 0 || i + 1 >= buf.length) return 0
      const f = x - i
      return buf[i] + (buf[i + 1] - buf[i]) * f
    }
    return this.readRing(t)
  }

  process(inputs, outputs) {
    this.record(inputs[0])
    const out = outputs[0]
    const ch = out[0]
    if (!ch) return true
    if (this.mode === 'off' && this.gain < 1e-4) {
      ch.fill(0)
      for (let c = 1; c < out.length; c++) out[c].fill(0)
      return true
    }
    const dt = 1 / sampleRate
    if (this.mode === 'free' && currentTime >= this.fadeAt) this.gainTarget = 0
    for (let i = 0; i < ch.length; i++) {
      if (this.mode === 'hand') {
        const next = this.pos + (this.target - this.pos) * this.handK
        this.speed = (next - this.pos) / dt
        this.pos = next
      } else if (this.mode === 'free') {
        this.speed += (this.freeRate - this.speed) * this.spinK
        this.pos += this.speed * dt
      }
      this.gain += (this.gainTarget - this.gain) * this.fadeK
      // A stylus barely moving makes no sound; keep the hush clean.
      const level = Math.min(1, Math.abs(this.speed) * 8)
      ch[i] = this.read(this.pos) * this.gain * level
    }
    for (let c = 1; c < out.length; c++) out[c].set(ch)
    if (this.mode === 'free' && this.gainTarget === 0 && this.gain < 1e-4) this.mode = 'off'
    return true
  }
}

registerProcessor('aihub-dj-scratch', ScratchProcessor)
