import React, { useEffect, useRef, useState } from 'react'
import { bestMelds, botEights, botRummy, cardLabel, chooseWhistCard, discardRummy, drawEights, drawRummy, eightsPlayable, isRed, newEights, newRummy, newWhist, nextWhistHand, passEights, playEights, playWhist, rankLabel, sameCard, SUIT_NAMES, SUIT_SYMBOLS, whistPlayable, whistTeam, WHIST_NAMES, type EightsState, type PlayCard, type RummyState, type WhistState } from '../../../../shared/games/cards'
import { GameButton, GameResult, useBoardView, ViewToggle, type GameProps } from './GameControls'
import { playSound } from './sounds'
import './tabletop.css'

type Table = 'eights' | 'rummy' | 'whist'
const TABLES: { id: Table; title: string; blurb: string }[] = [
  { id: 'eights', title: 'Crazy Eights', blurb: 'Match suit or rank. 8s are wild, 2s make the next player draw two, jacks skip, aces reverse.' },
  { id: 'rummy', title: 'Rummy', blurb: 'Draw, then discard. Turn all seven cards into sets and runs to go out.' },
  { id: 'whist', title: 'Whist', blurb: 'You and North against East and West. Follow suit, trumps win, first team to five points.' },
]
export function CardFace({ card, hidden, onClick, disabled, glow, small, delay = 0, className = '' }: { card?: PlayCard; hidden?: boolean; onClick?: () => void; disabled?: boolean; glow?: boolean; small?: boolean; delay?: number; className?: string }) {
  const style = { '--deal': `${delay}ms` } as React.CSSProperties
  const body = hidden || !card ? <span className="gr-pc-back" /> : <><span className="gr-pc-corner">{rankLabel(card.rank)}<br />{SUIT_SYMBOLS[card.suit]}</span><span className="gr-pc-pip">{card.rank > 10 ? ['J', 'Q', 'K'][card.rank - 11] : SUIT_SYMBOLS[card.suit]}</span><span className="gr-pc-corner is-flip">{rankLabel(card.rank)}<br />{SUIT_SYMBOLS[card.suit]}</span></>
  const classes = `gr-pc ${hidden || !card ? 'is-back' : isRed(card) ? 'is-red' : 'is-black'} ${glow ? 'is-glow' : ''} ${small ? 'is-small' : ''} ${className}`
  return onClick ? <button type="button" className={classes} style={style} disabled={disabled} onClick={onClick} aria-label={hidden || !card ? 'Face-down card' : cardLabel(card)}>{body}</button> : <span className={classes} style={style} aria-label={hidden || !card ? 'Face-down card' : cardLabel(card)}>{body}</span>
}
const Backs = ({ count, label }: { count: number; label: string }) => <span className="gr-backs" aria-label={`${label}: ${count} cards`}>{Array.from({ length: Math.min(count, 13) }, (_, i) => <CardFace key={i} hidden small />)}</span>

export default function CardRoom(props: GameProps) {
  const [table, setTable] = useState<Table>('eights'), [tilted, toggleView] = useBoardView('cards')
  const info = TABLES.find(item => item.id === table)!
  return <div className="gr-card-room">
    <nav className="gr-card-tabs" aria-label="Card games">{TABLES.map(item => <button key={item.id} type="button" aria-pressed={table === item.id} className={table === item.id ? 'active' : ''} onClick={() => { setTable(item.id); playSound('card') }}>{item.title}</button>)}<ViewToggle tilted={tilted} onToggle={toggleView} /></nav>
    <p className="gr-card-blurb">{info.blurb}</p>
    <div className={`gr-felt-stage ${tilted ? 'is-3d' : 'is-flat'}`}>{table === 'eights' ? <EightsTable key="eights" {...props} /> : table === 'rummy' ? <RummyTable key="rummy" {...props} /> : <WhistTable key="whist" {...props} />}</div>
  </div>
}

