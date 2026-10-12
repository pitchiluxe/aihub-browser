// The one shape every fare source is turned into. Each site describes the
// same flight differently ("9:32 pm" vs "9:32 PM on Tuesday"); everything
// downstream — merging, ranking, the AI pick — only ever sees this.

export type SiteId = 'google' | 'kayak' | 'momondo'
export type FareCurrency = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD'

export interface FareQuery { from: string; to: string; depart: string; ret: string; adults: number; currency: FareCurrency }

export interface Leg {
  /** 24-hour local time, "HH:MM". */
  departTime: string
  arriveTime: string
  /** Days after departure the leg lands (overnight = 1). */
  arriveDayOffset: number
  airlines: string[]
  stops: number
  layovers: string[]
  durationMin: number
}

export interface FareOffer extends Leg {
  source: SiteId
  /** Round-trip total for all travellers, as the site displays it. */
  price: number
  currency: string
  /** Bags included per traveller; null when the site did not say. */
  bags: { carry: number; checked: number } | null
  bookUrl: string
  /** Cheapest return leg the site paired with this outbound, when shown. */
  ret: Leg | null
}

export function to24h(t: string): string | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*([ap])\.?m\.?\s*$/i.exec(t)
  if (!m) return null
  let h = Number(m[1]); const min = Number(m[2])
  if (h < 1 || h > 12 || min > 59) return null
  if (m[3].toLowerCase() === 'p' && h !== 12) h += 12
  if (m[3].toLowerCase() === 'a' && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function parseDuration(s: string): number | null {
  const h = /(\d+)\s*(?:hr|h)\b/i.exec(s)
  const m = /(\d+)\s*(?:min|m)\b/i.exec(s)
  if (!h && !m) return null
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0)
}

export function splitAirlines(s: string): string[] {
  return s.split(/\s*(?:,|\band\b|\+|\/)\s*/i).map(x => x.trim()).filter(Boolean)
}

export function parseMoney(s: string): number | null {
  const m = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/.exec(s)
  if (!m) return null
  const n = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

const TIME = /^\d{2}:\d{2}$/

export function normalizeOffer(o: FareOffer): FareOffer | null {
  if (!o || !Number.isFinite(o.price) || o.price <= 20 || o.price > 50_000) return null
  if (!Array.isArray(o.airlines) || !o.airlines.length || o.airlines.some(a => !a || a.length > 60)) return null
  if (!TIME.test(o.departTime) || !TIME.test(o.arriveTime)) return null
  if (!Number.isFinite(o.durationMin) || o.durationMin <= 0 || o.durationMin > 72 * 60) return null
  if (!Number.isInteger(o.stops) || o.stops < 0 || o.stops > 4) return null
  if (!/^https:\/\//.test(o.bookUrl)) return null
  return o
}

/** "American Airlines" and "American" are one carrier: Google uses short
 *  names, Kayak often the long form. Unmatched names split one flight into
 *  two rows and miss its bag-fee entry. */
export function canonicalAirline(name: string): string {
  return name.trim().toLowerCase().replace(/\s+(airlines?|air lines|airways)$/, '')
}

export function offerKey(o: Pick<Leg, 'airlines' | 'departTime' | 'arriveTime' | 'arriveDayOffset'>): string {
  return `${canonicalAirline(o.airlines[0])}|${o.departTime}|${o.arriveTime}|${o.arriveDayOffset}`
}
