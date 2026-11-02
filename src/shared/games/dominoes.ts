import { shuffled, type Random } from './random'
// Double-six dominoes, draw or block game, two to four players, first to the target score.
export type Tile = [number, number]
export type DominoMode = 'draw' | 'block'
export interface DominoPlayer { name: string; bot: boolean; hand: Tile[]; score: number }
export interface DominoState {
  players: DominoPlayer[]; boneyard: Tile[]; chain: Tile[]; current: number; mode: DominoMode; target: number
  passes: number; phase: 'play' | 'round' | 'over'; round: number; winner: number | null; log: string[]; lastPlayed: { side: 'left' | 'right'; by: number } | null
}
export type DominoMove = { tile: number; side: 'left' | 'right' }
export const pips = (tile: Tile) => tile[0] + tile[1]
export const handPips = (hand: Tile[]) => hand.reduce((sum, tile) => sum + pips(tile), 0)
export function fullSet(): Tile[] { const set: Tile[] = []; for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) set.push([a, b]); return set }
const ends = (state: DominoState) => state.chain.length ? [state.chain[0][0], state.chain[state.chain.length - 1][1]] as const : null

function deal(players: DominoPlayer[], random: Random) {
  const set = shuffled(fullSet(), random), size = 7
  players.forEach((player, at) => { player.hand = set.slice(at * size, at * size + size) })
  return set.slice(players.length * size)
}
// The highest double opens the first round; after that, the last round's winner leads with anything.
function opener(players: DominoPlayer[]): number {
  for (let double = 6; double >= 0; double--) { const at = players.findIndex(player => player.hand.some(tile => tile[0] === double && tile[1] === double)); if (at >= 0) return at }
  return 0
}
export function newDominoes(humans = 1, total = 2, mode: DominoMode = 'draw', random: Random = Math.random, target = 100): DominoState {
  const count = Math.min(4, Math.max(2, total))
  const players = Array.from({ length: count }, (_, i) => ({ name: i < humans ? humans === 1 ? 'You' : `Player ${i + 1}` : `Computer ${i - humans + 1}`, bot: i >= humans, hand: [] as Tile[], score: 0 }))
  const boneyard = deal(players, random), current = opener(players)
  return { players, boneyard: mode === 'draw' ? boneyard : [], chain: [], current, mode, target, passes: 0, phase: 'play', round: 1, winner: null, log: [`${players[current].name} ${players[current].name === 'You' ? 'hold' : 'holds'} the highest double and ${players[current].name === 'You' ? 'lead' : 'leads'}.`], lastPlayed: null }
}
export function legalDominoMoves(state: DominoState): DominoMove[] {
  if (state.phase !== 'play') return []
  const hand = state.players[state.current].hand, open = ends(state), moves: DominoMove[] = []
  if (!open) {
    // The opening round must start with the highest double in play.
    if (state.round === 1) {
      const top = Math.max(...state.players.flatMap(player => player.hand.filter(tile => tile[0] === tile[1]).map(tile => tile[0])), -1)
      if (top >= 0) return hand.flatMap((tile, index) => tile[0] === top && tile[1] === top ? [{ tile: index, side: 'right' as const }] : [])
    }
    return hand.map((_, index) => ({ tile: index, side: 'right' as const }))
  }
  hand.forEach((tile, index) => {
    if (tile.includes(open[0])) moves.push({ tile: index, side: 'left' })
    if (tile.includes(open[1]) && !(open[0] === open[1] && tile.includes(open[0]))) moves.push({ tile: index, side: 'right' })
  })
  return moves
}
export const canDraw = (state: DominoState) => state.phase === 'play' && state.mode === 'draw' && state.boneyard.length > 0 && legalDominoMoves(state).length === 0

