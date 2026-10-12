import React from 'react'
import type { FlexDay } from './useFareSearch'

const fmt = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

export default function FlexDateStrip({ days, current, currentPrice, onPick }: { days: FlexDay[]; current: string; currentPrice: number | null; onPick: (depart: string, ret: string) => void }) {
  if (!days.length) return null
  const all = [...days, { depart: current, ret: '', price: currentPrice }].sort((a, b) => a.depart.localeCompare(b.depart))
  const priced = all.filter(d => d.price !== null).map(d => d.price!)
  const min = priced.length ? Math.min(...priced) : null
  return <div className="fare-flex-strip" aria-label="Prices on nearby dates">
    {all.map(d => <button key={d.depart} disabled={d.depart === current || d.price === null}
      className={`${d.depart === current ? 'is-current' : ''} ${d.price !== null && d.price === min ? 'is-cheapest' : ''}`}
      onClick={() => onPick(d.depart, d.ret)}>
      <span>{fmt(d.depart)}</span><b>{d.price === null ? '—' : `$${d.price}`}</b>
    </button>)}
  </div>
}
