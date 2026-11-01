import { seededRandom, shuffled } from './random'

export type OriginalId = 'echo' | 'orbit' | 'rulequake'
const PREFIXES: Record<OriginalId, string> = { echo: 'EH', orbit: 'OA', rulequake: 'RQ' }
export function challengeCode(id: OriginalId, seed: number): string { return `${PREFIXES[id]}-${(seed >>> 0).toString(36).toUpperCase().padStart(7, '0')}` }
export function parseChallenge(id: OriginalId, text: string): number | null {
  const match = text.trim().toUpperCase().match(new RegExp(`^${PREFIXES[id]}-([0-9A-Z]{7})$`))
  if (!match) return null
  const seed = parseInt(match[1], 36)
  return seed <= 0xffffffff ? seed : null
}
export function dailySeed(id: OriginalId, date: string): number {
  let hash = 2166136261
  for (const character of `${id}:${date}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return hash >>> 0
}
export type EchoDirection = 'up' | 'right' | 'down' | 'left'
const DELTAS: Record<EchoDirection, number> = { up: -7, right: 1, down: 7, left: -1 }
export interface EchoState { seed: number; player: number; trail: number[]; crystals: number[]; turn: number; hearts: number; score: number; over: boolean; message: string }
function echoCrystals(state: EchoState): number[] {
  const available = shuffled(Array.from({ length: 49 }, (_, i) => i).filter(i => i !== state.player && !state.crystals.includes(i)), seededRandom(state.seed ^ Math.imul(state.turn + 1, 7919)))
  return [...state.crystals, ...available.slice(0, 5 - state.crystals.length)]
}
export function newEcho(seed: number): EchoState {
  const state: EchoState = { seed, player: 24, trail: [], crystals: [], turn: 0, hearts: 3, score: 0, over: false, message: 'Your echo wakes after four moves.' }
  return { ...state, crystals: echoCrystals(state) }
}
export function echoStep(state: EchoState, direction: EchoDirection): EchoState {
  if (state.over) return state
  const player = state.player + DELTAS[direction]
  if (player < 0 || player >= 49 || (direction === 'left' && state.player % 7 === 0) || (direction === 'right' && state.player % 7 === 6)) return state
  // Four moves permits collisions on this bipartite grid; an odd delay never can.
  const trail = [...state.trail, state.player].slice(-4), echo = trail.length === 4 ? trail[0] : -1
  const hit = player === echo, collected = state.crystals.includes(player)
  const hearts = state.hearts - Number(hit), turn = state.turn + 1
  const next = { ...state, player, trail, turn, hearts, score: Math.max(0, state.score + (collected ? 100 : 0) - (hit ? 150 : 0)), over: hearts <= 0 || turn >= 36, crystals: state.crystals.filter(cell => cell !== player), message: hit ? 'Echo collision! One heart and 150 points lost.' : collected ? 'Crystal secured. Keep your future path open.' : 'Four moves ago is closer than it looks.' }
  return { ...next, crystals: echoCrystals(next) }
}

export interface OrbitState { seed: number; player: number; direction: 1 | -1; hazard: number; stars: number[]; fuel: number; turn: number; cargo: number; shields: number; score: number; over: boolean; message: string }
const ring = (value: number) => (value % 12 + 12) % 12
export function newOrbit(seed: number): OrbitState {
  return { seed, player: 0, direction: 1, hazard: 6, stars: shuffled([1, 2, 3, 4, 5, 7, 8, 9, 10, 11], seededRandom(seed)).slice(0, 4), fuel: 6, turn: 0, cargo: 0, shields: 3, score: 0, over: false, message: 'Stars drift every third beat. The storm moves every beat.' }
}
export function orbitStep(state: OrbitState, action: 'coast' | 'reverse' | 'bank'): OrbitState {
  if (state.over || (action === 'reverse' && !state.fuel)) return state
  if (action === 'bank') return { ...state, score: state.cargo, over: true, message: 'Cargo banked. A safe landing.' }
  const direction = action === 'reverse' ? (state.direction === 1 ? -1 : 1) : state.direction
  const turn = state.turn + 1, player = ring(state.player + direction), hazard = ring(state.hazard - 1)
  let stars = state.stars.map(position => turn % 3 === 0 ? ring(position + 1) : position)
  const caught = stars.includes(player), collision = player === hazard || (player === state.hazard && hazard === state.player)
  let cargo = state.cargo + (caught ? 100 + state.turn * 10 : 0)
  if (collision) cargo = Math.floor(cargo / 2)
  stars = stars.filter(position => position !== player)
  if (caught) {
    const slots = shuffled(Array.from({ length: 12 }, (_, i) => i).filter(i => i !== player && i !== hazard && !stars.includes(i)), seededRandom(state.seed ^ Math.imul(turn, 3571)))
    if (slots.length) stars.push(slots[0])
  }
  const shields = state.shields - Number(collision), over = shields <= 0 || turn >= 24
  return { ...state, player, direction, hazard, stars, fuel: state.fuel - Number(action === 'reverse'), turn, cargo, shields, over, score: over ? Math.floor(cargo / 2) : 0, message: collision ? 'Storm hit! Half your cargo is gone.' : caught ? 'Star captured. Bank it or risk another orbit?' : over ? 'Fuel window closed. Half your cargo was rescued.' : 'Watch the next storm position before you move.' }
}

export interface QuakeTile { color: number; shape: number; value: number }
export interface QuakeRule { color: number; shape: number; even: boolean; kind: 'and' | 'xor' | 'not' }
export interface QuakeState { seed: number; board: QuakeTile[]; rule: QuakeRule; round: number; combo: number; score: number; remaining: number; hearts: number; over: boolean; message: string }
export function quakeMatches(tile: QuakeTile, rule: QuakeRule): boolean {
  if (rule.kind === 'not') return tile.shape !== rule.shape && (tile.value % 2 === 0) === rule.even
  const color = tile.color === rule.color, shape = tile.shape === rule.shape
  return rule.kind === 'and' ? color && shape : color !== shape
}
function quakeDeal(seed: number, round: number): { board: QuakeTile[]; rule: QuakeRule } {
  const random = seededRandom(seed ^ Math.imul(round + 1, 104729))
  const rule: QuakeRule = { color: Math.floor(random() * 3), shape: Math.floor(random() * 3), even: random() > .5, kind: (['and', 'xor', 'not'] as const)[round % 3] }
  const board = Array.from({ length: 16 }, () => ({ color: Math.floor(random() * 3), shape: Math.floor(random() * 3), value: 1 + Math.floor(random() * 9) }))
  // Every deal has a legal answer, including rare AND combinations.
  if (!board.some(tile => quakeMatches(tile, rule))) {
    board[Math.floor(random() * 16)] = rule.kind === 'not' ? { color: 0, shape: (rule.shape + 1) % 3, value: rule.even ? 2 : 3 } : { color: rule.color, shape: rule.kind === 'xor' ? (rule.shape + 1) % 3 : rule.shape, value: 1 }
  }
  return { board, rule }
}
export function newQuake(seed: number): QuakeState { return { seed, ...quakeDeal(seed, 0), round: 0, combo: 0, score: 0, remaining: 450, hearts: 3, over: false, message: 'Read the rule, then choose one matching tile.' } }
export function quakeTick(state: QuakeState): QuakeState {
  if (state.over) return state
  const remaining = Math.max(0, state.remaining - 1)
  return { ...state, remaining, over: remaining === 0 }
}
export function quakePick(state: QuakeState, index: number): QuakeState {
  if (state.over || !Number.isInteger(index) || index < 0 || index >= state.board.length) return state
  const correct = quakeMatches(state.board[index], state.rule), round = state.round + 1
  const combo = correct ? state.combo + 1 : 0, hearts = state.hearts - Number(!correct), remaining = Math.max(0, state.remaining - (correct ? 0 : 40))
  return { ...state, ...quakeDeal(state.seed, round), round, combo, hearts, remaining, score: state.score + (correct ? 100 + Math.min(10, combo) * 20 : 0), over: hearts <= 0 || remaining === 0, message: correct ? 'Correct. New board, new rule!' : 'Wrong tile. One heart and four seconds lost.' }
}
