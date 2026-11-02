import React, { useEffect, useRef, useState } from 'react'
import { chooseMove, type FamilyGame, type Move } from '../../../../shared/games/family/core'
import { familyGame } from '../../../../shared/games/family/index'
import { CustomBoard } from './FamilyCustom'
import Fireworks from './Fireworks'
import { GameButton, GameResult, useBoardView, ViewToggle, type GameProps } from './GameControls'
import { playSound } from './sounds'
import './family.css'

const HIDDEN_INFO = new Set(['liarsdice', 'seabattle'])
type Mode = 'computer' | 'local'
export const matches = (move: Move, index: number) => move.to === index || (Array.isArray(move.area) && (move.area as number[]).includes(index))

export default function FamilyTable({ id, paused, onFinish }: GameProps & { id: string }) {
  const entry = familyGame(id)!, game = entry.game as FamilyGame
  const [mode, setMode] = useState<Mode>('computer'), [state, setState] = useState(() => game.setup(Math.random))
  const [selected, setSelected] = useState<number | null>(null), [thinking, setThinking] = useState(false), [tilted, toggleView] = useBoardView(`family-${id}`)
  const reported = useRef(false), [celebrate, setCelebrate] = useState(0)
  const seat = game.current(state), outcome = game.outcome(state), moves = outcome ? [] : game.moves(state)
  const isBot = (player: number) => game.players > 1 && mode === 'computer' && player !== 0
  const humanTurn = !outcome && !isBot(seat)
  const play = (move: Move, sound: Parameters<typeof playSound>[0] = 'knock') => {
    if (paused) return
    setState((current: unknown) => game.play(current, move, Math.random)); setSelected(null); playSound(move.roll || move.label === 'Roll' || move.label === 'Roll dice' ? 'dice' : sound)
  }
  useEffect(() => {
    if (paused || outcome || !isBot(seat)) return
    setThinking(true)
    const timer = setTimeout(() => {
      const move = chooseMove(game, state, Math.random, 650)
      setThinking(false)
      if (move) play(move, move.from !== undefined || move.to !== undefined ? 'knock' : 'click')
    }, game.layout.kind === 'custom' ? 650 : 450)
    return () => { clearTimeout(timer); setThinking(false) }
  }, [state, paused, mode])
  useEffect(() => {
    if (!outcome || reported.current) return
    reported.current = true
    const won = game.players === 1 ? outcome.winner === 0 : mode === 'computer' ? outcome.winner === 0 : outcome.winner !== null
    playSound(won ? 'win' : 'lose')
    if (won) setCelebrate(value => value + 1)
    if (won && (game.players === 1 || mode === 'computer')) onFinish(1000)
  }, [outcome?.text])
  const restart = (next: Mode = mode) => { setMode(next); setState(game.setup(Math.random)); setSelected(null); reported.current = false; setCelebrate(0) }

  // Board clicks: pick a piece with moves, then a destination; or place directly when moves have no source.
  const sources = new Set(moves.filter(m => m.from !== undefined).map(m => m.from!))
  const targets = selected !== null ? moves.filter(m => m.from === selected) : moves.filter(m => m.from === undefined && (m.to !== undefined || m.area))
  const click = (index: number) => {
    if (!humanTurn || paused) return
    if (sources.has(index) && selected !== index) { setSelected(index); playSound('click'); return }
    const move = targets.find(m => matches(m, index))
    if (move) play(move)
    else if (selected !== null) { setSelected(null) } else playSound('error')
  }
  const buttons = moves.filter(m => m.from === undefined && m.to === undefined && !m.area && m.label && !(game.layout.kind === 'custom' && customHandles(id, m)))
  const names = game.names || ['Player 1', 'Player 2', 'Player 3', 'Player 4']
  const nameOf = (player: number) => game.players === 1 ? 'You' : mode === 'computer' ? player === 0 ? 'You' : names[player].startsWith('Computer') ? names[player] : `Computer (${names[player]})` : names[player] === 'You' ? 'Player 1' : names[player] === 'Computer' ? 'Player 2' : names[player]
  const board = { game, state, moves, selected, sources, targets, humanTurn, click, play, last: game.lastMove?.(state) || [], won: outcome ? game.winningCells?.(state) || [] : [], seat, mode }
  return <div className={`gr-play-layout gr-family-layout is-${game.layout.kind}`}>
    <div className={`gr-family-stage ${tilted ? 'is-3d' : 'is-flat'}`}>
      {game.layout.kind !== 'custom' && <ViewToggle tilted={tilted} onToggle={toggleView} />}
      {game.layout.kind === 'grid' ? <GridBoard {...board} /> : game.layout.kind === 'graph' ? <GraphBoard {...board} /> : game.layout.kind === 'hex' ? <HexBoard {...board} /> : <CustomBoard {...board} hidden={mode === 'computer' && HIDDEN_INFO.has(id)} />}
    </div>
    <aside className="gr-game-aside gr-family-aside">
      <div className="gr-family-box" style={{ '--box': entry.color } as React.CSSProperties}><span>{entry.icon}</span><div><strong>{game.title}</strong><small>{entry.shelf} · ages {entry.age}</small></div></div>
      {game.players > 1 && <div className="gr-player-list">{Array.from({ length: game.players }, (_, p) => <div key={p} className={seat === p && !outcome ? 'current' : ''}><i style={{ background: game.colors?.[p] || '#888' }} /><span>{nameOf(p)}</span></div>)}</div>}
      <h3>{outcome ? 'Game over' : thinking ? `${nameOf(seat)} is thinking…` : game.players === 1 ? 'Your move' : `${nameOf(seat)}${humanTurn && mode === 'computer' ? ' — your turn' : ' to play'}`}</h3>
      <p aria-live="polite">{game.status?.(state) || (selected !== null ? 'Now click where it should go.' : sources.size ? 'Click one of your glowing pieces.' : '')}</p>
      {humanTurn && buttons.length > 0 && <div className="gr-circuit-actions">{buttons.map((move, i) => <GameButton key={i} disabled={paused} onClick={() => play(move, 'click')}>{move.label}</GameButton>)}</div>}
      {outcome && <GameResult title={outcome.winner === null ? 'Draw' : game.players === 1 ? outcome.winner === 0 ? 'Solved!' : 'So close' : `${nameOf(outcome.winner)} ${nameOf(outcome.winner) === 'You' ? 'win' : 'wins'}`} text={outcome.text} />}
      <details className="gr-rules" open={!outcome}><summary>How to play</summary><ol className="gr-family-rules">{entry.rules.map(rule => <li key={rule}>{rule}</li>)}</ol></details>
      <div className="gr-circuit-actions">{game.players > 1 && <GameButton onClick={() => restart('computer')}>Play the computer</GameButton>}{game.players > 1 && !HIDDEN_INFO.has(id) && <GameButton onClick={() => restart('local')}>{game.players > 2 ? `${game.players} players` : '2 players'}, one screen</GameButton>}{game.players === 1 && <GameButton onClick={() => restart()}>Start over</GameButton>}</div>
    </aside>
    {celebrate > 0 && <Fireworks key={celebrate} title={id === 'tictactoe' ? 'Three in a row!' : 'You win!'} onDone={() => setCelebrate(0)} />}
  </div>
}
// Custom tables draw their own controls for these moves, so they are not repeated as aside buttons.
function customHandles(id: string, move: Move): boolean {
  switch (id) {
    case 'yacht': return move.hold !== undefined || move.box !== undefined
    case 'farkle': return move.pick !== undefined
    case 'liarsdice': return move.count !== undefined
    case 'nim': case 'codebreaker': case 'hangman': return true
    default: return false
  }
}

