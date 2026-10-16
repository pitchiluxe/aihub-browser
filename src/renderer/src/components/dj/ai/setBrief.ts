// A brief is one sentence: what to play, for how long, and where the energy
// goes. Presets and common phrasing are read by rules so a set starts
// instantly; embedded instructions ("no Drake") become rules from the start.
import { parseInstruction, type SetRule } from './instructions'

export interface EnergyPoint { atMin: number; level: number }
export interface SetBrief { vibe: string; durationMin: number; curve: EnergyPoint[]; discoveryShare: number; seeds: string[]; rules: SetRule[] }
export type PresetId = 'warmup' | 'peak' | 'late' | 'focus' | 'workout'

export const PRESETS: Record<PresetId, { label: string; text: string }> = {
  warmup:  { label: 'Warm-up',   text: 'afrobeats and house warm-up, 1h' },
  peak:    { label: 'Peak hour', text: 'peak hour party hits, 1h' },
  late:    { label: 'Late night', text: 'late night deep house and r&b, 90 min' },
  focus:   { label: 'Focus',     text: 'focus lofi and jazz, 2h' },
  workout: { label: 'Workout',   text: 'workout high energy hip hop and edm, 45 min' },
}

const SHAPES: Record<string, (d: number) => EnergyPoint[]> = {
  warmup:  d => [{ atMin: 0, level: 0.35 }, { atMin: d, level: 0.7 }],
  peak:    d => [{ atMin: 0, level: 0.75 }, { atMin: d * 0.5, level: 0.95 }, { atMin: d, level: 0.85 }],
  late:    d => [{ atMin: 0, level: 0.55 }, { atMin: d, level: 0.3 }],
  focus:   d => [{ atMin: 0, level: 0.3 }, { atMin: d, level: 0.3 }],
  workout: d => [{ atMin: 0, level: 0.7 }, { atMin: d * 0.3, level: 0.95 }, { atMin: d * 0.9, level: 0.95 }, { atMin: d, level: 0.6 }],
  default: d => [{ atMin: 0, level: 0.45 }, { atMin: d * 0.65, level: 0.8 }, { atMin: d, level: 0.6 }],
}

export function curveAt(curve: EnergyPoint[], atMin: number): number {
  if (!curve.length) return 0.5
  if (atMin <= curve[0].atMin) return curve[0].level
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1], b = curve[i]
    if (atMin <= b.atMin) return a.level + ((b.level - a.level) * (atMin - a.atMin)) / Math.max(1e-9, b.atMin - a.atMin)
  }
  return curve[curve.length - 1].level
}

function readDuration(t: string): number | null {
  const m = /(\d+(?:\.\d+)?) ?(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/.exec(t)
  if (!m) return null
  const n = Number(m[1])
  return Math.round(/^h/.test(m[2]) ? n * 60 : n)
}

export function parseBrief(text: string, opts: { nowHour?: number; nowMinute?: number; now?: number } = {}): SetBrief {
  const now = new Date()
  const nowHour = opts.nowHour ?? now.getHours(), nowMinute = opts.nowMinute ?? now.getMinutes()
  const lower = text.toLowerCase().trim()
  const durationMin = Math.min(240, Math.max(20, readDuration(lower) ?? 60))

  const shapeKey = /warm[- ]?up|opening/.test(lower) ? 'warmup' : /\bpeak\b|party|hype|club/.test(lower) ? 'peak'
    : /late night|after ?hours|wind down/.test(lower) ? 'late' : /focus|study|work(ing)? music|concentrat/.test(lower) ? 'focus'
    : /workout|gym|run(ning)?|training/.test(lower) ? 'workout' : 'default'
  let curve = SHAPES[shapeKey](durationMin)

  // "peak at 11" / "peak at 23:30": put the top of the curve there.
  const pk = /peak (?:at|around) (\d{1,2})(?::(\d{2}))? ?(am|pm)?/.exec(lower)
  if (pk) {
    let h = Number(pk[1]) % 24
    if (pk[3] === 'pm' && h < 12) h += 12
    else if (!pk[3] && h < 12 && h + 12 > nowHour) h += 12
    const at = ((h * 60 + Number(pk[2] || 0)) - (nowHour * 60 + nowMinute) + 1440) % 1440
    const atMin = Math.min(durationMin, at)
    curve = [{ atMin: 0, level: curve[0].level }, { atMin, level: 0.95 }, ...(atMin < durationMin ? [{ atMin: durationMin, level: 0.75 }] : [])]
  }

  const rules: SetRule[] = []
  const seeds: string[] = []
  const parts = lower.split(/,|;| into | then | and then /).map(s => s.trim()).filter(Boolean)
  for (const part of parts) {
    const asRule = parseInstruction(part, opts.now)
    const r = asRule.items.find(i => 'rule' in i)
    if (r && 'rule' in r && r.rule.kind !== 'onlyGenres' && r.rule.kind !== 'moreGenre') { rules.push(r.rule); continue }
    const seed = part
      .replace(/\b\d+(?:\.\d+)? ?(h|hr|hrs|hours?|m|mins?|minutes?)\b/g, '')
      .replace(/\bpeak (?:at|around) \d{1,2}(?::\d{2})? ?(am|pm)?\b/g, '')
      .replace(/\b(warm[- ]?up|opening|peak hour|peak|party hits|late night|after ?hours|wind down|focus|workout|high energy|set|mix|music|for|a|an|the|of|some)\b/g, '')
      // Shape words between styles ("… then build into amapiano") are not
      // searches: "build" alone filled the pool with songs titled "Build".
      .replace(/\b(build(?:s|ing)?(?: it)?(?: up)?|start(?:s|ing)?(?: off| with)?|end(?:s|ing)?(?: with| on)?|finish(?:es|ing)?(?: with| on)?|move|moving|go|going|switch(?:ing)?|ease|easing|slowly|gradually)\b/g, '')
      .replace(/\s+/g, ' ').trim()
    if (seed && !/^\d+$/.test(seed)) seeds.push(...seed.split(/ and | & /).map(s => s.trim()).filter(Boolean))
  }

  return { vibe: text.trim(), durationMin, curve, discoveryShare: 0.25, seeds: seeds.length ? seeds : [lower.split(',')[0].trim()], rules }
}
