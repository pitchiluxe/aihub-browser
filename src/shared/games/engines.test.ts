import { describe, expect, it } from 'vitest'
import { seededRandom, shuffled } from './random'
import { blockFits, blocksAction, clearBlockLines, newBlocks, BLOCK_SHAPES } from './blocks'
import { drawSolitaire, moveSolitaire, newSolitaire, selectedCards, solitaireWon, type Card } from './solitaire'
import { board2048Over, DELTAS, MAZE, mazeOpen, mazeStep, move2048, newMaze, newSnake, snakeFood, snakeStep, spawn2048 } from './arcade'
import { MAX_ROM_BYTES, validateRom } from './catalog'

describe('reproducible game randomness', () => {
  it('shuffles without loss and repeats from a known seed', () => {
    const values = Array.from({ length: 52 }, (_, i) => i)
    expect(shuffled(values, seededRandom(42))).toEqual(shuffled(values, seededRandom(42)))
    expect(new Set(shuffled(values)).size).toBe(52)
    expect(values[0]).toBe(0)
  })
})
describe('Falling Blocks', () => {
  it('starts with one of every piece in its seven-piece bag', () => {
    const state = newBlocks(seededRandom(1))
    expect(new Set([state.piece.kind, ...state.queue]).size).toBe(7)
    expect(blockFits(state.board, state.piece)).toBe(true)
  })
  it('refuses walls and occupied cells', () => {
    const state = newBlocks()
    expect(blockFits(state.board, { kind: 1, cells: BLOCK_SHAPES[1], x: -1, y: 0 })).toBe(false)
    expect(blockFits(state.board, { kind: 1, cells: BLOCK_SHAPES[1], x: 9, y: 0 })).toBe(false)
    state.board[0][3] = 1
    expect(blockFits(state.board, { kind: 1, cells: BLOCK_SHAPES[1], x: 3, y: 0 })).toBe(false)
  })
  it('locks a hard drop without mutating the previous board', () => {
    const state = newBlocks(seededRandom(2)), before = structuredClone(state)
    const next = blocksAction(state, 'drop', seededRandom(3))
    expect(state).toEqual(before)
    expect(next.board.flat().filter(Boolean)).toHaveLength(4)
    expect(next.score).toBeGreaterThan(0)
    expect(blockFits(next.board, next.piece)).toBe(true)
  })
  it('clears full lines and awards the correct line score', () => {
    const state = newBlocks()
    state.board[18] = Array(10).fill(1); state.board[19] = Array(10).fill(1)
    state.board[18][0] = state.board[18][1] = state.board[19][0] = state.board[19][1] = 0
    state.piece = { kind: 1, cells: BLOCK_SHAPES[1], x: 0, y: 18 }
    const next = blocksAction(state, 'tick')
    expect(next.lines).toBe(2); expect(next.score).toBe(300); expect(next.board.flat().every(value => !value)).toBe(true)
    expect(clearBlockLines(Array.from({ length: 20 }, (_, i) => Array(10).fill(i > 15 ? 1 : 0))).cleared).toBe(4)
  })
  it('permits holding only once between locks', () => {
    const state = newBlocks(), held = blocksAction(state, 'hold')
    expect(held.hold).toBe(state.piece.kind)
    expect(blocksAction(held, 'hold')).toBe(held)
    expect(blocksAction(blocksAction(held, 'drop'), 'hold').held).toBe(true)
  })
})
const card = (rank: number, suit: number, up = true): Card => ({ rank, suit, up, id: suit * 13 + rank - 1 })
describe('Klondike Solitaire', () => {
  it('deals all 52 unique cards with seven face-up tableau tops', () => {
    const state = newSolitaire(seededRandom(6))
    expect(state.piles.map(pile => pile.length)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(state.stock).toHaveLength(24)
    expect(state.piles.flat().filter(value => value.up)).toHaveLength(7)
    expect(new Set([...state.stock, ...state.piles.flat()].map(value => value.id)).size).toBe(52)
  })
  it('draws and recycles the stock in the correct order', () => {
    let state = newSolitaire(seededRandom(7))
    const first = state.stock.at(-1)!
    for (let i = 0; i < 24; i++) state = drawSolitaire(state)
    expect(state.waste).toHaveLength(24)
    state = drawSolitaire(state)
    expect(state.stock).toHaveLength(24); expect(state.waste).toHaveLength(0)
    expect(drawSolitaire(state).waste[0].id).toBe(first.id)
  })
  it('requires descending alternating colors and a King in an empty pile', () => {
    const state = newSolitaire(); state.piles = [[card(8, 0)], [card(7, 1)], [], [], [], [], []]
    expect(moveSolitaire(state, { area: 'pile', pile: 1, index: 0 }, { area: 'pile', pile: 0 }).piles[0]).toHaveLength(2)
    expect(moveSolitaire(state, { area: 'pile', pile: 1, index: 0 }, { area: 'pile', pile: 2 })).toBe(state)
    state.piles[1] = [card(7, 3)]
    expect(moveSolitaire(state, { area: 'pile', pile: 1, index: 0 }, { area: 'pile', pile: 0 })).toBe(state)
    state.piles[1] = [card(13, 0)]
    expect(moveSolitaire(state, { area: 'pile', pile: 1, index: 0 }, { area: 'pile', pile: 2 }).piles[2][0].rank).toBe(13)
  })
  it('builds foundations in suit order and exposes the next covered card', () => {
    const state = newSolitaire(); state.piles = [[card(10, 1, false), card(1, 0)], [], [], [], [], [], []]
    const next = moveSolitaire(state, { area: 'pile', pile: 0, index: 1 }, { area: 'foundation', pile: 0 })
    expect(next.foundations[0][0].rank).toBe(1); expect(next.piles[0][0].up).toBe(true); expect(next.score).toBe(15)
    expect(state.piles[0][0].up).toBe(false)
    expect(moveSolitaire(state, { area: 'pile', pile: 0, index: 1 }, { area: 'foundation', pile: 1 })).toBe(state)
    expect(selectedCards(state, { area: 'pile', pile: 0, index: 0 })).toEqual([])
  })
  it('recognizes victory only after all four foundations are complete', () => {
    const state = newSolitaire()
    expect(solitaireWon(state)).toBe(false)
    state.foundations = Array.from({ length: 4 }, (_, suit) => Array.from({ length: 13 }, (_, rank) => card(rank + 1, suit)))
    expect(solitaireWon(state)).toBe(true)
  })
})
describe('Snake', () => {
  it('does not reverse into its own neck and never spawns food inside the snake', () => {
    const state = newSnake(seededRandom(1)), next = snakeStep(state, 'left')
    expect(next.direction).toBe('right'); expect(next.snake[0].x).toBe(10)
    const food = snakeFood(state.snake, () => 0)!
    expect(state.snake.some(part => part.x === food.x && part.y === food.y)).toBe(false)
  })
  it('grows on food, ends at walls, and recognizes a filled board', () => {
    const state = newSnake(); state.food = { x: 10, y: 10 }
    const next = snakeStep(state)
    expect(next.score).toBe(10); expect(next.snake).toHaveLength(4)
    state.snake[0] = { x: 19, y: 10 }
    expect(snakeStep(state).over).toBe(true)
    expect(snakeFood(Array.from({ length: 400 }, (_, i) => ({ x: i % 20, y: Math.floor(i / 20) })))).toBeNull()
  })
})
describe('2048', () => {
  it('merges each tile at most once and preserves total tile value', () => {
    const board = [2, 2, 2, 2, ...Array(12).fill(0)]
    const result = move2048(board, 'left')
    expect(result.board.slice(0, 4)).toEqual([4, 4, 0, 0]); expect(result.score).toBe(8)
    expect(move2048(board, 'right').board.slice(0, 4)).toEqual([0, 0, 4, 4])
    expect(board.slice(0, 4)).toEqual([2, 2, 2, 2])
  })
  it('handles vertical slides, no-op moves, spawning, and dead boards', () => {
    const board = [2, 0, 0, 0, 2, 0, 0, 0, ...Array(8).fill(0)]
    expect(move2048(board, 'up').board[0]).toBe(4)
    const onlyCorner = [2, ...Array(15).fill(0)]
    expect(move2048(onlyCorner, 'left').moved).toBe(false)
    expect(spawn2048(onlyCorner, () => 0).filter(Boolean)).toHaveLength(2)
    expect(board2048Over([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2])).toBe(true)
    expect(board2048Over(Array(16).fill(2))).toBe(false)
  })
})
describe('Maze Chase', () => {
  it('has no unreachable pellets or malformed rows', () => {
    expect(MAZE.every(row => row.length === 19)).toBe(true)
    const state = newMaze(), reached = new Set([state.player.y * 19 + state.player.x]), pending = [state.player]
    for (let i = 0; i < pending.length; i++) for (const [dx, dy] of Object.values(DELTAS)) {
      const point = { x: pending[i].x + dx, y: pending[i].y + dy }, id = point.y * 19 + point.x
      if (mazeOpen(point) && !reached.has(id)) { reached.add(id); pending.push(point) }
    }
    expect(state.pellets.every(id => reached.has(id))).toBe(true)
  })
  it('collects dots, applies power orbs, and finishes on the final dot', () => {
    const state = newMaze(), next = mazeStep(state, 'left', 1)
    expect(next.score).toBe(10); expect(next.pellets.length).toBe(state.pellets.length - 1)
    state.player = { x: 2, y: 1 }
    expect(mazeStep(state, 'left', 1).power).toBe(35)
    const last = newMaze(); last.pellets = [9 * 19 + 8]
    expect(mazeStep(last, 'left', 1)).toMatchObject({ over: true, won: true })
  })
  it('uses a life on collision without modifying the previous state', () => {
    const state = newMaze(); state.ghosts[0] = { x: 8, y: 9 }; state.lives = 1
    const before = structuredClone(state), next = mazeStep(state, 'left', 1)
    expect(next.lives).toBe(0); expect(next.over).toBe(true); expect(state).toEqual(before)
  })
})
describe('game import boundaries', () => {
  it('accepts supported files and refuses oversized or executable inputs', () => {
    expect(() => validateRom('mario.nes', 16384, 'nes')).not.toThrow()
    expect(() => validateRom('sonic.md', 1024, 'genesis')).not.toThrow()
    expect(() => validateRom('arcade.zip', 2048, 'arcade')).not.toThrow()
    expect(() => validateRom('game.exe', 3000, 'nes')).toThrow()
    expect(() => validateRom('game.nes', MAX_ROM_BYTES + 1, 'nes')).toThrow()
    expect(() => validateRom('game.nes', 0, 'nes')).toThrow()
  })
})
