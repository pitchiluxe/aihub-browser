import React from 'react'
import './board-pieces.css'

// Pip slots on a 3×3 grid for each face value.
const PIPS = [[4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]]
// Faces of a real die: opposite sides sum to seven. The rolled value faces up.
const SIDES = (value: number) => { const rest = [1, 2, 3, 4, 5, 6].filter(side => side !== value && side !== 7 - value); return [value, 7 - value, rest[0], 7 - rest[0], rest[1], 7 - rest[1]] }

export function Die({ value }: { value: number }) {
  return <span className="gr-die" aria-hidden="true">{SIDES(value).map((side, face) => <span key={face} className={`gr-die-face f${face}`}>{Array.from({ length: 9 }, (_, slot) => <i key={slot} className={PIPS[side - 1].includes(slot) ? 'on' : ''} />)}</span>)}</span>
}
export const Pawn = ({ color }: { color: string }) => <svg viewBox="0 0 20 30" className="gr-pawn"><ellipse cx="10" cy="27" rx="8" ry="2.6" fill="#0006" /><path d="M10 3a4.5 4.5 0 0 1 2.6 8.2Q15 13 13 15l2.5 9h-11L7 15q-2-2 .4-3.8A4.5 4.5 0 0 1 10 3Z" fill={color} stroke="#0008" strokeWidth=".8" /><ellipse cx="8.4" cy="6.6" rx="1.4" ry="1" fill="#fff8" /></svg>
