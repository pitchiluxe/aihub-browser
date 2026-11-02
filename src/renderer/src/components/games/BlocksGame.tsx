import React, { useEffect, useState } from 'react'
import { BLOCK_SHAPES, blocksAction, ghostPiece, newBlocks, type BlocksState } from '../../../../shared/games/blocks'
import { GameButton, GameResult, GameStats, useCounterSound, useEndSound, useGameKeys, type GameProps } from './GameControls'
import './blocks-3d.css'
const COLORS = ['transparent', '#75d7e8', '#f5cc68', '#bda3f5', '#75d5a6', '#ef9ca6', '#6eb6ff', '#edaa75']
const KEY_ACTION: Record<string, Parameters<typeof blocksAction>[1]> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down', ArrowUp: 'rotate', ' ': 'drop', c: 'hold', C: 'hold' }
function Preview({ kind }: { kind: number | null }) {
  const shape = kind === null ? [] : BLOCK_SHAPES[kind]
  return <div className="gr-piece-preview" aria-label={kind === null ? 'No held piece' : 'Next piece'} style={{ gridTemplateColumns: `repeat(${shape[0]?.length || 4}, 15px)` }}>{shape.flatMap((row, y) => row.map((cell, x) => <i key={`${x}-${y}`} style={{ background: cell ? COLORS[kind! + 1] : 'transparent' }} />))}</div>
}
export default function BlocksGame({ paused, onFinish }: GameProps) {
  const [state, setState] = useState<BlocksState>(() => newBlocks())
  useCounterSound(state.lines, 'clear'); useCounterSound(state.board.flat().filter(Boolean).length, 'tile'); useEndSound(state.over, false)
  const act = (action: Parameters<typeof blocksAction>[1]) => { if (!paused) setState(value => blocksAction(value, action)) }
  useGameKeys(key => { const action = KEY_ACTION[key]; if (action) act(action) }, paused || state.over)
  useEffect(() => {
    if (paused || state.over) return
    const timer = setInterval(() => setState(value => blocksAction(value, 'tick')), Math.max(90, 750 - Math.floor(state.lines / 10) * 65))
    return () => clearInterval(timer)
  }, [paused, state.over, Math.floor(state.lines / 10)])
  useEffect(() => { if (state.over) onFinish(state.score) }, [state.over, state.score, onFinish])
  const ghost = ghostPiece(state)
  const display = state.board.map(row => [...row])
  if (!state.over) {
    ghost.cells.forEach((row, y) => row.forEach((cell, x) => { if (cell && !display[ghost.y + y][ghost.x + x]) display[ghost.y + y][ghost.x + x] = -1 }))
    state.piece.cells.forEach((row, y) => row.forEach((cell, x) => { if (cell) display[state.piece.y + y][state.piece.x + x] = state.piece.kind + 1 }))
  }
  return <div className="gr-play-layout">
    <div className="gr-block-stage"><div className="gr-block-board" role="img" aria-label="Falling Blocks board" data-testid="blocks-board">{display.flatMap((row, y) => row.map((cell, x) => <i key={`${x}-${y}`} className={cell < 0 ? 'ghost' : cell > 0 ? 'filled' : ''} style={{ backgroundColor: cell > 0 ? COLORS[cell] : undefined }} />))}</div></div>
    <aside className="gr-game-aside"><GameStats items={[["Score", state.score], ['Lines', state.lines], ['Level', 1 + Math.floor(state.lines / 10)]]} /><h3>Up next</h3><Preview kind={state.queue[0] ?? null} /><h3>Hold</h3><Preview kind={state.hold} /><p>← → move · ↑ rotate<br />↓ soft drop · Space drop<br />C holds a piece</p><div className="gr-touch-controls"><GameButton label="Move left" onClick={() => act('left')}>←</GameButton><GameButton label="Rotate piece" onClick={() => act('rotate')}>↻</GameButton><GameButton label="Move right" onClick={() => act('right')}>→</GameButton><GameButton onClick={() => act('drop')}>Drop</GameButton><GameButton onClick={() => act('hold')}>Hold</GameButton></div>{state.over && <GameResult title="Nice run" text={`${state.score} points and ${state.lines} cleared lines.`} />}</aside>
  </div>
}