function useBotTurn(active: boolean, paused: boolean, run: () => void, deps: unknown[], delay = 900) {
  useEffect(() => { if (!active || paused) return; const timer = setTimeout(run, delay); return () => clearTimeout(timer) }, [active, paused, ...deps])
}
function useFinish(over: boolean, won: boolean, score: number, onFinish: GameProps['onFinish']) {
  const reported = useRef(false)
  useEffect(() => { if (!over) { reported.current = false; return } if (reported.current) return; reported.current = true; playSound(won ? 'win' : 'lose'); if (won) onFinish(score) }, [over])
}
const Players = ({ names, current, counts, scores }: { names: string[]; current: number; counts: number[]; scores?: string[] }) => <div className="gr-player-list">{names.map((name, at) => <div key={at} className={current === at ? 'current' : ''}><span>{name}</span><strong>{scores ? scores[at] : `${counts[at]} cards`}</strong></div>)}</div>

function EightsTable({ paused, onFinish }: GameProps) {
  const [state, setState] = useState<EightsState>(() => newEights()), [wild, setWild] = useState<number | null>(null)
  const human = !state.bots[state.current] && state.winner === null, seat = human ? state.current : state.bots.indexOf(false)
  const top = state.pile[state.pile.length - 1]
  useBotTurn(state.bots[state.current] && state.winner === null, paused, () => { const next = botEights(state); playSound(next.pile.length > state.pile.length ? 'card' : 'click'); setState(next) }, [state])
  useFinish(state.winner !== null, state.winner !== null && !state.bots[state.winner], 300 - state.hands.flat().length * 5, onFinish)
  const play = (index: number) => {
    if (paused || !human) return
    const card = state.hands[state.current][index]
    if (!eightsPlayable(state, card)) { playSound('error'); return }
    if (card.rank === 8) { setWild(index); return }
    playSound('card'); setState(playEights(state, index))
  }
  return <div className="gr-play-layout gr-tabletop-layout">
    <div className="gr-felt">
      <div className="gr-opponents">{state.names.map((name, at) => at === seat ? null : <div key={at} className={`gr-opponent ${state.current === at ? 'current' : ''}`}><strong>{name}</strong><Backs count={state.hands[at].length} label={name} /></div>)}</div>
      <div className="gr-card-center">
        <button type="button" className="gr-stock" disabled={!human || state.drew || paused} onClick={() => { playSound('card'); setState(drawEights(state)) }} aria-label={`Draw a card, ${state.stock.length} left`}><CardFace hidden /><small>{state.stock.length}</small></button>
        <span className="gr-pile"><CardFace key={state.pile.length} card={top} className="is-played" /></span>
        <span className={`gr-suit-badge ${state.suit === 1 || state.suit === 2 ? 'is-red' : ''}`} title={`Suit to follow: ${SUIT_NAMES[state.suit]}`}>{SUIT_SYMBOLS[state.suit]}</span>
      </div>
      {wild !== null && <div className="gr-wild" role="dialog" aria-label="Choose a suit"><strong>Name the new suit</strong><div>{[0, 1, 2, 3].map(suit => <button key={suit} type="button" className={suit === 1 || suit === 2 ? 'is-red' : ''} onClick={() => { playSound('card'); setState(playEights(state, wild, suit)); setWild(null) }}>{SUIT_SYMBOLS[suit]}<small>{SUIT_NAMES[suit]}</small></button>)}</div></div>}
      <div className={`gr-my-hand is-fan ${human ? 'is-turn' : ''}`}>{state.hands[seat].map((card, index) => <CardFace key={`${card.suit}-${card.rank}`} card={card} delay={index * 40} glow={human && eightsPlayable(state, card)} disabled={paused || !human} onClick={() => play(index)} />)}</div>
    </div>
    <aside className="gr-game-aside">
      <Players names={state.names} current={state.current} counts={state.hands.map(hand => hand.length)} />
      <h3>{state.winner !== null ? `${state.names[state.winner]} ${state.names[state.winner] === 'You' ? 'win' : 'wins'}!` : human ? 'Your turn' : `${state.names[state.current]} is playing…`}</h3>
      <p>{human ? state.drew ? 'Play the card you drew, or pass.' : `Follow ${SUIT_NAMES[state.suit]} or a ${rankLabel(top.rank)} — or play an 8. Click the deck to draw.` : state.log[0]}</p>
      {human && state.drew && <div className="gr-circuit-actions"><GameButton disabled={paused} onClick={() => setState(passEights(state))}>Pass</GameButton></div>}
      {state.winner !== null && <GameResult title="Round over" text={state.log[0]} />}
      <details className="gr-rules"><summary>Players</summary><div className="gr-circuit-actions"><GameButton onClick={() => setState(newEights(1, 2))}>You vs 1</GameButton><GameButton onClick={() => setState(newEights(1, 4))}>You vs 3</GameButton><GameButton onClick={() => setState(newEights(2, 2))}>2 players</GameButton></div></details>
      <ol className="gr-turn-log">{state.log.slice(0, 5).map((line, i) => <li key={`${state.log.length}-${i}`}>{line}</li>)}</ol>
    </aside>
  </div>
}

