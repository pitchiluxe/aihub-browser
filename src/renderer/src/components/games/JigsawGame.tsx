import React, { useEffect, useRef, useState } from 'react'
import { cutJigsaw, jigsawDone, magnetPull, piecePath, scatter, tryPlace, type Jigsaw } from '../../../../shared/games/jigsaw'
import AnimalArt, { ANIMALS, type Animal } from './AnimalArt'
import Fireworks from './Fireworks'
import { GameButton, GameStats, type GameProps } from './GameControls'
import { playSound } from './sounds'
import './tabletop.css'

const W = 600, H = 450, TRAY = 560, SCAN_MS = 1900, NEXT_MS = 3200
const LEVELS = [{ name: 'Easy', rows: 3, cols: 4 }, { name: 'Medium', rows: 4, cols: 5 }, { name: 'Hard', rows: 6, cols: 8 }]
const randomAnimal = (not?: Animal): Animal => { const options = ANIMALS.filter(animal => animal !== not); return options[Math.floor(Math.random() * options.length)] }
// What the puzzle agent is doing: waiting behind its sign, scanning the board, or giving its verdict.
type Check = { stage: 'idle' } | { stage: 'scanning' } | { stage: 'pass'; next: Animal } | { stage: 'fail'; loose: number }

export default function JigsawGame({ paused, onFinish }: GameProps) {
  const [animal, setAnimal] = useState<Animal>(() => randomAnimal()), [level, setLevel] = useState(0)
  const [puzzle, setPuzzle] = useState<Jigsaw>(() => scatter(cutJigsaw(LEVELS[0].rows, LEVELS[0].cols, W, H), TRAY))
  const [dragging, setDragging] = useState<{ index: number; dx: number; dy: number; pull: number } | null>(null), [order, setOrder] = useState<number[]>(() => puzzle.pieces.map((_, i) => i))
  const [ghost, setGhost] = useState(true), [seconds, setSeconds] = useState(0), [moves, setMoves] = useState(0), [solved, setSolved] = useState(0)
  const [check, setCheck] = useState<Check>({ stage: 'idle' }), [justSnapped, setJustSnapped] = useState<number | null>(null)
  const svg = useRef<SVGSVGElement>(null), timers = useRef<number[]>([])
  const allIn = jigsawDone(puzzle), approved = check.stage === 'pass'
  const w = W / puzzle.cols, h = H / puzzle.rows
  useEffect(() => { if (paused || approved) return; const timer = setInterval(() => setSeconds(value => value + 1), 1000); return () => clearInterval(timer) }, [paused, approved])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const later = (ms: number, run: () => void) => { timers.current.push(window.setTimeout(run, ms)) }

  const start = (nextLevel = level, nextAnimal = randomAnimal(animal)) => {
    timers.current.forEach(clearTimeout); timers.current = []
    const fresh = scatter(cutJigsaw(LEVELS[nextLevel].rows, LEVELS[nextLevel].cols, W, H), TRAY)
    setLevel(nextLevel); setAnimal(nextAnimal); setPuzzle(fresh); setOrder(fresh.pieces.map((_, i) => i)); setSeconds(0); setMoves(0); setCheck({ stage: 'idle' }); playSound('card')
  }
  // The agent climbs over its sign, sweeps the board with its lens, then rules.
  const askAgent = () => {
    if (paused || check.stage === 'scanning' || approved) return
    setCheck({ stage: 'scanning' }); playSound('click')
    later(SCAN_MS, () => {
      const loose = puzzle.pieces.filter(piece => !piece.placed).length
      if (loose) { setCheck({ stage: 'fail', loose }); playSound('buzz'); return }
      const next = randomAnimal(animal)
      setCheck({ stage: 'pass', next }); setSolved(value => value + 1); playSound('win')
      onFinish(Math.max(100, puzzle.pieces.length * 100 - seconds * 2))
      later(NEXT_MS, () => start(level, next))
    })
  }

  const point = (event: React.PointerEvent) => { const box = svg.current!.getBoundingClientRect(), scale = (W + TRAY + 40) / box.width; return { x: (event.clientX - box.left) * scale - 20, y: (event.clientY - box.top) * scale - 20 } }
  const grab = (index: number) => (event: React.PointerEvent) => {
    const piece = puzzle.pieces[index]
    if (paused || piece.placed || check.stage === 'scanning' || approved) return
    const at = point(event); (event.target as Element).setPointerCapture(event.pointerId)
    setDragging({ index, dx: at.x - piece.x, dy: at.y - piece.y, pull: 0 }); setOrder(previous => [...previous.filter(i => i !== index), index]); playSound('click')
    if (check.stage === 'fail') setCheck({ stage: 'idle' })
  }
  const drag = (event: React.PointerEvent) => {
    if (!dragging) return
    const at = point(event)
    const x = Math.max(-w / 2, Math.min(W + TRAY - w / 2, at.x - dragging.dx)), y = Math.max(-h / 2, Math.min(H - h / 2, at.y - dragging.dy))
    const pulled = magnetPull(puzzle, dragging.index, x, y)
    // A soft tick the moment the magnet first catches the piece.
    if (pulled.strength > 0 && dragging.pull === 0) playSound('tile')
    setDragging({ ...dragging, pull: pulled.strength })
    setPuzzle(previous => ({ ...previous, pieces: previous.pieces.map((piece, i) => i === dragging.index ? { ...piece, x: pulled.x, y: pulled.y } : piece) }))
  }
  const drop = () => {
    if (!dragging) return
    const piece = puzzle.pieces[dragging.index], { puzzle: next, snapped } = tryPlace(puzzle, dragging.index, piece.x, piece.y)
    setPuzzle(next); setDragging(null); setMoves(value => value + 1); playSound(snapped ? 'snap' : 'tile')
    if (snapped) { setOrder(previous => [dragging.index, ...previous.filter(i => i !== dragging.index)]); setJustSnapped(dragging.index); later(450, () => setJustSnapped(value => value === dragging.index ? null : value)) }
  }
  const placed = puzzle.pieces.filter(piece => piece.placed).length
  const speech = check.stage === 'scanning' ? 'Let me take a close look…'
    : check.stage === 'pass' ? `Perfect! Every piece is home. Next up: the ${check.next.toLowerCase()}!`
    : check.stage === 'fail' ? `Not yet — ${check.loose} ${check.loose === 1 ? 'piece still needs' : 'pieces still need'} a home. I've marked ${check.loose === 1 ? 'it' : 'them'} for you.`
    : allIn ? 'Looks finished! Press Done and I will check it.' : 'Put the pieces together, then press Done.'
  return <div className="gr-jigsaw-layout">
    <div className="gr-jigsaw-stage">
      <svg ref={svg} className={`gr-jigsaw ${check.stage === 'scanning' ? 'is-scanning' : ''}`} viewBox={`-20 -20 ${W + TRAY + 40} ${H + 40}`} role="img" aria-label={`${animal} jigsaw puzzle, ${placed} of ${puzzle.pieces.length} pieces placed`} data-testid="jigsaw" onPointerMove={drag} onPointerUp={drop} onPointerCancel={drop}>
        <defs>
          <g id="gr-jigsaw-art"><svg width={W} height={H} viewBox="0 0 400 300" preserveAspectRatio="none"><AnimalArt animal={animal} /></svg></g>
          {puzzle.pieces.map((piece, i) => <clipPath key={i} id={`gr-piece-${i}`}><path d={piecePath(piece.edges, w, h)} transform={`translate(${piece.col * w} ${piece.row * h})`} /></clipPath>)}
          <linearGradient id="gr-scan" x1="0" x2="1"><stop offset="0" stopColor="#6ef7ff" stopOpacity="0" /><stop offset=".5" stopColor="#6ef7ff" stopOpacity=".55" /><stop offset="1" stopColor="#6ef7ff" stopOpacity="0" /></linearGradient>
        </defs>
        <rect x="-12" y="-12" width={W + 24} height={H + 24} rx="10" fill="#2a1d14" />
        <rect width={W} height={H} fill="#16121f" />
        {ghost && <use href="#gr-jigsaw-art" opacity=".18" />}
        {dragging && dragging.pull > 0 && (() => { const piece = puzzle.pieces[dragging.index]; return <path className="gr-magnet-target" d={piecePath(piece.edges, w, h)} transform={`translate(${piece.col * w} ${piece.row * h})`} style={{ opacity: 0.25 + dragging.pull * 0.9 }} /> })()}
        <rect x={W + 18} y="-12" width={TRAY - 10} height={H + 24} rx="14" fill="#ffffff08" stroke="#ffffff14" />
        {order.map(i => {
          const piece = puzzle.pieces[i], loose = check.stage === 'fail' && !piece.placed
          return <g key={i} className={`gr-piece ${piece.placed ? 'is-placed' : ''} ${justSnapped === i ? 'is-snapped' : ''} ${dragging?.index === i ? 'is-dragging' : ''} ${dragging?.index === i && dragging.pull > 0 ? 'is-pulled' : ''} ${loose ? 'is-loose' : ''}`} data-piece={i} style={{ transform: `translate(${piece.x - piece.col * w}px, ${piece.y - piece.row * h}px)` }} onPointerDown={grab(i)}>
            <g clipPath={`url(#gr-piece-${i})`}><use href="#gr-jigsaw-art" /></g>
            <path d={piecePath(piece.edges, w, h)} transform={`translate(${piece.col * w} ${piece.row * h})`} fill="none" stroke={loose ? '#ff5f6d' : piece.placed ? '#00000022' : '#fff8'} strokeWidth={loose ? 3 : piece.placed ? 1 : 1.5} />
          </g>
        })}
        {check.stage === 'scanning' && <rect className="gr-scan-beam" x={-60} y={0} width={60} height={H} fill="url(#gr-scan)" style={{ animationDuration: `${SCAN_MS}ms` }} />}
        {approved && <g className="gr-jigsaw-done"><use href="#gr-jigsaw-art" /><text x={W / 2} y={H - 26} textAnchor="middle">{animal}!</text></g>}
      </svg>
      {approved && <Fireworks duration={NEXT_MS} title="Puzzle approved!" />}
    </div>
    <aside className="gr-game-aside">
      <GameStats items={[['Placed', `${placed}/${puzzle.pieces.length}`], ['Time', `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`], ['Moves', moves], ['Solved', solved]]} />
      <PuzzleAgent stage={check.stage} speech={speech} ready={allIn} />
      <div className="gr-circuit-actions"><GameButton disabled={paused || check.stage === 'scanning' || approved} onClick={askAgent}><span className={allIn && check.stage === 'idle' ? 'gr-done-ready' : ''}>✓ Done</span></GameButton></div>
      <p>Drag pieces from the tray onto the board. Near its spot a piece feels the magnet pull and clicks into place.</p>
      <div className="gr-circuit-actions">{LEVELS.map((item, i) => <GameButton key={item.name} onClick={() => start(i)}>{item.name} · {item.rows * item.cols}</GameButton>)}</div>
      <div className="gr-circuit-actions"><GameButton onClick={() => start()}>New animal</GameButton><GameButton onClick={() => setGhost(value => !value)}>{ghost ? 'Hide picture' : 'Show picture'}</GameButton></div>
    </aside>
  </div>
}

