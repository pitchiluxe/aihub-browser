import React, { useEffect, useRef, useState } from 'react'
import { findBestMove, letterValue, makeDictionary, newWordTiles, passWordTiles, playWordTiles, PREMIUMS, RACK, scoreMove, SIZE, type Dictionary, type Placement, type WordTilesState } from '../../../../shared/games/wordtiles'
import { shuffled } from '../../../../shared/games/random'
import { GameButton, GameResult, type GameProps } from './GameControls'
import { playSound } from './sounds'
import './word-games.css'

// The 172,000-word list loads only when this game opens, then stays for the session.
let dictionaryJob: Promise<Dictionary> | null = null
const loadDictionary = () => dictionaryJob ||= import('./data/words.txt?raw').then(module => makeDictionary(module.default))
const PREMIUM_LABEL: Record<string, string> = { DL: 'Double letter', TL: 'Triple letter', DW: 'Double word', TW: 'Triple word' }

function Tile({ letter, blank, fresh, small }: { letter: string; blank?: boolean; fresh?: boolean; small?: boolean }) {
  return <span className={`gr-wt-tile ${fresh ? 'is-fresh' : ''} ${small ? 'is-small' : ''} ${blank ? 'is-blank' : ''}`}>{letter === '?' ? '' : letter}{!blank && letter !== '?' && <sub>{letterValue(letter)}</sub>}</span>
}

