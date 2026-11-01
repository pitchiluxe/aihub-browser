import React, { useEffect, useRef } from 'react'
export interface GameProps { paused: boolean; onFinish: (score: number) => void }
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
