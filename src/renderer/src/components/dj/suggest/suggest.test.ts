import { describe, it, expect } from 'vitest'
import { densityOf, findBreakdown, phraseGrid, snapMs } from './phrase'
import { extractJson, oneSentence, parseFx, parseSuggestion } from './parse'
import { directionFor, FloorMeter, reindex } from './rank'
import { clashOf, decide } from './stemGuard'
import { downsample, encodeWav, toFilter } from './voice'
import { FxRunner, schedule } from './fxScript'
import { suggestionSchema } from './prompt'
import type { PoolEntry, TrackRecord } from './types'

let n = 0
const entry = (over: Partial<PoolEntry> = {}): PoolEntry => {
  const id = `file:C:/m/${++n}.mp3`
  const record: TrackRecord = { id, title: `Song ${n}`, artist: 'A', bpm: 120, camelot: '8A', energy: 0.6, density: 0.5, durationSec: 240, introEndSec: 8, outroStartSec: 208 }
  return {
    id, title: record.title, artist: 'A', bpm: 120, camelot: '8A', energy: 0.6, density: 0.5, durationSec: 240,
    relation: 'perfect', pitchPct: 0, phrasesMs: phraseGrid(120, 8, 240, 40), beatMs: 500, record, ...over,
  }
}

describe('phrase metrics', () => {
  it('lays a 16-beat grid from the downbeat and snaps to it', () => {
    const g = phraseGrid(120, 8, 64)   // 8 s phrases
    expect(g).toEqual([0, 8000, 16000, 24000, 32000, 40000, 48000, 56000])
    expect(snapMs(10100, g)).toBe(8000)
    expect(snapMs(12500, g)).toBe(16000)
    expect(phraseGrid(120, 0, 600, 16)).toHaveLength(16)
  })

  it('finds the bass drop-out of a breakdown', () => {
    const rate = 10
    const low = new Float32Array(200 * rate).fill(0.8)
    low.fill(0.1, 120 * rate, 136 * rate)
    expect(findBreakdown(low, rate, 200, 190)).toBeCloseTo(120, 0)
    expect(findBreakdown(new Float32Array(200 * rate).fill(0.8), rate, 200)).toBeNull()
  })

  it('reads a brick-walled master as denser than a dynamic one', () => {
    const flat = Float32Array.from({ length: 4000 }, (_, i) => 0.8 + 0.05 * Math.sin(i))
    const dyn = Float32Array.from({ length: 4000 }, (_, i) => 0.1 + 0.8 * Math.abs(Math.sin(i / 50)) ** 4)
    expect(densityOf(flat)!).toBeGreaterThan(0.85)
    expect(densityOf(dyn)!).toBeLessThan(0.5)
  })
})

describe('model answer', () => {
  it('pulls JSON out of a fenced reply and keeps one sentence', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('Here you go: {"a":2} hope it helps')).toEqual({ a: 2 })
    expect(oneSentence("Sure! Here's my pick: relative minor lift keeps the groove. Also it is great.")).toBe('Relative minor lift keeps the groove.')
    expect(oneSentence('Both compatible with now_playing')).toBe('Both compatible with the playing track.')
  })

  it('keeps pool picks only, snaps cues to phrases and fills to three', () => {
    const pool = [entry(), entry(), entry(), entry()]
    const json = {
      picks: [
        { id: pool[2].id, rationale: 'Same key, same tempo.', energy_rating: 8, cues: [{ label: 'Mix in', ms: 8100 }, { label: 'Drop', ms: 23000 }, { label: 'Outro', ms: 207000 }], loop: { start_ms: 40100, end_ms: 48000 }, mix_in_ms: 8100, gain_trim_db: -9, stems: { isolate: 'instrumental', deck: 'incoming' } },
        { id: 'file:invented.mp3', rationale: 'x' },
        { id: pool[2].id, rationale: 'dup' },
      ],
      mashup: { ids: [pool[0].id, pool[1].id], rationale: 'They layer.' },
      fx: [{ at_beat: 0, fx: 'echo', action: 'on', value: 0.6, beats: 0 }, { at_beat: -16, fx: 'filter', action: 'sweep', value: 0.2, beats: 16 }],
    }
    const r = parseSuggestion(json, pool, 'hold')
    expect(r.fromModel).toBe(1)
    expect(r.picks.map(p => p.entry.id)).toEqual([pool[2].id, pool[0].id, pool[1].id])
    const p = r.picks[0]
    expect(p.cues.map(c => c.ms)).toEqual([8000, 24000, 208000])
    expect(p.loop).toEqual({ startMs: 40000, endMs: 48000 })   // 8 s = 16 beats at 120 BPM
    expect(p.gainTrimDb).toBe(-6)
    expect(r.mashup?.entries.map(e => e.id)).toEqual([pool[0].id, pool[1].id])
    expect(r.fx.map(f => f.atBeat)).toEqual([-16, 0])
  })

  it('still offers three picks, a mashup and a macro with no model at all', () => {
    const pool = [entry(), entry(), entry({ camelot: '9A', relation: 'adjacent' })]
    const r = parseSuggestion(null, pool, 'step_up')
    expect(r.picks).toHaveLength(3)
    expect(r.picks[0].cues).toHaveLength(3)
    expect(r.mashup).not.toBeNull()
    expect(r.fx.length).toBeGreaterThan(0)
  })

  it('constrains the answer to pool ids in the schema', () => {
    const s: any = suggestionSchema(['yt:abcdefghijk', 'yt:bbbbbbbbbbb'])
    expect(s.properties.picks.items.properties.id.enum).toEqual(['yt:abcdefghijk', 'yt:bbbbbbbbbbb'])
    expect(s.properties.picks.minItems).toBe(3)
  })
})

