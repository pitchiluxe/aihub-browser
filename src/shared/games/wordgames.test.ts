import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { seededRandom } from './random'
import { buildCrossword, cellsOf, CLUE_BANK } from './crossword'
import { CENTER, findBestMove, LETTERS, makeDictionary, newWordTiles, passWordTiles, playWordTiles, PREMIUMS, scoreMove, SIZE, type Placement } from './wordtiles'

const dictionary = makeDictionary(readFileSync(join(__dirname, '../../renderer/src/components/games/data/words.txt'), 'utf8'))
const across = (word: string, row: number, col: number): Placement[] => [...word].map((letter, i) => ({ row, col: col + i, letter, blank: false }))

describe('crossword generator', () => {
  it('uses only clean answers from its own bank', () => {
    for (const [answer, clue] of CLUE_BANK) { expect(answer).toMatch(/^[A-Z]{3,11}$/); expect(clue.length).toBeGreaterThan(3) }
  })
  it('builds a connected grid where every crossing letter agrees', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const puzzle = buildCrossword(seededRandom(seed))
      expect(puzzle.words.length).toBeGreaterThanOrEqual(10)
      for (const word of puzzle.words) cellsOf(word).forEach(([r, c], i) => expect(puzzle.grid[r][c]).toBe(word.answer[i]))
      // Every word after the first shares a cell with another word.
      for (const word of puzzle.words) expect(puzzle.words.some(other => other !== word && cellsOf(other).some(([r, c]) => cellsOf(word).some(([y, x]) => y === r && x === c)))).toBe(true)
    }
  })
})
describe('word tiles', () => {
  it('has a 100-tile bag and a symmetric board with the star in the middle', () => {
    expect(Object.values(LETTERS).reduce((sum, [count]) => sum + count, 0)).toBe(100)
    expect(PREMIUMS[CENTER][CENTER]).toBe('DW')
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) expect(PREMIUMS[r][c]).toBe(PREMIUMS[c][r])
  })
  it('checks words against the dictionary and scores premiums', () => {
    const empty = newWordTiles().board
    expect(scoreMove(empty, across('CAT', 7, 6), dictionary)).toMatchObject({ ok: true, score: 10 })
    expect(scoreMove(empty, across('CAT', 6, 6), dictionary).error).toMatch(/centre/)
    expect(scoreMove(empty, across('XQZ', 7, 6), dictionary).error).toMatch(/dictionary/)
  })
  it('requires new words to connect and counts every cross-word', () => {
    const state = newWordTiles(), first = playWordTiles({ ...state, racks: [['C', 'A', 'T', 'E', 'E', 'E', 'E'], state.racks[1]] }, across('CAT', 7, 6), dictionary).state
    expect(scoreMove(first.board, across('DOG', 2, 2), dictionary).error).toMatch(/connect/)
    const result = scoreMove(first.board, [{ row: 7, col: 9, letter: 'S', blank: false }], dictionary)
    expect(result.ok).toBe(true); expect(result.words.map(word => word.word)).toEqual(['CATS'])
  })
  it('finds a legal move for the computer and plays a game to the end', () => {
    const random = seededRandom(5)
    let state = newWordTiles(0, 2, random)
    for (let turn = 0; turn < 80 && !state.over; turn++) {
      const move = findBestMove(state.board, state.racks[state.current], dictionary, 400)
      state = move ? playWordTiles(state, move.placements, dictionary).state : passWordTiles(state, [], random)
    }
    expect(state.board.flat().filter(Boolean).length).toBeGreaterThan(20)
    expect(Math.max(...state.scores)).toBeGreaterThan(50)
  }, 60_000)
})
