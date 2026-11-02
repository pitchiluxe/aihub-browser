import { shuffled, type Random } from './random'
// Word Tiles: build crossing words on a 15 × 15 board from a rack of seven.
// The premium layout and tile mix are this game's own.
export const SIZE = 15, CENTER = 7, RACK = 7, BINGO = 50
export type Premium = 'DL' | 'TL' | 'DW' | 'TW' | null
const OCTANT: [number, number, Exclude<Premium, null>][] = [
  [0, 3, 'TW'], [3, 0, 'TW'], [1, 1, 'DW'], [2, 2, 'DW'], [4, 4, 'DW'], [1, 6, 'TL'], [5, 5, 'TL'], [3, 7, 'TL'], [0, 0, 'DL'], [2, 6, 'DL'], [3, 3, 'DL'], [6, 6, 'DL'], [0, 7, 'DL'], [5, 1, 'DL'],
]
export const PREMIUMS: Premium[][] = (() => {
  const grid: Premium[][] = Array.from({ length: SIZE }, () => Array(SIZE).fill(null))
  const last = SIZE - 1
  for (const [r, c, kind] of OCTANT) for (const [y, x] of [[r, c], [c, r], [last - r, c], [c, last - r], [r, last - c], [last - c, r], [last - r, last - c], [last - c, last - r]]) grid[y][x] = kind
  grid[CENTER][CENTER] = 'DW'
  return grid
})()
export const LETTERS: Record<string, [number, number]> = {
  A: [9, 1], B: [2, 3], C: [2, 3], D: [4, 2], E: [11, 1], F: [2, 4], G: [3, 2], H: [3, 3], I: [8, 1], J: [1, 8], K: [1, 5], L: [4, 1], M: [2, 3],
  N: [6, 1], O: [8, 1], P: [2, 3], Q: [1, 10], R: [6, 1], S: [5, 1], T: [6, 1], U: [4, 1], V: [2, 4], W: [2, 4], X: [1, 8], Y: [2, 4], Z: [1, 10], '?': [2, 0],
}
export const letterValue = (letter: string) => LETTERS[letter]?.[1] ?? 0
export interface Cell { letter: string; blank: boolean }
export interface Placement { row: number; col: number; letter: string; blank: boolean }
export interface WordTilesState { board: (Cell | null)[][]; racks: string[][]; bag: string[]; scores: number[]; names: string[]; bots: boolean[]; current: number; passes: number; over: boolean; log: string[]; last: Placement[] }
export interface Dictionary { has: (word: string) => boolean; hasPrefix: (prefix: string) => boolean }
/** Dictionary over a newline-separated word list; prefix checks use binary search on the sorted list. */
export function makeDictionary(text: string): Dictionary {
  const words = text.split(/\r?\n/).map(word => word.trim().toUpperCase()).filter(word => /^[A-Z]{2,15}$/.test(word)).sort()
  const set = new Set(words)
  return {
    has: word => set.has(word),
    hasPrefix: prefix => { let lo = 0, hi = words.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (words[mid] < prefix) lo = mid + 1; else hi = mid } return lo < words.length && words[lo].startsWith(prefix) },
  }
}
export function newWordTiles(humans = 1, total = 2, random: Random = Math.random): WordTilesState {
  const bag = shuffled(Object.entries(LETTERS).flatMap(([letter, [count]]) => Array(count).fill(letter) as string[]), random)
  const count = Math.min(4, Math.max(2, total))
  const racks = Array.from({ length: count }, () => bag.splice(0, RACK))
  return { board: Array.from({ length: SIZE }, () => Array(SIZE).fill(null)), racks, bag, scores: Array(count).fill(0), names: Array.from({ length: count }, (_, i) => i < humans ? humans === 1 ? 'You' : `Player ${i + 1}` : `Computer ${i - humans + 1}`), bots: Array.from({ length: count }, (_, i) => i >= humans), current: 0, passes: 0, over: false, log: ['The first word must cover the centre star.'], last: [] }
}
const inside = (row: number, col: number) => row >= 0 && col >= 0 && row < SIZE && col < SIZE
export interface MoveResult { ok: boolean; error?: string; words: { word: string; score: number }[]; score: number }
export function scoreMove(board: (Cell | null)[][], placements: Placement[], dictionary: Dictionary): MoveResult {
  const fail = (error: string): MoveResult => ({ ok: false, error, words: [], score: 0 })
  if (!placements.length) return fail('Place at least one tile.')
  if (placements.some(p => !inside(p.row, p.col) || board[p.row][p.col])) return fail('Tiles must go on empty squares.')
  if (new Set(placements.map(p => p.row * SIZE + p.col)).size !== placements.length) return fail('Two tiles cannot share a square.')
  const sameRow = placements.every(p => p.row === placements[0].row), sameCol = placements.every(p => p.col === placements[0].col)
  if (!sameRow && !sameCol) return fail('Tiles must be in one row or one column.')
  const at = new Map(placements.map(p => [p.row * SIZE + p.col, p]))
  const letterAt = (row: number, col: number) => board[row]?.[col] ?? at.get(row * SIZE + col) ?? null
  const across = placements.length > 1 ? sameRow : !!(letterAt(placements[0].row, placements[0].col - 1) || letterAt(placements[0].row, placements[0].col + 1))
  // The tiles placed must form one unbroken line, with existing tiles filling any gaps.
  const line = placements.map(p => across ? p.col : p.row), fixed = across ? placements[0].row : placements[0].col
  for (let i = Math.min(...line); i <= Math.max(...line); i++) if (!(across ? letterAt(fixed, i) : letterAt(i, fixed))) return fail('Tiles must form one connected word.')
  const empty = board.every(row => row.every(cell => !cell))
  if (empty && !at.has(CENTER * SIZE + CENTER)) return fail('The first word must cover the centre star.')
  if (empty && placements.length < 2) return fail('The first word needs at least two letters.')
  const readWord = (row: number, col: number, horizontal: boolean) => {
    const dr = horizontal ? 0 : 1, dc = horizontal ? 1 : 0
    while (inside(row - dr, col - dc) && letterAt(row - dr, col - dc)) { row -= dr; col -= dc }
    let word = '', sum = 0, multiplier = 1
    while (inside(row, col) && letterAt(row, col)) {
      const cell = letterAt(row, col)!, fresh = at.has(row * SIZE + col), premium = fresh ? PREMIUMS[row][col] : null
      const value = cell.blank ? 0 : letterValue(cell.letter)
      sum += value * (premium === 'DL' ? 2 : premium === 'TL' ? 3 : 1)
      multiplier *= premium === 'DW' ? 2 : premium === 'TW' ? 3 : 1
      word += cell.letter; row += dr; col += dc
    }
    return { word, score: sum * multiplier }
  }
  const words: { word: string; score: number }[] = []
  const main = readWord(placements[0].row, placements[0].col, across)
  if (main.word.length > 1) words.push(main)
  for (const p of placements) { const cross = readWord(p.row, p.col, !across); if (cross.word.length > 1) words.push(cross) }
  if (!words.length) return fail('Make a word of at least two letters.')
  if (!empty && !placements.some(p => touchesExisting(board, p))) return fail('Your word must connect to the tiles on the board.')
  const invalid = words.find(word => !dictionary.has(word.word))
  if (invalid) return fail(`${invalid.word} is not in the dictionary.`)
  const score = words.reduce((sum, word) => sum + word.score, 0) + (placements.length === RACK ? BINGO : 0)
  return { ok: true, words, score }
}
const touchesExisting = (board: (Cell | null)[][], p: Placement) => [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dr, dc]) => !!board[p.row + dr]?.[p.col + dc])

