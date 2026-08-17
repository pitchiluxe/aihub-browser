import { describe, it, expect } from 'vitest'
import {
  pickVoice, scoreVoice, speechChunks, spokenReference,
  VERSE_PITCH, VERSE_RATE, type VoiceLike,
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
