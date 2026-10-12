import { describe, it, expect } from 'vitest'
import { stageLevel } from './stageLevel'

const deck = (playing: boolean, db: number) => ({ playing, meterDb: () => db })

describe('stageLevel', () => {
  it('follows the loudest playing deck (meters live on decks, not the engine)', () => {
    expect(stageLevel({ decks: { A: deck(true, -10), B: deck(true, -30) } } as any)).toBeCloseTo(0.75)
  })
  it('is silent when nothing plays', () => {
    expect(stageLevel({ decks: { A: deck(false, -3), B: deck(false, -3) } } as any)).toBe(0)
  })
})
