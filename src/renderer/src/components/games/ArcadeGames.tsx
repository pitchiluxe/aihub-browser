import React, { useEffect, useRef, useState } from 'react'
import { board2048Over, MAZE, mazeStep, move2048, newMaze, newSnake, snakeStep, spawn2048, type Direction } from '../../../../shared/games/arcade'
import { GameButton, GameResult, GameStats, useGameKeys, type GameProps } from './GameControls'
const DIRECTIONS: Record<string, Direction> = { ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down', ArrowLeft: 'left' }
function DirectionPad({ onDirection, disabled }: { onDirection: (direction: Direction) => void; disabled: boolean }) {
  return <div className="gr-direction-pad">{(['up', 'left', 'down', 'right'] as Direction[]).map(direction => <GameButton key={direction} disabled={disabled} label={`Move ${direction}`} onClick={() => onDirection(direction)}>{{ up: '↑', left: '←', down: '↓', right: '→' }[direction]}</GameButton>)}</div>
}
export function SnakeGame({ paused, onFinish }: GameProps) {
  const [state, setState] = useState(() => newSnake())
  const wanted = useRef<Direction>('right')
  useGameKeys(key => { if (DIRECTIONS[key]) wanted.current = DIRECTIONS[key] }, paused || state.over)
  useEffect(() => {
    if (paused || state.over) return
    const timer = setInterval(() => setState(value => snakeStep(value, wanted.current)), Math.max(65, 160 - Math.floor(state.score / 50) * 10))
    return () => clearInterval(timer)
  }, [paused, state.over, Math.floor(state.score / 50)])
  useEffect(() => { if (state.over) onFinish(state.score) }, [state.over, state.score, onFinish])
  return <div className="gr-play-layout"><svg className="gr-square-board" viewBox="0 0 20 20" role="img" aria-label="Snake game board"><defs><pattern id="snake-grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M 1 0 L 0 0 0 1" fill="none" stroke="#ffffff0c" strokeWidth=".025" /></pattern></defs><rect width="20" height="20" fill="#101923" /><rect width="20" height="20" fill="url(#snake-grid)" />{state.food && <circle cx={state.food.x + .5} cy={state.food.y + .5} r=".34" fill="#f5cc68" />}{state.snake.map((part, i) => <rect key={i} x={part.x + .05} y={part.y + .05} width=".9" height=".9" rx=".2" fill={i ? '#6ed5ae' : '#d7f3be'} />)}</svg><aside className="gr-game-aside"><GameStats items={[["Score", state.score], ['Length', state.snake.length]]} /><h3>Keep your tail in sight</h3><p>Use the arrow keys or the controls below. Eat the gold fruit, and avoid the walls and your own tail.</p><DirectionPad disabled={paused || state.over} onDirection={direction => { wanted.current = direction }} />{state.over && <GameResult title={state.won ? 'The whole board is yours' : 'End of the trail'} text={`You scored ${state.score} points.`} />}</aside></div>
}
// The player's mouth faces the way it is travelling, alternating open and half-open each cell.
const MOUTH_ANGLE: Record<Direction, number> = { right: 0, down: 90, left: 180, up: 270 }
export function MazeGame({ paused, onFinish }: GameProps) {
  const [state, setState] = useState(() => newMaze())
  const wanted = useRef<Direction>('left'), tick = useRef(0)
  useGameKeys(key => { if (DIRECTIONS[key]) wanted.current = DIRECTIONS[key] }, paused || state.over)
  useEffect(() => {
    if (paused || state.over) return
    const timer = setInterval(() => setState(value => mazeStep(value, wanted.current, tick.current++)), 180)
    return () => clearInterval(timer)
  }, [paused, state.over])
  useEffect(() => { if (state.over) onFinish(state.score) }, [state.over, state.score, onFinish])
  return <div className="gr-play-layout gr-maze-layout"><svg className="gr-maze-board" viewBox="0 0 19 13" role="img" aria-label="Maze Chase game board"><rect width="19" height="13" rx=".4" fill="#101923" />{MAZE.flatMap((row, y) => [...row].map((cell, x) => cell === '#' ? <rect key={`${x}-${y}`} x={x + .12} y={y + .12} width=".76" height=".76" rx=".16" fill="#263f62" stroke="#6eb6ff" strokeWidth=".035" /> : null))}{state.pellets.map(id => <circle key={id} cx={id % 19 + .5} cy={Math.floor(id / 19) + .5} r={MAZE[Math.floor(id / 19)][id % 19] === 'o' ? .22 : .065} fill="#f5cc68" />)}<g transform={`translate(${state.player.x + .5} ${state.player.y + .5}) rotate(${MOUTH_ANGLE[state.direction]})`}>{(state.player.x + state.player.y) % 2 ? <path d="M0 0L.303 -.175A.35 .35 0 1 0 .303 .175Z" fill="#f5cc68" /> : <path d="M0 0L.338 -.09A.35 .35 0 1 0 .338 .09Z" fill="#f5cc68" />}</g>{state.ghosts.map((ghost, i) => <g key={i} transform={`translate(${ghost.x + .17} ${ghost.y + .17})`}><path d="M0 .66V.32a.33.33 0 0 1 .66 0V.66L.5.53.33.66.16.53Z" fill={state.power ? '#788aa4' : i ? '#bda3f5' : '#ed9c81'} /><circle cx=".23" cy=".28" r=".07" fill="#101923" /><circle cx=".45" cy=".28" r=".07" fill="#101923" /></g>)}</svg><aside className="gr-game-aside"><GameStats items={[["Score", state.score], ['Lives', state.lives], ['Dots left', state.pellets.length]]} /><h3>A small maze. A big appetite.</h3><p>Use the arrows to change direction. Large power orbs let you chase the pursuers for a few seconds.</p><DirectionPad disabled={paused || state.over} onDirection={direction => { wanted.current = direction }} />{state.over && <GameResult title={state.won ? 'Maze cleared' : 'Caught at last'} text={`You collected ${state.score} points.`} />}</aside></div>
}
export function MergeGame({ paused, onFinish }: GameProps) {
  const [state, setState] = useState(() => ({ board: spawn2048(spawn2048(Array(16).fill(0))), score: 0, over: false }))
  const [history, setHistory] = useState<typeof state[]>([])
  const move = (direction: Direction) => {
    if (paused || state.over) return
    const result = move2048(state.board, direction)
    if (!result.moved) return
    const board = spawn2048(result.board)
    setHistory(previous => [...previous.slice(-49), state]); setState({ board, score: state.score + result.score, over: board2048Over(board) })
  }
  useGameKeys(key => { if (DIRECTIONS[key]) move(DIRECTIONS[key]) }, paused || state.over)
  useEffect(() => { if (state.over) onFinish(state.score) }, [state.over, state.score, onFinish])
  return <div className="gr-play-layout"><div className="gr-merge-board" role="grid" aria-label="2048 game board">{state.board.map((value, i) => <div role="gridcell" key={i} className={value ? 'number' : ''} style={{ background: value ? `hsl(${250 - Math.log2(value) * 13} 52% ${Math.max(28, 84 - Math.log2(value) * 4)}%)` : undefined, color: value >= 128 ? '#fff' : '#172135' }}>{value || ''}</div>)}</div><aside className="gr-game-aside"><GameStats items={[["Score", state.score], ['Best tile', Math.max(...state.board)]]} /><h3>Make room for the next move</h3><p>Use the arrows to slide all tiles. Equal neighbors merge once per move. Reach 2048, then keep going.</p><DirectionPad disabled={paused || state.over} onDirection={move} /><GameButton disabled={!history.length || paused} onClick={() => { setState(history[history.length - 1]); setHistory(history.slice(0, -1)) }}>Undo</GameButton>{Math.max(...state.board) >= 2048 && !state.over && <p className="gr-success" role="status">2048 reached. Keep building!</p>}{state.over && <GameResult title="No room left" text={`Your board reached ${Math.max(...state.board)}.`} />}</aside></div>
}
