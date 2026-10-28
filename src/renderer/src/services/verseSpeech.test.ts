import { describe, it, expect } from 'vitest'
import {
  FRENCH_VOICE, naturalSpeed, naturalVoiceFor, naturalVoiceSpeaks, pauseAfter, pickVoice, scoreVoice, speakable, speechChunks, spokenReference,
  systemProsody, VERSE_PITCH, VERSE_RATE, type VoiceLike,
} from './verseSpeech'

const v = (name: string, lang = 'en-US', extra: Partial<VoiceLike> = {}): VoiceLike =>
  ({ name, lang, ...extra })

describe('picking a voice', () => {
  it('prefers a natural voice over the default one', () => {
    // The ordering matters: Windows lists the ancient SAPI voices first, so
    // "whatever getVoices() returned first" is reliably the worst option.
    const chosen = pickVoice([
      v('Microsoft David Desktop - English (United States)', 'en-US', { default: true }),
      v('Microsoft Aria Online (Natural) - English (United States)'),
    ])
    expect(chosen?.name).toContain('Natural')
  })

  it('ranks natural above neural above premium above plain', () => {
    const natural = scoreVoice(v('Aria Natural'))
    const neural  = scoreVoice(v('Jenny Neural'))
    const premium = scoreVoice(v('Serena Premium'))
    const plain   = scoreVoice(v('Alex'))
    expect(natural).toBeGreaterThan(neural)
    expect(neural).toBeGreaterThan(premium)
    expect(premium).toBeGreaterThan(plain)
  })

  it('avoids eSpeak and the desktop-era voices when anything else exists', () => {
    const chosen = pickVoice([v('eSpeak English'), v('Samantha')])
    expect(chosen?.name).toBe('Samantha')
  })

  it('still returns a poor voice rather than nothing when it is all there is', () => {
    expect(pickVoice([v('eSpeak English')])?.name).toBe('eSpeak English')
  })

  it('refuses a voice in the wrong language, however good it sounds', () => {
    // An English psalm read by a French neural voice is unintelligible.
    expect(scoreVoice(v('Amelie Natural', 'fr-FR'))).toBeLessThan(0)
    expect(pickVoice([v('Amelie Natural', 'fr-FR')])).toBeNull()
  })

  it('matches on the language prefix, so en-GB counts for en', () => {
    expect(pickVoice([v('Daniel', 'en-GB')])?.name).toBe('Daniel')
  })

  it('returns null for an empty or missing voice list', () => {
    expect(pickVoice([])).toBeNull()
    expect(pickVoice(undefined as any)).toBeNull()
  })
})

describe('chunking a passage for the engine', () => {
  it('splits on sentence ends and keeps the punctuation', () => {
    const chunks = speechChunks('In the beginning God created the heavens and the earth. The earth was formless.')
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toMatch(/earth\.$/)
  })

  it('keeps a question mark on its clause so the engine inflects', () => {
    const chunks = speechChunks('Who has believed our message? To whom has the arm been revealed?')
    expect(chunks[0].endsWith('?')).toBe(true)
    expect(chunks[1].endsWith('?')).toBe(true)
  })

  it('breaks a long sentence at its internal punctuation', () => {
    const long = 'For God so loved the world, that he gave his one and only Son, ' +
      'that whoever believes in him should not perish, but have eternal life, ' +
      'and this is the promise that stands over every page that follows it.'
    const chunks = speechChunks(long, 60)
    expect(chunks.length).toBeGreaterThan(2)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(90)
  })

  it('never cuts a word in half, even past the cap', () => {
    const noPunctuation = 'a'.repeat(400)
    const chunks = speechChunks(noPunctuation, 100)
    expect(chunks.join('')).toContain('aaaa')
    expect(chunks.join(' ').replace(/\s/g, '')).toBe(noPunctuation)
  })

  it('collapses whitespace so line breaks are not read as pauses', () => {
    expect(speechChunks('The LORD\n\n  is my   shepherd.')).toEqual(['The LORD is my shepherd.'])
  })

  it('returns nothing for empty or missing text rather than an empty utterance', () => {
    expect(speechChunks('')).toEqual([])
    expect(speechChunks('   ')).toEqual([])
    expect(speechChunks(undefined as any)).toEqual([])
  })

  it('reassembles to the original words, so nothing is dropped', () => {
    const text = 'Come to me, all you who labour and are heavily burdened, and I will give you rest. ' +
      'Take my yoke upon you and learn from me; for I am gentle and lowly in heart.'
    const words = (s: string) => s.replace(/\s+/g, ' ').trim()
    expect(words(speechChunks(text).join(' '))).toBe(words(text))
  })
})