function RummyTable({ paused, onFinish }: GameProps) {
  const [state, setState] = useState<RummyState>(() => newRummy())
  const human = !state.bots[state.current] && state.winner === null, seat = human ? state.current : state.bots.indexOf(false)
  const hand = state.hands[seat], { melds } = bestMelds(hand), top = state.discard[state.discard.length - 1]
  const meldOf = (card: PlayCard) => melds.findIndex(meld => meld.some(other => sameCard(other, card)))
  useBotTurn(state.bots[state.current] && state.winner === null, paused, () => { playSound('card'); setState(botRummy(state)) }, [state], state.phase === 'draw' ? 750 : 650)
  useFinish(state.winner !== null, state.winner !== null && !state.bots[state.winner], 500, onFinish)
  return <div className="gr-play-layout gr-tabletop-layout">
    <div className="gr-felt">
      <div className="gr-opponents">{state.names.map((name, at) => at === seat ? null : <div key={at} className={`gr-opponent ${state.current === at ? 'current' : ''}`}><strong>{name}</strong>{state.winner === at ? <span className="gr-reveal">{state.hands[at].map(card => <CardFace key={cardLabel(card)} card={card} small />)}</span> : <Backs count={state.hands[at].length} label={name} />}</div>)}</div>
      <div className="gr-card-center">
        <button type="button" className="gr-stock" disabled={!human || state.phase !== 'draw' || paused} onClick={() => { playSound('card'); setState(drawRummy(state, 'stock')) }} aria-label="Draw from the stock"><CardFace hidden /><small>{state.stock.length}</small></button>
        <span className="gr-pile">{top ? <CardFace key={state.discard.length} card={top} className="is-played" glow={human && state.phase === 'draw'} disabled={!human || state.phase !== 'draw' || paused} onClick={() => { playSound('card'); setState(drawRummy(state, 'discard')) }} /> : <span className="gr-pc is-empty" />}</span>
      </div>
      <div className={`gr-my-hand is-fan ${human ? 'is-turn' : ''}`}>{hand.map((card, index) => { const meld = meldOf(card); return <CardFace key={cardLabel(card)} card={card} delay={index * 40} className={meld >= 0 ? `is-meld meld-${meld}` : ''} glow={human && state.phase === 'discard'} disabled={paused || !human || state.phase !== 'discard'} onClick={() => { playSound('card'); setState(discardRummy(state, index)) }} /> })}</div>
    </div>
    <aside className="gr-game-aside">
      <Players names={state.names} current={state.current} counts={state.hands.map(cards => cards.length)} />
      <h3>{state.winner !== null ? `Rummy! ${state.names[state.winner]} ${state.names[state.winner] === 'You' ? 'win' : 'wins'}` : human ? state.phase === 'draw' ? 'Draw a card' : 'Discard a card' : `${state.names[state.current]} is playing…`}</h3>
      <p>{human ? state.phase === 'draw' ? 'Take the top discard or a card from the stock.' : `Coloured cards already form ${melds.length} meld${melds.length === 1 ? '' : 's'}. Click a card to throw it away.` : state.log[0]}</p>
      {state.winner !== null && <GameResult title="Hand over" text={state.log[0]} />}
      <details className="gr-rules"><summary>Players</summary><div className="gr-circuit-actions"><GameButton onClick={() => setState(newRummy(1, 2))}>You vs 1</GameButton><GameButton onClick={() => setState(newRummy(1, 3))}>You vs 2</GameButton><GameButton onClick={() => setState(newRummy(2, 2))}>2 players</GameButton></div></details>
      <ol className="gr-turn-log">{state.log.slice(0, 5).map((line, i) => <li key={`${state.log.length}-${i}`}>{line}</li>)}</ol>
    </aside>
  </div>
}

