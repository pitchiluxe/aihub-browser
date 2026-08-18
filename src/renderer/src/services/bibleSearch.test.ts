import { describe, it, expect } from 'vitest'
import { tokenize } from './bibleSearch'

// The index and the query go through the same tokenizer, so what matters is
// not any particular token but that the two sides agree — an accented verse
// must be findable by an unaccented search and the other way round.
describe('bibleSearch tokenize', () => {
  it('drops English stop words and keeps content words', () => {
    expect(tokenize('For God so loved the world')).toEqual(['god', 'loved', 'world'])
  })

  it('folds accents so “prière” and “priere” collide', () => {
    expect(tokenize('prière')).toEqual(tokenize('priere'))
    expect(tokenize('Ésaïe')).toEqual(tokenize('esaie'))
  })

  it('indexes French content words and drops French stop words', () => {
    const toks = tokenize('Car Dieu a tant aimé le monde')
    expect(toks).toContain('dieu')
    expect(toks).toContain('monde')
    expect(toks).toContain('aime')
    expect(toks).not.toContain('car')
    expect(toks).not.toContain('le')
  })

  it('breaks French elisions apart', () => {
    // "l'Éternel" has to index as the name, not as the article plus a word
    // nobody will ever type.
    expect(tokenize("l'Éternel")).toEqual(['eternel'])
    expect(tokenize('l’Éternel')).toEqual(['eternel'])
    // "qu'il" is two stop words and should leave nothing behind.
    expect(tokenize('qu’il')).toEqual([])
  })

  it('leaves English possessives alone', () => {
    // "god's" is not an elision — splitting it would index "s" and lose "god".
    expect(tokenize("God's word").some(t => t.startsWith('god'))).toBe(true)
  })
})