const clone = (state: DominoState): DominoState => ({ ...state, players: state.players.map(player => ({ ...player, hand: player.hand.map(tile => [...tile] as Tile) })), boneyard: state.boneyard.map(tile => [...tile] as Tile), chain: state.chain.map(tile => [...tile] as Tile), log: [...state.log] })
function finishRound(next: DominoState, winner: number, blocked: boolean) {
  const others = next.players.reduce((sum, player, at) => at === winner ? sum : sum + handPips(player.hand), 0)
  const points = blocked ? others - handPips(next.players[winner].hand) : others
  next.players[winner].score += Math.max(0, points)
  const name = next.players[winner].name
  next.log = [`${blocked ? 'The game is blocked. ' : ''}${name} ${name === 'You' ? 'win' : 'wins'} the round and ${name === 'You' ? 'score' : 'scores'} ${Math.max(0, points)}.`, ...next.log].slice(0, 20)
  next.winner = winner
  next.phase = next.players[winner].score >= next.target ? 'over' : 'round'
}
function advance(next: DominoState) { next.current = (next.current + 1) % next.players.length }

export function playDomino(state: DominoState, move: DominoMove): DominoState {
  if (!legalDominoMoves(state).some(candidate => candidate.tile === move.tile && candidate.side === move.side)) return state
  const next = clone(state), player = next.players[next.current], [tile] = player.hand.splice(move.tile, 1), open = ends(next)
  if (!open) next.chain.push(tile)
  else if (move.side === 'left') next.chain.unshift(tile[1] === open[0] ? tile : [tile[1], tile[0]])
  else next.chain.push(tile[0] === open[1] ? tile : [tile[1], tile[0]])
  next.passes = 0; next.lastPlayed = { side: move.side, by: next.current }
  next.log = [`${player.name} ${player.name === 'You' ? 'play' : 'plays'} ${tile[0]}–${tile[1]}.`, ...next.log].slice(0, 20)
  if (!player.hand.length) { finishRound(next, next.current, false); return next }
  advance(next); return next
}
export function drawDomino(state: DominoState): DominoState {
  if (!canDraw(state)) return state
  const next = clone(state), player = next.players[next.current]
  player.hand.push(next.boneyard.pop()!)
  next.log = [`${player.name} ${player.name === 'You' ? 'draw' : 'draws'} from the boneyard.`, ...next.log].slice(0, 20)
  return next
}
export function passDomino(state: DominoState): DominoState {
  if (state.phase !== 'play' || legalDominoMoves(state).length || canDraw(state)) return state
  const next = clone(state)
  next.passes++
  next.log = [`${next.players[next.current].name} ${next.players[next.current].name === 'You' ? 'pass' : 'passes'}.`, ...next.log].slice(0, 20)
  if (next.passes >= next.players.length) {
    // Nobody can move: the lightest hand takes the round.
    const lightest = next.players.reduce((best, player, at) => handPips(player.hand) < handPips(next.players[best].hand) ? at : best, 0)
    finishRound(next, lightest, true); return next
  }
  advance(next); return next
}
export function nextDominoRound(state: DominoState, random: Random = Math.random): DominoState {
  if (state.phase !== 'round') return state
  const next = clone(state)
  const boneyard = deal(next.players, random)
  next.boneyard = next.mode === 'draw' ? boneyard : []; next.chain = []; next.passes = 0; next.round++; next.phase = 'play'; next.lastPlayed = null
  next.current = next.winner ?? 0; next.winner = null
  next.log = [`Round ${next.round}. ${next.players[next.current].name} ${next.players[next.current].name === 'You' ? 'lead' : 'leads'}.`, ...next.log].slice(0, 20)
  return next
}
// Computer: shed the heaviest tile, keeping doubles out of trouble and favouring numbers it still holds.
export function chooseDominoMove(state: DominoState): DominoMove | null {
  const moves = legalDominoMoves(state), hand = state.players[state.current].hand
  if (!moves.length) return null
  const held = (value: number) => hand.filter(tile => tile.includes(value)).length
  const score = ({ tile, side }: DominoMove) => {
    const [a, b] = hand[tile], open = ends(state), exposed = open ? (side === 'left' ? (a === open[0] ? b : a) : (a === open[1] ? b : a)) : b
    return pips(hand[tile]) + (a === b ? 6 : 0) + held(exposed) * 2
  }
  return moves.reduce((best, move) => score(move) > score(best) ? move : best)
}
