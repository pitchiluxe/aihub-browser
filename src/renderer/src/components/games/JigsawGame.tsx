import React, { useEffect, useRef, useState } from 'react'
import { cutJigsaw, jigsawDone, piecePath, scatter, tryPlace, type Jigsaw } from '../../../../shared/games/jigsaw'
import AnimalArt, { ANIMALS, type Animal } from './AnimalArt'
import { GameButton, GameResult, GameStats, type GameProps } from './GameControls'
import { playSound } from './sounds'
import './tabletop.css'

const W = 600, H = 450, TRAY = 560
const LEVELS = [{ name: 'Easy', rows: 3, cols: 4 }, { name: 'Medium', rows: 4, cols: 5 }, { name: 'Hard', rows: 6, cols: 8 }]
const randomAnimal = (not?: Animal): Animal => { const options = ANIMALS.filter(animal => animal !== not); return options[Math.floor(Math.random() * options.length)] }

export default function JigsawGame({ paused, onFinish }: GameProps) {
  const [animal, setAnimal] = useState<Animal>(() => randomAnimal()), [level, setLevel] = useState(0)
  const [puzzle, setPuzzle] = useState<Jigsaw>(() => scatter(cutJigsaw(LEVELS[0].rows, LEVELS[0].cols, W, H), TRAY))
  const [dragging, setDragging] = useState<{ index: number; dx: number; dy: number } | null>(null), [order, setOrder] = useState<number[]>(() => puzzle.pieces.map((_, i) => i))
  const [ghost, setGhost] = useState(true), [seconds, setSeconds] = useState(0), [moves, setMoves] = useState(0)
  const svg = useRef<SVGSVGElement>(null), done = jigsawDone(puzzle), reported = useRef(false)
  const w = W / puzzle.cols, h = H / puzzle.rows
  useEffect(() => { if (paused || done) return; const timer = setInterval(() => setSeconds(value => value + 1), 1000); return () => clearInterval(timer) }, [paused, done])
  useEffect(() => { if (!done || reported.current) return; reported.current = true; playSound('win'); onFinish(Math.max(100, puzzle.pieces.length * 100 - seconds * 2)) }, [done])
  const start = (nextLevel = level, nextAnimal = randomAnimal(animal)) => {
    const fresh = scatter(cutJigsaw(LEVELS[nextLevel].rows, LEVELS[nextLevel].cols, W, H), TRAY)
    setLevel(nextLevel); setAnimal(nextAnimal); setPuzzle(fresh); setOrder(fresh.pieces.map((_, i) => i)); setSeconds(0); setMoves(0); reported.current = false; playSound('card')
  }
  const point = (event: React.PointerEvent) => { const box = svg.current!.getBoundingClientRect(), scale = (W + TRAY) / box.width; return { x: (event.clientX - box.left) * scale, y: (event.clientY - box.top) * scale } }
  const grab = (index: number) => (event: React.PointerEvent) => {
    const piece = puzzle.pieces[index]
    if (paused || piece.placed) return
    const at = point(event); (event.target as Element).setPointerCapture(event.pointerId)
    setDragging({ index, dx: at.x - piece.x, dy: at.y - piece.y }); setOrder(previous => [...previous.filter(i => i !== index), index]); playSound('click')
  }
  const drag = (event: React.PointerEvent) => {
    if (!dragging) return
    const at = point(event)
    setPuzzle(previous => ({ ...previous, pieces: previous.pieces.map((piece, i) => i === dragging.index ? { ...piece, x: Math.max(-w / 2, Math.min(W + TRAY - w / 2, at.x - dragging.dx)), y: Math.max(-h / 2, Math.min(H - h / 2, at.y - dragging.dy)) } : piece) }))
  }
  const drop = () => {
    if (!dragging) return
    const piece = puzzle.pieces[dragging.index], { puzzle: next, snapped } = tryPlace(puzzle, dragging.index, piece.x, piece.y)
    setPuzzle(next); setDragging(null); setMoves(value => value + 1); playSound(snapped ? 'knock' : 'tile')
    if (snapped) setOrder(previous => [dragging.index, ...previous.filter(i => i !== dragging.index)])
  }
  const placed = puzzle.pieces.filter(piece => piece.placed).length
  return <div className="gr-jigsaw-layout">
    <svg ref={svg} className="gr-jigsaw" viewBox={`-20 -20 ${W + TRAY + 40} ${H + 40}`} role="img" aria-label={`${animal} jigsaw puzzle, ${placed} of ${puzzle.pieces.length} pieces placed`} data-testid="jigsaw" onPointerMove={drag} onPointerUp={drop} onPointerCancel={drop}>
      <defs>
        <g id="gr-jigsaw-art"><svg width={W} height={H} viewBox="0 0 400 300" preserveAspectRatio="none"><AnimalArt animal={animal} /></svg></g>
        {puzzle.pieces.map((piece, i) => <clipPath key={i} id={`gr-piece-${i}`}><path d={piecePath(piece.edges, w, h)} transform={`translate(${piece.col * w} ${piece.row * h})`} /></clipPath>)}
      </defs>
      <rect x="-12" y="-12" width={W + 24} height={H + 24} rx="10" fill="#2a1d14" />
      <rect width={W} height={H} fill="#16121f" />
      {ghost && <use href="#gr-jigsaw-art" opacity=".18" />}
      <rect x={W + 18} y="-12" width={TRAY - 10} height={H + 24} rx="14" fill="#ffffff08" stroke="#ffffff14" />
      {order.map(i => { const piece = puzzle.pieces[i]; return <g key={i} className={`gr-piece ${piece.placed ? 'is-placed' : ''} ${dragging?.index === i ? 'is-dragging' : ''}`} transform={`translate(${piece.x - piece.col * w} ${piece.y - piece.row * h})`} onPointerDown={grab(i)}>
        <g clipPath={`url(#gr-piece-${i})`}><use href="#gr-jigsaw-art" /></g>
        <path d={piecePath(piece.edges, w, h)} transform={`translate(${piece.col * w} ${piece.row * h})`} fill="none" stroke={piece.placed ? '#00000022' : '#fff8'} strokeWidth={piece.placed ? 1 : 1.5} />
      </g> })}
      {done && <g className="gr-jigsaw-done"><use href="#gr-jigsaw-art" /><text x={W / 2} y={H - 26} textAnchor="middle">{animal}!</text></g>}
    </svg>
    <aside className="gr-game-aside">
      <GameStats items={[['Placed', `${placed}/${puzzle.pieces.length}`], ['Time', `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`], ['Moves', moves]]} />
      <h3>{done ? `You finished the ${animal.toLowerCase()}!` : `Who is hiding here?`}</h3>
      <p>Drag pieces from the tray onto the board. A piece clicks into place when it is close to its spot.</p>
      <div className="gr-circuit-actions">{LEVELS.map((item, i) => <GameButton key={item.name} onClick={() => start(i)}>{item.name} · {item.rows * item.cols}</GameButton>)}</div>
      <div className="gr-circuit-actions"><GameButton onClick={() => start()}>New animal</GameButton><GameButton onClick={() => setGhost(value => !value)}>{ghost ? 'Hide picture' : 'Show picture'}</GameButton></div>
      {done && <GameResult title="Puzzle complete" text={`${puzzle.pieces.length} pieces in ${Math.floor(seconds / 60)}m ${seconds % 60}s.`} />}
    </aside>
  </div>
}
