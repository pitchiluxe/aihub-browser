import React, { useEffect, useRef, useState } from 'react'
import { canDraw, chooseDominoMove, drawDomino, handPips, legalDominoMoves, newDominoes, nextDominoRound, passDomino, playDomino, type DominoMode, type DominoState, type Tile } from '../../../../shared/games/dominoes'
import { GameButton, GameResult, useBoardView, ViewToggle, type GameProps } from './GameControls'
import { playSound } from './sounds'
import './tabletop.css'

const PIP_SLOTS = [[], [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]]
const Half = ({ value }: { value: number }) => <span className="gr-dom-half">{Array.from({ length: 9 }, (_, slot) => <i key={slot} className={PIP_SLOTS[value].includes(slot) ? 'on' : ''} />)}</span>
export function DominoTile({ tile, vertical, hidden, fresh, className = '' }: { tile: Tile; vertical?: boolean; hidden?: boolean; fresh?: boolean; className?: string }) {
  return <span className={`gr-domino ${vertical ? 'is-vertical' : ''} ${hidden ? 'is-hidden' : ''} ${fresh ? 'is-fresh' : ''} ${className}`} aria-label={hidden ? 'Face-down domino' : `${tile[0]}–${tile[1]}`}>{!hidden && <><Half value={tile[0]} /><i className="gr-dom-bar" /><Half value={tile[1]} /></>}</span>
}
const PER_ROW = 9

