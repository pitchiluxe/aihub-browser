import React, { useEffect, useRef, useState } from 'react'
import { applyDraughts, chooseDraughtsMove, legalDraughtsMoves, newDraughts, type DraughtsState, type DraughtsVariant } from '../../../../shared/games/draughts'
import { GameButton, GameResult, GameStats, useBoardView, ViewToggle, type GameProps } from './GameControls'
import { playSound } from './sounds'
import './draughts.css'

const NAMES: Record<DraughtsVariant, string> = { checkers: 'Checkers', dames: 'Dames' }
const squareName = (state: DraughtsState, index: number) => `${String.fromCharCode(97 + index % state.size)}${state.size - Math.floor(index / state.size)}`

function DraughtsGame({ variant, paused, onFinish }: GameProps & { variant: DraughtsVariant }) {
  const [state, setState] = useState(() => newDraughts(variant)), [selected, setSelected] = useState<number | null>(null)
  const [opponent, setOpponent] = useState<'computer' | 'local'>('computer'), reported = useRef(false), [tilted, toggleView] = useBoardView(variant)
  useEffect(() => { if (state.last) playSound(state.last.captures.length ? 'capture' : 'knock') }, [state.last])
  const moves = legalDraughtsMoves(state), computerTurn = opponent === 'computer' && state.turn === -1 && !state.over
  const sources = new Set(moves.map(move => move.from)), targets = moves.filter(move => move.from === selected)
  const mustCapture = moves.some(move => move.captures.length)
  const counts = { you: state.board.filter(piece => piece > 0).length, them: state.board.filter(piece => piece < 0).length }
  useEffect(() => {
    if (paused || !computerTurn) return
    const timer = setTimeout(() => setState(value => { const move = chooseDraughtsMove(value); return move ? applyDraughts(value, move) : value }), 550)
    return () => clearTimeout(timer)
  }, [paused, computerTurn, state])
  useEffect(() => {
    if (!state.over || reported.current) return
    reported.current = true
    playSound(opponent === 'computer' && state.winner === -1 ? 'lose' : 'win')
    if (opponent === 'computer' && state.winner === 1) onFinish(counts.you * 100 + Math.max(0, 200 - state.board.length))
  }, [state.over])
  const restart = (mode = opponent) => { setOpponent(mode); setState(newDraughts(variant)); setSelected(null); reported.current = false }
  const click = (index: number) => {
    if (paused || state.over || computerTurn) return
    if (sources.has(index)) { playSound('click'); setSelected(selected === index ? null : index); return }
    const move = targets.find(candidate => candidate.path[candidate.path.length - 1] === index)
    if (move) { setState(applyDraughts(state, move)); setSelected(null) }
  }
  const sideName = (side: number) => opponent === 'computer' ? side > 0 ? 'You' : 'Computer' : side > 0 ? 'Light' : 'Dark'
  const lastSquares = new Set(state.last ? [state.last.from, ...state.last.path] : [])
  return <div className="gr-play-layout gr-draughts-layout">
    <div className={`gr-dr-stage ${tilted ? 'is-3d' : 'is-flat'}`}><ViewToggle tilted={tilted} onToggle={toggleView} /><div className={`gr-dr-board size-${state.size} is-${variant}`} role="grid" aria-label={`${NAMES[variant]} board`} data-testid="draughts-board" style={{ '--n': state.size } as React.CSSProperties}>
      {state.board.map((piece, index) => {
        const dark = (index % state.size + Math.floor(index / state.size)) % 2 === 1, target = targets.find(move => move.path[move.path.length - 1] === index)
        const label = `${squareName(state, index)}${piece ? `, ${piece > 0 ? 'light' : 'dark'} ${Math.abs(piece) === 2 ? 'king' : 'piece'}` : ''}${target ? ', move here' : ''}`
        return <button key={index} type="button" className={`gr-dr-square ${dark ? 'is-dark' : 'is-light'} ${selected === index ? 'is-selected' : ''} ${target ? 'is-target' : ''} ${sources.has(index) && !computerTurn ? 'is-movable' : ''} ${lastSquares.has(index) ? 'is-last' : ''} ${state.last?.captures.includes(index) ? 'is-captured' : ''}`} disabled={!dark} aria-label={label} onClick={() => click(index)}>
          {piece !== 0 && <span className={`gr-dr-piece ${piece > 0 ? 'is-light' : 'is-dark'} ${Math.abs(piece) === 2 ? 'is-king' : ''}`} />}
        </button>
      })}
    </div></div>
    <aside className="gr-game-aside"><GameStats items={[[sideName(1), counts.you], [sideName(-1), counts.them], ['Quiet moves', state.quiet]]} />
      <h3>{state.over ? 'Game over' : computerTurn ? 'Computer is thinking…' : `${sideName(state.turn)} to move`}</h3>
      <p>{state.over ? '' : mustCapture ? variant === 'dames' ? 'A capture is available — you must take the longest one.' : 'A capture is available — you must jump.' : selected === null ? 'Select a glowing piece to see where it can go.' : 'Click a highlighted square to move.'}</p>
      {state.over && <GameResult title={state.winner === 0 ? 'Draw' : `${sideName(state.winner!)} ${opponent === 'computer' && state.winner === 1 ? 'win' : 'wins'}`} text={state.winner === 0 ? `${state.quiet} king moves without a capture.` : `${state.winner === 1 ? counts.you : counts.them} pieces left on the board.`} />}
      <div className="gr-circuit-actions"><GameButton onClick={() => restart('computer')}>You vs computer</GameButton><GameButton onClick={() => restart('local')}>2 players, one screen</GameButton></div>
    </aside>
  </div>
}
export function CheckersGame(props: GameProps) { return <DraughtsGame {...props} variant="checkers" /> }
export function DamesGame(props: GameProps) { return <DraughtsGame {...props} variant="dames" /> }
