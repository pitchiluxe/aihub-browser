import { shuffled, type Random } from './random'
// The card room: Crazy Eights, Rummy and Whist on one 52-card deck.
// Suits 0–3 are ♠ ♥ ♦ ♣; ranks run 1 (ace) to 13 (king).
export interface PlayCard { suit: number; rank: number }
export const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'], SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs']
export const rankLabel = (rank: number) => ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][rank - 1]
export const cardLabel = (card: PlayCard) => `${rankLabel(card.rank)}${SUIT_SYMBOLS[card.suit]}`
export const isRed = (card: PlayCard) => card.suit === 1 || card.suit === 2
export const sameCard = (a: PlayCard, b: PlayCard) => a.suit === b.suit && a.rank === b.rank
export function freshDeck(random: Random = Math.random): PlayCard[] { return shuffled(Array.from({ length: 52 }, (_, i) => ({ suit: Math.floor(i / 13), rank: i % 13 + 1 })), random) }
export const sortHand = (hand: PlayCard[]) => [...hand].sort((a, b) => a.suit - b.suit || a.rank - b.rank)
const said = (name: string, you: string, other: string) => `${name} ${name === 'You' ? you : other}`
const names = (count: number, humans = 1) => Array.from({ length: count }, (_, i) => i < humans ? humans === 1 ? 'You' : `Player ${i + 1}` : `Computer ${i - humans + 1}`)

/* ── Crazy Eights ─────────────────────────────────────────────────────────
   Match the suit or rank of the top card. 8s are wild and name a suit.
   A 2 makes the next player draw two, a jack skips them, an ace reverses. */
export interface EightsState { hands: PlayCard[][]; names: string[]; bots: boolean[]; stock: PlayCard[]; pile: PlayCard[]; suit: number; current: number; direction: 1 | -1; drew: boolean; winner: number | null; log: string[] }
export function newEights(humans = 1, total = 2, random: Random = Math.random): EightsState {
  const count = Math.min(4, Math.max(2, total)), deck = freshDeck(random), size = count === 2 ? 7 : 5
  const hands = Array.from({ length: count }, (_, i) => sortHand(deck.slice(i * size, i * size + size)))
  let stock = deck.slice(count * size)
  // Never open on an action card.
  const start = stock.findIndex(card => ![1, 2, 8, 11].includes(card.rank))
  const top = stock[start]; stock = [...stock.slice(0, start), ...stock.slice(start + 1)]
  return { hands, names: names(count, humans), bots: Array.from({ length: count }, (_, i) => i >= humans), stock, pile: [top], suit: top.suit, current: 0, direction: 1, drew: false, winner: null, log: [`The first card is ${cardLabel(top)}.`] }
}
export const eightsPlayable = (state: EightsState, card: PlayCard) => card.rank === 8 || card.suit === state.suit || card.rank === state.pile[state.pile.length - 1].rank
const step = (state: EightsState, from: number, by = 1) => ((from + state.direction * by) % state.hands.length + state.hands.length) % state.hands.length
function drawFromStock(next: EightsState, player: number, count: number) {
  for (let i = 0; i < count; i++) {
    if (!next.stock.length) { const top = next.pile.pop()!; next.stock = shuffled(next.pile); next.pile = [top] }
    const card = next.stock.pop(); if (card) next.hands[player].push(card)
  }
  next.hands[player] = sortHand(next.hands[player])
}
export function playEights(state: EightsState, index: number, chosenSuit?: number): EightsState {
  const hand = state.hands[state.current], card = hand[index]
  if (state.winner !== null || !card || !eightsPlayable(state, card)) return state
  const next: EightsState = { ...state, hands: state.hands.map(cards => [...cards]), pile: [...state.pile, card], stock: [...state.stock], drew: false, log: [...state.log] }
  next.hands[state.current].splice(index, 1)
  next.suit = card.rank === 8 ? chosenSuit ?? card.suit : card.suit
  const name = state.names[state.current]
  next.log = [`${said(name, 'play', 'plays')} ${cardLabel(card)}${card.rank === 8 ? ` and ${name === 'You' ? 'call' : 'calls'} ${SUIT_NAMES[next.suit]}` : ''}.`, ...next.log].slice(0, 12)
  if (!next.hands[state.current].length) { next.winner = state.current; next.log = [`${said(name, 'go', 'goes')} out and ${name === 'You' ? 'win' : 'wins'}!`, ...next.log]; return next }
  if (card.rank === 1 && next.hands.length > 2) next.direction = -state.direction as 1 | -1
  let target = step(next, state.current)
  if (card.rank === 2) { drawFromStock(next, target, 2); next.log = [`${said(next.names[target], 'draw', 'draws')} two and ${next.names[target] === 'You' ? 'miss' : 'misses'} a turn.`, ...next.log]; target = step(next, target) }
  else if (card.rank === 11 || (card.rank === 1 && next.hands.length === 2)) { next.log = [`${said(next.names[target], 'are', 'is')} skipped.`, ...next.log]; target = step(next, target) }
  next.current = target
  return next
}
export function drawEights(state: EightsState): EightsState {
  if (state.winner !== null || state.drew) return state
  const next: EightsState = { ...state, hands: state.hands.map(cards => [...cards]), pile: [...state.pile], stock: [...state.stock], drew: true, log: [`${said(state.names[state.current], 'draw', 'draws')} a card.`, ...state.log].slice(0, 12) }
  drawFromStock(next, state.current, 1)
  return next
}
export function passEights(state: EightsState): EightsState {
  if (state.winner !== null || !state.drew) return state
  return { ...state, drew: false, current: step(state, state.current), log: [`${said(state.names[state.current], 'pass', 'passes')}.`, ...state.log].slice(0, 12) }
}
/** The computer's turn, start to finish: a play, or a draw and then a play or pass. */
export function botEights(state: EightsState): EightsState {
  const hand = state.hands[state.current], options = hand.map((card, index) => ({ card, index })).filter(({ card }) => eightsPlayable(state, card))
  if (!options.length) return state.drew ? passEights(state) : botEights(drawEights(state))
  // Keep eights for emergencies; lead with action cards when the next player is close to going out.
  const nextHand = state.hands[step(state, state.current)].length
  const value = ({ card }: { card: PlayCard }) => (card.rank === 8 ? -20 : 0) + ([2, 11].includes(card.rank) ? (nextHand <= 2 ? 30 : 5) : 0) + hand.filter(other => other.suit === card.suit).length
  const pick = options.reduce((best, option) => value(option) > value(best) ? option : best)
  const suits = [0, 1, 2, 3].map(suit => hand.filter(card => card.suit === suit && card.rank !== 8).length)
  return playEights(state, pick.index, suits.indexOf(Math.max(...suits)))
}

