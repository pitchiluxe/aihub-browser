import React from 'react'
import type { Move } from '../../../../shared/games/family/core'
import { BAR, LADDERS, OFF, SNAKES, type BackgammonState, type PitState, type SnakesState } from '../../../../shared/games/family/race'
import { farkleScore, yachtScore, YACHT_BOXES, type FarkleState, type LiarState, type PigState, type BoxState, type YachtState } from '../../../../shared/games/family/dice'
import { CODE_COLORS, DOTS, MEMORY_FACES, seaSunk, type CodeState, type DotsState, type HangmanState, type MemoryState, type NimState, type SeaState } from '../../../../shared/games/family/puzzles'
import { Die, Pawn } from './BoardPieces'
import type { BoardProps } from './FamilyTable'

const find = (moves: Move[], test: (move: Move) => boolean) => moves.find(test)
const RolledDie = ({ value, roll, held, onClick, label }: { value: number; roll: number; held?: boolean; onClick?: () => void; label?: string }) => {
  const die = <span key={roll} className={`gr-die-wrap ${roll ? 'rolled' : ''}`} style={{ '--spin': roll % 2 ? '1' : '-1' } as React.CSSProperties}><Die value={value} /></span>
  return onClick ? <button type="button" className={`gr-fdie ${held ? 'is-held' : ''}`} onClick={onClick} aria-label={label}>{die}</button> : <span className={`gr-fdie ${held ? 'is-held' : ''}`}>{die}</span>
}

export function CustomBoard(props: BoardProps & { hidden: boolean }) {
  switch (props.game.id) {
    case 'backgammon': return <Backgammon {...props} />
    case 'snakes': return <SnakesBoard {...props} />
    case 'mancala': case 'oware': return <Pits {...props} />
    case 'yacht': return <Yacht {...props} />
    case 'farkle': return <Farkle {...props} />
    case 'shutbox': return <ShutBox {...props} />
    case 'pig': return <Pig {...props} />
    case 'liarsdice': return <Liar {...props} />
    case 'nim': return <Nim {...props} />
    case 'codebreaker': return <CodeBreaker {...props} />
    case 'memory': return <Memory {...props} />
    case 'hangman': return <Hangman {...props} />
    case 'seabattle': return <Sea {...props} />
    case 'dotsboxes': return <Dots {...props} />
    default: return null
  }
}

/* ── Backgammon: top row 12–23, bottom row 11–0, the bar between, the tray on the right. ── */
function Backgammon({ state, selected, sources, targets, humanTurn, click, last }: BoardProps) {
  const s = state as BackgammonState, targetSet = new Set(targets.map(m => m.to))
  const point = (i: number, top: boolean) => {
    const count = Math.abs(s.points[i]), owner = s.points[i] > 0 ? 0 : 1
    return <button type="button" key={i} className={`gr-bg-point ${top ? 'is-top' : ''} ${i % 2 ? 'is-odd' : ''} ${selected === i ? 'is-selected' : ''} ${humanTurn && sources.has(i) ? 'is-source' : ''} ${humanTurn && targetSet.has(i) ? 'is-target' : ''} ${last.includes(i) ? 'is-last' : ''}`} onClick={() => click(i)} aria-label={`Point ${i + 1}, ${count} checkers`}>
      {Array.from({ length: Math.min(count, 5) }, (_, k) => <i key={k} className={`gr-checker owner-${owner}`}>{k === 4 && count > 5 ? count : ''}</i>)}
    </button>
  }
  return <div className="gr-bg" data-testid="family-board">
    <div className="gr-bg-half">{[12, 13, 14, 15, 16, 17].map(i => point(i, true))}</div>
    <button type="button" className={`gr-bg-bar ${humanTurn && sources.has(BAR) ? 'is-source' : ''} ${selected === BAR ? 'is-selected' : ''}`} onClick={() => click(BAR)} aria-label="Bar">{Array.from({ length: s.bar[1] }, (_, k) => <i key={`b${k}`} className="gr-checker owner-1" />)}<span className="gr-bg-dice">{s.rolled.map((value, k) => <RolledDie key={k} value={value} roll={s.rolled.join('') ? 1 : 0} held={!s.dice.includes(value)} />)}</span>{Array.from({ length: s.bar[0] }, (_, k) => <i key={`w${k}`} className="gr-checker owner-0" />)}</button>
    <div className="gr-bg-half">{[18, 19, 20, 21, 22, 23].map(i => point(i, true))}</div>
    <button type="button" className={`gr-bg-off ${humanTurn && targetSet.has(OFF) ? 'is-target' : ''}`} onClick={() => click(OFF)} aria-label="Bear off"><span>{s.off[1]}</span><small>off</small><span>{s.off[0]}</span></button>
    <div className="gr-bg-half">{[11, 10, 9, 8, 7, 6].map(i => point(i, false))}</div>
    <div className="gr-bg-bar is-spacer" />
    <div className="gr-bg-half">{[5, 4, 3, 2, 1, 0].map(i => point(i, false))}</div>
  </div>
}

