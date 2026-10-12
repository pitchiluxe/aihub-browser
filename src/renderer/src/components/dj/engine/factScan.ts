// Measures a track before it plays. A YouTube song is played silently on its
// own hidden scan player at 2× with key-lock off — an exact time compression —
// and captured; reading the capture at half rate restores the song exactly.
// 4× was faster but lost accuracy (2026-10-12 probe). Local files are decoded
// directly. The heavy maths runs in a worker, off the UI thread.
import type { DjTrack } from './DjEngine'
import type { MeasuredFacts } from '../ai/types'
import { captureTab, ytBridge } from './youtubeDeck'

export const FACT_SCAN_RATE = 2
const SCAN_DECK = 'F-scan'
/** Analysis rate after decimation; detectKey reads up to 1.8 kHz. */
const TARGET_RATE = 6000
/** Give up on a scan that makes no progress for this long. */
const STALL_MS = 20_000
/** Hard cap on one scan (a 7-minute song at 2× is 3.5 minutes). */
const MAX_SCAN_MS = 4 * 60_000

export interface FactSource { measure(track: DjTrack, signal: { cancelled: boolean }): Promise<MeasuredFacts | null> }

export function decimate(chunks: Float32Array[], factor: number): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Float32Array(Math.floor(total / factor))
  let k = 0, acc = 0, n = 0
  for (const c of chunks) for (let i = 0; i < c.length; i++) {
    acc += c[i]
    if (++n === factor) { if (k < out.length) out[k++] = acc / factor; acc = 0; n = 0 }
  }
  return out
}

export interface ScanPoll { ad?: boolean; paused?: boolean; ended?: boolean; t: number; d: number }

/**
 * One poll of the scan player. An ad is never recorded (its audio would be
 * measured as the song) and its end is never the song's end; when it finishes
 * the 2x rate is applied again, since YouTube resets it for the content.
 */
export function scanStep(wasAd: boolean, s: ScanPoll): { record: boolean; complete: boolean; reapplyRate: boolean } {
  const ad = !!s.ad
  return {
    record: !ad,
    complete: !ad && (!!s.ended || (!!s.d && s.t >= s.d - 1)),
    reapplyRate: wasAd && !ad,
  }
}

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, (r: MeasuredFacts | null) => void>()
function measureInWorker(pcm: Float32Array, rate: number): Promise<MeasuredFacts | null> {
  if (!worker) {
    worker = new Worker(new URL('./facts.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; facts?: MeasuredFacts }>) => {
      pending.get(e.data.id)?.(e.data.facts ?? null); pending.delete(e.data.id)
    }
  }
  const id = ++seq
  return new Promise(resolve => { pending.set(id, resolve); worker!.postMessage({ id, pcm, rate }, [pcm.buffer]) })
}

async function captureYouTube(ctx: AudioContext, videoId: string, signal: { cancelled: boolean }): Promise<{ pcm: Float32Array; rate: number } | null> {
  const yt = ytBridge()
  const loaded = await yt.load(SCAN_DECK, videoId).catch(() => null)
  // Region-blocked or embedding refused: never scanned, never played.
  if (!loaded?.ok || loaded.error) { void yt.unload(SCAN_DECK); return null }
  await yt.cmd(SCAN_DECK, 'keyLock', false)
  const streamId = await yt.streamId(SCAN_DECK).catch(() => null)
  if (!streamId) { void yt.unload(SCAN_DECK); return null }
  const stream = await captureTab(streamId, false).catch(() => null)
  if (!stream) { void yt.unload(SCAN_DECK); return null }
  const src = ctx.createMediaStreamSource(stream)
  const proc = ctx.createScriptProcessor(4096, 1, 1)
  const sink = ctx.createGain(); sink.gain.value = 0
  const chunks: Float32Array[] = []
  // Off until the first poll says the song (not a pre-roll ad) is playing.
  let recording = false, wasAd = false
  proc.onaudioprocess = e => { if (recording) chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))) }
  src.connect(proc); proc.connect(sink); sink.connect(ctx.destination)
  await yt.cmd(SCAN_DECK, 'play'); await yt.cmd(SCAN_DECK, 'rate', FACT_SCAN_RATE)
  const started = Date.now(); let lastT = -1, lastMove = Date.now(), complete = false
  try {
    while (!signal.cancelled && Date.now() - started < MAX_SCAN_MS) {
      await new Promise(r => setTimeout(r, 1000))
      const s = await yt.state(SCAN_DECK).catch(() => null) as any
      if (!s) break
      if (s.error) return null
      if (s.paused && !s.ended && !s.ad) void yt.cmd(SCAN_DECK, 'play')
      const step = scanStep(wasAd, s)
      wasAd = !!s.ad; recording = step.record
      if (step.reapplyRate) void yt.cmd(SCAN_DECK, 'rate', FACT_SCAN_RATE)
      if (step.complete) { complete = true; break }
      // An ad's clock is not the song's: it neither counts as progress nor as a stall.
      if (s.ad) { lastMove = Date.now(); continue }
      if (Math.abs(s.t - lastT) > 0.01) { lastT = s.t; lastMove = Date.now() }
      else if (Date.now() - lastMove > STALL_MS) return null
    }
  } finally {
    proc.disconnect(); src.disconnect(); sink.disconnect()
    stream.getTracks().forEach(t => t.stop())
    void yt.unload(SCAN_DECK)
  }
  if (signal.cancelled || (!complete && lastT < 30)) return null
  const factor = Math.max(1, Math.round(ctx.sampleRate / (TARGET_RATE * FACT_SCAN_RATE)))
  return { pcm: decimate(chunks, factor), rate: ctx.sampleRate / factor / FACT_SCAN_RATE }
}

async function decodeLocal(ctx: AudioContext, token: string): Promise<{ pcm: Float32Array; rate: number } | null> {
  try {
    const res = await fetch(`aihub-media://${token}/`)
    const buf = await ctx.decodeAudioData(await res.arrayBuffer())
    const ch = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i))
    const mono = new Float32Array(buf.length)
    for (const c of ch) for (let i = 0; i < c.length; i++) mono[i] += c[i] / ch.length
    const factor = Math.max(1, Math.round(buf.sampleRate / TARGET_RATE))
    return { pcm: decimate([mono], factor), rate: buf.sampleRate / factor }
  } catch { return null }
}

export function createFactSource(ctx: AudioContext): FactSource {
  return {
    async measure(track, signal) {
      const audio = track.youtubeId
        ? await captureYouTube(ctx, track.youtubeId, signal)
        : await decodeLocal(ctx, track.token)
      if (!audio || audio.pcm.length < audio.rate * 20) return null
      return measureInWorker(audio.pcm, audio.rate)
    },
  }
}
