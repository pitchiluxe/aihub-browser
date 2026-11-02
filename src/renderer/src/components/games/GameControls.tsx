import React, { useEffect, useRef, useState } from 'react'
import { Box, Square } from 'lucide-react'
import { playSound, type GameSound } from './sounds'
export interface GameProps { paused: boolean; onFinish: (score: number) => void }
const VIEW_KEY = 'aihub-game-room-view-v1'
// Each tabletop game remembers whether it was last played tilted or from above.
export function useBoardView(game: string): [boolean, () => void] {
  const [tilted, setTilted] = useState(() => { try { return JSON.parse(localStorage.getItem(VIEW_KEY) || '{}')[game] === '3d' } catch { return false } })
  const toggle = () => setTilted(value => {
    try { const stored = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}'); localStorage.setItem(VIEW_KEY, JSON.stringify({ ...stored, [game]: value ? 'top' : '3d' })) } catch { /* The view still switches for this round. */ }
    return !value
  })
  return [tilted, toggle]
}
export function ViewToggle({ tilted, onToggle }: { tilted: boolean; onToggle: () => void }) {
  return <button type="button" className="gr-view-toggle" onClick={onToggle} aria-pressed={!tilted}>{tilted ? <Square size={13} /> : <Box size={13} />}{tilted ? 'Top view' : '3D view'}</button>
}
// Step a displayed value toward its target one square at a time, so a pawn walks instead of teleporting.
// Longer jumps (sent to the lockup, back to the yard) happen in one move.
export function useWalk(target: number, length: number, stepMs = 170): number {
  const [shown, setShown] = useState(target)
  useEffect(() => {
    if (shown === target) return
    const forward = (target - shown + length) % length
    const timer = setTimeout(() => setShown(forward > 12 ? target : (shown + 1) % length), stepMs)
    return () => clearTimeout(timer)
  }, [shown, target, length, stepMs])
  return shown
}
// Plays a sound whenever a counter goes up (score, lines, moves) or down, ignoring the first render and restarts to zero.
export function useCounterSound(value: number, up: GameSound | null, down: GameSound | null = null) {
  const previous = useRef(value)
  useEffect(() => {
    const before = previous.current; previous.current = value
    if (value > before && up) playSound(up)
    else if (value < before && value !== 0 && down) playSound(down)
  }, [value])
}
export function useEndSound(over: boolean, won: boolean) {
  useEffect(() => { if (over) playSound(won ? 'win' : 'lose') }, [over])
}
// Dice tumble for this long before anything on the board reacts to them.
export const DICE_SETTLE_MS = 1050
export function useGameKeys(handler: (key: string) => void, paused: boolean) {
  const callback = useRef(handler); callback.current = handler
  useEffect(() => {
    if (paused) return
    const keydown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'c', 'C'].includes(event.key)) { event.preventDefault(); callback.current(event.key) }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [paused])
}
export function GameButton({ children, onClick, disabled = false, label }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; label?: string }) {
  return <button type="button" className="gr-control" disabled={disabled} aria-label={label} onClick={onClick}>{children}</button>
}
export function GameStats({ items }: { items: [string, string | number][] }) {
  return <div className="gr-stats">{items.map(([name, value]) => <div key={name}><span>{name}</span><strong>{value}</strong></div>)}</div>
}
export function GameResult({ title, text }: { title: string; text: string }) {
  return <div className="gr-result" role="status"><strong>{title}</strong><p>{text} Use New game to play again.</p></div>
}
