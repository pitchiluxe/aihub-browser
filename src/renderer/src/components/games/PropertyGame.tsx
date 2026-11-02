import React, { useEffect, useRef, useState } from 'react'
import { BOARD_SIZE, canBuild, canMortgage, canSell, canUnmortgage, chooseCircuitAction, circuitAction, circuitActor, circuitRent, circuitWorth, JAIL, JAIL_FINE, MAX_LEVEL, mortgageValue, newCircuit, ownsGroup, PROPERTY_BOARD, tradable, unmortgageCost, type CircuitAction, type CircuitState } from '../../../../shared/games/property'
import { Die, Pawn } from './BoardPieces'
import { DICE_SETTLE_MS, GameButton, GameResult, useBoardView, useWalk, ViewToggle, type GameProps } from './GameControls'
import { playSound } from './sounds'
import './property-3d.css'
const GROUPS = ['#8a5a3c', '#5fb8e6', '#d0479a', '#ee8a2c', '#d8433b', '#e6c43c', '#3b9d5a', '#2f5fb8']
const PLAYERS = ['#f5cc68', '#6eb6ff', '#ed9c81', '#c4afff']
const ICONS: Record<string, string> = { start: '➜', tax: '§', chance: '?', chest: '✉', jail: '▥', rest: 'P', gotojail: '⚑', station: '🚇', utility: '⚡' }
const STEP_MS = 170
// Clockwise from the bottom-right corner of a 10 × 10 grid.
const cellOf = (index: number) => index <= 9 ? { gridColumn: 10 - index, gridRow: 10 } : index <= 18 ? { gridColumn: 1, gridRow: 19 - index } : index <= 27 ? { gridColumn: index - 17, gridRow: 1 } : { gridColumn: 10, gridRow: index - 26 }
const sideOf = (index: number) => index % 9 === 0 ? 'corner' : ['bottom', 'left', 'top', 'right'][Math.floor(index / 9)]
const House = ({ color, tower }: { color: string; tower?: boolean }) => <svg viewBox="0 0 14 14" className={`gr-house ${tower ? 'is-tower' : ''}`}><path d={tower ? 'M2 13V6l5-4.5L12 6v7Z' : 'M1 7L7 1.5 13 7v6H1Z'} fill={tower ? '#d8433b' : color} stroke="#0009" strokeWidth=".8" /><path d="M1 7L7 1.5 13 7" fill="none" stroke="#fff6" strokeWidth=".8" /></svg>

// A pawn waits for the dice to land, then hops one space at a time.
function Walker({ index, color, name, target, wait }: { index: number; color: string; name: string; target: number; wait: number }) {
  const [goal, setGoal] = useState(target)
  useEffect(() => { if (target === goal) return; const timer = setTimeout(() => setGoal(target), wait); return () => clearTimeout(timer) }, [target])
  const shown = useWalk(goal, BOARD_SIZE, STEP_MS)
  const first = useRef(true)
  useEffect(() => { if (first.current) { first.current = false; return } playSound('step') }, [shown])
  return <span key={shown} className={`gr-walker seat-${index}`} style={cellOf(shown)} title={name}><span className="gr-walker-hop"><Pawn color={color} /></span></span>
}

