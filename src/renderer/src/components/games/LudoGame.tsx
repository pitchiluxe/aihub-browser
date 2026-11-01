import React, { useEffect, useRef, useState } from 'react'
import { chooseLudoMove, legalLudoMoves, LUDO_HOME, LUDO_SAFE, LUDO_SEATS, moveLudo, newLudo, rollLudo, type LudoState } from '../../../../shared/games/ludo'
import { Die, Pawn } from './BoardPieces'
import { GameButton, GameResult, useGameKeys, type GameProps } from './GameControls'
import './ludo.css'

const COLORS = ['#e2453c', '#2fa64a', '#f1c232', '#2d8be0']
// The 52 shared squares, clockwise from the end of the left arm, as [column, row].
const TRACK: [number, number][] = [
  ...[0, 1, 2, 3, 4, 5].map(x => [x, 6]), ...[5, 4, 3, 2, 1, 0].map(y => [6, y]), [7, 0],
  ...[0, 1, 2, 3, 4, 5].map(y => [8, y]), ...[9, 10, 11, 12, 13, 14].map(x => [x, 6]), [14, 7],
  ...[14, 13, 12, 11, 10, 9].map(x => [x, 8]), ...[9, 10, 11, 12, 13, 14].map(y => [8, y]), [7, 14],
  ...[14, 13, 12, 11, 10, 9].map(y => [6, y]), ...[5, 4, 3, 2, 1, 0].map(x => [x, 8]), [0, 7],
] as [number, number][]
// Home columns, progress 51–55, per seat.
const COLUMNS: [number, number][][] = [
  [13, 12, 11, 10, 9].map(y => [7, y]), [1, 2, 3, 4, 5].map(x => [x, 7]), [1, 2, 3, 4, 5].map(y => [7, y]), [13, 12, 11, 10, 9].map(x => [x, 7]),
] as [number, number][][]
const YARDS: [number, number][] = [[0, 9], [0, 0], [9, 0], [9, 9]]
const START_INDEX = [40, 1, 14, 27]

function cellOf(seat: number, progress: number): [number, number] | null {
  if (progress < 0 || progress === LUDO_HOME) return null
  return progress <= 50 ? TRACK[(START_INDEX[seat] + progress) % 52] : COLUMNS[seat][progress - 51]
}