/** The puzzle agent: a small robot that waits behind the "Puzzle check" sign
 *  and climbs over it with a magnifying lens when the player presses Done. */
function PuzzleAgent({ stage, speech, ready }: { stage: Check['stage']; speech: string; ready: boolean }) {
  return <div className={`gr-agent is-${stage} ${ready ? 'is-ready' : ''}`} data-testid="puzzle-agent">
    <div className="gr-agent-bubble" role="status" aria-live="polite">{speech}</div>
    <div className="gr-agent-booth">
      <svg className="gr-agent-bot" viewBox="0 0 120 120" aria-hidden="true">
        <line x1="60" y1="8" x2="60" y2="24" stroke="#9aa8bb" strokeWidth="3" /><circle className="gr-agent-light" cx="60" cy="8" r="6" />
        <rect x="22" y="22" width="76" height="58" rx="22" fill="#dfe8f2" stroke="#7f8ea3" strokeWidth="3" />
        <rect x="32" y="34" width="56" height="32" rx="14" fill="#1b2433" />
        <g className="gr-agent-eyes"><ellipse cx="48" cy="50" rx="6" ry="7" /><ellipse cx="72" cy="50" rx="6" ry="7" /></g>
        <path className="gr-agent-mouth" d="M50 72 Q60 78 70 72" fill="none" stroke="#7f8ea3" strokeWidth="3" strokeLinecap="round" />
        <rect x="30" y="82" width="60" height="38" rx="12" fill="#c9d6e4" stroke="#7f8ea3" strokeWidth="3" />
        <g className="gr-agent-lens"><line x1="98" y1="96" x2="112" y2="112" stroke="#6b4a2b" strokeWidth="6" strokeLinecap="round" /><circle cx="88" cy="86" r="15" fill="#bfefff66" stroke="#f5cc68" strokeWidth="5" /></g>
      </svg>
      <div className="gr-agent-sign"><span>Puzzle</span><b>Check</b></div>
    </div>
  </div>
}