/* ── Rummy ────────────────────────────────────────────────────────────────
   Seven cards each. Draw from the stock or the discard pile, then discard.
   Go out when all seven cards form sets (3–4 of a rank) or runs (3+ in suit). */
export interface RummyState { hands: PlayCard[][]; names: string[]; bots: boolean[]; stock: PlayCard[]; discard: PlayCard[]; current: number; phase: 'draw' | 'discard'; winner: number | null; log: string[] }
export function newRummy(humans = 1, total = 2, random: Random = Math.random): RummyState {
  const count = Math.min(4, Math.max(2, total)), deck = freshDeck(random)
  const hands = Array.from({ length: count }, (_, i) => sortHand(deck.slice(i * 7, i * 7 + 7)))
  const stock = deck.slice(count * 7)
  return { hands, names: names(count, humans), bots: Array.from({ length: count }, (_, i) => i >= humans), stock: stock.slice(1), discard: [stock[0]], current: 0, phase: 'draw', winner: null, log: ['Draw a card, then discard one. Make all seven cards into sets and runs to go out.'] }
}
const isSet = (cards: PlayCard[]) => cards.length >= 3 && cards.every(card => card.rank === cards[0].rank)
const isRun = (cards: PlayCard[]) => {
  if (cards.length < 3 || !cards.every(card => card.suit === cards[0].suit)) return false
  const ranks = cards.map(card => card.rank).sort((a, b) => a - b)
  return ranks.every((rank, i) => i === 0 || rank === ranks[i - 1] + 1)
}
/** The split of a hand into melds that leaves the fewest points unmatched. */
export function bestMelds(hand: PlayCard[]): { melds: PlayCard[][]; deadwood: PlayCard[] } {
  const points = (cards: PlayCard[]) => cards.reduce((sum, card) => sum + Math.min(10, card.rank), 0)
  let best = { melds: [] as PlayCard[][], deadwood: hand }
  const candidates: number[][] = []
  const n = hand.length
  for (let mask = 1; mask < 1 << n; mask++) {
    const picked = hand.filter((_, i) => mask >> i & 1)
    if (picked.length >= 3 && (isSet(picked) || isRun(picked))) candidates.push(hand.map((_, i) => i).filter(i => mask >> i & 1))
  }
  const search = (used: Set<number>, melds: number[][], start: number) => {
    const deadwood = hand.filter((_, i) => !used.has(i))
    if (points(deadwood) < points(best.deadwood)) best = { melds: melds.map(meld => meld.map(i => hand[i])), deadwood }
    for (let c = start; c < candidates.length; c++) {
      if (candidates[c].some(i => used.has(i))) continue
      search(new Set([...used, ...candidates[c]]), [...melds, candidates[c]], c + 1)
    }
  }
  search(new Set(), [], 0)
  return best
}
export function drawRummy(state: RummyState, from: 'stock' | 'discard'): RummyState {
  if (state.winner !== null || state.phase !== 'draw' || (from === 'discard' && !state.discard.length)) return state
  const next: RummyState = { ...state, hands: state.hands.map(cards => [...cards]), stock: [...state.stock], discard: [...state.discard], phase: 'discard' }
  if (from === 'stock' && !next.stock.length) { const top = next.discard.pop()!; next.stock = shuffled(next.discard); next.discard = [top] }
  const card = from === 'stock' ? next.stock.pop()! : next.discard.pop()!
  next.hands[state.current] = sortHand([...next.hands[state.current], card])
  const name = state.names[state.current]
  next.log = [from === 'stock' ? `${said(name, 'draw', 'draws')} from the stock.` : `${said(name, 'take', 'takes')} ${cardLabel(card)} from the discard pile.`, ...state.log].slice(0, 12)
  return next
}
export function discardRummy(state: RummyState, index: number): RummyState {
  const hand = state.hands[state.current]
  if (state.winner !== null || state.phase !== 'discard' || !hand[index]) return state
  const next: RummyState = { ...state, hands: state.hands.map(cards => [...cards]), discard: [...state.discard, hand[index]], phase: 'draw' }
  next.hands[state.current].splice(index, 1)
  const name = state.names[state.current]
  next.log = [`${said(name, 'discard', 'discards')} ${cardLabel(hand[index])}.`, ...state.log].slice(0, 12)
  if (!bestMelds(next.hands[state.current]).deadwood.length) { next.winner = state.current; next.log = [`Rummy! ${said(name, 'go', 'goes')} out.`, ...next.log] }
  else next.current = (state.current + 1) % state.hands.length
  return next
}
export function botRummy(state: RummyState): RummyState {
  if (state.phase === 'draw') {
    const top = state.discard[state.discard.length - 1], hand = state.hands[state.current]
    const before = bestMelds(hand).deadwood.length, withTop = top ? bestMelds([...hand, top]).deadwood.length : 99
    return drawRummy(state, top && withTop < before ? 'discard' : 'stock')
  }
  const hand = state.hands[state.current]
  // Throw away the card whose removal leaves the least deadwood, heaviest first on ties.
  let pick = 0, bestScore = Infinity
  hand.forEach((card, index) => {
    const rest = hand.filter((_, i) => i !== index), left = bestMelds(rest).deadwood
    const near = left.filter(other => other !== card && (other.rank === card.rank || (other.suit === card.suit && Math.abs(other.rank - card.rank) <= 2))).length
    const score = left.reduce((sum, other) => sum + Math.min(10, other.rank), 0) - near * 0.5
    if (score < bestScore || (score === bestScore && card.rank > hand[pick].rank)) { bestScore = score; pick = index }
  })
  return discardRummy(state, pick)
}

