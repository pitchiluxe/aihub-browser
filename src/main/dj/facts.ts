// The AI DJ's measured facts per track. Measuring a YouTube song costs a
// two-minute scan, so results are kept — but bounded, and validated, since the
// renderer is the only writer.
export interface TrackFacts {
  bpm: number | null; bpmConfidence: number; camelot: string | null; keyConfidence: number
  energy: number; introEndSec: number; outroStartSec: number; durationSec: number; playable: boolean; at: number
}

const unit = (v: unknown) => typeof v === 'number' && v >= 0 && v <= 1
const secs = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 6 * 3600

export function validFacts(x: unknown): x is TrackFacts {
  const f = x as TrackFacts
  return !!f && typeof f === 'object'
    && (f.bpm === null || (typeof f.bpm === 'number' && f.bpm > 30 && f.bpm < 300))
    && unit(f.bpmConfidence) && unit(f.keyConfidence) && unit(f.energy)
    && (f.camelot === null || (typeof f.camelot === 'string' && /^(1[0-2]|[1-9])[AB]$/.test(f.camelot)))
    && secs(f.introEndSec) && secs(f.outroStartSec) && secs(f.durationSec)
    && typeof f.playable === 'boolean' && typeof f.at === 'number'
}

export const FACTS_CAP = 5000
const ID = /^(yt:[A-Za-z0-9_-]{11}|file:.{1,1024})$/

export function putFacts(all: Record<string, TrackFacts>, id: string, f: TrackFacts, cap = FACTS_CAP): Record<string, TrackFacts> {
  if (!ID.test(id) || !validFacts(f)) return all
  const next = { ...all, [id]: f }
  const keys = Object.keys(next)
  if (keys.length > cap) {
    keys.sort((a, b) => next[a].at - next[b].at)
    for (const k of keys.slice(0, keys.length - cap)) delete next[k]
  }
  return next
}
