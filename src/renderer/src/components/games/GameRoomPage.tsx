import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Gamepad2, HardDrive, Pause, Play, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { BUILTIN_GAMES, CLASSIC_GAMES, ROM_SYSTEMS, MAX_GAME_LIBRARY_BYTES, MAX_GAME_LIBRARY_COUNT, type BuiltinGameId, type RomSystem } from '../../../../shared/games/catalog'
import { listRomGames, prepareRom, readRomFiles, removeRomGame, saveRomGame, type RomFiles, type RomGame } from '../../services/gameLibrary'
import { IS_INCOGNITO } from '../../services/incognitoMode'
import GameArtwork from './GameArtwork'
import './game-room.css'
const BlocksGame = lazy(() => import('./BlocksGame'))
const SolitaireGame = lazy(() => import('./SolitaireGame'))
const PropertyGame = lazy(() => import('./PropertyGame'))
const SnakeGame = lazy(() => import('./ArcadeGames').then(module => ({ default: module.SnakeGame })))
const MazeGame = lazy(() => import('./ArcadeGames').then(module => ({ default: module.MazeGame })))
const MergeGame = lazy(() => import('./ArcadeGames').then(module => ({ default: module.MergeGame })))
const RomPlayer = lazy(() => import('./RomPlayer'))
const COMPONENTS = { blocks: BlocksGame, solitaire: SolitaireGame, property: PropertyGame, snake: SnakeGame, maze: MazeGame, '2048': MergeGame }
type Selection = { kind: 'builtin'; id: BuiltinGameId } | { kind: 'rom'; game: RomGame; files: RomFiles }
const SCORE_KEY = 'aihub-game-room-scores-v1'
function loadScores(): Record<string, number> {
  if (IS_INCOGNITO) return {}
  try {
    const stored = JSON.parse(localStorage.getItem(SCORE_KEY) || '{}')
    return Object.fromEntries(BUILTIN_GAMES.map(game => [game.id, typeof stored[game.id] === 'number' && Number.isFinite(stored[game.id]) ? Math.min(1e9, Math.max(0, stored[game.id])) : 0]))
  } catch { return {} }
}
export default function GameRoomPage({ active }: { active: boolean }) {
  const [selection, setSelection] = useState<Selection | null>(null), [round, setRound] = useState(0)
  const [manualPause, setManualPause] = useState(false), [hidden, setHidden] = useState(document.hidden)
  const [category, setCategory] = useState('All games'), [query, setQuery] = useState('')
  const [library, setLibrary] = useState<RomGame[]>([]), [scores, setScores] = useState(loadScores)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState<{ title: string; system: RomSystem } | null>(null)
  const [romFile, setRomFile] = useState<File | null>(null), [biosFile, setBiosFile] = useState<File | null>(null)
  const privateFiles = useRef(new Map<string, RomFiles>())
  const paused = manualPause || !active || hidden || !!importing
  useEffect(() => { if (!IS_INCOGNITO) void listRomGames().then(setLibrary).catch(error => setError(error.message)) }, [])
  useEffect(() => {
    const change = () => { setHidden(document.hidden); if (document.hidden) setManualPause(true) }
    document.addEventListener('visibilitychange', change); return () => document.removeEventListener('visibilitychange', change)
  }, [])
  useEffect(() => { if (!active && selection) setManualPause(true) }, [active])
  useEffect(() => {
    if (!active || !selection || importing) return
    const handler = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'p' && !event.ctrlKey && !event.metaKey && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); setManualPause(value => !value) }
    }
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler)
  }, [active, selection, importing])
  const onFinish = useCallback((score: number) => {
    if (selection?.kind !== 'builtin' || !Number.isFinite(score)) return
    setScores(previous => {
      const next = { ...previous, [selection.id]: Math.max(previous[selection.id] || 0, Math.min(1e9, Math.floor(score))) }
      if (!IS_INCOGNITO) try { localStorage.setItem(SCORE_KEY, JSON.stringify(next)) } catch { /* A full profile still permits play. */ }
      return next
    })
  }, [selection?.kind === 'builtin' ? selection.id : null])
  const playBuiltin = (id: BuiltinGameId) => { setSelection({ kind: 'builtin', id }); setManualPause(false); setError(''); setRound(value => value + 1) }
  const playRom = async (game: RomGame) => {
    setBusy(true); setError('')
    try {
      const files = IS_INCOGNITO ? privateFiles.current.get(game.id) : await readRomFiles(game.id)
      if (!files) throw Error('Import this game again to play it.')
      setSelection({ kind: 'rom', game, files }); setManualPause(false); setRound(value => value + 1)
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not open this game.') }
    finally { setBusy(false) }
  }
  const openImport = (title = '', system: RomSystem = 'nes') => { setImporting({ title, system }); setRomFile(null); setBiosFile(null); setError('') }
  const importGame = async (event: React.FormEvent) => {
    event.preventDefault(); if (!importing || !romFile || busy) return
    setBusy(true); setError('')
    try {
      const prepared = await prepareRom(romFile, importing.title, importing.system, biosFile || undefined)
      if (IS_INCOGNITO) {
        const others = library.filter(game => game.id !== prepared.info.id)
        if (others.length >= MAX_GAME_LIBRARY_COUNT || others.reduce((total, game) => total + game.size, 0) + prepared.info.size > MAX_GAME_LIBRARY_BYTES) throw Error('This private room is limited to 40 games and 256 MB. Remove a game before adding another.')
        privateFiles.current.set(prepared.info.id, prepared.files)
      }
      else await saveRomGame(prepared.info, prepared.files)
      setLibrary(previous => [prepared.info, ...previous.filter(game => game.id !== prepared.info.id)])
      setImporting(null); setSelection({ kind: 'rom', game: prepared.info, files: prepared.files }); setManualPause(false); setRound(value => value + 1)
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not import this game.') }
    finally { setBusy(false) }
  }
  const title = selection?.kind === 'builtin' ? BUILTIN_GAMES.find(game => game.id === selection.id)?.title : selection?.game.title
  const matches = (text: string) => text.toLowerCase().includes(query.toLowerCase().trim())
  const builtins = BUILTIN_GAMES.filter(game => (category === 'All games' || category === 'Play offline' || category === game.genre) && matches(`${game.title} ${game.aliases} ${game.genre}`))
  const classics = CLASSIC_GAMES.filter(game => (category === 'All games' || category === 'Classics') && matches(`${game.title} ${game.genre}`))
  const imported = library.filter(game => (category === 'All games' || category === 'My games') && matches(game.title))
  const ActiveGame = selection?.kind === 'builtin' ? COMPONENTS[selection.id] : null
  return <div className="game-room">
    <header className="gr-header"><div className="gr-heading"><span className="gr-room-icon"><Gamepad2 size={24} /></span><div><h1>Game room</h1><p>{selection ? 'A good place for one more round.' : 'Quick games. Quiet card tables. Your own classics.'}</p></div></div><button className="gr-control" onClick={() => openImport()}><Plus size={15} />Add a game</button></header>
    {error && !importing && <div role="alert" className="gr-alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button></div>}
    {selection ? <main className="gr-player-area"><div className="gr-player-toolbar"><button className="gr-back" onClick={() => setSelection(null)}><ArrowLeft size={15} />Library</button><h2>{title}</h2><div className="gr-player-tools"><button className="gr-control" onClick={() => setManualPause(value => !value)}>{manualPause ? <Play size={14} /> : <Pause size={14} />}{manualPause ? 'Resume' : 'Pause'}</button><button className="gr-control" onClick={() => { setRound(value => value + 1); setManualPause(false) }}><RotateCcw size={14} />New game</button></div></div><div className={`gr-game-surface ${selection.kind === 'rom' ? 'is-rom' : ''}`}><Suspense fallback={<p className="gr-loading">Setting up your game…</p>}><div key={`${selection.kind === 'builtin' ? selection.id : selection.game.id}-${round}`} className="gr-game-content">{ActiveGame && <ActiveGame paused={paused} onFinish={onFinish} />}{selection.kind === 'rom' && <RomPlayer game={selection.game} files={selection.files} paused={paused} />}</div></Suspense>{manualPause && <div className="gr-pause-cover"><Pause size={26} /><h3>Take your time.</h3><p>Your game is paused.</p><button className="gr-control" onClick={() => setManualPause(false)}><Play size={15} />Resume game</button></div>}</div><p className="gr-session-note">P pauses built-in games. Switching browser tabs pauses play. {IS_INCOGNITO ? 'This room and its imported files disappear when the private window closes.' : 'Best scores and imported games are saved on this computer.'}</p></main>
    : <main className="gr-library"><div className="gr-library-intro"><div><h2>What are we playing?</h2><p>Six games ready now. Room for the classics you bring.</p></div><label className="gr-search"><Search size={15} /><input aria-label="Search games" placeholder="Find your next game…" value={query} onChange={event => setQuery(event.target.value)} /></label></div><nav className="gr-filters" aria-label="Game categories">{['All games', 'Play offline', 'Puzzle', 'Arcade', 'Cards', 'Board', 'Classics', 'My games'].map(item => <button key={item} aria-pressed={category === item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}{item === 'My games' && library.length ? ` (${library.length})` : ''}</button>)}</nav>
      {builtins.length > 0 && <section aria-label="Offline games"><div className="gr-section-heading"><h3>Ready to play</h3><span>No downloads. No account. Just play.</span></div><div className="gr-game-grid">{builtins.map(game => <button key={game.id} className="gr-game-tile" style={{ '--game-color': game.color } as React.CSSProperties} onClick={() => playBuiltin(game.id)} aria-label={`Play ${game.title}`}><div className="gr-tile-art"><GameArtwork id={game.id} color={game.color} /><span className="gr-play-mark"><Play size={17} fill="currentColor" /></span></div><div className="gr-tile-copy"><div className="gr-tile-meta"><span>{game.genre}</span><span>{game.players}</span></div><h4>{game.title}</h4><p>{game.description}</p><small>{scores[game.id] ? `Best score ${scores[game.id].toLocaleString()}` : 'Play offline'}</small></div></button>)}</div></section>}
      {imported.length > 0 && <section aria-label="Imported games"><div className="gr-section-heading"><h3>Your collection</h3><span><HardDrive size={13} />{library.length} imported {library.length === 1 ? 'game' : 'games'}</span></div><div className="gr-game-grid">{imported.map(game => <article key={game.id} className="gr-game-tile gr-imported-tile"><button className="gr-imported-play" disabled={busy} onClick={() => void playRom(game)} aria-label={`Play ${game.title}`}><div className="gr-tile-art"><GameArtwork id="rom" color="#6eb6ff" /><span className="gr-play-mark"><Play size={17} fill="currentColor" /></span></div><div className="gr-tile-copy"><div className="gr-tile-meta">{ROM_SYSTEMS.find(system => system.id === game.system)?.label}</div><h4>{game.title}</h4><p>{(game.size / 1024 / 1024).toFixed(1)} MB on this computer</p></div></button><button className="gr-remove-game" aria-label={`Remove ${game.title} from library`} disabled={busy} onClick={async () => { try { if (IS_INCOGNITO) privateFiles.current.delete(game.id); else await removeRomGame(game.id); setLibrary(previous => previous.filter(item => item.id !== game.id)) } catch { setError('Could not remove this game. Try again.') } }}><Trash2 size={14} /></button></article>)}</div></section>}
      {classics.length > 0 && <section aria-label="Classic games"><div className="gr-section-heading"><h3>Bring back a favorite</h3><span>Import a game file you own to play these titles.</span></div><div className="gr-classics-grid">{classics.map(game => { const existing = library.find(item => item.title === game.title); return <button key={game.title} className="gr-classic" onClick={() => existing ? void playRom(existing) : openImport(game.title, game.system)} disabled={busy}><span className="gr-classic-icon" style={{ color: game.color }}><Gamepad2 size={22} /></span><span><strong>{game.title}</strong><small>{game.genre} · {ROM_SYSTEMS.find(system => system.id === game.system)?.label}</small></span><span className="gr-classic-action">{existing ? 'Play' : 'Add game'}{existing ? <Play size={13} /> : <Plus size={13} />}</span></button> })}</div></section>}
      {!builtins.length && !classics.length && !imported.length && <div className="gr-empty"><Gamepad2 size={34} /><h3>{category === 'My games' ? 'Your collection starts here' : 'No game found'}</h3><p>{category === 'My games' ? 'Add a supported game file to keep it in your room.' : 'Try another name or category.'}</p>{category === 'My games' && <button className="gr-control" onClick={() => openImport()}>Add your first game</button>}</div>}
      <footer className="gr-footer">Built-in games are original implementations. Named commercial classics require your own game files. Imported games use EmulatorJS; the emulator downloads when you launch a game and requires an internet connection.</footer>
    </main>}
    {importing && <div className="gr-modal-backdrop" onKeyDown={event => { if (event.key === 'Escape' && !busy) setImporting(null) }}><form className="gr-import-modal" role="dialog" aria-modal="true" aria-labelledby="gr-import-title" onSubmit={importGame}><header><h2 id="gr-import-title">Bring a game to your room</h2><button type="button" className="gr-close" aria-label="Close game import" disabled={busy} onClick={() => setImporting(null)}><X size={19} /></button></header><p>Choose a game file you own. The file is stored locally{IS_INCOGNITO ? ' for this private session' : ' on this computer'}; the browser does not upload it.</p><label>Game name<input autoFocus value={importing.title} maxLength={100} placeholder="Use the game’s title, or leave blank for its filename" onChange={event => setImporting({ ...importing, title: event.target.value })} /></label><label>System<select value={importing.system} onChange={event => { setImporting({ ...importing, system: event.target.value as RomSystem }); setRomFile(null) }}>{ROM_SYSTEMS.map(system => <option key={system.id} value={system.id}>{system.label}</option>)}</select></label><label>Game file <small>Up to 64 MB</small><input key={importing.system} type="file" aria-label="Game file" accept={ROM_SYSTEMS.find(system => system.id === importing.system)!.extensions.map(extension => '.' + extension).join(',') + ',.zip'} onChange={event => setRomFile(event.target.files?.[0] || null)} /></label><details><summary>Optional BIOS file</summary><p>Some arcade games need a compatible BIOS or ROM set. Console versions of the named classics are often simpler to set up.</p><input type="file" aria-label="Optional BIOS file" accept=".bin,.rom,.bios,.zip" onChange={event => setBiosFile(event.target.files?.[0] || null)} /></details>{error && <p className="gr-import-error" role="alert">{error}</p>}<button type="submit" className="gr-import-submit" disabled={!romFile || busy}>{busy ? 'Adding your game…' : 'Add and play'}<Play size={15} /></button></form></div>}
  </div>
}