describe('vibe check', () => {
  it('turns floor against track energy into a direction', () => {
    expect(directionFor(0.9, 0.6)).toBe('step_up')
    expect(directionFor(0.3, 0.6)).toBe('cool_down')
    expect(directionFor(0.65, 0.6)).toBe('hold')
    expect(directionFor(null, 0.6)).toBe('hold')
  })

  it('re-orders picks for the floor without a new model call', () => {
    const pool = [entry({ energy: 0.4 }), entry({ energy: 0.6 }), entry({ energy: 0.9 })]
    const picks = parseSuggestion(null, pool, 'hold').picks
    expect(reindex(picks, 'step_up', 0.6)[0].entry.energy).toBe(0.9)
    expect(reindex(picks, 'cool_down', 0.6)[0].entry.energy).toBe(0.4)
  })

  it('smooths meter readings, takes the slider as is, forgets a silent meter', () => {
    let t = 0
    const m = new FloorMeter(1000, () => t)
    m.push(1, 'crowd'); m.push(0, 'crowd')
    expect(m.get()).toBeCloseTo(0.7)
    t = 5000
    expect(m.get()).toBeNull()
    m.push(0.2, 'manual'); t = 1e6
    expect(m.get()).toBe(0.2)
  })
})

describe('stem trigger', () => {
  it('isolates on a vocal clash and holds the bass on a bassline clash', () => {
    expect(clashOf({ vocal: 0.8, bass: 0.3 }, { vocal: 0.7, bass: 0.3 })).toEqual({ vocal: true, bass: false })
    expect(decide({ vocal: true, bass: false }, null)).toEqual({ deck: 'incoming', isolate: 'instrumental', killBass: false })
    expect(decide({ vocal: false, bass: true }, { isolate: 'none', deck: 'incoming' })).toEqual({ deck: 'incoming', isolate: null, killBass: true })
    expect(decide({ vocal: true, bass: true }, { isolate: 'acapella', deck: 'outgoing' })).toEqual({ deck: 'outgoing', isolate: 'acapella', killBass: false })
    expect(decide({ vocal: false, bass: false }, null)).toBeNull()
  })
})

describe('voice commands', () => {
  it('encodes 16-bit mono WAV', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1]), 16000)
    const v = new DataView(wav)
    expect(String.fromCharCode(...new Uint8Array(wav, 0, 4))).toBe('RIFF')
    expect(v.getUint32(24, true)).toBe(16000)
    expect(v.getInt16(46, true)).toBe(0x7fff)
    expect(v.getInt16(48, true)).toBe(-0x8000)
    expect(downsample(new Float32Array(48000), 48000)).toHaveLength(16000)
  })

  it('turns the model filter into a library filter, blanks meaning not said', () => {
    expect(toFilter({ clear: false, genres: ['House'], bpm_min: 0, bpm_max: 0, year_from: 1990, year_to: 1999, keys: ['8a', 'x'], text: '', energy: 'step_up' }))
      .toEqual({ clear: false, filter: { genres: ['house'], yearFrom: 1990, yearTo: 1999, camelot: ['8A'] }, direction: 'step_up' })
  })
})

describe('FX macro', () => {
  it('drops a degenerate macro (every step on one beat, repeats)', () => {
    const same = [0, 0, 0].map(() => ({ at_beat: 0, fx: 'reverb', action: 'on', value: 0.5, beats: 0 }))
    expect(parseFx(same)).toEqual([])
    expect(parseFx([...same, { at_beat: 4, fx: 'reverb', action: 'off', value: 0, beats: 0 }])).toHaveLength(2)
  })

  it('schedules beats from the anchor and plays them on the deck clock', () => {
    expect(schedule([{ atBeat: -4, fx: 'echo', action: 'on', value: 0.5, beats: 0 }], 100, 0.5)[0].atSec).toBe(98)
    const calls: string[] = []
    const deck: any = {
      time: 90, beatLen: 0.5, track: { token: 't' }, filterKnob: 0.5, fxOn: false, fxType: 'flanger', fxStrength: 0.6,
      setFilterKnob(v: number) { this.filterKnob = v; calls.push(`filter ${v.toFixed(2)}`) },
      setFxType(t: string) { this.fxType = t; calls.push(`type ${t}`) },
      setFxOn(on: boolean) { this.fxOn = on; calls.push(`on ${on}`) },
      setFxStrength(v: number) { this.fxStrength = v },
    }
    const fx = new FxRunner()
    expect(fx.arm(deck, [{ atBeat: -8, fx: 'filter', action: 'sweep', value: 0.2, beats: 8 }, { atBeat: 0, fx: 'echo', action: 'on', value: 0.6, beats: 0 }, { atBeat: 4, fx: 'echo', action: 'off', value: 0, beats: 0 }], 100)).toBe(3)
    for (const t of [96, 98, 100, 102, 104]) { deck.time = t; fx.tick() }
    expect(deck.filterKnob).toBeCloseTo(0.2)
    expect(calls).toContain('type echo')
    expect(calls).toContain('on true')
    expect(deck.fxOn).toBe(false)
  })
})
