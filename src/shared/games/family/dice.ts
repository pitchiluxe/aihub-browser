import type { Random } from '../random'
import type { FamilyGame, Move } from './core'
const d6 = (random: Random) => 1 + Math.floor(random() * 6)
const counts = (dice: number[]) => [1, 2, 3, 4, 5, 6].map(face => dice.filter(d => d === face).length)

/* ── Yacht: five dice, three rolls, twelve boxes to fill ── */
export const YACHT_BOXES = ['Ones', 'Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Full house', 'Four of a kind', 'Little straight', 'Big straight', 'Choice', 'Yacht']
export function yachtScore(box: number, dice: number[]): number {
  const c = counts(dice), sum = dice.reduce((a, b) => a + b, 0), sorted = [...dice].sort().join('')
  if (box < 6) return c[box] * (box + 1)
  if (box === 6) return c.includes(3) && c.includes(2) ? sum : 0
  if (box === 7) { const face = c.findIndex(n => n >= 4); return face >= 0 ? (face + 1) * 4 : 0 }
  if (box === 8) return sorted === '12345' ? 30 : 0
  if (box === 9) return sorted === '23456' ? 30 : 0
  if (box === 10) return sum
  return c.includes(5) ? 50 : 0
}
export interface YachtState { dice: number[]; held: boolean[]; rolls: number; scores: (number | null)[][]; turn: number; winner: number | null | undefined; last: number[] }
const yachtTotal = (scores: (number | null)[]) => scores.reduce<number>((sum, value) => sum + (value ?? 0), 0)
export const YACHT: FamilyGame<YachtState> = {
  id: 'yacht', title: 'Yacht', players: 2, names: ['You', 'Computer'], colors: ['#f6efe0', '#e8342c'], layout: { kind: 'custom' },
  setup: () => ({ dice: [1, 1, 1, 1, 1], held: Array(5).fill(false), rolls: 0, scores: [Array(12).fill(null), Array(12).fill(null)], turn: 0, winner: undefined, last: [] }),
  current: s => s.turn,
  moves: s => {
    if (s.winner !== undefined) return []
    const moves: Move[] = []
    if (s.rolls < 3) moves.push({ label: s.rolls ? `Roll again (${3 - s.rolls} left)` : 'Roll the dice', roll: true })
    if (s.rolls > 0 && s.rolls < 3) s.dice.forEach((_, i) => moves.push({ hold: i, label: `${s.held[i] ? 'Release' : 'Hold'} die ${i + 1}` }))
    if (s.rolls > 0) s.scores[s.turn].forEach((value, box) => { if (value === null) moves.push({ box, label: `${YACHT_BOXES[box]} · ${yachtScore(box, s.dice)}` }) })
    return moves
  },
  play: (s, move, random) => {
    if (move.roll) { const dice = s.dice.map((d, i) => s.held[i] ? d : d6(random)); return { ...s, dice, rolls: s.rolls + 1, last: s.held.map((h, i) => h ? -1 : i).filter(i => i >= 0) } }
    if (move.hold !== undefined) { const held = [...s.held]; held[move.hold as number] = !held[move.hold as number]; return { ...s, held } }
    const scores = s.scores.map(row => [...row]); scores[s.turn][move.box as number] = yachtScore(move.box as number, s.dice)
    const finished = scores.every(row => row.every(value => value !== null))
    const totals = scores.map(yachtTotal)
    return { dice: s.dice, held: Array(5).fill(false), rolls: 0, scores, turn: 1 - s.turn, last: [], winner: finished ? totals[0] === totals[1] ? null : totals[0] > totals[1] ? 0 : 1 : undefined }
  },
  outcome: s => s.winner === undefined ? null : { winner: s.winner, text: `${yachtTotal(s.scores[0])}–${yachtTotal(s.scores[1])}. ${s.winner === null ? 'A tie.' : `${['You', 'Computer'][s.winner]} ${s.winner === 0 ? 'win' : 'wins'}.`}` },
  bot: s => {
    if (s.rolls === 0) return { roll: true }
    const open = s.scores[s.turn].map((value, box) => value === null ? box : -1).filter(box => box >= 0)
    // Value a box by its score against what that box usually yields.
    const par = [2, 5, 8, 11, 14, 17, 18, 15, 12, 12, 21, 12]
    const best = open.reduce((top, box) => yachtScore(box, s.dice) - par[box] > yachtScore(top, s.dice) - par[top] ? box : top, open[0])
    if (s.rolls === 3 || yachtScore(best, s.dice) - par[best] >= 12) return { box: best }
    // Keep the most common face (the highest on ties); chase straights when four in a row are showing.
    const c = counts(s.dice), face = c.lastIndexOf(Math.max(...c)) + 1
    const run = [[1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6]].find(seq => seq.every(v => s.dice.includes(v)) && (open.includes(8) || open.includes(9)))
    const want = s.dice.map((d, i) => run ? run.includes(d) && s.dice.indexOf(d) === i : d === face)
    const toggle = want.findIndex((keep, i) => keep !== s.held[i])
    return toggle >= 0 ? { hold: toggle } : { roll: true }
  },
  status: s => s.rolls ? `Roll ${s.rolls} of 3. Click dice to hold them, then roll or pick a box.` : 'Roll to start your turn.',
  lastMove: s => s.last,
}

