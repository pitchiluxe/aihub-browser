import type { Random } from '../random'
// Shared shape for the family table: every game describes its rules through
// this interface, and one computer opponent and one board renderer serve them all.
export interface Move { from?: number; to?: number; label?: string; [key: string]: unknown }
export interface Piece { owner: number; glyph?: string; king?: boolean; color?: string; small?: boolean }
export interface Outcome { winner: number | null; text: string }
export type Layout =
  | { kind: 'grid'; rows: number; cols: number; style: 'checker' | 'plain' | 'intersections' | 'xiangqi'; holes?: (index: number) => boolean }
  | { kind: 'graph'; points: [number, number][]; lines: [number, number][]; size: [number, number] }
  | { kind: 'hex'; size: number }
  | { kind: 'custom' }
export interface FamilyGame<S = any> {
  id: string; title: string; players: 1 | 2 | 3 | 4; names?: string[]; colors?: string[]; layout: Layout
  setup(random: Random): S
  current(state: S): number
  moves(state: S): Move[]
  play(state: S, move: Move, random: Random): S
  outcome(state: S): Outcome | null
  pieceAt?(state: S, index: number): Piece | null
  /** Score for `player` (higher is better). Present → the computer searches ahead; absent → it plays out random games. */
  evaluate?(state: S, player: number): number
  status?(state: S): string
  lastMove?(state: S): number[]
  depth?: number
  /** A hand-written strategy for games where search is a poor fit (dice, hidden information). */
  bot?(state: S, random: Random): Move
}
export const sameMove = (a: Move, b: Move) => JSON.stringify(a) === JSON.stringify(b)

/** The computer's choice: alpha-beta when the game can score a position, Monte Carlo tree search otherwise. */
export function chooseMove<S>(game: FamilyGame<S>, state: S, random: Random, budgetMs = 700): Move | null {
  const moves = game.moves(state)
  if (moves.length <= 1) return moves[0] ?? null
  if (game.bot) {
    // Bots name a move by its key fields; hand back the full legal move (with its label).
    const pick = game.bot(state, random)
    return moves.find(move => Object.entries(pick).every(([key, value]) => JSON.stringify(move[key]) === JSON.stringify(value))) ?? moves[0]
  }
  return game.evaluate ? alphaBeta(game, state, random, budgetMs) : monteCarlo(game, state, random, budgetMs)
}

function alphaBeta<S>(game: FamilyGame<S>, root: S, random: Random, budgetMs: number): Move {
  const me = game.current(root), started = Date.now(), maxDepth = game.depth ?? 4
  let best = game.moves(root)[0], timedOut = false
  const search = (state: S, depth: number, alpha: number, beta: number): number => {
    if (Date.now() - started > budgetMs) { timedOut = true; return 0 }
    const done = game.outcome(state)
    if (done) return done.winner === null ? 0 : done.winner === me ? 1e6 + depth : -1e6 - depth
    if (depth === 0) return game.evaluate!(state, me)
    const moves = game.moves(state), maximise = game.current(state) === me
    let value = maximise ? -Infinity : Infinity
    for (const move of moves) {
      const score = search(game.play(state, move, random), depth - 1, alpha, beta)
      if (maximise) { value = Math.max(value, score); alpha = Math.max(alpha, value) } else { value = Math.min(value, score); beta = Math.min(beta, value) }
      if (alpha >= beta || timedOut) break
    }
    return value
  }
  // Iterative deepening keeps the best fully searched answer when time runs out.
  for (let depth = 1; depth <= maxDepth; depth++) {
    const moves = [...game.moves(root)].sort(() => random() - 0.5)
    if (best) moves.sort((a, b) => Number(sameMove(b, best)) - Number(sameMove(a, best)))
    let bestHere = moves[0], bestScore = -Infinity, alpha = -Infinity
    for (const move of moves) {
      const score = search(game.play(root, move, random), depth - 1, alpha, Infinity)
      if (timedOut) break
      if (score > bestScore) { bestScore = score; bestHere = move }
      alpha = Math.max(alpha, score)
    }
    if (timedOut) break
    best = bestHere
    if (bestScore >= 1e6) break
  }
  return best
}

interface Node<S> { state: S; move: Move | null; parent: Node<S> | null; children: Node<S>[]; untried: Move[]; visits: number; wins: number; mover: number }
function monteCarlo<S>(game: FamilyGame<S>, root: S, random: Random, budgetMs: number): Move {
  const started = Date.now()
  const make = (state: S, move: Move | null, parent: Node<S> | null, mover: number): Node<S> => ({ state, move, parent, children: [], untried: game.outcome(state) ? [] : [...game.moves(state)], visits: 0, wins: 0, mover })
  const tree = make(root, null, null, -1)
  let rounds = 0
  while (Date.now() - started < budgetMs && rounds < 20_000) {
    rounds++
    let node = tree
    // Select by UCB1, expand one move, play the rest out at random.
    while (!node.untried.length && node.children.length) node = node.children.reduce((best, child) => ucb(child, node.visits) > ucb(best, node.visits) ? child : best)
    if (node.untried.length) {
      const move = node.untried.splice(Math.floor(random() * node.untried.length), 1)[0]
      const mover = game.current(node.state), child = make(game.play(node.state, move, random), move, node, mover)
      node.children.push(child); node = child
    }
    let state = node.state, steps = 0, done = game.outcome(state)
    while (!done && steps++ < 300) {
      const moves = game.moves(state)
      if (!moves.length) break
      state = game.play(state, moves[Math.floor(random() * moves.length)], random); done = game.outcome(state)
    }
    for (let up: Node<S> | null = node; up; up = up.parent) {
      up.visits++
      if (done && up.mover >= 0) up.wins += done.winner === up.mover ? 1 : done.winner === null ? 0.5 : 0
      else if (!done) up.wins += 0.5
    }
  }
  return tree.children.reduce((best, child) => child.visits > best.visits ? child : best, tree.children[0]).move!
}
const ucb = <S>(node: Node<S>, parentVisits: number) => node.visits ? node.wins / node.visits + 1.2 * Math.sqrt(Math.log(parentVisits + 1) / node.visits) : Infinity

// Small helpers the grid games share.
export const DIRS8: [number, number][] = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
export const DIRS4: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]]
export const said = (name: string, you: string, other: string) => `${name} ${name === 'You' ? you : other}`