export default function PropertyGame({ paused, onFinish }: GameProps) {
  const [state, setState] = useState<CircuitState>(() => newCircuit()), [tilted, toggleView] = useBoardView('property')
  const [holding, setHolding] = useState(false), [selected, setSelected] = useState<number | null>(null), [trading, setTrading] = useState(false)
  const lastPositions = useRef(state.players.map(player => player.position)), reported = useRef(false)
  const actor = circuitActor(state), me = state.players[state.current], actorIsHuman = !state.players[actor].bot && state.phase !== 'over'
  const space = PROPERTY_BOARD[me.position]
  const act = (action: CircuitAction) => {
    if (paused || holding) return
    setState(value => {
      const next = circuitAction(value, action)
      if (next === value) { playSound('error'); return value }
      if (action.type === 'buy') playSound('coin')
      else if (action.type === 'build') playSound('knock')
      else if (action.type === 'bid') playSound('click')
      else if (['mortgage', 'sell', 'payJail'].includes(action.type)) playSound('pay')
      else if (action.type === 'unmortgage' || action.type === 'accept') playSound('coin')
      return next
    })
  }
  // Every roll: tumble the dice, walk the pawn, and only then reveal what happened there.
  useEffect(() => {
    if (!state.rollId) return
    playSound('dice')
    const steps = Math.max(0, ...state.players.map((player, at) => { const forward = (player.position - lastPositions.current[at] + BOARD_SIZE) % BOARD_SIZE; return forward > 12 ? 1 : forward }))
    lastPositions.current = state.players.map(player => player.position)
    setHolding(true)
    const timer = setTimeout(() => { setHolding(false); if (state.card) playSound('card'); else if (state.log[0]?.includes('rent') || state.log[0]?.includes(' tax')) playSound('pay') }, DICE_SETTLE_MS + steps * STEP_MS + 150)
    return () => clearTimeout(timer)
  }, [state.rollId])
  useEffect(() => { if (!holding) lastPositions.current = state.players.map(player => player.position) }, [state, holding])
  useEffect(() => {
    if (paused || holding || state.phase === 'over' || !state.players[actor].bot) return
    const timer = setTimeout(() => { const move = chooseCircuitAction(state); if (move) act(move) }, state.phase === 'auction' ? 450 : 750)
    return () => clearTimeout(timer)
  }, [paused, holding, state])
  useEffect(() => {
    if (state.phase !== 'over' || reported.current) return
    reported.current = true
    const human = state.players.findIndex(player => !player.bot)
    playSound(state.players[state.winner!].bot ? 'lose' : 'win')
    if (human >= 0) onFinish(Math.max(0, Math.round(circuitWorth(state, human))))
  }, [state.phase])
  const restart = (humans: number, bots: number) => { setState(newCircuit(humans, bots)); lastPositions.current = [0, 0, 0, 0]; reported.current = false; setSelected(null); setTrading(false) }

  const deed = selected !== null ? PROPERTY_BOARD[selected] : null
  const manage = actorIsHuman && actor === state.current && ['roll', 'end', 'debt'].includes(state.phase) && !holding
  const hint = holding ? 'Rolling…'
    : state.phase === 'buy' ? `${space.name} is for sale for $${space.price}. Buy it, or send it to auction.`
    : state.phase === 'auction' ? `Auction for ${PROPERTY_BOARD[state.auction!.space].name}. Highest bid $${state.auction!.bid}${state.auction!.leader >= 0 ? ` by ${state.players[state.auction!.leader].name}` : ''}.`
    : state.phase === 'trade' ? `${state.players[state.trade!.to].name}, do you accept this trade?`
    : state.phase === 'debt' ? `${me.name} ${me.name === 'You' ? 'owe' : 'owes'} $${-me.cash}. Sell buildings or mortgage property — click it on the board — or declare bankruptcy.`
    : state.phase === 'roll' && me.jail >= 0 ? `In the lockup (try ${me.jail + 1} of 3). Roll a double, pay $${JAIL_FINE}${me.passes ? ', or use a release pass' : ''}.`
    : state.phase === 'roll' ? 'Roll two dice. Doubles roll again — three in a row and it is the lockup.'
    : state.again ? 'Doubles! Manage your property, then roll again.' : 'Click your property to build, sell or mortgage. Then end your turn.'

  return <div className="gr-circuit-layout">
    <div className={`gr-circuit-stage ${tilted ? 'is-3d' : 'is-flat'}`}><ViewToggle tilted={tilted} onToggle={toggleView} />
      <div className="gr-circuit-board" data-testid="property-board">
        {PROPERTY_BOARD.map((tile, i) => {
          const owner = state.owners[i], level = state.levels[i]
          return <button type="button" key={i} onClick={() => setSelected(selected === i ? null : i)} aria-label={`${tile.name}${owner >= 0 ? `, owned by ${state.players[owner].name}` : ''}`} className={`gr-property is-${tile.type} side-${sideOf(i)} ${selected === i ? 'selected' : ''} ${state.mortgaged[i] ? 'is-mortgaged' : ''}`} style={{ ...cellOf(i), '--band': tile.group === undefined ? 'transparent' : GROUPS[tile.group], '--owner': owner >= 0 ? PLAYERS[owner] : 'transparent' } as React.CSSProperties}>
            <span className="gr-tile-face">{tile.group !== undefined && <i className="gr-tile-band" />}{tile.group === undefined && <span className="gr-space-icon">{ICONS[tile.type]}</span>}<strong>{tile.name}</strong>
            <small>{tile.price ? `$${tile.price}` : tile.type === 'start' ? 'Collect $200' : tile.type === 'tax' ? `Pay $${tile.tax}` : tile.type === 'jail' ? 'Just visiting' : ''}</small>
            {owner >= 0 && <span className="gr-owner">{level === MAX_LEVEL ? <House color={PLAYERS[owner]} tower /> : Array.from({ length: level }, (_, n) => <House key={n} color={PLAYERS[owner]} />)}</span>}
            {state.mortgaged[i] && <span className="gr-mortgage-stamp">Mortgaged</span>}</span>
          </button>
        })}
        {state.players.map((player, at) => !player.out && <Walker key={at} index={at} color={PLAYERS[at]} name={player.name} target={player.position} wait={DICE_SETTLE_MS} />)}
        <div className="gr-circuit-center">
          <span className="gr-deck is-chance" aria-hidden="true"><b>?</b>Opportunity</span><span className="gr-deck is-chest" aria-hidden="true"><b>✉</b>Town Hall</span>
          <h2 className="gr-circuit-banner">Property Circuit</h2>
          {state.card && !holding ? <div key={state.rollId} className={`gr-chance-card is-${state.card.deck}`}><b>{state.card.deck === 'chance' ? 'Opportunity' : 'Town Hall'}</b><p>{state.card.text}</p></div> : null}
          <div className="gr-dice" aria-label={`Dice: ${state.dice.join(' and ') || 'not rolled'}`}>{(state.dice.length ? state.dice : [5, 3]).map((die, i) => <span key={`${state.rollId}-${i}`} className={`gr-die-wrap ${state.rollId ? 'rolled' : ''}`} style={{ '--spin': i ? '-1' : '1' } as React.CSSProperties}><Die value={die} /></span>)}</div>
          <small>Turn {state.turns + 1}</small>
        </div>
      </div>
    </div>
    <aside className="gr-circuit-aside">
      <div className="gr-player-list">{state.players.map((person, i) => <div key={i} className={`${state.current === i ? 'current' : ''} ${person.out ? 'is-out' : ''}`}><Pawn color={PLAYERS[i]} /><span>{person.name}{person.out ? ' · Out' : person.jail >= 0 && person.position === JAIL ? ' · Lockup' : ''}{person.passes ? ` · ${person.passes} pass` : ''}</span><strong>${person.cash}</strong></div>)}</div>
      <h3>{state.phase === 'over' ? 'Circuit finished' : state.players[actor].bot ? `${state.players[actor].name} is thinking…` : actor === state.current ? `${me.name}${me.name === 'You' ? ' — your turn' : ' to play'}` : `${state.players[actor].name} to answer`}</h3>
      <p aria-live="polite">{hint}</p>
      {actorIsHuman && !holding && <div className="gr-circuit-actions">
        {state.phase === 'roll' && me.jail >= 0 && <><GameButton disabled={paused || me.cash < JAIL_FINE} onClick={() => act({ type: 'payJail' })}>Pay ${JAIL_FINE}</GameButton>{me.passes > 0 && <GameButton disabled={paused} onClick={() => act({ type: 'usePass' })}>Use pass</GameButton>}</>}
        {(state.phase === 'roll' || (state.phase === 'end' && state.again)) && <GameButton disabled={paused} onClick={() => act({ type: 'roll' })}>{me.jail >= 0 ? 'Roll for doubles' : state.again ? 'Roll again' : 'Roll dice'}</GameButton>}
        {state.phase === 'buy' && <><GameButton disabled={paused || me.cash < space.price!} onClick={() => act({ type: 'buy' })}>Buy ${space.price}</GameButton><GameButton disabled={paused} onClick={() => act({ type: 'decline' })}>Auction it</GameButton></>}
        {state.phase === 'auction' && state.auction && [10, 50, 100].map(step => <GameButton key={step} disabled={paused || state.auction!.bid + step > state.players[actor].cash} onClick={() => act({ type: 'bid', amount: state.auction!.bid + step })}>Bid ${state.auction!.bid + step}</GameButton>)}
        {state.phase === 'auction' && <GameButton disabled={paused} onClick={() => act({ type: 'pass' })}>Pass</GameButton>}
        {state.phase === 'trade' && <><GameButton onClick={() => act({ type: 'accept' })}>Accept trade</GameButton><GameButton onClick={() => act({ type: 'reject' })}>Decline</GameButton></>}
        {state.phase === 'debt' && <GameButton disabled={paused} onClick={() => act({ type: 'bankrupt' })}>Declare bankruptcy</GameButton>}
        {state.phase === 'end' && !state.again && <GameButton disabled={paused} onClick={() => { act({ type: 'end' }); setSelected(null) }}>End turn</GameButton>}
        {['roll', 'end'].includes(state.phase) && actor === state.current && <GameButton disabled={paused} onClick={() => setTrading(value => !value)}>{trading ? 'Close trade' : 'Propose a trade'}</GameButton>}
      </div>}
      {state.phase === 'trade' && state.trade && <TradeSummary state={state} />}
      {trading && manage && state.phase !== 'debt' && <TradeForm state={state} onOffer={trade => { act({ type: 'offer', trade }); setTrading(false) }} />}
      {deed && selected !== null && <DeedCard state={state} index={selected} manage={manage} onAct={act} onClose={() => setSelected(null)} />}
      {state.phase === 'over' && <GameResult title={`${state.players[state.winner!].name} ${state.players[state.winner!].name === 'You' ? 'win' : 'wins'}`} text={`The winning estate is worth $${Math.round(circuitWorth(state, state.winner!))}.`} />}
      <details className="gr-rules"><summary>Rules & players</summary><p>Buy streets, metro lines and works. Owning every street of a colour doubles its rent and lets you build — evenly — up to four houses and then a tower. Mortgage property for cash when you are short; mortgaged property collects no rent. Decline a purchase and it goes to auction. Trade unbuilt property and cash with anyone. Three doubles in a row, or the Go to lockup corner, sends you to the lockup. The last player standing wins.</p><div className="gr-circuit-actions"><GameButton onClick={() => restart(1, 1)}>You vs 1 computer</GameButton><GameButton onClick={() => restart(1, 3)}>You vs 3 computers</GameButton><GameButton onClick={() => restart(2, 0)}>2 players</GameButton><GameButton onClick={() => restart(4, 0)}>4 players</GameButton></div></details>
      <ol className="gr-turn-log" aria-label="Turn history">{state.log.slice(holding ? 1 : 0, 7).map((message, i) => <li key={`${state.log.length}-${i}`}>{message}</li>)}</ol>
    </aside>
  </div>
}