export default function WordTilesGame({ paused, onFinish }: GameProps) {
  const [dictionary, setDictionary] = useState<Dictionary | null>(null), [state, setState] = useState<WordTilesState>(() => newWordTiles())
  const [pending, setPending] = useState<(Placement & { rackIndex: number })[]>([]), [picked, setPicked] = useState<number | null>(null)
  const [order, setOrder] = useState<number[]>(() => Array.from({ length: RACK }, (_, i) => i)), [message, setMessage] = useState(''), [swapping, setSwapping] = useState<number[] | null>(null)
  const [blankFor, setBlankFor] = useState<{ row: number; col: number; rackIndex: number } | null>(null), [thinking, setThinking] = useState(false)
  const reported = useRef(false)
  useEffect(() => { void loadDictionary().then(setDictionary).catch(() => setMessage('The word list could not be loaded.')) }, [])
  const human = !state.bots[state.current] && !state.over, rack = state.racks[state.current]
  const seat = human ? state.current : state.bots.indexOf(false)
  useEffect(() => { setOrder(Array.from({ length: state.racks[seat]?.length || 0 }, (_, i) => i)); setPending([]); setPicked(null) }, [state.racks[seat]?.join(''), seat])
  useEffect(() => {
    if (!dictionary || paused || state.over || !state.bots[state.current]) return
    setThinking(true)
    // Let the "thinking" label paint before the search runs.
    const timer = setTimeout(() => {
      const move = findBestMove(state.board, rack, dictionary, 1200)
      setThinking(false)
      if (move) { playSound('tile'); setState(playWordTiles(state, move.placements, dictionary).state) }
      else setState(passWordTiles(state, state.bag.length >= RACK ? [0, 1, 2] : []))
    }, 700)
    return () => clearTimeout(timer)
  }, [dictionary, paused, state])
  useEffect(() => {
    if (!state.over || reported.current) return
    reported.current = true
    const me = state.bots.indexOf(false), won = me >= 0 && state.scores[me] === Math.max(...state.scores)
    playSound(won ? 'win' : 'lose'); if (me >= 0) onFinish(Math.max(0, state.scores[me]))
  }, [state.over])
  const used = new Set(pending.map(p => p.rackIndex))
  const preview = dictionary && pending.length ? scoreMove(state.board, pending, dictionary) : null
  const placeAt = (row: number, col: number) => {
    if (paused || !human || state.board[row][col]) return
    const existing = pending.find(p => p.row === row && p.col === col)
    if (existing) { setPending(pending.filter(p => p !== existing)); playSound('click'); return }
    if (picked === null) return
    if (rack[picked] === '?') { setBlankFor({ row, col, rackIndex: picked }); return }
    setPending([...pending, { row, col, letter: rack[picked], blank: false, rackIndex: picked }]); setPicked(null); playSound('tile')
  }
  const submit = () => {
    if (!dictionary) return
    const { state: next, result } = playWordTiles(state, pending, dictionary)
    if (!result.ok) { setMessage(result.error || 'That move is not allowed.'); playSound('error'); return }
    setMessage(''); playSound(pending.length === RACK ? 'win' : 'coin'); setState(next)
  }
  const pendingAt = (row: number, col: number) => pending.find(p => p.row === row && p.col === col)
  const lastCells = new Set(state.last.map(p => p.row * SIZE + p.col))
  const restart = (humans: number, total: number) => { setState(newWordTiles(humans, total)); reported.current = false; setMessage('') }
  return <div className="gr-word-layout is-tiles">
    <div className="gr-wt-board-wrap">
      <div className="gr-wt-board" role="grid" aria-label="Word Tiles board" data-testid="wordtiles-board">
        {state.board.flatMap((row, r) => row.map((cell, c) => {
          const premium = PREMIUMS[r][c], mine = pendingAt(r, c)
          return <button type="button" key={`${r}-${c}`} className={`gr-wt-cell ${premium ? `is-${premium.toLowerCase()}` : ''} ${r === 7 && c === 7 ? 'is-star' : ''}`} onClick={() => placeAt(r, c)} aria-label={`Row ${r + 1}, column ${c + 1}${cell ? `, ${cell.letter}` : premium ? `, ${PREMIUM_LABEL[premium]}` : ''}`}>
            {cell ? <Tile letter={cell.letter} blank={cell.blank} fresh={lastCells.has(r * SIZE + c)} /> : mine ? <Tile letter={mine.letter} blank={mine.blank} fresh /> : premium && <span className="gr-wt-premium">{r === 7 && c === 7 ? '★' : premium}</span>}
          </button>
        }))}
      </div>
      <div className="gr-wt-rack" aria-label="Your tiles">{order.map(index => { const letter = state.racks[seat]?.[index]; if (letter === undefined) return null; return <button type="button" key={`${index}-${letter}`} disabled={!human || used.has(index) || paused} className={`gr-wt-rack-slot ${picked === index ? 'is-picked' : ''} ${swapping?.includes(index) ? 'is-swap' : ''}`} onClick={() => { if (swapping) setSwapping(swapping.includes(index) ? swapping.filter(i => i !== index) : [...swapping, index]); else { setPicked(picked === index ? null : index); playSound('click') } }}>{!used.has(index) && <Tile letter={letter} />}</button> })}</div>
      {blankFor && <div className="gr-wild" role="dialog" aria-label="Choose a letter for the blank"><strong>Which letter is this blank?</strong><div className="gr-wt-alphabet">{[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(letter => <button key={letter} type="button" onClick={() => { setPending([...pending, { row: blankFor.row, col: blankFor.col, letter, blank: true, rackIndex: blankFor.rackIndex }]); setBlankFor(null); setPicked(null); playSound('tile') }}>{letter}</button>)}</div></div>}
    </div>
    <aside className="gr-game-aside">
      <div className="gr-player-list">{state.names.map((name, at) => <div key={at} className={state.current === at ? 'current' : ''}><span>{name}</span><strong>{state.scores[at]}</strong></div>)}</div>
      <h3>{!dictionary ? 'Opening the dictionary…' : state.over ? 'Game over' : thinking ? `${state.names[state.current]} is thinking…` : human ? 'Your move' : `${state.names[state.current]} to play`}</h3>
      <p>{message || (preview ? preview.ok ? `${preview.words.map(word => word.word).join(', ')} — ${preview.score} points` : preview.error : human ? 'Pick a tile from your rack, then click a square. Click a placed tile to take it back.' : state.log[0])}</p>
      {human && !swapping && <div className="gr-circuit-actions"><GameButton disabled={!pending.length || paused || !preview?.ok} onClick={submit}>Play word{preview?.ok ? ` (+${preview.score})` : ''}</GameButton><GameButton disabled={!pending.length} onClick={() => setPending([])}>Recall</GameButton><GameButton onClick={() => { setOrder(shuffled(order)); playSound('card') }}>Shuffle</GameButton><GameButton disabled={state.bag.length < RACK} onClick={() => { setPending([]); setSwapping([]) }}>Swap tiles</GameButton><GameButton onClick={() => setState(passWordTiles(state))}>Pass</GameButton></div>}
      {swapping && <div className="gr-circuit-actions"><GameButton disabled={!swapping.length} onClick={() => { setState(passWordTiles(state, swapping)); setSwapping(null); playSound('card') }}>Swap {swapping.length} tile{swapping.length === 1 ? '' : 's'}</GameButton><GameButton onClick={() => setSwapping(null)}>Cancel</GameButton></div>}
      <p className="gr-wt-bag">{state.bag.length} tiles left in the bag</p>
      {state.over && <GameResult title={state.log[0]} text="" />}
      <details className="gr-rules"><summary>Rules & players</summary><p>Every word reads left to right or top to bottom and must join the tiles already down. The first word covers the star. Coloured squares double or triple a letter or a whole word the first time they are covered. Using all seven tiles earns a 50-point bonus. Blanks can be any letter but score nothing.</p><div className="gr-circuit-actions"><GameButton onClick={() => restart(1, 2)}>You vs computer</GameButton><GameButton onClick={() => restart(1, 3)}>You vs 2 computers</GameButton><GameButton onClick={() => restart(2, 2)}>2 players</GameButton></div></details>
      <ol className="gr-turn-log">{state.log.slice(state.over ? 1 : 0, 6).map((line, i) => <li key={`${state.log.length}-${i}`}>{line}</li>)}</ol>
    </aside>
  </div>
}