/* ── Snakes & Ladders: square 1 at the bottom left, rows snake back and forth up to 100. ── */
const squareXY = (n: number) => { const row = Math.floor((n - 1) / 10), col = row % 2 ? 9 - (n - 1) % 10 : (n - 1) % 10; return [col * 10 + 5, 95 - row * 10] }
function SnakesBoard({ game, state }: BoardProps) {
  const s = state as SnakesState
  return <div className="gr-snakes" data-testid="family-board">
    {Array.from({ length: 100 }, (_, k) => { const n = 100 - k, row = Math.floor((n - 1) / 10), col = row % 2 ? 9 - (n - 1) % 10 : (n - 1) % 10; return <span key={n} className="gr-snake-cell" style={{ gridRow: 10 - row, gridColumn: col + 1, '--tint': `hsl(${(n * 37) % 360} 70% 88%)` } as React.CSSProperties}>{n}</span> })}
    <svg viewBox="0 0 100 100" className="gr-snake-art" aria-hidden="true">
      {Object.entries(LADDERS).map(([from, to]) => { const [x1, y1] = squareXY(+from), [x2, y2] = squareXY(to), dx = (y2 - y1), dy = -(x2 - x1), len = Math.hypot(dx, dy) || 1, ox = dx / len * 1.6, oy = dy / len * 1.6; return <g key={from} stroke="#8a5a20" strokeWidth=".9" strokeLinecap="round"><line x1={x1 - ox} y1={y1 - oy} x2={x2 - ox} y2={y2 - oy} /><line x1={x1 + ox} y1={y1 + oy} x2={x2 + ox} y2={y2 + oy} />{Array.from({ length: 6 }, (_, r) => { const t = (r + .5) / 6, x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t; return <line key={r} x1={x - ox} y1={y - oy} x2={x + ox} y2={y + oy} /> })}</g> })}
      {Object.entries(SNAKES).map(([from, to], k) => { const [x1, y1] = squareXY(+from), [x2, y2] = squareXY(to), mx = (x1 + x2) / 2 + (k % 2 ? 8 : -8), my = (y1 + y2) / 2; return <g key={from}><path d={`M${x1} ${y1}Q${mx} ${my} ${x2} ${y2}`} fill="none" stroke={['#2fa64a', '#e8342c', '#8a4fd6', '#e6a93a'][k % 4]} strokeWidth="2.4" strokeLinecap="round" /><circle cx={x1} cy={y1} r="1.8" fill="#1c1a22" /></g> })}
    </svg>
    {s.positions.map((position, p) => { if (!position) return null; const [x, y] = squareXY(position); return <span key={p} className={`gr-snake-token seat-${p}`} style={{ left: `${x + (p % 2 ? 2 : -2)}%`, top: `${y + (p > 1 ? 2 : -2)}%` }}><Pawn color={game.colors![p]} /></span> })}
    <span className="gr-snake-die"><RolledDie value={s.die || 1} roll={s.last.length ? s.last[1] + s.die : 0} /></span>
  </div>
}

