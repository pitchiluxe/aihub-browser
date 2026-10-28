import { describe, it, expect } from 'vitest'
import { rejoinClauses } from './frenchPhonemes'
import { isNaturalVoice, NATURAL_VOICES, voiceLang } from './voiceModel'

describe('putting the punctuation back on espeak output', () => {
  it('reattaches each clause mark in order', () => {
    // espeak's real output for this sentence: one line per clause.
    const out = 'kaʁ djˈø a tɑ̃t ɛmˈe lə- mˈɔ̃d\nkil a dɔnˈe sɔ̃ fˈis ynˈik\nmɛ kil ɛ la- vˈi etɛʁnˈɛl\n'
    const text = "Car Dieu a tant aimé le monde, qu'il a donné son Fils unique, mais qu'il ait la vie éternelle."
    expect(rejoinClauses(out, text)).toBe('kaʁ djˈø a tɑ̃t ɛmˈe lə mˈɔ̃d, kil a dɔnˈe sɔ̃ fˈis ynˈik, mɛ kil ɛ la vˈi etɛʁnˈɛl.')
  })

  it('keeps questions and exclamations, which carry the tone', () => {
    const out = 'ki a kʁˈy\nʁeʒwisˈevu tuʒˈuʁ\n'
    expect(rejoinClauses(out, 'Qui a cru? Réjouissez-vous toujours!')).toBe('ki a kʁˈy? ʁeʒwisˈevu tuʒˈuʁ!')
  })

  it('drops the hyphens espeak puts on unstressed words', () => {
    expect(rejoinClauses('ʒə- nə- mɑ̃kʁˈe\n', 'je ne manquerai.')).toBe('ʒə nə mɑ̃kʁˈe.')
  })

  it('falls back to commas and a full stop when the counts disagree', () => {
    expect(rejoinClauses('a\nb\nc\n', 'a, b c')).toBe('a, b, c.')
  })

  it('returns nothing for empty output', () => {
    expect(rejoinClauses('\n\n', 'x')).toBe('')
  })
})

describe('the voice list', () => {
  it('has exactly one French voice, and it is a real voice', () => {
    const french = NATURAL_VOICES.filter(v => v.lang === 'fr')
    expect(french.map(v => v.id)).toEqual(['ff_siwis'])
    expect(isNaturalVoice('ff_siwis')).toBe(true)
    expect(voiceLang('ff_siwis')).toBe('fr')
  })

  it('leads with an English voice, the default', () => {
    expect(NATURAL_VOICES[0].lang).toBe('en')
    expect(voiceLang('af_heart')).toBe('en')
  })
})