/* ── Farkle: set aside scoring dice and push your luck; first to 3,000 ── */
export function farkleScore(dice: number[]): { points: number; used: number } {
  if (!dice.length) return { points: 0, used: 0 }
  const c = counts(dice)
  if (dice.length === 6 && c.every(n => n === 1)) return { points: 1500, used: 6 }
  if (dice.length === 6 && c.filter(n => n === 2).length === 3) return { points: 750, used: 6 }
  let points = 0, used = 0
  c.forEach((n, i) => {
    const face = i + 1
    if (n >= 3) { points += (face === 1 ? 1000 : face * 100) * 2 ** (n - 3); used += n }
    else if (face === 1) { points += n * 100; used += n } else if (face === 5) { points += n * 50; used += n }
  })
  return { points, used }
}
export interface FarkleState { dice: number[]; picked: boolean[]; turnPoints: number; scores: number[]; turn: number; rolled: boolean; winner: number | null | undefined; log: string; last: number[] }
const FARKLE_TARGET = 3000
export const FARKLE: FamilyGame<FarkleState> = {
  id: 'farkle', title: 'Farkle', players: 2, names: ['You', 'Computer'], colors: ['#f6efe0', '#2f6fd8'], layout: { kind: 'custom' },
  setup: () => ({ dice: [], picked: [], turnPoints: 0, scores: [0, 0], turn: 0, rolled: false, winner: undefined, log: 'Roll six dice. Set aside scoring dice, then roll again or bank.', last: [] }),
  current: s => s.turn,
  moves: s => {
    if (s.winner !== undefined) return []
    if (!s.rolled) return [{ roll: true, label: s.dice.length ? `Roll ${s.dice.length} dice` : 'Roll six dice' }]
    const chosen = s.dice.filter((_, i) => s.picked[i]), value = farkleScore(chosen)
    const moves: Move[] = s.dice.map((_, i) => ({ pick: i, label: `${s.picked[i] ? 'Put back' : 'Set aside'} a ${s.dice[i]}` }))
    if (chosen.length && value.used === chosen.length) { moves.push({ roll: true, label: `Keep ${value.points} and roll ${s.dice.length - chosen.length || 6}` }); moves.push({ bank: true, label: `Bank ${s.turnPoints + value.points}` }) }
    return moves
  },
  play: (s, move, random) => {
    if (move.pick !== undefined) { const picked = [...s.picked]; picked[move.pick as number] = !picked[move.pick as number]; return { ...s, picked } }
    const chosen = s.dice.filter((_, i) => s.picked[i]), gained = farkleScore(chosen).points, turnPoints = s.turnPoints + gained
    if (move.bank) {
      const scores = [...s.scores]; scores[s.turn] += turnPoints
      return { dice: [], picked: [], turnPoints: 0, scores, turn: 1 - s.turn, rolled: false, winner: scores[s.turn] >= FARKLE_TARGET ? s.turn : undefined, log: `${['You', 'Computer'][s.turn]} banked ${turnPoints}.`, last: [] }
    }
    // Roll what is left; scoring with all six ("hot dice") gives all six back.
    const left = s.rolled ? s.dice.length - chosen.length || 6 : s.dice.length || 6
    const dice = Array.from({ length: left }, () => d6(random))
    if (!farkleScore(dice).points) return { dice, picked: [], turnPoints: 0, scores: s.scores, turn: 1 - s.turn, rolled: false, winner: undefined, log: `Farkle! ${['You', 'Computer'][s.turn]} lost ${turnPoints} points.`, last: [] }
    return { ...s, dice, picked: Array(left).fill(false), turnPoints, rolled: true, log: '', last: dice.map((_, i) => i) }
  },
  outcome: s => s.winner === undefined ? null : { winner: s.winner, text: `${s.scores[0]}–${s.scores[1]}. ${['You', 'Computer'][s.winner!]} reached ${FARKLE_TARGET}.` },
  bot: s => {
    if (!s.rolled) return { roll: true }
    // Set aside every scoring die, then bank once the turn is worth it or few dice remain.
    const scoring = s.dice.map((_, i) => i).filter(i => { const without = s.dice.filter((__, j) => j !== i); return farkleScore(s.dice).points > farkleScore(without).points })
    const toggle = s.dice.findIndex((_, i) => scoring.includes(i) !== s.picked[i])
    if (toggle >= 0) return { pick: toggle }
    const chosen = s.dice.filter((_, i) => s.picked[i]), total = s.turnPoints + farkleScore(chosen).points, left = s.dice.length - chosen.length || 6
    return total >= 500 || (total >= 300 && left <= 2) || s.scores[s.turn] + total >= FARKLE_TARGET ? { bank: true } : { roll: true }
  },
  status: s => s.log || `Turn so far: ${s.turnPoints} · You ${s.scores[0]} · Computer ${s.scores[1]}`,
  lastMove: s => s.last,
}