/* ── Whist ────────────────────────────────────────────────────────────────
   Four players in two partnerships (You + North against East + West).
   The dealer's last card sets trumps. Follow suit if you can; the highest
   trump, or the highest card of the suit led, takes the trick. Each trick
   over six scores a point; the first partnership to five points wins. */
export interface WhistState { hands: PlayCard[][]; names: string[]; trump: number; trick: { player: number; card: PlayCard }[]; leader: number; current: number; tricks: [number, number]; score: [number, number]; dealer: number; lastTrick: { player: number; card: PlayCard }[] | null; phase: 'play' | 'hand' | 'over'; log: string[] }
export const WHIST_NAMES = ['You', 'West', 'North', 'East']
export const whistTeam = (player: number) => player % 2 as 0 | 1
export function newWhist(random: Random = Math.random, score: [number, number] = [0, 0], dealer = 3): WhistState {
  const deck = freshDeck(random), hands = [0, 1, 2, 3].map(i => sortHand(deck.slice(i * 13, i * 13 + 13)))
  const trump = deck[51].suit, leader = (dealer + 1) % 4
  return { hands, names: WHIST_NAMES, trump, trick: [], leader, current: leader, tricks: [0, 0], score, dealer, lastTrick: null, phase: 'play', log: [`${WHIST_NAMES[dealer]} dealt. Trumps are ${SUIT_NAMES[trump]}.`] }
}
export function whistPlayable(state: WhistState, player: number): number[] {
  const hand = state.hands[player], led = state.trick[0]?.card.suit
  const follow = hand.map((card, i) => card.suit === led ? i : -1).filter(i => i >= 0)
  return led === undefined || !follow.length ? hand.map((_, i) => i) : follow
}
export function trickWinner(trick: { player: number; card: PlayCard }[], trump: number): number {
  const led = trick[0].card.suit
  return trick.reduce((best, play) => {
    const strength = (card: PlayCard) => (card.suit === trump ? 200 : card.suit === led ? 100 : 0) + (card.rank === 1 ? 14 : card.rank)
    return strength(play.card) > strength(best.card) ? play : best
  }).player
}
export function playWhist(state: WhistState, index: number): WhistState {
  if (state.phase !== 'play' || !whistPlayable(state, state.current).includes(index)) return state
  const next: WhistState = { ...state, hands: state.hands.map(cards => [...cards]), trick: [...state.trick], tricks: [...state.tricks] as [number, number], score: [...state.score] as [number, number], log: [...state.log] }
  const [card] = next.hands[state.current].splice(index, 1)
  next.trick.push({ player: state.current, card })
  if (next.trick.length < 4) { next.current = (state.current + 1) % 4; return next }
  const winner = trickWinner(next.trick, state.trump)
  next.tricks[whistTeam(winner)]++
  next.lastTrick = next.trick; next.trick = []; next.leader = winner; next.current = winner
  next.log = [`${said(WHIST_NAMES[winner], 'take', 'takes')} the trick.`, ...next.log].slice(0, 12)
  if (next.hands.every(hand => !hand.length)) {
    const team = next.tricks[0] > 6 ? 0 : 1, points = next.tricks[team] - 6
    next.score[team] += points
    next.log = [`${team === 0 ? 'You and North' : 'East and West'} won ${next.tricks[team]} tricks for ${points} point${points === 1 ? '' : 's'}.`, ...next.log]
    next.phase = next.score[team] >= 5 ? 'over' : 'hand'
  }
  return next
}
export function nextWhistHand(state: WhistState, random: Random = Math.random): WhistState {
  return state.phase === 'hand' ? newWhist(random, state.score, (state.dealer + 1) % 4) : state
}
export function chooseWhistCard(state: WhistState): number {
  const player = state.current, hand = state.hands[player], legal = whistPlayable(state, player), power = (card: PlayCard) => card.rank === 1 ? 14 : card.rank
  const lowest = (options: number[]) => options.reduce((best, i) => power(hand[i]) + (hand[i].suit === state.trump ? 20 : 0) < power(hand[best]) + (hand[best].suit === state.trump ? 20 : 0) ? i : best)
  if (!state.trick.length) {
    // Lead the top of the longest plain suit, or an ace.
    const ace = legal.find(i => hand[i].rank === 1 && hand[i].suit !== state.trump)
    if (ace !== undefined) return ace
    const counts = [0, 1, 2, 3].map(suit => suit === state.trump ? -1 : hand.filter(card => card.suit === suit).length), suit = counts.indexOf(Math.max(...counts))
    const options = legal.filter(i => hand[i].suit === suit)
    return (options.length ? options : legal).reduce((best, i) => power(hand[i]) > power(hand[best]) ? i : best)
  }
  const current = trickWinner(state.trick, state.trump)
  if (whistTeam(current) === whistTeam(player)) return lowest(legal)
  const winning = legal.filter(i => trickWinner([...state.trick, { player, card: hand[i] }], state.trump) === player)
  return winning.length ? lowest(winning) : lowest(legal)
}
