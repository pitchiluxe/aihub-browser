import { shuffled, type Random } from './random'
export interface Card { id: number; suit: number; rank: number; up: boolean }
export interface SolitaireState { stock: Card[]; waste: Card[]; piles: Card[][]; foundations: Card[][]; moves: number; score: number }
export type CardSource = { area: 'waste' | 'foundation' | 'pile'; pile: number; index: number }
export const cardRed = (card: Card) => card.suit === 1 || card.suit === 2
export function newSolitaire(random: Random = Math.random): SolitaireState {
  const deck = shuffled(Array.from({ length: 52 }, (_, id) => ({ id, suit: Math.floor(id / 13), rank: id % 13 + 1, up: false })), random)
  const piles = Array.from({ length: 7 }, (_, col) => Array.from({ length: col + 1 }, (_, row) => ({ ...deck.pop()!, up: row === col })))
  return { stock: deck, waste: [], piles, foundations: [[], [], [], []], moves: 0, score: 0 }
}
export function drawSolitaire(state: SolitaireState): SolitaireState {
  if (!state.stock.length) return state.waste.length ? { ...state, stock: state.waste.map(card => ({ ...card, up: false })).reverse(), waste: [], moves: state.moves + 1 } : state
  const stock = [...state.stock], card = { ...stock.pop()!, up: true }
  return { ...state, stock, waste: [...state.waste, card], moves: state.moves + 1 }
}
export function selectedCards(state: SolitaireState, from: CardSource): Card[] {
  const pile = from.area === 'waste' ? state.waste : from.area === 'foundation' ? state.foundations[from.pile] : state.piles[from.pile]
  if (!pile || from.index < 0 || from.index >= pile.length) return []
  if (from.area !== 'pile' && from.index !== pile.length - 1) return []
  const cards = pile.slice(from.index)
  if (cards.some(card => !card.up)) return []
  if (!cards.every((card, i) => i === 0 || (cards[i - 1].rank === card.rank + 1 && cardRed(cards[i - 1]) !== cardRed(card)))) return []
  return cards
}
export function moveSolitaire(state: SolitaireState, from: CardSource, to: { area: 'pile' | 'foundation'; pile: number }): SolitaireState {
  if (from.area === to.area && from.pile === to.pile) return state
  const cards = selectedCards(state, from), first = cards[0]
  const destination = to.area === 'pile' ? state.piles[to.pile] : state.foundations[to.pile]
  if (!first || !destination) return state
  const top = destination[destination.length - 1]
  if (to.area === 'foundation') {
    if (cards.length !== 1 || first.suit !== to.pile || first.rank !== (top?.rank || 0) + 1) return state
  } else if (top ? top.rank !== first.rank + 1 || cardRed(top) === cardRed(first) : first.rank !== 13) return state
  const next = { ...state, stock: [...state.stock], waste: [...state.waste], piles: state.piles.map(pile => [...pile]), foundations: state.foundations.map(pile => [...pile]), moves: state.moves + 1, score: state.score + (to.area === 'foundation' ? 10 : from.area === 'foundation' ? -10 : 0) }
  const source = from.area === 'waste' ? next.waste : from.area === 'foundation' ? next.foundations[from.pile] : next.piles[from.pile]
  source.splice(from.index)
  const previous = source[source.length - 1]
  if (previous && !previous.up) { source[source.length - 1] = { ...previous, up: true }; next.score += 5 }
  ;(to.area === 'pile' ? next.piles[to.pile] : next.foundations[to.pile]).push(...cards)
  return next
}
export const solitaireWon = (state: SolitaireState) => state.foundations.every(pile => pile.length === 13)
