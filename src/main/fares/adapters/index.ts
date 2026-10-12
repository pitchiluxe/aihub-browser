import type { FareQuery } from '../../../shared/fares/types'
import { googleAdapter } from './google'
import { kayakAdapter, momondoAdapter } from './kayak'
import type { SiteAdapter } from './types'

/** Live sources, fastest first so the table appears quickly. */
export const FARE_ADAPTERS: SiteAdapter<any>[] = [googleAdapter, kayakAdapter, momondoAdapter]

/** True only for a URL one of the live adapters itself builds — the allow-list
 *  for the visible verify window. Matching on each adapter's own origin and
 *  path prefix keeps it correct when an adapter's URL shape changes (Google's
 *  search URL is `/travel/flights?q=…`, which a `/flights/` pattern missed). */
export function isFareSiteUrl(url: string): boolean {
  let u: URL
  try { u = new URL(url) } catch { return false }
  if (u.protocol !== 'https:') return false
  const sample: FareQuery = { from: 'AAA', to: 'BBB', depart: '2000-01-01', ret: '2000-01-02', adults: 1, currency: 'USD' }
  return FARE_ADAPTERS.some(a => {
    const ref = new URL(a.url(sample))
    const prefix = ref.pathname.split('/').slice(0, 2).join('/')
    return u.origin === ref.origin && u.pathname.startsWith(prefix)
  })
}

/** Sites that could not be read reliably in testing — offered as prefilled links. */
export function handoffLinks(q: FareQuery): { name: string; url: string }[] {
  const mdY = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`
  const yymmdd = (d: string) => d.slice(2).replace(/-/g, '')
  return [
    { name: 'Expedia', url: `https://www.expedia.com/Flights-Search?trip=roundtrip&leg1=${encodeURIComponent(`from:${q.from},to:${q.to},departure:${mdY(q.depart)}TANYT`)}&leg2=${encodeURIComponent(`from:${q.to},to:${q.from},departure:${mdY(q.ret)}TANYT`)}&passengers=${encodeURIComponent(`adults:${q.adults}`)}&mode=search` },
    { name: 'Skyscanner', url: `https://www.skyscanner.com/transport/flights/${q.from.toLowerCase()}/${q.to.toLowerCase()}/${yymmdd(q.depart)}/${yymmdd(q.ret)}/?adultsv2=${q.adults}&currency=${q.currency}` },
  ]
}
