import React, { useEffect, useState } from 'react'
import { challengeCode, dailySeed, echoStep, newEcho, newOrbit, newQuake, orbitStep, parseChallenge, quakePick, quakeTick, type EchoDirection, type OriginalId, type QuakeRule } from '../../../../shared/games/originals'
import { GameButton, GameResult, GameStats, useGameKeys, type GameProps, useCounterSound, useEndSound } from './GameControls'
import './originals.css'

const NAMES = { echo: 'Echo Heist', orbit: 'Orbit Auction', rulequake: 'Rulequake' }
function localDate() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` }
function ChallengeRoom({ id, paused, onFinish }: GameProps & { id: OriginalId }) {
  const [seed, setSeed] = useState(() => dailySeed(id, localDate()))
  const [code, setCode] = useState(() => challengeCode(id, seed)), [started, setStarted] = useState(false)
  const [attempt, setAttempt] = useState(0), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [result, setResult] = useState<number | null>(null)
  const start = (next: number) => { setSeed(next); setCode(challengeCode(id, next)); setAttempt(value => value + 1); setStarted(true); setResult(null); setError(''); setNotice('') }
  const finish = (score: number) => { setResult(score); onFinish(score) }
  const copy = async () => {
    const text = `${NAMES[id]} · ${challengeCode(id, seed)}${result !== null ? ` · I scored ${result}. Can you beat it?` : ' · Play the same setup in AIHub Browser → Game room.'}`
    try { await navigator.clipboard.writeText(text); setNotice('Challenge copied. Send it to a friend who has AIHub Browser.') }
    catch { setNotice(`Copy this challenge code: ${challengeCode(id, seed)}`) }
  }
  return <div className="gr-original-room">
    <div className="gr-challenge-bar"><span className="gr-original-badge">AIHub Originals</span><strong>{challengeCode(id, seed)}</strong><GameButton disabled={paused} onClick={() => void copy()}>Copy challenge</GameButton></div>
    {!started ? <div className="gr-original-welcome"><h3>One setup. A thousand ways to play it.</h3><p>Start with today’s challenge, roll a fresh setup, or enter a friend’s code. Matching codes produce the same starting board and random sequence. Your choices decide the rest.</p><GameButton disabled={paused} onClick={() => start(seed)}>Start round</GameButton></div> : <div key={attempt}>{id === 'echo' ? <EchoGame paused={paused} onFinish={finish} seed={seed} /> : id === 'orbit' ? <OrbitGame paused={paused} onFinish={finish} seed={seed} /> : <QuakeGame paused={paused} onFinish={finish} seed={seed} />}</div>}
    <form className="gr-challenge-form" onSubmit={event => { event.preventDefault(); const parsed = parseChallenge(id, code); if (parsed === null) setError(`Enter a code such as ${challengeCode(id, 42)}.`); else start(parsed) }}>
      <label>Challenge code<input aria-label={`${NAMES[id]} challenge code`} maxLength={10} value={code} disabled={paused} onChange={event => setCode(event.target.value)} /></label><button className="gr-control" disabled={paused} type="submit">Play code</button><GameButton disabled={paused} onClick={() => start(dailySeed(id, localDate()))}>Today’s setup</GameButton><GameButton disabled={paused} onClick={() => start(crypto.getRandomValues(new Uint32Array(1))[0])}>Random setup</GameButton>
    </form>{error && <p role="alert" className="gr-import-error">{error}</p>}{notice && <p role="status" className="gr-challenge-note">{notice}</p>}
    <p className="gr-challenge-note">Scores stay on this computer. Challenges are friendly comparisons, without an online leaderboard. Rulequake scores also depend on reaction time.</p>
  </div>
}
export function EchoHeist(props: GameProps) { return <ChallengeRoom {...props} id="echo" /> }
export function OrbitAuction(props: GameProps) { return <ChallengeRoom {...props} id="orbit" /> }
export function Rulequake(props: GameProps) { return <ChallengeRoom {...props} id="rulequake" /> }
function useResult(over: boolean, score: number, onFinish: GameProps['onFinish']) {
  useCounterSound(score, 'coin'); useEndSound(over, score > 0)
  // Report on the transition, not whenever the parent renders a new callback.
  useEffect(() => { if (over) onFinish(score) }, [over, score])
}
function EchoGame({ seed, paused, onFinish }: GameProps & { seed: number }) {
  const [state, setState] = useState(() => newEcho(seed))
  const move = (direction: EchoDirection) => { if (!paused) setState(value => echoStep(value, direction)) }
  useGameKeys(key => { const directions: Record<string, EchoDirection> = { ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down', ArrowLeft: 'left' }; if (directions[key]) move(directions[key]) }, paused || state.over)
  useResult(state.over, state.score, onFinish); useCounterSound(state.hearts, null, 'buzz'); useCounterSound(state.turn, 'step')
  const echo = state.trail.length === 4 ? state.trail[0] : -1
  const nextEcho = state.trail.length >= 3 ? state.trail[state.trail.length - 3] : -1
  return <div className="gr-play-layout"><div className="gr-echo-board" role="img" aria-label={`Echo Heist board. Player at row ${Math.floor(state.player / 7) + 1}, column ${state.player % 7 + 1}`} data-testid="echo-board">{Array.from({ length: 49 }, (_, cell) => <div key={cell} className={`gr-echo-cell ${state.player === cell ? 'is-player' : ''} ${echo === cell ? 'is-echo' : ''} ${nextEcho === cell ? 'is-warning' : ''}`}><span>{state.player === cell ? '◆' : echo === cell ? '◈' : state.crystals.includes(cell) ? '✦' : ''}</span>{nextEcho === cell && <small>next</small>}</div>)}</div><aside className="gr-game-aside"><GameStats items={[["Score", state.score], ['Moves left', 36 - state.turn], ['Hearts', state.hearts]]} /><h3>Outrun your own decisions.</h3><p>Arrows move the blue diamond. Collect stars for 100 points. Your pink echo replays your position four moves later. Colliding costs a heart and 150 points. The dashed cell marks where the echo lands next.</p><div className="gr-direction-pad">{(['up', 'left', 'down', 'right'] as EchoDirection[]).map(direction => <GameButton key={direction} label={`Heist ${direction}`} disabled={paused || state.over} onClick={() => move(direction)}>{{ up: '↑', left: '←', down: '↓', right: '→' }[direction]}</GameButton>)}</div><p role="status">{state.message}</p>{state.over && <GameResult title={state.hearts ? 'Heist complete' : 'Your past caught you'} text={`${state.score} points. Copy your challenge above.`} />}</aside></div>
}
function OrbitGame({ seed, paused, onFinish }: GameProps & { seed: number }) {
  const [state, setState] = useState(() => newOrbit(seed))
  const act = (action: 'coast' | 'reverse' | 'bank') => { if (!paused) setState(value => orbitStep(value, action)) }
  useGameKeys(key => { if (key === 'ArrowLeft') act('reverse'); if (key === 'ArrowRight' || key === ' ') act('coast'); if (key === 'ArrowDown') act('bank') }, paused || state.over)
  useResult(state.over, state.score, onFinish); useCounterSound(state.shields, null, 'buzz'); useCounterSound(state.cargo, 'coin'); useCounterSound(state.turn, 'step')
  const point = (slot: number, radius = 118) => ({ x: 160 + Math.sin(slot * Math.PI / 6) * radius, y: 160 - Math.cos(slot * Math.PI / 6) * radius })
  return <div className="gr-play-layout"><svg className="gr-orbit-board" viewBox="0 0 320 320" role="img" aria-label={`Orbit Auction. Ship at ${state.player + 1}, storm at ${state.hazard + 1}, cargo ${state.cargo}`}><circle cx="160" cy="160" r="118" fill="none" stroke="#ffffff20" strokeWidth="2" />{Array.from({ length: 12 }, (_, slot) => { const { x, y } = point(slot); return <g key={slot}><circle cx={x} cy={y} r="19" fill={slot === state.hazard ? '#813b59' : '#203149'} stroke={slot === state.player ? '#6ed5ae' : '#ffffff30'} strokeWidth="2" /><text x={x} y={y + 6} textAnchor="middle" fill={slot === state.hazard ? '#ffacbb' : '#f5cc68'} fontSize="22">{slot === state.player ? '◆' : slot === state.hazard ? '☄' : state.stars.includes(slot) ? '✦' : ''}</text><text x={point(slot, 147).x} y={point(slot, 147).y + 4} textAnchor="middle" fill="#a9b7cb" fontSize="10">{slot + 1}</text></g> })}<text x="160" y="140" textAnchor="middle" fill="#6ed5ae" fontSize="12">UNBANKED CARGO</text><text x="160" y="179" textAnchor="middle" fill="#fff" fontWeight="700" fontSize="34">{state.cargo}</text><text x="160" y="205" textAnchor="middle" fill="#a9b7cb" fontSize="12">{state.direction === 1 ? 'Clockwise ↻' : 'Counterclockwise ↺'}</text></svg><aside className="gr-game-aside"><GameStats items={[["Beats left", 24 - state.turn], ['Reversals', state.fuel], ['Shields', state.shields]]} /><h3>How much is one more orbit worth?</h3><p>Each move advances your ship and the storm in opposite directions. Stars drift clockwise every third beat. Reverse spends one of six fuel charges. A storm collision halves your cargo and removes a shield.</p><p>Bank any time to keep everything. Run out of beats or shields and only half is rescued. Take your time: this game waits for your move.</p><div className="gr-original-actions"><GameButton disabled={paused || state.over} onClick={() => act('coast')}>Coast →</GameButton><GameButton disabled={paused || state.over || !state.fuel} onClick={() => act('reverse')}>Reverse ←</GameButton><GameButton disabled={paused || state.over} onClick={() => act('bank')}>Bank cargo ↓</GameButton></div><p role="status">{state.message}</p>{state.over && <GameResult title="Auction closed" text={`${state.score} points secured.`} />}</aside></div>
}
const COLORS = ['Gold', 'Mint', 'Lilac'], SHAPES = ['circle', 'triangle', 'diamond'], SYMBOLS = ['●', '▲', '◆']
function ruleText(rule: QuakeRule) { return rule.kind === 'and' ? `${COLORS[rule.color]} AND ${SHAPES[rule.shape]}` : rule.kind === 'xor' ? `${COLORS[rule.color]} OR ${SHAPES[rule.shape]} — but NOT both` : `NOT ${SHAPES[rule.shape]} AND an ${rule.even ? 'even' : 'odd'} number` }
function QuakeGame({ seed, paused, onFinish }: GameProps & { seed: number }) {
  const [state, setState] = useState(() => newQuake(seed))
  useEffect(() => { if (paused || state.over) return; const timer = setInterval(() => setState(quakeTick), 100); return () => clearInterval(timer) }, [paused, state.over])
  useResult(state.over, state.score, onFinish); useCounterSound(state.hearts, null, 'error')
  return <div className="gr-quake-layout"><div><GameStats items={[["Score", state.score], ['Seconds', (state.remaining / 10).toFixed(1)], ['Hearts', state.hearts], ['Streak', state.combo]]} /><div className="gr-quake-rule" aria-live="polite"><small>THE CURRENT RULE</small><strong>{ruleText(state.rule)}</strong></div><div className="gr-quake-board" role="group" aria-label="Rulequake tiles">{state.board.map((tile, index) => <button key={index} className="gr-quake-tile" style={{ '--tile-color': ['#f5cc68', '#6ed5ae', '#c4afff'][tile.color] } as React.CSSProperties} disabled={paused || state.over} aria-label={`${COLORS[tile.color]} ${SHAPES[tile.shape]} ${tile.value}, tile ${index + 1}`} onClick={() => setState(value => quakePick(value, index))}><span aria-hidden="true">{SYMBOLS[tile.shape]}</span><strong>{tile.value}</strong><small>{COLORS[tile.color]}</small></button>)}</div></div><aside className="gr-game-aside"><h3>Trust the rule. Not the reflex.</h3><p>Pick any tile that matches the rule above the board. Every pick replaces the board and changes the rule: AND, exclusive OR, then NOT with odd/even numbers.</p><p>Correct picks build a streak bonus. Wrong picks cost a heart and four seconds. You have 45 seconds and three hearts. Keyboard: Tab to a tile, then Enter or Space.</p><p role="status">{state.message}</p>{state.over && <GameResult title="Quake settled" text={`${state.score} points across ${state.round} decisions.`} />}</aside></div>
}
