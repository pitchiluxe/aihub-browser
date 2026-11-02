import React, { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { ROM_SYSTEMS, type BuiltinGame, type RomSystem } from '../../../../shared/games/catalog'
import { cartridgeHue } from '../../../../shared/games/romFolder'
import { cachedBoxart, findBoxart } from '../../services/boxartLibrary'
import type { RomGame } from '../../services/gameLibrary'
import CartridgeArt from './CartridgeArt'
import GameArtwork from './GameArtwork'

const SHORT_SYSTEM: Record<RomSystem, string> = { nes: 'NES', genesis: 'GENESIS', snes: 'SNES', gb: 'GAME BOY', gba: 'GBA', arcade: 'ARCADE', mame: 'ARCADE' }

export function ArcadeCabinet({ game, best, onPlay }: { game: BuiltinGame; best: number; onPlay: () => void }) {
  return <button className="gr-cabinet" style={{ '--game-color': game.color } as React.CSSProperties} onClick={onPlay} aria-label={`Play ${game.title}`}>
    <span className="gr-cab-marquee">{game.title}</span>
    <span className="gr-cab-screen"><GameArtwork id={game.id} color={game.color} /><span className="gr-cab-attract">{best ? `HI ${best.toLocaleString()}` : 'PRESS START'}</span></span>
    <span className="gr-cab-panel" aria-hidden="true"><i className="gr-cab-stick" /><i className="gr-cab-btn" /><i className="gr-cab-btn" /></span>
    <span className="gr-cab-body"><small>{game.genre} · {game.players}</small><span className="gr-cab-coin" aria-hidden="true" /></span>
  </button>
}

// The real box art when libretro has it; the generated label otherwise, or while it loads.
function CartridgeLabelArt({ game }: { game: RomGame }) {
  const [url, setUrl] = useState(() => cachedBoxart(game.id) || ''), [failed, setFailed] = useState(false)
  useEffect(() => { let live = true; void findBoxart(game).then(found => { if (live) setUrl(found) }).catch(() => undefined); return () => { live = false } }, [game.id])
  return url && !failed ? <img className="gr-cart-boxart" src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <CartridgeArt title={game.title} />
}

export function Cartridge({ game, busy, onPlay, onRemove }: { game: RomGame; busy: boolean; onPlay: () => void; onRemove: () => void }) {
  const hue = cartridgeHue(game.title)
  return <article className={`gr-cart is-${game.system}`} style={{ '--cart-hue': hue } as React.CSSProperties}>
    <button className="gr-cart-play" disabled={busy} onClick={onPlay} aria-label={`Play ${game.title}`} title={`${game.title} · ${ROM_SYSTEMS.find(system => system.id === game.system)?.label}`}>
      <span className="gr-cart-shell"><span className="gr-cart-grip" aria-hidden="true" /><span className="gr-cart-label"><CartridgeLabelArt game={game} /><span className="gr-cart-title">{game.title}</span></span><span className="gr-cart-badge">{SHORT_SYSTEM[game.system]}</span></span>
    </button>
    <button className="gr-remove-game" aria-label={`Remove ${game.title} from library`} disabled={busy} onClick={onRemove}><Trash2 size={12} /></button>
  </article>
}

// A board-game box on the family-table shelf: coloured lid, big emblem, and the game's promise on the side.
export function BoardGameBox({ title, icon, color, blurb, age, players, onPlay }: { title: string; icon: string; color: string; blurb: string; age: string; players: string; onPlay: () => void }) {
  return <button className="gr-gamebox" style={{ '--box': color, '--tilt': `${(cartridgeHue(title) % 5) - 2}deg` } as React.CSSProperties} onClick={onPlay} aria-label={`Play ${title}`}>
    <span className="gr-gamebox-lid"><span className="gr-gamebox-icon" aria-hidden="true">{icon}</span><strong>{title}</strong></span>
    <span className="gr-gamebox-side"><small>{blurb}</small><em>{players} · {age}</em></span>
  </button>
}

export function WantedCard({ title, genre, system, owned, busy, onClick }: { title: string; genre: string; system: RomSystem; owned: boolean; busy: boolean; onClick: () => void }) {
  return <button className={`gr-wanted ${owned ? 'is-owned' : ''}`} onClick={onClick} disabled={busy} style={{ '--tilt': `${(cartridgeHue(title) % 7) - 3}deg` } as React.CSSProperties}>
    <i className="gr-pin" aria-hidden="true" /><strong>{title}</strong><small>{genre} · {SHORT_SYSTEM[system]}</small><span>{owned ? 'On the shelf — play' : <><Plus size={11} />Add game</>}</span>
  </button>
}
