import { estimatedBagFee } from './bagFees'
import { offerKey, type FareOffer, type SiteId } from './types'

export interface BagNeeds { carry: boolean; checked: boolean }
export interface SitePrice { source: SiteId; price: number; bookUrl: string; verify: boolean }
export interface FareRow {
  key: string
  /** Representative offer: the cheapest one seen for this outbound flight. */
  offer: FareOffer
  prices: SitePrice[]
  best: number
  bagFee: number
  trueTotal: number
  /** How many sites priced within $5 of the best price. */
  agreement: number
}
export type SortMode = 'best' | 'cheapest' | 'fastest' | 'stops'

const SOURCE_ORDER: SiteId[] = ['google', 'kayak', 'momondo']

export function mergeOffers(offers: FareOffer[]): FareRow[] {
  const groups = new Map<string, FareOffer[]>()
  for (const o of offers) {
    const k = offerKey(o)
    groups.set(k, [...(groups.get(k) || []), o])
  }
  const rows: FareRow[] = []
  for (const [key, list] of groups) {
    const perSite = new Map<SiteId, FareOffer>()
    for (const o of list) {
      const cur = perSite.get(o.source)
      if (!cur || o.price < cur.price) perSite.set(o.source, o)
    }
    const cheapest = [...perSite.values()].sort((a, b) => a.price - b.price)[0]
    const best = cheapest.price
    const prices = SOURCE_ORDER.filter(s => perSite.has(s)).map(s => {
      const o = perSite.get(s)!
      return { source: s, price: o.price, bookUrl: o.bookUrl, verify: o.price > best * 1.25 }
    })
    // Prefer an offer that knows its bags and its return leg as the representative.
    const offer = { ...cheapest, bags: cheapest.bags ?? list.find(o => o.bags)?.bags ?? null, ret: cheapest.ret ?? list.find(o => o.ret)?.ret ?? null }
    rows.push({ key, offer, prices, best, bagFee: 0, trueTotal: best, agreement: prices.filter(p => p.price - best <= 5).length })
  }
  return rows
}

function bagFeeFor(o: FareOffer, needs: BagNeeds, adults: number): number {
  const airline = o.airlines[0]
  let fee = 0
  // Unknown inclusion: assume the airline's usual policy (fee table).
  if (needs.carry && !(o.bags && o.bags.carry > 0)) fee += estimatedBagFee(airline, 'carry')
  if (needs.checked && !(o.bags && o.bags.checked > 0)) fee += estimatedBagFee(airline, 'checked')
  return fee * adults
}

export function rankRows(rows: FareRow[], mode: SortMode, needs: BagNeeds, adults: number, filters: { nonstop?: boolean } = {}): FareRow[] {
  const priced = rows
    .filter(r => !filters.nonstop || r.offer.stops === 0)
    .map(r => { const bagFee = bagFeeFor(r.offer, needs, adults); return { ...r, bagFee, trueTotal: r.best + bagFee } })
  // Best value: every hour in the air is worth $15 and every stop $25 to a
  // typical traveller — enough to prefer a slightly dearer nonstop, not
  // enough to bury a much cheaper flight.
  const value = (r: FareRow) => r.trueTotal + (r.offer.durationMin / 60) * 15 + r.offer.stops * 25
  const by: Record<SortMode, (a: FareRow, b: FareRow) => number> = {
    best: (a, b) => value(a) - value(b),
    cheapest: (a, b) => a.trueTotal - b.trueTotal || a.offer.durationMin - b.offer.durationMin,
    fastest: (a, b) => a.offer.durationMin - b.offer.durationMin || a.trueTotal - b.trueTotal,
    stops: (a, b) => a.offer.stops - b.offer.stops || a.trueTotal - b.trueTotal,
  }
  return priced.sort(by[mode])
}
