// src/renderer/src/components/travel/fares/FareTable.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { mergeOffers, rankRows, type BagNeeds, type FareRow, type SortMode } from '../../../../../shared/fares/rank'
import type { FareOffer, SiteId } from '../../../../../shared/fares/types'

const SITE: Record<SiteId, string> = { google: 'Google', kayak: 'Kayak', momondo: 'Momondo' }
const SORTS: { id: SortMode; label: string }[] = [{ id: 'best', label: 'Best value' }, { id: 'cheapest', label: 'Cheapest' }, { id: 'fastest', label: 'Fastest' }, { id: 'stops', label: 'Fewest stops' }]
const hm = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`
const t12 = (t: string) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'a' : 'p'}` }

export default function FareTable({ offers, adults, onBook, onRowsRanked }: { offers: FareOffer[]; adults: number; onBook: (url: string) => void; onRowsRanked?: (rows: FareRow[]) => void }) {
  const [mode, setMode] = useState<SortMode>('best')
  const [needs, setNeeds] = useState<BagNeeds>({ carry: true, checked: false })
  const [nonstop, setNonstop] = useState(false)
  const rows = useMemo(() => rankRows(mergeOffers(offers), mode, needs, adults, { nonstop }), [offers, mode, needs, adults, nonstop])
  useEffect(() => { onRowsRanked?.(rows) }, [rows, onRowsRanked])

  return <section className="fare-table" aria-label="Live fares">
    <div className="fare-sortbar">
      <div role="group" aria-label="Sort">{SORTS.map(s => <button key={s.id} aria-pressed={mode === s.id} className={mode === s.id ? 'selected' : ''} onClick={() => setMode(s.id)}>{s.label}</button>)}</div>
      <div role="group" aria-label="Filters">
        <button aria-pressed={nonstop} className={nonstop ? 'selected' : ''} onClick={() => setNonstop(v => !v)}>Nonstop</button>
        <button aria-pressed={needs.carry} className={needs.carry ? 'selected' : ''} onClick={() => setNeeds(n => ({ ...n, carry: !n.carry }))}>Carry-on</button>
        <button aria-pressed={needs.checked} className={needs.checked ? 'selected' : ''} onClick={() => setNeeds(n => ({ ...n, checked: !n.checked }))}>Checked bag</button>
      </div>
    </div>
    {rows.map(r => <article key={r.key} className="fare-row" data-fare-row>
      <div className="fare-row-main">
        <div className="fare-airline">{r.offer.airlines.join(' + ')}<small>{r.offer.stops ? `${r.offer.stops} stop${r.offer.stops > 1 ? 's' : ''}${r.offer.layovers.length ? ` · ${r.offer.layovers.join(', ')}` : ''}` : 'Nonstop'}</small></div>
        <div className="fare-times"><span>{t12(r.offer.departTime)} → {t12(r.offer.arriveTime)}{r.offer.arriveDayOffset ? <sup>+{r.offer.arriveDayOffset}</sup> : null}</span><small>{hm(r.offer.durationMin)}</small></div>
        <div className="fare-bags">{r.offer.bags ? `${r.offer.bags.carry ? 'carry-on incl.' : 'no carry-on'}` : 'bags unknown'}</div>
        <div className="fare-price">
          <b>${r.trueTotal}</b>
          {r.bagFee > 0 && <small>${r.best} fare + ${r.bagFee} bags est.</small>}
          <span className="fare-agree" title="Sites within $5 of the best price">{'●'.repeat(r.agreement)}{'○'.repeat(Math.max(0, r.prices.length - r.agreement))} {r.agreement} site{r.agreement > 1 ? 's' : ''}</span>
        </div>
      </div>
      <div className="fare-row-sites">
        {r.prices.map(p => <button key={p.source} className={p.verify ? 'is-verify' : ''} onClick={() => onBook(p.bookUrl)}>
          {SITE[p.source]} ${p.price}{p.verify ? ' · verify' : ''}
        </button>)}
      </div>
    </article>)}
  </section>
}
