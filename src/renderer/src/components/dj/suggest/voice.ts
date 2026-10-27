// Voice commands: push-to-talk recording of the microphone, encoded as 16 kHz
// mono WAV for the local speech-to-text server (src/main/stt.ts), and the
// transcript turned into a library filter by the local model.
import { extractJson } from './parse'
import { filterMessages, FILTER_SCHEMA } from './prompt'
import type { CandidateFilter, Direction } from './types'

const TARGET_RATE = 16000
const MAX_SEC = 15

/** Float samples → 16-bit PCM WAV. */
export function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buf
}

/** Box-filter downsampling — plenty for speech. */
export function downsample(x: Float32Array, from: number, to = TARGET_RATE): Float32Array {
  if (from <= to) return x
  const ratio = from / to
  const out = new Float32Array(Math.floor(x.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio), b = Math.min(x.length, Math.floor((i + 1) * ratio))
    let s = 0
    for (let j = a; j < b; j++) s += x[j]
    out[i] = s / Math.max(1, b - a)
  }
  return out
}

/** Push-to-talk: start() opens the microphone, stop() hands back the WAV. Its own audio context — nothing reaches the speakers. */
export class VoiceRecorder {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: ScriptProcessorNode | null = null
  private chunks: Float32Array[] = []
  private length = 0
  get recording(): boolean { return !!this.ctx }

  async start(): Promise<void> {
    if (this.ctx) return
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
    this.ctx = new AudioContext()
    const src = this.ctx.createMediaStreamSource(this.stream)
    this.node = this.ctx.createScriptProcessor(4096, 1, 1)
    this.chunks = []; this.length = 0
    const cap = MAX_SEC * this.ctx.sampleRate
    this.node.onaudioprocess = e => {
      if (this.length >= cap) return
      const c = new Float32Array(e.inputBuffer.getChannelData(0))
      this.chunks.push(c); this.length += c.length
    }
    const mute = this.ctx.createGain(); mute.gain.value = 0
    src.connect(this.node).connect(mute).connect(this.ctx.destination)
  }

  async stop(): Promise<ArrayBuffer | null> {
    const ctx = this.ctx
    if (!ctx) return null
    const rate = ctx.sampleRate
    this.node?.disconnect()
    this.stream?.getTracks().forEach(t => t.stop())
    await ctx.close().catch(() => {})
    this.ctx = null; this.node = null; this.stream = null
    if (this.length < rate * 0.4) return null // a tap, not a command
    const all = new Float32Array(this.length)
    let o = 0
    for (const c of this.chunks) { all.set(c, o); o += c.length }
    this.chunks = []
    return encodeWav(downsample(all, rate), Math.min(rate, TARGET_RATE))
  }
}

export interface VoiceFilter { clear: boolean; filter: CandidateFilter; direction: Direction | null }

/** Model JSON → a filter the library query understands (zeros and blanks mean "not said"). */
export function toFilter(j: any): VoiceFilter {
  const n = (v: unknown, lo: number, hi: number) => { const x = Number(v); return Number.isFinite(x) && x >= lo && x <= hi ? x : undefined }
  const f: CandidateFilter = {}
  const genres = Array.isArray(j?.genres) ? j.genres.filter((g: unknown) => typeof g === 'string' && g.trim()).map((g: string) => g.trim().toLowerCase()).slice(0, 5) : []
  if (genres.length) f.genres = genres
  f.bpmMin = n(j?.bpm_min, 40, 250); f.bpmMax = n(j?.bpm_max, 40, 250)
  f.yearFrom = n(j?.year_from, 1900, 2100); f.yearTo = n(j?.year_to, 1900, 2100)
  const keys = Array.isArray(j?.keys) ? j.keys.filter((k: unknown) => typeof k === 'string' && /^(1[0-2]|[1-9])[AB]$/i.test(k)).map((k: string) => k.toUpperCase()) : []
  if (keys.length) f.camelot = keys
  if (typeof j?.text === 'string' && j.text.trim()) f.text = j.text.trim().slice(0, 60)
  for (const k of Object.keys(f) as (keyof CandidateFilter)[]) if (f[k] === undefined) delete f[k]
  const direction = j?.energy === 'step_up' || j?.energy === 'cool_down' || j?.energy === 'hold' ? j.energy : null
  return { clear: j?.clear === true, filter: f, direction }
}

const ai = () => (window as any).electronAPI?.ai

/** Microphone WAV → transcript → filter. */
export async function interpret(wav: ArrayBuffer, now: { bpm: number; camelot: string | null } | null): Promise<{ transcript: string; result: VoiceFilter }> {
  const stt = await ai()?.transcribe(wav)
  if (!stt?.ok) throw new Error(stt?.error || 'Speech-to-text failed')
  const transcript: string = stt.text
  if (/^\s*(clear|reset|remove)( the)? (filters?|everything)\b/i.test(transcript)) return { transcript, result: { clear: true, filter: {}, direction: null } }
  const r = await ai()?.json(filterMessages(transcript, now), FILTER_SCHEMA)
  if (!r?.ok) throw new Error(r?.error || 'The local model did not answer')
  const j = extractJson(r.content)
  if (!j) throw new Error('The local model did not return JSON')
  return { transcript, result: toFilter(j) }
}
