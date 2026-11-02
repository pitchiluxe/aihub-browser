import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, FolderOpen, Gamepad2, HardDrive, Pause, Play, Plus, RotateCcw, Search, Volume2, VolumeX, X } from 'lucide-react'
import { BUILTIN_GAMES, CLASSIC_GAMES, ROM_SYSTEMS, MAX_GAME_LIBRARY_BYTES, MAX_GAME_LIBRARY_COUNT, MAX_ROM_BYTES, type BuiltinGameId, type RomSystem } from '../../../../shared/games/catalog'
import { cleanRomTitle, detectRomSystem } from '../../../../shared/games/romFolder'
import { listRomGames, prepareRom, readRomFiles, removeRomGame, saveRomGame, type RomFiles, type RomGame } from '../../services/gameLibrary'
import { IS_INCOGNITO } from '../../services/incognitoMode'
import { ArcadeCabinet, BoardGameBox, Cartridge, WantedCard } from './RoomScene'
import { FAMILY_GAMES, familyGame } from '../../../../shared/games/family/index'
import { isMuted, onMuteChange, playSound, setMuted } from './sounds'
import './game-room.css'
import './game-room-scene.css'
const BlocksGame = lazy(() => import('./BlocksGame'))
const SolitaireGame = lazy(() => import('./SolitaireGame'))
const PropertyGame = lazy(() => import('./PropertyGame'))
const SnakeGame = lazy(() => import('./ArcadeGames').then(module => ({ default: module.SnakeGame })))
const MazeGame = lazy(() => import('./ArcadeGames').then(module => ({ default: module.MazeGame })))
const MergeGame = lazy(() => import('./ArcadeGames').then(module => ({ default: module.MergeGame })))
const RomPlayer = lazy(() => import('./RomPlayer'))
const EchoHeist = lazy(() => import('./OriginalGames').then(module => ({ default: module.EchoHeist })))
const OrbitAuction = lazy(() => import('./OriginalGames').then(module => ({ default: module.OrbitAuction })))
const Rulequake = lazy(() => import('./OriginalGames').then(module => ({ default: module.Rulequake })))
const CheckersGame = lazy(() => import('./DraughtsGame').then(module => ({ default: module.CheckersGame })))
const DamesGame = lazy(() => import('./DraughtsGame').then(module => ({ default: module.DamesGame })))
const LudoGame = lazy(() => import('./LudoGame'))
const DominoesGame = lazy(() => import('./DominoesGame'))
const CardRoom = lazy(() => import('./CardRoom'))
const PoolGame = lazy(() => import('./PoolGame'))
const PinballGame = lazy(() => import('./PinballGame'))
const CrosswordGame = lazy(() => import('./CrosswordGame'))
const WordTilesGame = lazy(() => import('./WordTilesGame'))
const JigsawGame = lazy(() => import('./JigsawGame'))
const FamilyTable = lazy(() => import('./FamilyTable'))
const COMPONENTS = { blocks: BlocksGame, solitaire: SolitaireGame, property: PropertyGame, snake: SnakeGame, maze: MazeGame, '2048': MergeGame, echo: EchoHeist, orbit: OrbitAuction, rulequake: Rulequake, checkers: CheckersGame, dames: DamesGame, ludo: LudoGame, dominoes: DominoesGame, cards: CardRoom, pool: PoolGame, pinball: PinballGame, crossword: CrosswordGame, wordtiles: WordTilesGame, jigsaw: JigsawGame }
const HOW_TO_KEY = 'aihub-game-room-howto-seen-v1'
// Bulbs around the neon sign, clockwise from the top-left corner, as [left %, top %].
const MARQUEE_BULBS: [number, number][] = [...Array.from({ length: 10 }, (_, i) => [i * 11, 0]), ...Array.from({ length: 3 }, (_, i) => [100, 25 + i * 25]), ...Array.from({ length: 10 }, (_, i) => [99 - i * 11, 100]), ...Array.from({ length: 3 }, (_, i) => [0, 75 - i * 25])] as [number, number][]
function readSeenHowTo(): string[] {
  if (IS_INCOGNITO) return []
  try { const stored = JSON.parse(localStorage.getItem(HOW_TO_KEY) || '[]'); return Array.isArray(stored) ? stored.filter(item => typeof item === 'string') : [] } catch { return [] }
}
type Selection = { kind: 'builtin'; id: BuiltinGameId } | { kind: 'family'; id: string } | { kind: 'rom'; game: RomGame; files: RomFiles }
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
  const [notice, setNotice] = useState(''), [progress, setProgress] = useState(''), [entering, setEntering] = useState(true)
  const privateFiles = useRef(new Map<string, RomFiles>()), folderInput = useRef<HTMLInputElement>(null)
  const [seenHowTo, setSeenHowTo] = useState(readSeenHowTo), [muted, setMutedState] = useState(isMuted)
  useEffect(() => onMuteChange(setMutedState), [])
  const markHowToSeen = (id: string) => setSeenHowTo(previous => {
    if (previous.includes(id)) return previous
    const next = [...previous, id]
    if (!IS_INCOGNITO) try { localStorage.setItem(HOW_TO_KEY, JSON.stringify(next)) } catch { /* Instructions simply reopen next time. */ }
    return next
  })
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
      await storeGame(prepared, library)
      setLibrary(previous => [prepared.info, ...previous.filter(game => game.id !== prepared.info.id)])
      setImporting(null); setSelection({ kind: 'rom', game: prepared.info, files: prepared.files }); setManualPause(false); setRound(value => value + 1)
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not import this game.') }
    finally { setBusy(false) }
  }
  const storeGame = async (prepared: { info: RomGame; files: RomFiles }, current: RomGame[]) => {
    if (!IS_INCOGNITO) return saveRomGame(prepared.info, prepared.files)
    const others = current.filter(game => game.id !== prepared.info.id)
    if (others.length >= MAX_GAME_LIBRARY_COUNT || others.reduce((total, game) => total + game.size, 0) + prepared.info.size > MAX_GAME_LIBRARY_BYTES) throw Error(`This private room is limited to ${MAX_GAME_LIBRARY_COUNT} games and 256 MB. Remove a game before adding another.`)
    privateFiles.current.set(prepared.info.id, prepared.files)
  }
  const importFolder = async (list: FileList | null) => {
    const files = [...(list || [])]
    if (folderInput.current) folderInput.current.value = ''
    if (!files.length || busy) return
    setBusy(true); setError(''); setNotice('')
    let current = library, added = 0, already = 0, skipped = 0, failure = ''
    for (const [index, file] of files.entries()) {
      setProgress(`Stocking the shelves… ${index + 1} of ${files.length}`)
      try {
        if (file.size > MAX_ROM_BYTES || !detectRomSystem(file.name, new Uint8Array(0)) && !/\.zip$/i.test(file.name)) { skipped++; continue }
        const detected = detectRomSystem(file.name, new Uint8Array(await file.arrayBuffer()))
        if (!detected) { skipped++; continue }
        const prepared = await prepareRom(file, cleanRomTitle(detected.innerName), detected.system)
        if (current.some(game => game.id === prepared.info.id)) { already++; continue }
        await storeGame(prepared, current)
        current = [prepared.info, ...current]; added++; setLibrary(current)
      } catch (error) {
        failure = error instanceof Error ? error.message : 'A game could not be added.'
        if (/limited to/.test(failure)) break
        skipped++
      }
    }
    setProgress(''); setBusy(false)
    const parts = [`${added} ${added === 1 ? 'game' : 'games'} added to your shelves`, already && `${already} already there`, skipped && `${skipped} skipped (not a console game file)`].filter(Boolean)
    if (failure && /limited to/.test(failure)) setError(failure)
    setNotice(parts.join(' · ') + '.')
  }
  const title = selection?.kind === 'builtin' ? BUILTIN_GAMES.find(game => game.id === selection.id)?.title : selection?.kind === 'family' ? familyGame(selection.id)?.game.title : selection?.game.title
  const playFamily = (id: string) => { setSelection({ kind: 'family', id }); setManualPause(false); setError(''); setRound(value => value + 1) }
  const matches = (text: string) => text.toLowerCase().includes(query.toLowerCase().trim())
  const family = FAMILY_GAMES.filter(item => (category === 'All games' || category === 'Play offline' || category === 'Family' || category === 'Board' && item.shelf !== 'Dice' && item.shelf !== 'Puzzles & party') && matches(`${item.game.title} ${item.shelf} ${item.blurb}`))
  const builtins = BUILTIN_GAMES.filter(game => (category === 'All games' || category === 'Play offline' || category === game.genre) && matches(`${game.title} ${game.aliases} ${game.genre}`))
  const classics = CLASSIC_GAMES.filter(game => (category === 'All games' || category === 'Classics') && matches(`${game.title} ${game.genre}`))
  const imported = library.filter(game => (category === 'All games' || category === 'My games') && matches(game.title)).sort((a, b) => a.title.localeCompare(b.title))
  const remove = async (game: RomGame) => { try { if (IS_INCOGNITO) privateFiles.current.delete(game.id); else await removeRomGame(game.id); setLibrary(previous => previous.filter(item => item.id !== game.id)) } catch { setError('Could not remove this game. Try again.') } }
  const folderButton = <button className="gr-control" disabled={busy} onClick={() => folderInput.current?.click()}><FolderOpen size={15} />Stock from a folder</button>
  const ActiveGame = selection?.kind === 'builtin' ? COMPONENTS[selection.id] : null
  return <div className={`game-room ${selection ? 'is-playing' : ''}`}>
    <div className="gr-room-backdrop" aria-hidden="true"><i className="gr-ceiling-light" /><i className="gr-ceiling-light" /><i className="gr-ceiling-light" /><i className="gr-floor" /><i className="gr-floor-glow" /><span className="gr-spots">{Array.from({ length: 5 }, (_, i) => <i key={i} className={`gr-spot spot-${i}`} />)}</span><i className="gr-haze" /><span className="gr-truss">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span></div>
    {entering && <div className="gr-doors" aria-hidden="true" onAnimationEnd={event => { if (event.target === event.currentTarget) setEntering(false) }}><i /><i /></div>}
    <header className="gr-header"><div className="gr-heading"><span className="gr-sign-marquee"><h1 className="gr-neon" data-text="Game room">Game room</h1>{MARQUEE_BULBS.map(([x, y], i) => <i key={i} className="gr-sign-bulb" style={{ left: `${x}%`, top: `${y}%`, '--n': i } as React.CSSProperties} />)}</span><p>{selection ? 'A good place for one more round.' : 'Pull up a stool. The machines are warm.'}</p></div><div className="gr-header-tools">{folderButton}<button className="gr-control is-primary" onClick={() => openImport()}><Plus size={15} />Add a game</button></div></header>
    <input ref={folderInput} type="file" hidden multiple aria-label="Game folder" {...{ webkitdirectory: '' } as React.InputHTMLAttributes<HTMLInputElement>} onChange={event => void importFolder(event.target.files)} />
    {(progress || notice) && !importing && <div role="status" className="gr-alert is-notice">{progress || notice}{!progress && <button aria-label="Dismiss message" onClick={() => setNotice('')}><X size={15} /></button>}</div>}
    {error && !importing && <div role="alert" className="gr-alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button></div>}
    {selection ? <main className="gr-player-area"><div className="gr-player-toolbar"><button className="gr-back" onClick={() => setSelection(null)}><ArrowLeft size={15} />Back to the room</button><h2>{title}</h2><div className="gr-player-tools"><button className="gr-control" aria-pressed={muted} aria-label={muted ? 'Turn game sounds on' : 'Mute game sounds'} onClick={() => { setMuted(!muted); if (muted) playSound('click') }}>{muted ? <VolumeX size={14} /> : <Volume2 size={14} />}{muted ? 'Sound off' : 'Sound on'}</button><button className="gr-control" onClick={() => setManualPause(value => !value)}>{manualPause ? <Play size={14} /> : <Pause size={14} />}{manualPause ? 'Resume' : 'Pause'}</button><button className="gr-control" onClick={() => { setRound(value => value + 1); setManualPause(false) }}><RotateCcw size={14} />New game</button></div></div>
      {selection.kind === 'builtin' && (() => { const info = BUILTIN_GAMES.find(game => game.id === selection.id)!; return <details key={info.id} className="gr-howto" open={!seenHowTo.includes(info.id)} onToggle={event => { if (!event.currentTarget.open) markHowToSeen(info.id) }}><summary>How to play {info.title}</summary><div><p className="gr-howto-goal"><strong>Goal</strong>{info.goal}</p><ol>{info.howTo.map(step => <li key={step}>{step}</li>)}</ol><button type="button" className="gr-control" onClick={event => { (event.currentTarget.closest('details') as HTMLDetailsElement).open = false }}>Got it — let’s play</button></div></details> })()}
      <div className={`gr-stage ${selection.kind === 'rom' ? 'is-tv' : 'is-table'}`}>{selection.kind === 'rom' && <div className="gr-tv-top" aria-hidden="true"><i /><i /></div>}<div className={`gr-game-surface ${selection.kind === 'rom' ? 'is-rom' : ''}`}><Suspense fallback={<p className="gr-loading">Setting up your game…</p>}><div key={`${selection.kind === 'rom' ? selection.game.id : selection.id}-${round}`} className="gr-game-content">{ActiveGame && <ActiveGame paused={paused} onFinish={onFinish} />}{selection.kind === 'family' && <FamilyTable id={selection.id} paused={paused} onFinish={onFinish} />}{selection.kind === 'rom' && <RomPlayer game={selection.game} files={selection.files} paused={paused} />}</div></Suspense>{manualPause && <div className="gr-pause-cover"><Pause size={26} /><h3>Take your time.</h3><p>Your game is paused.</p><button className="gr-control" onClick={() => setManualPause(false)}><Play size={15} />Resume game</button></div>}</div>{selection.kind === 'rom' && <div className="gr-tv-base" aria-hidden="true"><span>{ROM_SYSTEMS.find(system => system.id === selection.game.system)?.label}</span><i /><i /></div>}</div>
      <p className="gr-session-note">P pauses built-in games. Switching browser tabs pauses play. {IS_INCOGNITO ? 'This room and its imported files disappear when the private window closes.' : 'Best scores and imported games are saved on this computer.'}</p></main>
    : <main className="gr-library"><div className="gr-library-intro"><div><h2>What are we playing?</h2><p>{BUILTIN_GAMES.length} machines on the floor and {FAMILY_GAMES.length} games on the family table. {library.length ? `${library.length} cartridges on your wall.` : 'An empty cartridge wall, waiting for your classics.'}</p></div><label className="gr-search"><Search size={15} /><input aria-label="Search games" placeholder="Find your next game…" value={query} onChange={event => setQuery(event.target.value)} /></label></div><nav className="gr-filters" aria-label="Game categories">{['All games', 'Play offline', 'Family', 'Originals', 'Board', 'Cards', 'Word', 'Puzzle', 'Arcade', 'Classics', 'My games'].map(item => <button key={item} aria-pressed={category === item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}{item === 'My games' && library.length ? ` (${library.length})` : ''}</button>)}</nav>
      {builtins.length > 0 && <section aria-label="Offline games" className="gr-zone"><div className="gr-section-heading"><h3><span className="gr-plaque">The arcade floor</span></h3><span>No downloads. No account. Just play.</span></div><div className="gr-arcade-row">{builtins.map(game => <ArcadeCabinet key={game.id} game={game} best={scores[game.id] || 0} onPlay={() => playBuiltin(game.id)} />)}</div></section>}
      {family.length > 0 && <section aria-label="Family board games" className="gr-zone"><div className="gr-section-heading"><h3><span className="gr-plaque">The family table</span></h3><span>Classic board, dice and party games for every age.</span></div>{(['Strategy', 'Classic boards', 'Race & luck', 'Dice', 'Puzzles & party'] as const).map(shelf => { const items = family.filter(item => item.shelf === shelf); return items.length ? <div key={shelf} className="gr-boxshelf"><h4>{shelf}</h4><div className="gr-boxshelf-row">{items.map(item => <BoardGameBox key={item.game.id} title={item.game.title} icon={item.icon} color={item.color} blurb={item.blurb} age={item.age} players={item.game.players === 1 ? '1 player' : item.game.players > 2 ? `1–${item.game.players} players` : '1–2 players'} onPlay={() => playFamily(item.game.id)} />)}</div></div> : null })}{(category === 'All games' || category === 'Play offline' || category === 'Family' || category === 'Word') && <div className="gr-boxshelf"><h4>Word games</h4><div className="gr-boxshelf-row">{BUILTIN_GAMES.filter(game => game.genre === 'Word' && matches(`${game.title} ${game.aliases}`)).map(game => <BoardGameBox key={game.id} title={game.title} icon={game.id === 'crossword' ? '✎' : 'A₁'} color={game.color} blurb={game.description} age="8+" players={game.players} onPlay={() => playBuiltin(game.id)} />)}</div></div>}</section>}
      {imported.length > 0 && <section aria-label="Imported games" className="gr-zone"><div className="gr-section-heading"><h3><span className="gr-plaque">Cartridge wall</span></h3><span><HardDrive size={13} />{library.length} {library.length === 1 ? 'cartridge' : 'cartridges'} on this computer</span></div><div className="gr-shelf">{imported.map(game => <Cartridge key={game.id} game={game} busy={busy} onPlay={() => void playRom(game)} onRemove={() => void remove(game)} />)}</div></section>}
      {!library.length && (category === 'All games' || category === 'My games') && !query && <section className="gr-zone gr-shelf-empty"><div className="gr-shelf is-empty" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</div><div><h3>Stock your cartridge wall</h3><p>Pick a folder of game files you own. Every NES, Genesis, Super Nintendo and Game Boy game inside — loose or zipped — gets its own cartridge here.</p>{folderButton}</div></section>}
      {classics.length > 0 && <section aria-label="Classic games" className="gr-zone"><div className="gr-section-heading"><h3><span className="gr-plaque">Wanted board</span></h3><span>Import a game file you own to play these titles.</span></div><div className="gr-corkboard">{classics.map(game => { const existing = library.find(item => item.title.toLowerCase() === game.title.toLowerCase()); return <WantedCard key={game.title} title={game.title} genre={game.genre} system={game.system} owned={!!existing} busy={busy} onClick={() => existing ? void playRom(existing) : openImport(game.title, game.system)} /> })}</div></section>}
      {!builtins.length && !family.length && !classics.length && !imported.length && <div className="gr-empty"><Gamepad2 size={34} /><h3>{category === 'My games' ? 'Your collection starts here' : 'No game found'}</h3><p>{category === 'My games' ? 'Add a supported game file, or a whole folder, to keep it in your room.' : 'Try another name or category.'}</p>{category === 'My games' && <div className="gr-header-tools"><button className="gr-control" onClick={() => openImport()}>Add your first game</button>{folderButton}</div>}</div>}
      <footer className="gr-footer">Built-in games are original implementations. Cartridge labels are original artwork generated from each title. Named commercial classics require your own game files. Imported games use EmulatorJS; the emulator downloads when you launch a game and requires an internet connection.</footer>
    </main>}
    {importing && <div className="gr-modal-backdrop" onKeyDown={event => { if (event.key === 'Escape' && !busy) setImporting(null) }}><form className="gr-import-modal" role="dialog" aria-modal="true" aria-labelledby="gr-import-title" onSubmit={importGame}><header><h2 id="gr-import-title">Bring a game to your room</h2><button type="button" className="gr-close" aria-label="Close game import" disabled={busy} onClick={() => setImporting(null)}><X size={19} /></button></header><p>Choose a game file you own. The file is stored locally{IS_INCOGNITO ? ' for this private session' : ' on this computer'}; the browser does not upload it.</p><label>Game name<input autoFocus value={importing.title} maxLength={100} placeholder="Use the game’s title, or leave blank for its filename" onChange={event => setImporting({ ...importing, title: event.target.value })} /></label><label>System<select value={importing.system} onChange={event => { setImporting({ ...importing, system: event.target.value as RomSystem }); setRomFile(null) }}>{ROM_SYSTEMS.map(system => <option key={system.id} value={system.id}>{system.label}</option>)}</select></label><label>Game file <small>Up to 64 MB</small><input key={importing.system} type="file" aria-label="Game file" accept={ROM_SYSTEMS.find(system => system.id === importing.system)!.extensions.map(extension => '.' + extension).join(',') + ',.zip'} onChange={event => setRomFile(event.target.files?.[0] || null)} /></label><details><summary>Optional BIOS file</summary><p>Some arcade games need a compatible BIOS or ROM set. Console versions of the named classics are often simpler to set up.</p><input type="file" aria-label="Optional BIOS file" accept=".bin,.rom,.bios,.zip" onChange={event => setBiosFile(event.target.files?.[0] || null)} /></details>{error && <p className="gr-import-error" role="alert">{error}</p>}<button type="submit" className="gr-import-submit" disabled={!romFile || busy}>{busy ? 'Adding your game…' : 'Add and play'}<Play size={15} /></button></form></div>}
  </div>
}