export default function LudoGame({ paused, onFinish }: GameProps) {
  const [state, setState] = useState<LudoState>(() => newLudo()), [rolls, setRolls] = useState(0), reported = useRef(false)
  const player = state.players[state.current], moves = legalLudoMoves(state), humanTurn = !player.bot && state.phase !== 'over'
  const roll = () => { if (!paused && state.phase === 'roll') { setState(value => rollLudo(value)); setRolls(value => value + 1) } }
  const move = (token: number) => { if (!paused && moves.includes(token)) setState(value => moveLudo(value, token)) }
  useGameKeys(key => { if (key === ' ' && humanTurn) roll() }, paused || !humanTurn)
  useEffect(() => {
    if (paused || state.phase === 'over') return
    if (player.bot) {
      const timer = setTimeout(() => {
        if (state.phase === 'roll') { setState(value => rollLudo(value)); setRolls(value => value + 1) }
        else { const token = chooseLudoMove(state); if (token !== null) setState(value => moveLudo(value, token)) }
      }, state.phase === 'roll' ? 700 : 650)
      return () => clearTimeout(timer)
    }
    // With only one possible move there is nothing to decide.
    if (state.phase !== 'move' || moves.length !== 1) return
    const timer = setTimeout(() => setState(value => moveLudo(value, moves[0])), 450)
    return () => clearTimeout(timer)
  }, [paused, state])
  useEffect(() => {
    if (state.phase !== 'over' || reported.current) return
    reported.current = true
    if (!state.players[state.winner!].bot) onFinish(Math.max(100, 2000 - state.turns * 10))
  }, [state.phase])
  const restart = (humans: number, total: number) => { setState(newLudo(humans, total)); reported.current = false }

  const pawnsAt = new Map<string, { player: number; token: number }[]>()
  state.players.forEach((person, index) => person.tokens.forEach((progress, token) => {
    const cell = cellOf(person.seat, progress)
    if (cell) { const key = cell.join(','); pawnsAt.set(key, [...(pawnsAt.get(key) || []), { player: index, token }]) }
  }))
  const pawnButton = (index: number, token: number, extra = '') => {
    const person = state.players[index], movable = index === state.current && humanTurn && moves.includes(token)
    return <button key={`${index}-${token}`} type="button" className={`gr-ludo-pawn ${movable ? 'is-movable' : ''} ${extra}`} disabled={!movable || paused} onClick={() => move(token)} aria-label={`${movable ? 'Move ' : ''}${LUDO_SEATS[person.seat]} pawn ${token + 1}`}><Pawn color={COLORS[person.seat]} /></button>
  }
  const cells: React.ReactNode[] = []
  TRACK.forEach(([x, y], index) => {
    const startSeat = START_INDEX.indexOf(index)
    cells.push(<div key={`t${index}`} className={`gr-ludo-cell ${startSeat >= 0 ? 'is-start' : ''} ${LUDO_SAFE.has(index) && startSeat < 0 ? 'is-star' : ''}`} style={{ gridColumn: x + 1, gridRow: y + 1, '--seat': startSeat >= 0 ? COLORS[startSeat] : undefined } as React.CSSProperties}>{(pawnsAt.get(`${x},${y}`) || []).map(({ player: p, token }) => pawnButton(p, token))}</div>)
  })
  COLUMNS.forEach((column, seat) => column.forEach(([x, y], step) => cells.push(<div key={`c${seat}-${step}`} className="gr-ludo-cell is-column" style={{ gridColumn: x + 1, gridRow: y + 1, '--seat': COLORS[seat] } as React.CSSProperties}>{(pawnsAt.get(`${x},${y}`) || []).map(({ player: p, token }) => pawnButton(p, token))}</div>)))

  return <div className="gr-play-layout gr-ludo-layout">
    <div className="gr-ludo-stage"><div className="gr-ludo-board" role="group" aria-label="Ludo board" data-testid="ludo-board">
      {YARDS.map(([x, y], seat) => { const owner = state.players.findIndex(person => person.seat === seat); return <div key={`y${seat}`} className="gr-ludo-yard" style={{ gridColumn: `${x + 1} / span 6`, gridRow: `${y + 1} / span 6`, '--seat': COLORS[seat] } as React.CSSProperties}><div className="gr-ludo-nest">{[0, 1, 2, 3].map(token => <span key={token} className="gr-ludo-spot">{owner >= 0 && state.players[owner].tokens[token] === -1 && pawnButton(owner, token)}</span>)}</div></div> })}
      {cells}
      <div className="gr-ludo-center" style={{ gridColumn: '7 / span 3', gridRow: '7 / span 3' }}>{state.players.map((person, index) => <span key={index} className={`gr-ludo-finished seat-${person.seat}`}>{person.tokens.map((progress, token) => progress === LUDO_HOME ? <Pawn key={token} color={COLORS[person.seat]} /> : null)}</span>)}</div>
    </div></div>
    <aside className="gr-game-aside gr-ludo-aside">
      <div className="gr-player-list">{state.players.map((person, index) => <div key={index} className={state.current === index ? 'current' : ''}><Pawn color={COLORS[person.seat]} /><span>{person.name}</span><strong>{person.tokens.filter(progress => progress === LUDO_HOME).length}/4 home</strong></div>)}</div>
      <div className="gr-ludo-tray"><span key={rolls} className={`gr-die-wrap ${state.dice ? 'rolled' : ''}`} style={{ '--spin': rolls % 2 ? '1' : '-1' } as React.CSSProperties} aria-label={state.dice ? `Die shows ${state.dice}` : 'Die not rolled'} role="img"><Die value={state.dice || 6} /></span></div>
      <h3>{state.phase === 'over' ? 'Game over' : player.bot ? `${player.name} is playing…` : state.phase === 'roll' ? `${player.name}${player.name === 'You' ? '' : ' —'} roll the die` : 'Choose a pawn to move'}</h3>
      <p>{state.log[0]}</p>
      <div className="gr-circuit-actions"><GameButton disabled={paused || !humanTurn || state.phase !== 'roll'} onClick={roll}>Roll die</GameButton></div>
      {state.phase === 'over' && <GameResult title={`${state.players[state.winner!].name} ${state.players[state.winner!].name === 'You' ? 'win' : 'wins'}!`} text={`All four pawns home after ${state.turns} turns.`} />}
      <details className="gr-rules"><summary>Players</summary><div className="gr-circuit-actions"><GameButton onClick={() => restart(1, 2)}>You vs 1 computer</GameButton><GameButton onClick={() => restart(1, 4)}>You vs 3 computers</GameButton><GameButton onClick={() => restart(2, 2)}>2 players</GameButton><GameButton onClick={() => restart(4, 4)}>4 players</GameButton></div></details>
      <ol className="gr-turn-log" aria-label="Turn history">{state.log.slice(1, 6).map((message, i) => <li key={i}>{message}</li>)}</ol>
    </aside>
  </div>
}