/* ── Mancala and Oware: two rows of pits; stores (or captured seeds) at the ends. ── */
const Seeds = ({ count }: { count: number }) => <span className="gr-seeds">{Array.from({ length: Math.min(count, 18) }, (_, k) => <i key={k} style={{ '--a': `${k * 137.5}deg`, '--r': `${Math.min(34, 6 + Math.sqrt(k) * 9)}%`, '--h': `${(k * 53) % 360}` } as React.CSSProperties} />)}<b>{count}</b></span>
function Pits({ game, state, targets, humanTurn, click, last }: BoardProps) {
  const s = state as PitState, kalah = game.id === 'mancala', playable = new Set(targets.map(m => m.to))
  const north = kalah ? [12, 11, 10, 9, 8, 7] : [11, 10, 9, 8, 7, 6], south = kalah ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5]
  const pit = (i: number) => <button type="button" key={i} className={`gr-pit ${humanTurn && playable.has(i) ? 'is-target' : ''} ${last.includes(i) ? 'is-last' : ''}`} onClick={() => click(i)} aria-label={`Pit with ${s.pits[i]} seeds`}><Seeds count={s.pits[i]} /></button>
  return <div className={`gr-mancala ${kalah ? 'is-kalah' : 'is-oware'}`} data-testid="family-board">
    <span className="gr-store"><Seeds count={kalah ? s.pits[13] : s.stores[1]} /><small>North</small></span>
    <div className="gr-pit-row">{north.map(pit)}</div><div className="gr-pit-row">{south.map(pit)}</div>
    <span className="gr-store"><Seeds count={kalah ? s.pits[6] : s.stores[0]} /><small>South</small></span>
  </div>
}

