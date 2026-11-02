import React, { useEffect, useMemo, useRef, useState } from 'react'
import { buildCrossword, cellsOf, type Crossword, type CrosswordWord } from '../../../../shared/games/crossword'
import { GameButton, GameResult, GameStats, type GameProps } from './GameControls'
import { playSound } from './sounds'
import './word-games.css'

const key = (row: number, col: number) => `${row},${col}`
export default function CrosswordGame({ paused, onFinish }: GameProps) {
  const [puzzle, setPuzzle] = useState<Crossword>(() => buildCrossword()), [entries, setEntries] = useState<Record<string, string>>({})
  const [cursor, setCursor] = useState(() => ({ row: puzzle.words[0].row, col: puzzle.words[0].col, across: puzzle.words[0].across }))
  const [checked, setChecked] = useState(false), [revealed, setRevealed] = useState(0), [seconds, setSeconds] = useState(0), [done, setDone] = useState(false)
  const grid = useRef<HTMLDivElement>(null)
  const active = useMemo(() => puzzle.words.find(word => word.across === cursor.across && cellsOf(word).some(([r, c]) => r === cursor.row && c === cursor.col)) || puzzle.words.find(word => cellsOf(word).some(([r, c]) => r === cursor.row && c === cursor.col))!, [puzzle, cursor])
  const activeCells = new Set(cellsOf(active).map(([r, c]) => key(r, c)))
  const numbers = new Map(puzzle.words.map(word => [key(word.row, word.col), word.number]))
  const solved = puzzle.grid.every((row, r) => row.every((letter, c) => !letter || entries[key(r, c)] === letter))
  useEffect(() => { if (paused || done) return; const timer = setInterval(() => setSeconds(value => value + 1), 1000); return () => clearInterval(timer) }, [paused, done])
  useEffect(() => { if (!solved || done) return; setDone(true); playSound('win'); onFinish(Math.max(100, 3000 - seconds * 3 - revealed * 120)) }, [solved])
  const select = (word: CrosswordWord) => { setCursor({ row: word.row, col: word.col, across: word.across }); grid.current?.focus() }
  const move = (dr: number, dc: number) => {
    let row = cursor.row + dr, col = cursor.col + dc
    while (row >= 0 && col >= 0 && row < puzzle.size && col < puzzle.size && !puzzle.grid[row][col]) { row += dr; col += dc }
    if (row >= 0 && col >= 0 && row < puzzle.size && col < puzzle.size) setCursor({ ...cursor, row, col })
  }
  const advance = (step: number) => {
    const cells = cellsOf(active), at = cells.findIndex(([r, c]) => r === cursor.row && c === cursor.col), next = cells[at + step]
    if (next) setCursor({ ...cursor, row: next[0], col: next[1] })
  }
  const keydown = (event: React.KeyboardEvent) => {
    if (paused || done) return
    const letter = event.key.length === 1 && /[a-z]/i.test(event.key) ? event.key.toUpperCase() : null
    if (letter) { event.preventDefault(); setEntries(value => ({ ...value, [key(cursor.row, cursor.col)]: letter })); setChecked(false); playSound('tile'); advance(1); return }
    if (event.key === 'Backspace') { event.preventDefault(); const here = key(cursor.row, cursor.col); if (entries[here]) setEntries(value => { const next = { ...value }; delete next[here]; return next }); else advance(-1); return }
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (arrows[event.key]) { event.preventDefault(); const across = event.key === 'ArrowLeft' || event.key === 'ArrowRight'; if (across !== cursor.across) setCursor({ ...cursor, across }); else move(...arrows[event.key]) }
    if (event.key === ' ' || event.key === 'Tab') { event.preventDefault(); const list = puzzle.words, at = list.indexOf(active); select(list[(at + (event.shiftKey ? -1 : 1) + list.length) % list.length]) }
  }
  const click = (row: number, col: number) => { if (!puzzle.grid[row][col]) return; setCursor(row === cursor.row && col === cursor.col ? { ...cursor, across: !cursor.across } : { ...cursor, row, col }); grid.current?.focus() }
  const reveal = (cells: [number, number][]) => { setEntries(value => ({ ...value, ...Object.fromEntries(cells.map(([r, c]) => [key(r, c), puzzle.grid[r][c]!])) })); setRevealed(value => value + cells.length); playSound('card') }
  const fresh = () => { const next = buildCrossword(); setPuzzle(next); setEntries({}); setCursor({ row: next.words[0].row, col: next.words[0].col, across: next.words[0].across }); setChecked(false); setRevealed(0); setSeconds(0); setDone(false) }
  const clueList = (across: boolean) => <section><h4>{across ? 'Across' : 'Down'}</h4><ol>{puzzle.words.filter(word => word.across === across).map(word => <li key={`${word.number}-${across}`}><button type="button" className={word === active ? 'active' : ''} onClick={() => select(word)}><b>{word.number}</b>{word.clue} <small>({word.answer.length})</small></button></li>)}</ol></section>
  return <div className="gr-word-layout">
    <div>
      <div className="gr-xw-current"><b>{active.number} {active.across ? 'Across' : 'Down'}</b>{active.clue}</div>
      <div ref={grid} className="gr-xw-grid" tabIndex={0} role="grid" aria-label="Crossword grid" data-testid="crossword-grid" style={{ '--n': puzzle.size } as React.CSSProperties} onKeyDown={keydown}>
        {puzzle.grid.flatMap((row, r) => row.map((letter, c) => {
          const id = key(r, c), entry = entries[id], wrong = checked && entry && entry !== letter
          return letter ? <div key={id} role="gridcell" className={`gr-xw-cell ${activeCells.has(id) ? 'in-word' : ''} ${cursor.row === r && cursor.col === c ? 'is-cursor' : ''} ${wrong ? 'is-wrong' : ''} ${done ? 'is-done' : ''}`} onClick={() => click(r, c)} style={{ '--i': r + c } as React.CSSProperties}>{numbers.has(id) && <small>{numbers.get(id)}</small>}<span key={entry}>{entry || ''}</span></div> : <div key={id} className="gr-xw-block" />
        }))}
      </div>
    </div>
    <aside className="gr-game-aside gr-xw-aside">
      <GameStats items={[['Time', `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`], ['Words', puzzle.words.length], ['Revealed', revealed]]} />
      <div className="gr-circuit-actions"><GameButton onClick={() => { setChecked(true); playSound('click') }}>Check</GameButton><GameButton onClick={() => reveal([[cursor.row, cursor.col]])}>Reveal letter</GameButton><GameButton onClick={() => reveal(cellsOf(active))}>Reveal word</GameButton><GameButton onClick={fresh}>New puzzle</GameButton></div>
      {done && <GameResult title="Puzzle solved!" text={`Finished in ${Math.floor(seconds / 60)}m ${seconds % 60}s.`} />}
      <div className="gr-xw-clues">{clueList(true)}{clueList(false)}</div>
    </aside>
  </div>
}