export interface BoardProps { game: FamilyGame; state: any; moves: Move[]; selected: number | null; sources: Set<number>; targets: Move[]; humanTurn: boolean; click: (index: number) => void; play: (move: Move, sound?: Parameters<typeof playSound>[0]) => void; last: number[]; won: number[]; seat: number; mode: Mode }

function Stone({ game, state, index }: { game: FamilyGame; state: unknown; index: number }) {
  const piece = game.pieceAt?.(state, index)
  if (!piece) return null
  const color = piece.color || game.colors?.[piece.owner] || '#ccc', dark = ['#1d1d24', '#2f6fd8', '#8a4fd6', '#c3201f', '#e8342c', '#1f8a4c'].includes(color)
  return <span className={`gr-stone ${piece.glyph ? 'has-glyph' : ''} ${piece.king ? 'is-king' : ''}`} style={{ '--stone': color, '--ink': dark ? '#fff4e6' : '#1b1b22' } as React.CSSProperties}>{piece.glyph && <b>{piece.glyph}</b>}</span>
}

function GridBoard({ game, state, selected, sources, targets, humanTurn, click, last, won }: BoardProps) {
  const layout = game.layout as Extract<FamilyGame['layout'], { kind: 'grid' }>, cells = layout.rows * layout.cols
  const targetSet = new Set(targets.flatMap(m => [m.to, ...((m.area as number[]) || [])]).filter(i => i !== undefined) as number[])
  return <div className={`gr-fgrid is-${layout.style}`} style={{ '--rows': layout.rows, '--cols': layout.cols } as React.CSSProperties} role="grid" aria-label={`${game.title} board`} data-testid="family-board">
    {layout.style === 'xiangqi' && <span className="gr-river" aria-hidden="true">楚 河　　漢 界</span>}
    {Array.from({ length: cells }, (_, i) => {
      if (layout.holes?.(i)) return <span key={i} className="gr-fcell is-hole" />
      const r = Math.floor(i / layout.cols), c = i % layout.cols, dark = layout.style === 'checker' && (r + c) % 2 === 1
      const palace = layout.style === 'xiangqi' && c >= 3 && c <= 5 && (r <= 2 || r >= 7)
      return <button type="button" key={i} className={`gr-fcell ${dark ? 'is-dark' : ''} ${palace ? 'is-palace' : ''} ${last.includes(i) ? 'is-last' : ''} ${won.includes(i) ? 'is-win' : ''} ${selected === i ? 'is-selected' : ''} ${humanTurn && sources.has(i) ? 'is-source' : ''} ${humanTurn && targetSet.has(i) ? 'is-target' : ''} ${layout.style === 'intersections' || layout.style === 'xiangqi' ? `edge-${r === 0 ? 't' : r === layout.rows - 1 ? 'b' : ''}${c === 0 ? 'l' : c === layout.cols - 1 ? 'r' : ''}` : ''}`} onClick={() => click(i)} aria-label={`Row ${r + 1}, column ${c + 1}`}><Stone game={game} state={state} index={i} /></button>
    })}
  </div>
}