/* ── Shut the Box: flip down tiles that add up to your roll; shut all nine to win ── */
export interface BoxState { tiles: boolean[]; dice: number[]; winner: number | null | undefined; last: number[] }
const combos = (tiles: boolean[], total: number) => {
  const found: number[][] = []
  const search = (start: number, left: number, chosen: number[]) => { if (!left) { found.push(chosen); return } for (let n = start; n <= Math.min(9, left); n++) if (tiles[n - 1]) search(n + 1, left - n, [...chosen, n]) }
  search(1, total, []); return found
}
export const SHUT_THE_BOX: FamilyGame<BoxState> = {
  id: 'shutbox', title: 'Shut the Box', players: 1, names: ['You'], layout: { kind: 'custom' },
  setup: () => ({ tiles: Array(9).fill(true), dice: [], winner: undefined, last: [] }),
  current: () => 0,
  moves: s => {
    if (s.winner !== undefined) return []
    if (!s.dice.length) return [{ roll: true, label: s.tiles[6] || s.tiles[7] || s.tiles[8] ? 'Roll two dice' : 'Roll one die' }]
    return combos(s.tiles, s.dice.reduce((a, b) => a + b, 0)).map(tiles => ({ tiles, label: `Shut ${tiles.join(' + ')}` }))
  },
  play: (s, move, random) => {
    if (move.roll) {
      const dice = s.tiles[6] || s.tiles[7] || s.tiles[8] ? [d6(random), d6(random)] : [d6(random)]
      const next = { ...s, dice, last: [] }
      if (!combos(s.tiles, dice.reduce((a, b) => a + b, 0)).length) return { ...next, winner: null }
      return next
    }
    const tiles = [...s.tiles]; (move.tiles as number[]).forEach(n => { tiles[n - 1] = false })
    return { tiles, dice: [], winner: tiles.every(up => !up) ? 0 : undefined, last: move.tiles as number[] }
  },
  outcome: s => s.winner === undefined ? null : { winner: s.winner, text: s.winner === 0 ? 'You shut the box!' : `No way to make ${s.dice.reduce((a, b) => a + b, 0)}. Your score is ${s.tiles.reduce((sum, up, i) => up ? sum + i + 1 : sum, 0)} — lower is better.` },
  status: s => s.dice.length ? `You rolled ${s.dice.join(' + ')} = ${s.dice.reduce((a, b) => a + b, 0)}. Choose tiles that add up to it.` : 'Roll the dice.',
  lastMove: s => s.last,
}

/* ── Pig: roll as long as you dare; a 1 wipes the turn. First to 100. ── */
export interface PigState { scores: number[]; turnPoints: number; die: number; turn: number; winner: number | null | undefined; log: string; last: number[] }
export const PIG: FamilyGame<PigState> = {
  id: 'pig', title: 'Pig', players: 2, names: ['You', 'Computer'], colors: ['#f6efe0', '#ed9c81'], layout: { kind: 'custom' },
  setup: () => ({ scores: [0, 0], turnPoints: 0, die: 0, turn: 0, winner: undefined, log: 'Roll to build points. Hold to bank them. A 1 loses the turn.', last: [] }),
  current: s => s.turn,
  moves: s => s.winner !== undefined ? [] : [{ roll: true, label: 'Roll' }, ...(s.turnPoints ? [{ hold: true, label: `Hold ${s.turnPoints}` }] : [])],
  play: (s, move, random) => {
    const name = ['You', 'Computer'][s.turn]
    if (move.hold) { const scores = [...s.scores]; scores[s.turn] += s.turnPoints; return { scores, turnPoints: 0, die: s.die, turn: 1 - s.turn, winner: scores[s.turn] >= 100 ? s.turn : undefined, log: `${name} banked ${s.turnPoints}.`, last: [] } }
    const die = d6(random)
    if (die === 1) return { ...s, die, turnPoints: 0, turn: 1 - s.turn, log: `${name} rolled a 1 and lost ${s.turnPoints}.`, last: [1] }
    return { ...s, die, turnPoints: s.turnPoints + die, log: '', last: [die] }
  },
  outcome: s => s.winner === undefined ? null : { winner: s.winner, text: `${s.scores[0]}–${s.scores[1]}.` },
  bot: s => s.turnPoints >= 20 || s.scores[s.turn] + s.turnPoints >= 100 ? { hold: true } : { roll: true },
  status: s => s.log || `This turn: ${s.turnPoints}`,
  lastMove: s => s.last,
}

