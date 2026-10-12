// Everything the set planner needs to know about a track, measured from its
// audio: tempo (with a confidence), key, energy and where to mix in and out.
// Pure — the same function runs in a worker for live scans and in tests.
import type { MeasuredFacts } from '../ai/types'
import { buildEnvelope, detectBpm, onsetCurve, ENV_RATE } from './analysis'
import { detectKey } from './key'

/** Below this the key detector is guessing (see the 2026-10-12 probe). */
const KEY_CONFIDENCE_FLOOR = 0.4

function perSecondRms(pcm: Float32Array, rate: number): Float32Array {
  const secs = Math.floor(pcm.length / rate)
  const out = new Float32Array(secs)
  for (let s = 0; s < secs; s++) {
    let sum = 0
    const from = Math.floor(s * rate), to = Math.floor((s + 1) * rate)
    for (let i = from; i < to; i++) sum += pcm[i] * pcm[i]
    out[s] = Math.sqrt(sum / Math.max(1, to - from))
  }
  return out
}

const median = (a: Float32Array) => { const s = Array.from(a).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0 }

export function measureFacts(pcm: Float32Array, rate: number): MeasuredFacts {
  const durationSec = pcm.length / rate
  const onset = onsetCurve(buildEnvelope(pcm, rate))
  const bpm = detectBpm(onset)

  // Tempo confidence: does each half of the song agree with the whole?
  let bpmConfidence = 0
  if (bpm !== null) {
    const half = Math.floor(onset.length / 2)
    const agrees = (x: number | null) => x !== null && Math.abs(x - bpm) / bpm < 0.02
    const a = half >= ENV_RATE * 10 ? detectBpm(onset.subarray(0, half)) : null
    const b = half >= ENV_RATE * 10 ? detectBpm(onset.subarray(half)) : null
    bpmConfidence = agrees(a) && agrees(b) ? 1 : agrees(a) || agrees(b) ? 0.7 : 0.4
  }

  const key = detectKey(pcm, rate)
  const keyOk = !!key && key.confidence >= KEY_CONFIDENCE_FLOOR

  // Energy: how loud the busy part of the song is, blended with its pace.
  const rms = perSecondRms(pcm, rate)
  const loudSorted = Array.from(rms).sort((x, y) => y - x)
  const loudHalf = loudSorted.slice(0, Math.max(1, Math.floor(loudSorted.length / 2)))
  const meanLoud = loudHalf.reduce((n, v) => n + v, 0) / loudHalf.length
  const db = 20 * Math.log10(Math.max(1e-6, meanLoud))
  const loudness = Math.min(1, Math.max(0, (db + 30) / 24))           // -30 dB → 0, -6 dB → 1
  const pace = bpm === null ? 0.3 : Math.min(1, Math.max(0, (bpm - 80) / 90)) // 80 → 0, 170 → 1
  const energy = Math.round((0.6 * loudness + 0.4 * pace) * 100) / 100

  // Mix points: where a rolling 4 s loudness first / last reaches 70% of the
  // song's typical (median) loudness.
  const typical = median(rms)
  const rolling = (i: number) => { let s = 0, n = 0; for (let k = i; k < Math.min(rms.length, i + 4); k++) { s += rms[k]; n++ } return n ? s / n : 0 }
  let introEndSec = 0, outroStartSec = Math.floor(durationSec)
  if (typical > 1e-4) {
    for (let i = 0; i < rms.length; i++) if (rolling(i) >= 0.7 * typical) { introEndSec = i; break }
    for (let i = rms.length - 4; i >= 0; i--) if (rolling(i) >= 0.7 * typical) { outroStartSec = i + 4; break }
  }

  return {
    bpm, bpmConfidence,
    camelot: keyOk ? key!.camelot : null,
    keyConfidence: key ? key.confidence : 0,
    energy, introEndSec, outroStartSec, durationSec,
  }
}