function DeedCard({ state, index, manage, onAct, onClose }: { state: CircuitState; index: number; manage: boolean; onAct: (action: CircuitAction) => void; onClose: () => void }) {
  const space = PROPERTY_BOARD[index], owner = state.owners[index], mine = manage && owner === state.current
  return <div className="gr-deed" style={{ '--band': space.group === undefined ? '#33415a' : GROUPS[space.group] } as React.CSSProperties}>
    <header><small>{space.type === 'property' ? 'Title deed' : space.type === 'station' ? 'Metro line' : space.type === 'utility' ? 'Works' : 'Space'}</small><strong>{space.name}</strong><button type="button" aria-label="Close deed" onClick={onClose}>×</button></header>
    {space.type === 'property' && <table><tbody>{space.rents!.map((rent, level) => <tr key={level} className={owner >= 0 && state.levels[index] === level ? 'is-now' : ''}><td>{level === 0 ? 'Rent' : level === MAX_LEVEL ? 'With a tower' : `With ${level} house${level > 1 ? 's' : ''}`}</td><td>${rent}</td></tr>)}<tr><td>District complete, no houses</td><td>${space.rents![0] * 2}</td></tr><tr><td>Each house / tower</td><td>${space.house}</td></tr></tbody></table>}
    {space.type === 'station' && <p>Fare $25, doubling for each metro line the owner holds: $25 · $50 · $100 · $200.</p>}
    {space.type === 'utility' && <p>Rent is 4 × the dice, or 10 × with both works.</p>}
    {space.price ? <p>Price ${space.price} · Mortgage ${mortgageValue(index)} · Lift ${unmortgageCost(index)}{owner >= 0 ? ` · Owner ${state.players[owner].name}${state.mortgaged[index] ? ' (mortgaged)' : ''} · Rent now $${circuitRent(state, index, 7)}${space.type === 'utility' ? ' at 7' : ''}` : ''}</p> : <p>{space.type === 'jail' ? 'Visitors just pass by. Inmates roll doubles, pay, or use a pass to get out.' : space.type === 'gotojail' ? 'Go straight to the lockup without passing Launch.' : space.type === 'chance' || space.type === 'chest' ? 'Draw a card and do what it says.' : space.type === 'tax' ? `Pay $${space.tax} to the bank.` : space.type === 'start' ? 'Collect $200 every time you pass.' : 'Take a breather. Nothing happens here.'}</p>}
    {mine && <div className="gr-circuit-actions">
      {space.type === 'property' && <><GameButton disabled={state.phase === 'debt' || !canBuild(state, index)} onClick={() => onAct({ type: 'build', space: index })}>{state.levels[index] === MAX_LEVEL - 1 ? 'Build tower' : 'Build house'} ${space.house}</GameButton><GameButton disabled={!canSell(state, index)} onClick={() => onAct({ type: 'sell', space: index })}>Sell ${space.house! / 2}</GameButton></>}
      {state.mortgaged[index] ? <GameButton disabled={state.phase === 'debt' || !canUnmortgage(state, index)} onClick={() => onAct({ type: 'unmortgage', space: index })}>Lift mortgage ${unmortgageCost(index)}</GameButton> : <GameButton disabled={!canMortgage(state, index)} onClick={() => onAct({ type: 'mortgage', space: index })}>Mortgage +${mortgageValue(index)}</GameButton>}
    </div>}
    {mine && space.type === 'property' && !ownsGroup(state, index) && <small className="gr-deed-note">Own every street in this colour to build.</small>}
  </div>
}

