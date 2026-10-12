// src/main/fares/adapters/index.ts
import type { FareQuery } from '../../../shared/fares/types'
import { googleAdapter } from './google'
import { kayakAdapter, momondoAdapter } from './kayak'
import type { SiteAdapter } from './types'

/** Live sources, fastest first so the table appears quickly. */
export const FARE_ADAPTERS: SiteAdapter<any>[] = [googleAdapter, kayakAdapter, momondoAdapter]

/** Sites that could not be read reliably in testing — offered as prefilled links. */
export function handoffLinks(q: FareQuery): { name: string; url: string }[] {
  const mdY = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`
  const yymmdd = (d: string) => d.slice(2).replace(/-/g, '')
  return [
    { name: 'Expedia', url: `https://www.expedia.com/Flights-Search?trip=roundtrip&leg1=${encodeURIComponent(`from:${q.from},to:${q.to},departure:${mdY(q.depart)}TANYT`)}&leg2=${encodeURIComponent(`from:${q.to},to:${q.from},departure:${mdY(q.ret)}TANYT`)}&passengers=${encodeURIComponent(`adults:${q.adults}`)}&mode=search` },
    { name: 'Skyscanner', url: `https://www.skyscanner.com/transport/flights/${q.from.toLowerCase()}/${q.to.toLowerCase()}/${yymmdd(q.depart)}/${yymmdd(q.ret)}/?adultsv2=${q.adults}&currency=${q.currency}` },
  ]
}
