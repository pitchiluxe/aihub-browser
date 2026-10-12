// src/renderer/src/components/travel/fares/AiPickCard.tsx
import React from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import type { FareRow } from '../../../../../shared/fares/rank'

export default function AiPickCard({ row, reason, loading }: { row: FareRow | null; reason: string; loading: boolean }) {
  if (loading) return <div className="fare-pick is-loading"><Loader2 size={15} className="fare-spin" /> AI is comparing the table…</div>
  if (!row) return null
  return <div className="fare-pick">
    <div className="fare-pick-head"><Sparkles size={15} /> AI pick</div>
    <div className="fare-pick-flight">{row.offer.airlines.join(' + ')} · {row.offer.stops ? `${row.offer.stops} stop` : 'Nonstop'} · {row.offer.departTime}</div>
    <div className="fare-pick-price">${row.trueTotal}<small> true total</small></div>
    <p>{reason}</p>
  </div>
}
