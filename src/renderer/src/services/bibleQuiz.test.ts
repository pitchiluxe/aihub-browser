import { describe, it, expect } from 'vitest'
import {
  BLANK, blankKeyword, buildExercise, checkAnswer, exerciseForBox, firstLetters,
  normalizeText, pickDistractors, similarity, splitPhrases, type QuizVerse,
} from './bibleQuiz'

const JOHN_3_16: QuizVerse = {
  ref: 'JHN.3.16',
  text: 'For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.',
}

// A pool in the same voice, the way the Lab feeds it: other verses from John.
const POOL: QuizVerse[] = [
  { ref: 'JHN.1.1',   text: 'In the beginning was the Word, and the Word was with God, and the Word was God.' },
  { ref: 'JHN.14.6',  text: 'Jesus said to him, "I am the way, the truth, and the life. No one comes to the Father, except through me."' },
  { ref: 'JHN.15.13', text: 'Greater love has no one than this, that someone lay down his life for his friends.' },
  { ref: 'JHN.11.25', text: 'Jesus said to her, "I am the resurrection and the life. He who believes in me will still live, even if he dies."' },
  { ref: 'JHN.8.12',  text: 'Again, therefore, Jesus spoke to them, saying, "I am the light of the world."' },
  { ref: 'JHN.10.10', text: 'I came that they may have life, and may have it abundantly.' },
]

describe('exerciseForBox — difficulty rises with mastery', () => {
  it('maps each box to the exercise the design specifies', () => {
    expect(exerciseForBox(1)).toBe('choose-text')
    expect(exerciseForBox(2)).toBe('fill-blank')
    expect(exerciseForBox(3)).toBe('first-letters')
    expect(exerciseForBox(4)).toBe('scramble')
    expect(exerciseForBox(5)).toBe('type-recall')
  })
})

describe('choose-text', () => {
  const ex = buildExercise(JOHN_3_16, POOL, 1)

  it('always includes the real verse among the options', () => {
    expect(ex.options).toHaveLength(4)
    expect(ex.options).toContain(JOHN_3_16.text)
    expect(ex.options![ex.answerIndex!]).toBe(JOHN_3_16.text)
  })

  it('uses real verses as distractors, never the answer twice', () => {
    const texts = new Set(POOL.map(p => p.text))
    const wrong = ex.options!.filter((_, i) => i !== ex.answerIndex)
    expect(wrong).toHaveLength(3)
    expect(new Set(wrong).size).toBe(3)
    for (const w of wrong) expect(texts.has(w)).toBe(true)
  })

  it('presents the same options on a rebuild, so a remount is not a reshuffle', () => {
    const again = buildExercise(JOHN_3_16, POOL, 1)
    expect(again.options).toEqual(ex.options)
    expect(again.answerIndex).toBe(ex.answerIndex)
  })

  it('grades the chosen index', () => {
    expect(checkAnswer(ex, ex.answerIndex!)).toBe(true)
    expect(checkAnswer(ex, (ex.answerIndex! + 1) % 4)).toBe(false)
  })

  it('never offers a distractor identical to the answer', () => {
    const dupPool = [...POOL, { ref: 'OTHER.1.1', text: JOHN_3_16.text }]
    const d = pickDistractors(JOHN_3_16, dupPool, 3, () => 0.5)
    expect(d.every(v => normalizeText(v.text) !== normalizeText(JOHN_3_16.text))).toBe(true)
  })
})