function clone(state: WordTilesState): WordTilesState { return { ...state, board: state.board.map(row => [...row]), racks: state.racks.map(rack => [...rack]), bag: [...state.bag], scores: [...state.scores], log: [...state.log] } }
function finish(next: WordTilesState, outPlayer: number | null) {
  // Unplayed tiles count against their holder; whoever went out collects them.
  const leftovers = next.racks.map(rack => rack.reduce((sum, letter) => sum + letterValue(letter), 0))
  leftovers.forEach((value, at) => { next.scores[at] -= value })
  if (outPlayer !== null) next.scores[outPlayer] += leftovers.reduce((a, b) => a + b, 0)
  next.over = true
  const top = Math.max(...next.scores), winners = next.names.filter((_, at) => next.scores[at] === top)
  next.log = [`Game over. ${winners.join(' and ')} ${winners.length > 1 || winners[0] === 'You' ? 'win' : 'wins'} with ${top}.`, ...next.log]
}
const advance = (next: WordTilesState) => { next.current = (next.current + 1) % next.racks.length }
export function playWordTiles(state: WordTilesState, placements: Placement[], dictionary: Dictionary): { state: WordTilesState; result: MoveResult } {
  const result = scoreMove(state.board, placements, dictionary)
  if (state.over || !result.ok) return { state, result }
  const rack = [...state.racks[state.current]]
  for (const p of placements) { const at = rack.indexOf(p.blank ? '?' : p.letter); if (at < 0) return { state, result: { ...result, ok: false, error: 'Those tiles are not on your rack.' } }; rack.splice(at, 1) }
  const next = clone(state)
  placements.forEach(p => { next.board[p.row][p.col] = { letter: p.letter, blank: p.blank } })
  next.racks[state.current] = [...rack, ...next.bag.splice(0, RACK - rack.length)]
  next.scores[state.current] += result.score; next.passes = 0; next.last = placements
  const name = state.names[state.current]
  next.log = [`${name} ${name === 'You' ? 'play' : 'plays'} ${result.words.map(word => word.word).join(', ')} for ${result.score}${placements.length === RACK ? ' — all seven tiles!' : ''}.`, ...state.log].slice(0, 20)
  if (!next.racks[state.current].length) finish(next, state.current)
  else advance(next)
  return { state: next, result }
}
export function passWordTiles(state: WordTilesState, exchange: number[] = [], random: Random = Math.random): WordTilesState {
  if (state.over || (exchange.length && state.bag.length < RACK)) return state
  const next = clone(state), rack = next.racks[state.current], name = state.names[state.current]
  if (exchange.length) {
    const returned = exchange.sort((a, b) => b - a).map(i => rack.splice(i, 1)[0])
    rack.push(...next.bag.splice(0, returned.length)); next.bag = shuffled([...next.bag, ...returned], random)
  }
  next.passes++; next.last = []
  next.log = [`${name} ${exchange.length ? `${name === 'You' ? 'swap' : 'swaps'} ${exchange.length} tile${exchange.length > 1 ? 's' : ''}` : name === 'You' ? 'pass' : 'passes'}.`, ...state.log].slice(0, 20)
  if (next.passes >= next.racks.length * 2) finish(next, null)
  else advance(next)
  return next
}
/** Finds the best-scoring legal move for a rack, giving up after `budgetMs`. */
export function findBestMove(board: (Cell | null)[][], rack: string[], dictionary: Dictionary, budgetMs = 1500): { placements: Placement[]; score: number } | null {
  const started = Date.now(), empty = board.every(row => row.every(cell => !cell))
  let best: { placements: Placement[]; score: number } | null = null
  const anchor = (r: number, c: number) => empty ? r === CENTER && c === CENTER : !board[r][c] && [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dr, dc]) => board[r + dr]?.[c + dc])
  for (const across of [true, false]) {
    const get = (line: number, i: number) => across ? board[line][i] : board[i][line]
    for (let line = 0; line < SIZE; line++) for (let start = 0; start < SIZE; start++) {
      if (Date.now() - started > budgetMs) return best
      if (start > 0 && get(line, start - 1)) continue
      // Only starts that can reach an anchor with the tiles in hand.
      let reach = -1, free = 0
      for (let i = start; i < SIZE && free <= rack.length; i++) { if (!get(line, i)) free++; if (anchor(across ? line : i, across ? i : line) && free <= rack.length) { reach = i; break } }
      if (reach < 0) continue
      const extend = (i: number, word: string, left: string[], placed: Placement[]) => {
        if (i < SIZE && get(line, i)) { const letter = get(line, i)!.letter; if (dictionary.hasPrefix(word + letter)) extend(i + 1, word + letter, left, placed); return }
        if (placed.length && word.length > 1 && i - 1 >= reach && dictionary.has(word)) {
          const result = scoreMove(board, placed, dictionary)
          if (result.ok && (!best || result.score > best.score)) best = { placements: placed, score: result.score }
        }
        if (i >= SIZE || !left.length) return
        for (const tile of new Set(left)) {
          const rest = [...left]; rest.splice(rest.indexOf(tile), 1)
          for (const letter of tile === '?' ? 'ESARTIONL' : tile) {
            if (!dictionary.hasPrefix(word + letter)) continue
            extend(i + 1, word + letter, rest, [...placed, { row: across ? line : i, col: across ? i : line, letter, blank: tile === '?' }])
          }
        }
      }
      extend(start, '', rack, [])
    }
  }
  return best
}