describe('spoken references', () => {
  it('says "verse" instead of a colon', () => {
    expect(spokenReference('John 3:16')).toBe('John 3 verse 16')
  })

  it('reads a verse range as "to"', () => {
    expect(spokenReference('1 Thessalonians 5:16–18')).toBe('1 Thessalonians 5 verse 16 to 18')
  })

  it('leaves a reference without a colon alone', () => {
    expect(spokenReference('Psalm 23')).toBe('Psalm 23')
  })
})

describe('prosody', () => {
  it('reads slower and slightly lower than the UI default', () => {
    // Scripture at rate 1.0 sounds like a terms-and-conditions readout.
    expect(VERSE_RATE).toBeLessThan(1)
    expect(VERSE_PITCH).toBeLessThanOrEqual(1)
  })
})

describe('reading like a person', () => {
  it('says LORD as a word, not four letters', () => {
    expect(speakable('The LORD is my shepherd. [GOD] said')).toBe('The Lord is my shepherd. God said')
  })

  it('rests longer after a full stop than after a comma', () => {
    expect(pauseAfter('He restores my soul.')).toBeGreaterThan(pauseAfter('He leads me,'))
  })

  it('leaves the longest rest after the announced reference', () => {
    expect(pauseAfter('Psalm 23', true)).toBeGreaterThan(pauseAfter('Amen.'))
  })

  it('does not read every clause at one identical rate', () => {
    const rates = new Set([0, 1, 2, 3].map(i => systemProsody('and the earth.', i, 10).rate.toFixed(3)))
    expect(rates.size).toBeGreaterThan(1)
  })

  it('stays close to the base rate — drift, not wobble', () => {
    for (let i = 0; i < 12; i++) {
      const { rate } = systemProsody('x.', i, 20)
      expect(Math.abs(rate - VERSE_RATE) / VERSE_RATE).toBeLessThan(0.05)
    }
  })

  it('lifts the pitch on a question', () => {
    expect(systemProsody('Who is like you?', 0, 3).pitch).toBeGreaterThan(systemProsody('You are.', 0, 3).pitch)
  })

  it('slows down to land the last clause', () => {
    expect(systemProsody('Amen.', 4, 5).rate).toBeLessThan(systemProsody('Amen.', 0, 5).rate)
    expect(naturalSpeed(4, 5)).toBeLessThan(naturalSpeed(0, 5))
  })

  it('follows the reading pace setting', () => {
    expect(naturalSpeed(0, 3, 0.8)).toBeLessThan(naturalSpeed(0, 3, 1.1))
    expect(systemProsody('x.', 0, 3, 0.8).rate).toBeLessThan(systemProsody('x.', 0, 3, 1.1).rate)
  })
})

describe('French and the choice of voice', () => {
  it('announces a French reference the French way', () => {
    expect(spokenReference('Jean 3:16', 'fr')).toBe('Jean 3, verset 16')
    expect(spokenReference('1 Thessaloniciens 5:16–18', 'fr')).toBe('1 Thessaloniciens 5, verset 16 à 18')
  })

  it('reads English and French with the natural voice, nothing else', () => {
    expect(naturalVoiceSpeaks('en')).toBe(true)
    expect(naturalVoiceSpeaks('fr')).toBe(true)
    expect(naturalVoiceSpeaks('de')).toBe(false)
  })

  it('uses the voice the reader picked for English', () => {
    expect(naturalVoiceFor('en', 'am_michael')).toBe('am_michael')
  })

  it('always reads French with the French voice, whatever was picked', () => {
    expect(naturalVoiceFor('fr', 'am_michael')).toBe(FRENCH_VOICE)
  })

  it('never asks the French voice to read English', () => {
    expect(naturalVoiceFor('en', FRENCH_VOICE)).toBe('af_heart')
    expect(naturalVoiceFor('en', '')).toBe('af_heart')
  })
})