function TradeForm({ state, onOffer }: { state: CircuitState; onOffer: (trade: { from: number; to: number; give: number[]; get: number[]; cash: number }) => void }) {
  const others = state.players.map((_, at) => at).filter(at => at !== state.current && !state.players[at].out)
  const [to, setTo] = useState(others[0]), [give, setGive] = useState<number[]>([]), [get, setGet] = useState<number[]>([]), [cash, setCash] = useState(0)
  const list = (player: number, chosen: number[], set: (value: number[]) => void) => PROPERTY_BOARD.map((space, at) => tradable(state, at, player) ? <label key={at} className="gr-trade-item" style={{ '--band': space.group === undefined ? '#8592a8' : GROUPS[space.group] } as React.CSSProperties}><input type="checkbox" checked={chosen.includes(at)} onChange={event => set(event.target.checked ? [...chosen, at] : chosen.filter(item => item !== at))} />{space.name}{state.mortgaged[at] ? ' (M)' : ''}</label> : null)
  return <form className="gr-trade" onSubmit={event => { event.preventDefault(); onOffer({ from: state.current, to, give, get, cash }) }}>
    <label>Trade with <select value={to} onChange={event => { setTo(Number(event.target.value)); setGet([]); setCash(0) }}>{others.map(at => <option key={at} value={at}>{state.players[at].name}</option>)}</select></label>
    <div className="gr-trade-cols"><fieldset><legend>You give</legend>{list(state.current, give, setGive)}</fieldset><fieldset><legend>You get</legend>{list(to, get, setGet)}</fieldset></div>
    <label>Cash {cash >= 0 ? `you pay $${cash}` : `they pay $${-cash}`}<input type="range" min={-state.players[to].cash} max={state.players[state.current].cash} step={10} value={cash} onChange={event => setCash(Number(event.target.value))} /></label>
    <button type="submit" className="gr-control" disabled={!give.length && !get.length && !cash}>Send offer</button>
  </form>
}

function TradeSummary({ state }: { state: CircuitState }) {
  const trade = state.trade!, names = (list: number[]) => list.map(at => PROPERTY_BOARD[at].name).join(', ') || 'nothing'
  return <div className="gr-trade is-summary"><p><strong>{state.players[trade.from].name}</strong> gives {names(trade.give)}{trade.cash > 0 ? ` and $${trade.cash}` : ''}.</p><p><strong>{state.players[trade.to].name}</strong> gives {names(trade.get)}{trade.cash < 0 ? ` and $${-trade.cash}` : ''}.</p></div>
}