function GraphBoard({ game, state, selected, sources, targets, humanTurn, click, last }: BoardProps) {
  const layout = game.layout as Extract<FamilyGame['layout'], { kind: 'graph' }>, [w, h] = layout.size, pad = Math.max(0.6, Math.max(w, h) * 0.045)
  const sx = (x: number) => (x + pad) / (w + pad * 2) * 100, sy = (y: number) => (y + pad) / (h + pad * 2) * 100
  const targetSet = new Set(targets.map(m => m.to).filter(i => i !== undefined) as number[])
  return <div className="gr-fgraph" style={{ aspectRatio: `${w + pad * 2} / ${h + pad * 2}`, '--ar': (w + pad * 2) / (h + pad * 2) } as React.CSSProperties} data-testid="family-board">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{layout.lines.map(([a, b], i) => <line key={i} x1={sx(layout.points[a][0])} y1={sy(layout.points[a][1])} x2={sx(layout.points[b][0])} y2={sy(layout.points[b][1])} vectorEffect="non-scaling-stroke" />)}</svg>
    {layout.points.map(([x, y], i) => <button type="button" key={i} className={`gr-fpoint ${last.includes(i) ? 'is-last' : ''} ${selected === i ? 'is-selected' : ''} ${humanTurn && sources.has(i) ? 'is-source' : ''} ${humanTurn && targetSet.has(i) ? 'is-target' : ''}`} style={{ left: `${sx(x)}%`, top: `${sy(y)}%`, '--dot': `${Math.min(9, 60 / Math.max(w, h) + 2)}%` } as React.CSSProperties} onClick={() => click(i)} aria-label={`Point ${i + 1}`}><Stone game={game} state={state} index={i} /></button>)}
  </div>
}

function HexBoard({ game, state, targets, humanTurn, click, last }: BoardProps) {
  const size = (game.layout as { size: number }).size, r = 5.2, dx = r * Math.sqrt(3), dy = r * 1.5
  const targetSet = new Set(targets.map(m => m.to))
  const width = dx * (size + (size - 1) / 2) + dx, height = dy * (size - 1) + r * 2 + 6
  const corner = (cx: number, cy: number) => Array.from({ length: 6 }, (_, k) => { const a = Math.PI / 6 + k * Math.PI / 3; return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}` }).join(' ')
  return <svg className="gr-fhex" viewBox={`-4 -4 ${width + 8} ${height + 4}`} data-testid="family-board" role="grid" aria-label="Hex board">
    <path d={`M${dx / 2} ${r - 2}H${dx * size + dx / 2 - dx / 2}`} stroke={game.colors![0]} strokeWidth="2.4" />
    <path d={`M${dx / 2 + (size - 1) * dx / 2} ${height - 4}H${dx * size + (size - 1) * dx / 2}`} stroke={game.colors![0]} strokeWidth="2.4" />
    {Array.from({ length: size * size }, (_, i) => {
      const row = Math.floor(i / size), col = i % size, cx = dx / 2 + col * dx + row * dx / 2 + 2, cy = r + row * dy + 2, piece = game.pieceAt?.(state, i)
      return <g key={i} className={`gr-hexcell ${humanTurn && targetSet.has(i) ? 'is-target' : ''} ${last.includes(i) ? 'is-last' : ''}`} onClick={() => click(i)}>
        <polygon points={corner(cx, cy)} fill={piece ? game.colors![piece.owner] : (col === 0 || col === size - 1) ? '#2f6fd822' : (row === 0 || row === size - 1) ? '#e8342c22' : '#f4ead2'} stroke="#3b2a1c" strokeWidth=".5" />
      </g>
    })}
  </svg>
}