export default function DominoesGame({ paused, onFinish }: GameProps) {
  const [state, setState] = useState<DominoState>(() => newDominoes()), [chosen, setChosen] = useState<number | null>(null), [tilted, toggleView] = useBoardView('dominoes')
  const reported = useRef(false)
  // The hand at the bottom belongs to whoever is playing at this screen right now.
  const seat = !state.players[state.current].bot ? state.current : Math.max(0, state.players.findIndex(person => !person.bot))
  const player = state.players[state.current], moves = legalDominoMoves(state), humanTurn = !player.bot && state.phase === 'play'
  const apply = (next: DominoState, sound: Parameters<typeof playSound>[0]) => { if (next !== state) { playSound(sound); setState(next); setChosen(null) } }
  useEffect(() => {
    if (paused || state.phase !== 'play' || !player.bot) return
    const timer = setTimeout(() => {
      const move = chooseDominoMove(state)
      apply(move ? playDomino(state, move) : canDraw(state) ? drawDomino(state) : passDomino(state), move ? 'tile' : canDraw(state) ? 'card' : 'click')
    }, canDraw(state) ? 380 : 850)
    return () => clearTimeout(timer)
  }, [paused, state])
  useEffect(() => {
    if (state.phase === 'round') playSound(state.players[state.winner!].bot ? 'pay' : 'coin')
    if (state.phase !== 'over' || reported.current) return
    reported.current = true
    const human = state.players.findIndex(person => !person.bot)
    playSound(state.players[state.winner!].bot ? 'lose' : 'win')
    if (human >= 0) onFinish(state.players[human].score)
  }, [state.phase])
  const restart = (humans: number, total: number, mode: DominoMode = state.mode) => { setState(newDominoes(humans, total, mode)); setChosen(null); reported.current = false }
  const pick = (index: number) => {
    if (paused || !humanTurn) return
    const sides = moves.filter(move => move.tile === index)
    if (!sides.length) { playSound('error'); return }
    if (sides.length === 1) apply(playDomino(state, sides[0]), 'tile')
    else setChosen(index)
  }
  const rows: Tile[][] = []
  for (let i = 0; i < state.chain.length; i += PER_ROW) rows.push(state.chain.slice(i, i + PER_ROW))
  const freshIndex = state.lastPlayed ? state.lastPlayed.side === 'left' ? 0 : state.chain.length - 1 : -1
  const showHands = state.phase !== 'play'
  return <div className="gr-play-layout gr-tabletop-layout">
    <div className={`gr-felt-stage ${tilted ? 'is-3d' : 'is-flat'}`}><ViewToggle tilted={tilted} onToggle={toggleView} />
      <div className="gr-felt gr-dominoes-felt">
        <div className="gr-opponents">{state.players.map((person, at) => at === seat && !person.bot ? null : <div key={at} className={`gr-opponent ${state.current === at ? 'current' : ''}`}><strong>{person.name}</strong><span className="gr-opponent-hand">{person.hand.map((tile, i) => <DominoTile key={i} tile={tile} vertical hidden={!showHands} />)}</span><small>{person.score} pts</small></div>)}</div>
        <div className="gr-dom-chain" data-testid="domino-chain">
          {chosen !== null && <button type="button" className="gr-dom-end is-left" onClick={() => apply(playDomino(state, { tile: chosen, side: 'left' }), 'tile')}>◀ Play here</button>}
          {rows.map((row, r) => <div key={r} className={`gr-dom-row ${r % 2 ? 'is-reversed' : ''}`}>{row.map((tile, i) => { const index = r * PER_ROW + i; return <DominoTile key={index} tile={r % 2 ? [tile[1], tile[0]] : tile} vertical={tile[0] === tile[1]} fresh={index === freshIndex} /> })}</div>)}
          {!state.chain.length && <p className="gr-dom-empty">{player.bot ? `${player.name} will open.` : 'Play a tile to open the line.'}</p>}
          {chosen !== null && <button type="button" className="gr-dom-end is-right" onClick={() => apply(playDomino(state, { tile: chosen, side: 'right' }), 'tile')}>Play here ▶</button>}
        </div>
        <div className="gr-dom-boneyard" aria-label={`${state.boneyard.length} tiles in the boneyard`}>{state.mode === 'draw' ? <>{state.boneyard.slice(0, 8).map((tile, i) => <DominoTile key={i} tile={tile} hidden />)}<small>{state.boneyard.length} in the boneyard</small></> : <small>Block game — no drawing</small>}</div>
        <div className={`gr-my-hand ${humanTurn ? 'is-turn' : ''}`}>{state.players[seat].bot ? null : state.players[seat].hand.map((tile, index) => { const playable = humanTurn && seat === state.current && moves.some(move => move.tile === index); return <button type="button" key={`${tile.join()}`} className={`gr-hand-tile ${playable ? 'is-playable' : ''} ${chosen === index ? 'is-chosen' : ''}`} onClick={() => pick(index)} disabled={paused} aria-label={`${playable ? 'Play' : 'Your tile'} ${tile[0]}–${tile[1]}`}><DominoTile tile={tile} vertical /></button> })}</div>
      </div>
    </div>
    <aside className="gr-game-aside">
      <div className="gr-player-list">{state.players.map((person, at) => <div key={at} className={state.current === at ? 'current' : ''}><span>{person.name}</span><strong>{person.score}</strong></div>)}</div>
      <h3>{state.phase === 'over' ? 'Match over' : state.phase === 'round' ? 'Round over' : player.bot ? `${player.name} is thinking…` : `${player.name}${player.name === 'You' ? ' — your turn' : ' to play'}`}</h3>
      <p>{state.phase === 'play' && humanTurn ? moves.length ? chosen !== null ? 'This tile fits both ends. Pick a side.' : 'Click a glowing tile to play it.' : canDraw(state) ? 'Nothing fits. Draw from the boneyard.' : 'Nothing fits. Pass your turn.' : state.log[0]}</p>
      <div className="gr-circuit-actions">
        {humanTurn && canDraw(state) && <GameButton disabled={paused} onClick={() => apply(drawDomino(state), 'card')}>Draw a tile</GameButton>}
        {humanTurn && !moves.length && !canDraw(state) && <GameButton disabled={paused} onClick={() => apply(passDomino(state), 'click')}>Pass</GameButton>}
        {state.phase === 'round' && <GameButton onClick={() => { setState(nextDominoRound(state)); playSound('card') }}>Next round</GameButton>}
      </div>
      {showHands && <p className="gr-dom-tally">{state.players.map(person => `${person.name}: ${handPips(person.hand)} pips left`).join(' · ')}</p>}
      {state.phase === 'over' && <GameResult title={`${state.players[state.winner!].name} ${state.players[state.winner!].name === 'You' ? 'win' : 'wins'} the match`} text={`First to ${state.target} points.`} />}
      <details className="gr-rules"><summary>Game & players</summary><p>Match a number at either end of the line. In the draw game you take from the boneyard until something fits; in the block game you pass. Going out scores every pip left in the other hands. A blocked line goes to the lightest hand.</p><div className="gr-circuit-actions"><GameButton onClick={() => restart(1, 2, 'draw')}>Draw · vs 1</GameButton><GameButton onClick={() => restart(1, 4, 'draw')}>Draw · vs 3</GameButton><GameButton onClick={() => restart(1, 2, 'block')}>Block · vs 1</GameButton><GameButton onClick={() => restart(1, 4, 'block')}>Block · vs 3</GameButton><GameButton onClick={() => restart(2, 2)}>2 players</GameButton></div></details>
      <ol className="gr-turn-log" aria-label="Game history">{state.log.slice(0, 5).map((message, i) => <li key={`${state.log.length}-${i}`}>{message}</li>)}</ol>
    </aside>
  </div>
}
