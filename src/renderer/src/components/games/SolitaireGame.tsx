import React, { useEffect, useState } from 'react'
import { cardRed, drawSolitaire, moveSolitaire, newSolitaire, solitaireWon, type Card, type CardSource, type SolitaireState } from '../../../../shared/games/solitaire'
import { GameButton, GameResult, GameStats, useCounterSound, useEndSound, type GameProps } from './GameControls'
const SUITS = ['♠', '♥', '♦', '♣']
const rank = (value: number) => ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][value - 1]
function PlayingCard({ card, selected, onClick, onDoubleClick, style }: { card: Card; selected?: boolean; onClick: () => void; onDoubleClick?: () => void; style?: React.CSSProperties }) {
  return <button className={`gr-card ${card.up ? 'face' : 'back'} ${selected ? 'selected' : ''}`} style={{ ...style, color: card.up ? cardRed(card) ? '#b82942' : '#182237' : undefined }} aria-label={card.up ? `${rank(card.rank)} ${SUITS[card.suit]}` : 'Face-down card'} onClick={onClick} onDoubleClick={onDoubleClick}><span>{card.up ? rank(card.rank) : ''}</span><b>{card.up ? SUITS[card.suit] : '◇'}</b></button>
}
export default function SolitaireGame({ paused, onFinish }: GameProps) {
  const [state, setState] = useState<SolitaireState>(() => newSolitaire())
  const [history, setHistory] = useState<SolitaireState[]>([])
  const [selected, setSelected] = useState<CardSource | null>(null)
  const [hint, setHint] = useState('Select a face-up card, then a destination. Double-click a card to send it home.')
  const won = solitaireWon(state)
  useCounterSound(history.length, 'card', 'card'); useEndSound(won, true)
  useEffect(() => { if (won) onFinish(Math.max(0, state.score)) }, [won, state.score, onFinish])
  const commit = (next: SolitaireState) => {
    if (paused || next === state) return false
    setHistory(previous => [...previous.slice(-99), state]); setState(next); setSelected(null); setHint('Build alternating colors downward. Foundations build by suit from Ace to King.'); return true
  }
  const destination = (area: 'pile' | 'foundation', pile: number) => {
    if (selected && !commit(moveSolitaire(state, selected, { area, pile }))) setHint('That move does not fit. Use alternating colors and descending ranks, or place a King in an empty column.')
  }
  const choose = (from: CardSource) => {
    if (paused) return
    if (selected && from.area === 'pile' && (selected.area !== 'pile' || from.pile !== selected.pile) && commit(moveSolitaire(state, selected, { area: 'pile', pile: from.pile }))) return
    setSelected(from)
  }
  const home = (from: CardSource, card: Card) => { if (!commit(moveSolitaire(state, from, { area: 'foundation', pile: card.suit }))) setHint('A foundation needs the next rank of the same suit.') }
  return <div className="gr-solitaire">
    <GameStats items={[["Score", state.score], ['Moves', state.moves], ['Foundations', state.foundations.reduce((total, pile) => total + pile.length, 0) + '/52']]} />
    <div className="gr-solitaire-top"><div className="gr-stock-group"><button className="gr-card back" aria-label={state.stock.length ? `Draw card (${state.stock.length} left)` : 'Recycle waste'} onClick={() => { if (!paused) commit(drawSolitaire(state)) }}><b>{state.stock.length ? '◇' : '↻'}</b><small>{state.stock.length}</small></button><div className="gr-card-slot">{state.waste.length > 0 && <PlayingCard card={state.waste[state.waste.length - 1]} selected={selected?.area === 'waste'} onClick={() => choose({ area: 'waste', pile: 0, index: state.waste.length - 1 })} onDoubleClick={() => home({ area: 'waste', pile: 0, index: state.waste.length - 1 }, state.waste[state.waste.length - 1])} />}</div></div><div className="gr-foundations">{state.foundations.map((pile, i) => <div className="gr-card-slot" key={i}><button className="gr-empty-card" aria-label={`Foundation ${SUITS[i]}`} onClick={() => destination('foundation', i)}>{SUITS[i]}</button>{pile.length > 0 && <PlayingCard card={pile[pile.length - 1]} onClick={() => selected ? destination('foundation', i) : choose({ area: 'foundation', pile: i, index: pile.length - 1 })} />}</div>)}</div></div>
    <div className="gr-tableau">{state.piles.map((pile, col) => <div key={col} className="gr-tableau-column" style={{ minHeight: Math.max(180, pile.length * 27 + 100) }}><button className="gr-empty-card" aria-label={`Column ${col + 1}`} onClick={() => destination('pile', col)}>K</button>{pile.map((card, index) => <PlayingCard key={card.id} card={card} style={{ top: index * (card.up ? 27 : 17), zIndex: index + 1 }} selected={selected?.area === 'pile' && selected.pile === col && index >= selected.index} onClick={() => choose({ area: 'pile', pile: col, index })} onDoubleClick={() => home({ area: 'pile', pile: col, index }, card)} />)}</div>)}</div>
    <div className="gr-solitaire-help"><p role="status">{hint}</p><GameButton disabled={!history.length || paused} onClick={() => { const previous = history[history.length - 1]; if (previous) { setState(previous); setHistory(history.slice(0, -1)); setSelected(null) } }}>Undo</GameButton></div>
    {won && <GameResult title="A clean table" text="Every card is home. Well played." />}
  </div>
}