/* ── Liar's dice: bid on all the dice under both cups; call "Liar!" to check ── */
export interface LiarState { cups: number[][]; bid: { count: number; face: number } | null; bidder: number; turn: number; winner: number | null | undefined; log: string; reveal: boolean }
const deal = (sizes: number[], random: Random) => sizes.map(size => Array.from({ length: size }, () => d6(random)).sort())
export const LIARS_DICE: FamilyGame<LiarState> = {
  id: 'liarsdice', title: "Liar's Dice", players: 2, names: ['You', 'Computer'], colors: ['#f6efe0', '#c4afff'], layout: { kind: 'custom' },
  setup: random => ({ cups: deal([5, 5], random), bid: null, bidder: -1, turn: 0, winner: undefined, log: 'Bid how many of one face are under both cups — or call the last bid a lie.', reveal: false }),
  current: s => s.turn,
  moves: s => {
    if (s.winner !== undefined) return []
    if (s.reveal) return [{ next: true, label: 'Next round' }]
    const total = s.cups[0].length + s.cups[1].length, moves: Move[] = []
    for (let count = s.bid?.count ?? 1; count <= Math.min(total, (s.bid?.count ?? 1) + 2); count++) for (let face = 1; face <= 6; face++) {
      if (s.bid && (count < s.bid.count || (count === s.bid.count && face <= s.bid.face))) continue
      moves.push({ count, face, label: `${count} × ${face}` })
    }
    if (s.bid) moves.push({ liar: true, label: 'Liar!' })
    return moves
  },
  play: (s, move, random) => {
    if (move.next) { const sizes = s.cups.map(cup => cup.length); return { ...s, cups: deal(sizes, random), bid: null, bidder: -1, reveal: false, log: `New round. ${['You', 'Computer'][s.turn]} ${s.turn === 0 ? 'bid' : 'bids'} first.` } }
    if (move.liar) {
      const { count, face } = s.bid!, actual = s.cups.flat().filter(d => d === face).length, loser = actual >= count ? s.turn : s.bidder
      const cups = s.cups.map(cup => [...cup]); cups[loser].pop()
      const winner = cups[loser].length ? undefined : 1 - loser
      return { ...s, cups, reveal: true, turn: loser, winner, log: `There ${actual === 1 ? 'is' : 'are'} ${actual} × ${face}. ${['You', 'Computer'][loser]} ${loser === 0 ? 'lose' : 'loses'} a die.` }
    }
    return { ...s, bid: { count: move.count as number, face: move.face as number }, bidder: s.turn, turn: 1 - s.turn, log: `${['You', 'Computer'][s.turn]} ${s.turn === 0 ? 'bid' : 'bids'} ${move.count} × ${move.face}.` }
  },
  outcome: s => s.winner === undefined ? null : { winner: s.winner, text: s.winner === 0 ? 'The computer is out of dice. You win!' : 'You are out of dice.' },
  bot: (s, random) => {
    if (s.reveal) return { next: true }
    const mine = s.cups[s.turn], unseen = s.cups[1 - s.turn].length
    // Expect a sixth of the hidden dice to show any face.
    const expected = (face: number) => mine.filter(d => d === face).length + unseen / 6
    if (s.bid && s.bid.count > expected(s.bid.face) + 0.9) return { liar: true }
    const face = [1, 2, 3, 4, 5, 6].reduce((best, f) => expected(f) > expected(best) ? f : best, 6)
    const options = LIARS_DICE.moves(s).filter(m => !m.liar) as { count: number; face: number }[]
    const safe = options.filter(o => o.count <= expected(o.face) + (random() < 0.25 ? 1 : 0.3))
    return (safe.find(o => o.face === face) ?? safe[0] ?? (s.bid ? { liar: true } : options[0])) as Move
  },
  status: s => s.log,
}
