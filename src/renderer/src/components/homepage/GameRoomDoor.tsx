import React, { useState } from 'react'
import { Gamepad2, Lightbulb, LightbulbOff } from 'lucide-react'
import './game-room-door.css'

// The homepage entrance to the Game room: a lit marquee over double doors.
// The bulbs can be switched off; they are on unless the user turned them off.
const LIGHTS_KEY = 'aihub-game-room-door-lights'
const TOP = 22, SIDE = 4
const COLORS = ['#ff4d6d', '#ffb703', '#8ac926', '#3fc1ff', '#b388ff', '#ff7ae0']

function Bulbs({ count, edge }: { count: number; edge: 'top' | 'bottom' | 'left' | 'right' }) {
  return <span className={`grd-bulbs is-${edge}`} aria-hidden="true">{Array.from({ length: count }, (_, i) => {
    const order = edge === 'top' ? i : edge === 'right' ? TOP + i : edge === 'bottom' ? TOP + SIDE + (count - 1 - i) : TOP * 2 + SIDE + (count - 1 - i)
    return <i key={i} style={{ '--bulb': COLORS[order % COLORS.length], '--order': order } as React.CSSProperties} />
  })}</span>
}

export default function GameRoomDoor({ onEnter, isLight }: { onEnter: () => void; isLight: boolean }) {
  const [lights, setLights] = useState(() => { try { return localStorage.getItem(LIGHTS_KEY) !== 'off' } catch { return true } })
  const toggle = () => setLights(value => { try { localStorage.setItem(LIGHTS_KEY, value ? 'off' : 'on') } catch { /* Lasts for this visit. */ } return !value })
  return <div className={`grd ${lights ? 'is-lit' : 'is-dark'} ${isLight ? 'is-light-theme' : ''}`}>
    <Bulbs count={TOP} edge="top" /><Bulbs count={SIDE} edge="right" /><Bulbs count={TOP} edge="bottom" /><Bulbs count={SIDE} edge="left" />
    <button type="button" className="grd-door" aria-label="Enter the Game room" onClick={onEnter}>
      <span className="grd-leaf is-left" aria-hidden="true"><i /></span><span className="grd-leaf is-right" aria-hidden="true"><i /></span>
      <span className="grd-glow" aria-hidden="true" />
      <span className="grd-sign">
        <span className="grd-title"><Gamepad2 size={26} aria-hidden="true" />Game room</span>
        <span className="grd-sub">Arcade, cards, board games, and your classics</span>
        <span className="grd-enter">Step inside →</span>
      </span>
    </button>
    <button type="button" className="grd-switch" aria-pressed={lights} aria-label={lights ? 'Turn the door lights off' : 'Turn the door lights on'} title={lights ? 'Lights off' : 'Lights on'} onClick={toggle}>{lights ? <Lightbulb size={14} /> : <LightbulbOff size={14} />}</button>
  </div>
}