/* ── Dice tables ── */
function Yacht({ state, moves, humanTurn, play, seat, mode }: BoardProps) {
  const s = state as YachtState
  return <div className="gr-dice-table" data-testid="family-board">
    <div className="gr-dice-row">{s.dice.map((value, i) => { const hold = find(moves, m => m.hold === i); return <RolledDie key={i} value={value} roll={s.held[i] ? 0 : s.rolls * 10 + i} held={s.held[i]} onClick={humanTurn && hold ? () => play(hold, 'click') : undefined} label={`${s.held[i] ? 'Release' : 'Hold'} ${value}`} /> })}</div>
    <table className="gr-scorecard"><thead><tr><th /><th>{mode === 'computer' ? 'You' : 'Player 1'}</th><th>{mode === 'computer' ? 'Computer' : 'Player 2'}</th></tr></thead><tbody>
      {YACHT_BOXES.map((name, box) => <tr key={name}><th>{name}</th>{[0, 1].map(p => { const value = s.scores[p][box], option = p === seat && humanTurn ? find(moves, m => m.box === box) : undefined; return <td key={p}>{value !== null ? value : option ? <button type="button" onClick={() => play(option, 'coin')}>{yachtScore(box, s.dice)}</button> : ''}</td> })}</tr>)}
      <tr className="is-total"><th>Total</th>{[0, 1].map(p => <td key={p}>{s.scores[p].reduce<number>((sum, v) => sum + (v ?? 0), 0)}</td>)}</tr>
    </tbody></table>
  </div>
}
function Farkle({ state, moves, humanTurn, play }: BoardProps) {
  const s = state as FarkleState, chosen = s.dice.filter((_, i) => s.picked[i]), value = farkleScore(chosen)
  return <div className="gr-dice-table" data-testid="family-board">
    <div className="gr-farkle-scores"><span>You <b>{s.scores[0]}</b></span><span>This turn <b>{s.turnPoints + (value.used === chosen.length ? value.points : 0)}</b></span><span>Computer <b>{s.scores[1]}</b></span></div>
    <div className="gr-dice-row">{s.dice.map((d, i) => { const pick = find(moves, m => m.pick === i); return <RolledDie key={i} value={d} roll={s.last.length ? i + 1 + s.dice.join('').length : 0} held={s.picked[i]} onClick={humanTurn && pick ? () => play(pick, 'click') : undefined} label={`Set aside ${d}`} /> })}</div>
    <p className="gr-dice-hint">{s.rolled ? chosen.length ? value.used === chosen.length ? `Set aside: ${value.points} points` : 'Some chosen dice do not score.' : 'Click scoring dice to set them aside.' : ''}</p>
  </div>
}
function ShutBox({ state }: BoardProps) {
  const s = state as BoxState
  return <div className="gr-dice-table gr-shutbox" data-testid="family-board">
    <div className="gr-box-tiles">{s.tiles.map((up, i) => <span key={i} className={`gr-box-tile ${up ? '' : 'is-down'} ${s.last.includes(i + 1) ? 'is-last' : ''}`}>{i + 1}</span>)}</div>
    <div className="gr-dice-row">{s.dice.map((d, i) => <RolledDie key={i} value={d} roll={d * 7 + i + s.tiles.filter(Boolean).length} />)}</div>
  </div>
}
function Pig({ state }: BoardProps) {
  const s = state as PigState
  return <div className="gr-dice-table" data-testid="family-board">
    <div className="gr-farkle-scores"><span>You <b>{s.scores[0]}</b></span><span>This turn <b>{s.turnPoints}</b></span><span>Computer <b>{s.scores[1]}</b></span></div>
    <div className="gr-pig-track">{[0, 1].map(p => <div key={p}><i style={{ width: `${Math.min(100, s.scores[p])}%` }} /></div>)}</div>
    <div className="gr-dice-row is-big">{s.die ? <RolledDie value={s.die} roll={s.scores[0] * 7 + s.scores[1] * 3 + s.turnPoints + s.die} /> : <span className="gr-pig">🐷</span>}</div>
  </div>
}
function Liar({ state, moves, humanTurn, play, hidden }: BoardProps & { hidden: boolean }) {
  const s = state as LiarState, bids = moves.filter(m => m.count !== undefined)
  return <div className="gr-dice-table" data-testid="family-board">
    <div className="gr-cup"><small>Computer · {s.cups[1].length} dice</small><div className="gr-dice-row is-small">{s.cups[1].map((d, i) => hidden && !s.reveal ? <span key={i} className="gr-cup-hidden">?</span> : <RolledDie key={i} value={d} roll={0} held={!!s.bid && d === s.bid.face} />)}</div></div>
    <div className="gr-bid">{s.bid ? <>Bid: <b>{s.bid.count} × </b><RolledDie value={s.bid.face} roll={0} /></> : 'No bid yet'}</div>
    <div className="gr-cup is-mine"><small>Your cup · {s.cups[0].length} dice</small><div className="gr-dice-row is-small">{s.cups[0].map((d, i) => <RolledDie key={i} value={d} roll={s.cups[0].join('').length + i} held={!!s.bid && d === s.bid.face} />)}</div></div>
    {humanTurn && bids.length > 0 && !s.reveal && <div className="gr-bid-grid">{bids.map((m, i) => <button key={i} type="button" onClick={() => play(m, 'click')}>{m.count as number} × {['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][(m.face as number) - 1]}</button>)}</div>}
  </div>
}

/* ── Puzzles and party games ── */
function Nim({ state, moves, humanTurn, play }: BoardProps) {
  const s = state as NimState
  return <div className="gr-nim" data-testid="family-board">{s.heaps.map((size, heap) => <div key={heap} className={`gr-nim-heap ${s.last.includes(heap) ? 'is-last' : ''}`}><small>Heap {heap + 1}</small><div>{Array.from({ length: size }, (_, k) => { const take = find(moves, m => m.heap === heap && m.take === size - k); return <button key={k} type="button" className="gr-nim-stick" disabled={!humanTurn || !take} onClick={() => take && play(take, 'click')} aria-label={`Take ${size - k} from heap ${heap + 1}`} /> })}</div></div>)}<p className="gr-dice-hint">Click a stick: it and every stick to its right are taken.</p></div>
}
function CodeBreaker({ state, moves, play }: BoardProps) {
  const s = state as CodeState, over = s.winner !== undefined
  return <div className="gr-code" data-testid="family-board">
    <div className="gr-code-secret">{s.secret.map((c, i) => <i key={i} style={{ background: over ? CODE_COLORS[c] : '#2a2638' }}>{over ? '' : '?'}</i>)}</div>
    {Array.from({ length: 10 }, (_, row) => { const guess = s.guesses[row], draft = row === s.guesses.length ? s.draft : null; return <div key={row} className={`gr-code-row ${draft ? 'is-active' : ''}`}><span>{row + 1}</span>{Array.from({ length: 4 }, (_, k) => { const color = guess ? guess.pegs[k] : draft?.[k]; return <i key={k} style={{ background: color !== undefined ? CODE_COLORS[color] : undefined }} /> })}<b className="gr-code-pegs">{guess && [...Array(guess.exact).fill('exact'), ...Array(guess.near).fill('near')].map((kind, k) => <em key={k} className={kind} />)}</b></div> })}
    {!over && <div className="gr-code-palette">{CODE_COLORS.map((color, c) => { const add = find(moves, m => m.add === c); return <button key={c} type="button" disabled={!add} style={{ background: color }} onClick={() => add && play(add, 'tile')} aria-label={`Add colour ${c + 1}`} /> })}{find(moves, m => !!m.undo) && <button type="button" className="gr-control" onClick={() => play(find(moves, m => !!m.undo)!, 'click')}>Undo</button>}{find(moves, m => !!m.submit) && <button type="button" className="gr-control" onClick={() => play(find(moves, m => !!m.submit)!, 'coin')}>Check</button>}</div>}
  </div>
}
function Memory({ state, targets, humanTurn, click }: BoardProps) {
  const s = state as MemoryState, playable = new Set(targets.map(m => m.to))
  return <div className="gr-memory" data-testid="family-board">{s.cards.map((face, i) => { const up = s.matched[i] || s.open.includes(i); return <button key={i} type="button" className={`gr-memory-card ${up ? 'is-up' : ''} ${s.matched[i] ? 'is-matched' : ''}`} disabled={!humanTurn || !playable.has(i)} onClick={() => click(i)} aria-label={up ? MEMORY_FACES[face] : 'Hidden card'}><span className="gr-memory-back" /><span className="gr-memory-face">{MEMORY_FACES[face]}</span></button> })}</div>
}
function Hangman({ state, moves, play }: BoardProps) {
  const s = state as HangmanState, over = s.winner !== undefined
  const parts = [<line key="h" x1="60" y1="30" x2="60" y2="42" />, <circle key="head" cx="60" cy="50" r="8" />, <line key="b" x1="60" y1="58" x2="60" y2="82" />, <line key="la" x1="60" y1="64" x2="48" y2="74" />, <line key="ra" x1="60" y1="64" x2="72" y2="74" />, <line key="ll" x1="60" y1="82" x2="50" y2="98" />, <line key="rl" x1="60" y1="82" x2="70" y2="98" />]
  return <div className="gr-hangman" data-testid="family-board">
    <svg viewBox="0 0 100 110" className="gr-gallows"><path d="M10 105h60M25 105V20h35v10" fill="none" stroke="#c9944e" strokeWidth="4" strokeLinecap="round" /><g fill="none" stroke="#fbf7ec" strokeWidth="3" strokeLinecap="round">{parts.slice(0, s.misses)}</g></svg>
    <div className="gr-hang-word">{[...s.word].map((ch, i) => <span key={i} className={s.guessed.includes(ch) ? 'is-found' : over ? 'is-missed' : ''}>{s.guessed.includes(ch) || over ? ch : ''}</span>)}</div>
    <div className="gr-keys">{[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(letter => { const move = find(moves, m => m.letter === letter); return <button key={letter} type="button" disabled={!move} className={s.guessed.includes(letter) ? s.word.includes(letter) ? 'is-hit' : 'is-miss' : ''} onClick={() => move && play(move, s.word.includes(letter) ? 'coin' : 'error')}>{letter}</button> })}</div>
  </div>
}
function Sea({ state, targets, humanTurn, click, hidden }: BoardProps & { hidden: boolean }) {
  const s = state as SeaState, playable = new Set(targets.map(m => m.to)), sunk = [seaSunk(s.ships[0], s.shots[1]).flat(), seaSunk(s.ships[1], s.shots[0]).flat()]
  const grid = (owner: number, interactive: boolean) => <div className={`gr-sea ${interactive ? 'is-enemy' : ''}`}>{Array.from({ length: 100 }, (_, i) => {
    const shot = s.shots[1 - owner].includes(i), ship = s.ships[owner].some(cells => cells.includes(i)), showShip = ship && (owner === 0 || !hidden || s.winner !== undefined || sunk[1].includes(i))
    return <button key={i} type="button" disabled={!interactive || !humanTurn || !playable.has(i)} onClick={() => click(i)} className={`${showShip ? 'is-ship' : ''} ${shot ? ship ? 'is-hit' : 'is-miss' : ''} ${(owner === 0 ? sunk[0] : sunk[1]).includes(i) ? 'is-sunk' : ''} ${s.last.includes(i) && s.shots[1 - owner].includes(i) ? 'is-last' : ''}`} aria-label={`${owner ? 'Enemy' : 'Your'} square ${i + 1}`} />
  })}</div>
  return <div className="gr-sea-wrap" data-testid="family-board"><div><small>Enemy waters</small>{grid(1, true)}</div><div><small>Your fleet</small>{grid(0, false)}</div></div>
}
function Dots({ game, state, targets, humanTurn, click }: BoardProps) {
  const s = state as DotsState, playable = new Set(targets.map(m => m.to)), gap = 20, pad = 6
  const edge = (i: number) => i < 20 ? { x1: pad + (i % 4) * gap, y1: pad + Math.floor(i / 4) * gap, x2: pad + (i % 4 + 1) * gap, y2: pad + Math.floor(i / 4) * gap } : { x1: pad + ((i - 20) % 5) * gap, y1: pad + Math.floor((i - 20) / 5) * gap, x2: pad + ((i - 20) % 5) * gap, y2: pad + (Math.floor((i - 20) / 5) + 1) * gap }
  return <svg className="gr-dots" viewBox={`0 0 ${pad * 2 + gap * 4} ${pad * 2 + gap * 4}`} data-testid="family-board">
    {s.boxes.map((owner, b) => owner >= 0 && <rect key={b} x={pad + (b % 4) * gap + 1.5} y={pad + Math.floor(b / 4) * gap + 1.5} width={gap - 3} height={gap - 3} rx="2" fill={game.colors![owner]} opacity=".35" />)}
    {Array.from({ length: 40 }, (_, i) => { const e = edge(i), owner = s.edges[i]; return <g key={i} className={`gr-dot-edge ${humanTurn && playable.has(i) ? 'is-open' : ''} ${s.last.includes(i) ? 'is-last' : ''}`} onClick={() => humanTurn && playable.has(i) && click(i)}><line {...e} stroke="transparent" strokeWidth="5" /><line {...e} stroke={owner >= 0 ? game.colors![owner] : '#ffffff18'} strokeWidth={owner >= 0 ? 1.8 : 1} strokeLinecap="round" /></g> })}
    {Array.from({ length: DOTS * DOTS }, (_, k) => <circle key={k} cx={pad + (k % DOTS) * gap} cy={pad + Math.floor(k / DOTS) * gap} r="1.6" fill="#fbf7ec" />)}
  </svg>
}