function WhistTable({ paused, onFinish }: GameProps) {
  const [state, setState] = useState<WhistState>(() => newWhist()), [holding, setHolding] = useState(false)
  const legal = state.current === 0 && state.phase === 'play' && !holding ? whistPlayable(state, 0) : []
  // A finished trick stays on the table for a moment before it is gathered.
  useEffect(() => { if (!state.lastTrick || state.trick.length) return; setHolding(true); const timer = setTimeout(() => setHolding(false), 1100); return () => clearTimeout(timer) }, [state.lastTrick])
  useBotTurn(state.current !== 0 && state.phase === 'play' && !holding, paused, () => { playSound('card'); setState(playWhist(state, chooseWhistCard(state))) }, [state, holding], 650)
  useFinish(state.phase === 'over', state.score[0] > state.score[1], state.score[0] * 100, onFinish)
  const shown = holding && state.lastTrick ? state.lastTrick : state.trick
  return <div className="gr-play-layout gr-tabletop-layout">
    <div className="gr-felt gr-whist-felt">
      {[1, 2, 3].map(seat => <div key={seat} className={`gr-whist-seat seat-${seat} ${state.current === seat ? 'current' : ''}`}><strong>{WHIST_NAMES[seat]}{seat === 2 ? ' (partner)' : ''}</strong><Backs count={state.hands[seat].length} label={WHIST_NAMES[seat]} /></div>)}
      <div className="gr-trick">{shown.map(play => <CardFace key={`${play.player}-${cardLabel(play.card)}`} card={play.card} className={`trick-${play.player} is-played`} />)}</div>
      <span className={`gr-suit-badge is-trump ${state.trump === 1 || state.trump === 2 ? 'is-red' : ''}`} title={`Trumps: ${SUIT_NAMES[state.trump]}`}>{SUIT_SYMBOLS[state.trump]}<small>trumps</small></span>
      <div className={`gr-my-hand is-fan ${legal.length ? 'is-turn' : ''}`}>{state.hands[0].map((card, index) => <CardFace key={cardLabel(card)} card={card} delay={index * 30} glow={legal.includes(index)} disabled={paused || !legal.includes(index)} onClick={() => { playSound('card'); setState(playWhist(state, index)) }} />)}</div>
    </div>
    <aside className="gr-game-aside">
      <Players names={['You & North', 'East & West']} current={whistTeam(state.current)} counts={[]} scores={[`${state.score[0]} pts · ${state.tricks[0]} tricks`, `${state.score[1]} pts · ${state.tricks[1]} tricks`]} />
      <h3>{state.phase === 'over' ? state.score[0] > state.score[1] ? 'You and North win!' : 'East and West win' : state.phase === 'hand' ? 'Hand over' : state.current === 0 && !holding ? state.trick.length ? 'Your turn — follow suit if you can' : 'Your lead' : `${WHIST_NAMES[state.current]} is playing…`}</h3>
      <p>{state.log[0]}</p>
      {state.phase === 'hand' && <div className="gr-circuit-actions"><GameButton onClick={() => { playSound('card'); setState(nextWhistHand(state)) }}>Deal the next hand</GameButton></div>}
      {state.phase === 'over' && <GameResult title="Match over" text={`Final score ${state.score[0]}–${state.score[1]}.`} />}
      <ol className="gr-turn-log">{state.log.slice(1, 6).map((line, i) => <li key={`${state.log.length}-${i}`}>{line}</li>)}</ol>
    </aside>
  </div>
}
