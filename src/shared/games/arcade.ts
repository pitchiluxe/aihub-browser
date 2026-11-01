import type { Random } from './random'
export type Direction = 'up' | 'right' | 'down' | 'left'
export const DELTAS: Record<Direction, [number, number]> = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }
export interface Point { x: number; y: number }
export interface SnakeState { snake: Point[]; food: Point | null; direction: Direction; score: number; over: boolean; won: boolean }
export function snakeFood(snake: Point[], random: Random = Math.random): Point | null {
  const empty = Array.from({ length: 400 }, (_, i) => ({ x: i % 20, y: Math.floor(i / 20) })).filter(point => !snake.some(part => part.x === point.x && part.y === point.y))
  return empty.length ? empty[Math.floor(random() * empty.length)] : null
}
export function newSnake(random: Random = Math.random): SnakeState {
  const snake = [{ x: 9, y: 10 }, { x: 8, y: 10 }, { x: 7, y: 10 }]
  return { snake, food: snakeFood(snake, random), direction: 'right', score: 0, over: false, won: false }
}
export function snakeStep(state: SnakeState, direction = state.direction, random: Random = Math.random): SnakeState {
  if (state.over) return state
  const delta = DELTAS[direction], previous = DELTAS[state.direction]
  if (delta[0] === -previous[0] && delta[1] === -previous[1]) direction = state.direction
  const [dx, dy] = DELTAS[direction], head = { x: state.snake[0].x + dx, y: state.snake[0].y + dy }
  const eating = state.food?.x === head.x && state.food.y === head.y
  const body = eating ? state.snake : state.snake.slice(0, -1)
  if (head.x < 0 || head.x >= 20 || head.y < 0 || head.y >= 20 || body.some(part => part.x === head.x && part.y === head.y)) return { ...state, direction, over: true }
  const snake = [head, ...body], food = eating ? snakeFood(snake, random) : state.food
  return { ...state, direction, snake, food, score: state.score + (eating ? 10 : 0), over: !food, won: !food }
}
export function spawn2048(board: number[], random: Random = Math.random): number[] {
  const empty = board.map((value, index) => value ? -1 : index).filter(index => index >= 0)
  if (!empty.length) return board
  const next = [...board]; next[empty[Math.floor(random() * empty.length)]] = random() < 0.9 ? 2 : 4
  return next
}
export function move2048(board: number[], direction: Direction): { board: number[]; score: number; moved: boolean; over: boolean } {
  const next = Array(16).fill(0); let score = 0
  for (let line = 0; line < 4; line++) {
    const indices = Array.from({ length: 4 }, (_, i) => direction === 'left' ? line * 4 + i : direction === 'right' ? line * 4 + 3 - i : direction === 'up' ? i * 4 + line : (3 - i) * 4 + line)
    const values = indices.map(index => board[index]).filter(Boolean), merged: number[] = []
    for (let i = 0; i < values.length; i++) {
      if (values[i] === values[i + 1]) { merged.push(values[i] * 2); score += values[i] * 2; i++ } else merged.push(values[i])
    }
    indices.forEach((index, i) => { next[index] = merged[i] || 0 })
  }
  return { board: next, score, moved: next.some((value, i) => value !== board[i]), over: board2048Over(next) }
}
export function board2048Over(board: number[]): boolean {
  return board.every((value, i) => value && (i % 4 === 3 || value !== board[i + 1]) && (i >= 12 || value !== board[i + 4]))
}

// Original maze: '.' is a pellet, 'o' grants a short chase reversal.
export const MAZE = [
  '###################', '#o....#.....#....o#', '#.##..#.###.#..##.#', '#.....#..#..#.....#',
  '#.###.##.#.##.###.#', '#.................#', '###.#.#######.#.###', '#...#....#....#...#',
  '#.#####..#..#####.#', '#.................#', '#.##.###...###.##.#', '#o...#.......#...o#', '###################',
]
export interface MazeState { player: Point; ghosts: Point[]; pellets: number[]; power: number; lives: number; score: number; over: boolean; won: boolean; direction: Direction }
const pelletId = (point: Point) => point.y * 19 + point.x
export const mazeOpen = (point: Point) => !!MAZE[point.y] && !!MAZE[point.y][point.x] && MAZE[point.y][point.x] !== '#'
export function newMaze(): MazeState {
  const pellets = MAZE.flatMap((row, y) => [...row].flatMap((value, x) => value === '#' || (x === 9 && y === 9) ? [] : [y * 19 + x]))
  return { player: { x: 9, y: 9 }, ghosts: [{ x: 1, y: 5 }, { x: 17, y: 5 }], pellets, power: 0, lives: 3, score: 0, over: false, won: false, direction: 'left' }
}
export function mazeStep(state: MazeState, direction: Direction, tick: number): MazeState {
  if (state.over) return state
  const advance = (point: Point, d: Direction) => ({ x: point.x + DELTAS[d][0], y: point.y + DELTAS[d][1] })
  const candidate = advance(state.player, direction), previousMove = advance(state.player, state.direction)
  const player = mazeOpen(candidate) ? candidate : mazeOpen(previousMove) ? previousMove : state.player
  const movedDirection = player === candidate ? direction : state.direction
  const eaten = state.pellets.includes(pelletId(player)), powered = eaten && MAZE[player.y][player.x] === 'o'
  const power = powered ? 35 : Math.max(0, state.power - 1)
  let score = state.score + (eaten ? powered ? 50 : 10 : 0)
  const pellets = state.pellets.filter(id => id !== pelletId(player))
  const ghosts = state.ghosts.map((ghost, i) => {
    if (tick % 2) return ghost
    const options = (Object.keys(DELTAS) as Direction[]).map(d => advance(ghost, d)).filter(mazeOpen)
    options.sort((a, b) => (Math.abs(a.x - player.x) + Math.abs(a.y - player.y) - Math.abs(b.x - player.x) - Math.abs(b.y - player.y)) * (power ? -1 : 1))
    return options[(tick + i) % 7 === 0 ? options.length - 1 : 0] || ghost
  })
  let hit = false
  ghosts.forEach((ghost, i) => {
    if ((ghost.x === player.x && ghost.y === player.y) || (ghost.x === state.player.x && ghost.y === state.player.y && state.ghosts[i].x === player.x && state.ghosts[i].y === player.y)) {
      if (power) { ghosts[i] = { x: i ? 17 : 1, y: 5 }; score += 200 } else hit = true
    }
  })
  const lives = state.lives - (hit ? 1 : 0), won = !pellets.length
  return { ...state, player: hit ? { x: 9, y: 9 } : player, ghosts: hit ? [{ x: 1, y: 5 }, { x: 17, y: 5 }] : ghosts, pellets, power: hit ? 0 : power, lives, score, direction: movedDirection, over: won || lives <= 0, won }
}