describe('fill-blank', () => {
  const ex = buildExercise(JOHN_3_16, POOL, 2)

  it('removes exactly one word and leaves the word count intact', () => {
    expect(ex.masked!.split(/\s+/)).toHaveLength(JOHN_3_16.text.split(/\s+/).length)
    expect(ex.masked!.match(new RegExp(BLANK, 'g'))).toHaveLength(1)
  })

  it('leaves the punctuation where it was', () => {
    const punct = (s: string) => s.replace(/[^,.;:!?"']/g, '')
    expect(punct(ex.masked!)).toBe(punct(JOHN_3_16.text))
  })

  it('does not blank out a word anyone could guess without knowing the verse', () => {
    expect(['the', 'and', 'that', 'for']).not.toContain(ex.missing!.toLowerCase())
    expect(ex.missing!.length).toBeGreaterThanOrEqual(4)
  })

  it('accepts the missing word regardless of case and stray punctuation', () => {
    expect(checkAnswer(ex, ex.missing!)).toBe(true)
    expect(checkAnswer(ex, ` ${ex.missing!.toUpperCase()}. `)).toBe(true)
    expect(checkAnswer(ex, 'wrong')).toBe(false)
  })

  it('falls back gracefully on a verse of nothing but short words', () => {
    const { masked, missing } = blankKeyword('He is with us.', 0)
    expect(masked).toContain(BLANK)
    expect(missing).toBeTruthy()
  })
})

describe('first-letters', () => {
  it('keeps one letter per word, the word lengths, and the punctuation', () => {
    expect(firstLetters('For God so loved the world,')).toBe('F__ G__ s_ l____ t__ w____,')
  })

  it('produces a skeleton with the same word count as the verse', () => {
    const ex = buildExercise(JOHN_3_16, POOL, 3)
    expect(ex.skeleton!.split(/\s+/)).toHaveLength(JOHN_3_16.text.split(/\s+/).length)
  })

  it('grades against the full verse, forgiving punctuation and case', () => {
    const ex = buildExercise(JOHN_3_16, POOL, 3)
    expect(checkAnswer(ex, JOHN_3_16.text.toLowerCase().replace(/,/g, ''))).toBe(true)
    expect(checkAnswer(ex, 'for god so loved the world')).toBe(false)
  })
})

describe('scramble', () => {
  const ex = buildExercise(JOHN_3_16, POOL, 4)

  it('breaks the verse into phrases, not into individual words', () => {
    expect(ex.orderedPhrases!.length).toBeGreaterThanOrEqual(2)
    expect(ex.orderedPhrases!.every(p => p.split(/\s+/).length >= 2)).toBe(true)
  })

  it('gives back every phrase, shuffled', () => {
    expect([...ex.phrases!].sort()).toEqual([...ex.orderedPhrases!].sort())
  })

  it('never presents the phrases already in the right order', () => {
    expect(ex.phrases).not.toEqual(ex.orderedPhrases)
  })

  it('passes only the true order', () => {
    expect(checkAnswer(ex, ex.orderedPhrases!)).toBe(true)
    expect(checkAnswer(ex, [...ex.orderedPhrases!].reverse())).toBe(false)
    expect(checkAnswer(ex, ex.orderedPhrases!.slice(1))).toBe(false)
  })

  it('splits a verse with no internal punctuation into even runs', () => {
    const parts = splitPhrases('I came that they may have life and may have it abundantly')
    expect(parts.length).toBeGreaterThanOrEqual(2)
    expect(parts.join(' ')).toBe('I came that they may have life and may have it abundantly')
  })
})

describe('type-recall', () => {
  const ex = buildExercise(JOHN_3_16, POOL, 5)

  it('accepts the verse typed with different case and punctuation', () => {
    expect(checkAnswer(ex, JOHN_3_16.text)).toBe(true)
    expect(checkAnswer(ex, JOHN_3_16.text.toUpperCase().replace(/[,.]/g, ''))).toBe(true)
  })

  it('rejects half of it', () => {
    expect(checkAnswer(ex, 'For God so loved the world')).toBe(false)
  })

  it('rejects padding the answer with the whole chapter', () => {
    expect(checkAnswer(ex, `${JOHN_3_16.text} ${POOL.map(p => p.text).join(' ')}`)).toBe(false)
  })

  it('scores overlap symmetrically enough to punish both omission and padding', () => {
    expect(similarity(JOHN_3_16.text, JOHN_3_16.text)).toBe(1)
    expect(similarity('For God so loved', JOHN_3_16.text)).toBeLessThan(0.3)
  })
})

describe('every exercise type is solvable', () => {
  it('builds something answerable for each box', () => {
    for (const box of [1, 2, 3, 4, 5] as const) {
      const ex = buildExercise(JOHN_3_16, POOL, box)
      expect(ex.ref).toBe('JHN.3.16')
      expect(ex.fullText).toBe(JOHN_3_16.text)
      expect(ex.instruction).toBeTruthy()
      const answer =
        box === 1 ? ex.answerIndex! :
        box === 2 ? ex.missing! :
        box === 4 ? ex.orderedPhrases! :
        ex.fullText
      expect(checkAnswer(ex, answer)).toBe(true)
    }
  })
})
