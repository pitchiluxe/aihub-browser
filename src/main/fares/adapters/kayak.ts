// src/main/fares/adapters/kayak.ts
// Kayak and Momondo are one platform with one result layout. Each result is a
// [role="group"] container whose text starts with the keyboard-navigation
// lines ("Go to next result"…) followed by one block per leg:
//   9:32 pm – 9:19 am+1 / Frontier / 1 stop / LAS / … layover … / 14h 47m / ATL / - / LAX
// then optional bag counts (carry, checked) and the price.
import { normalizeOffer, parseDuration, parseMoney, splitAirlines, to24h, type FareOffer, type FareQuery, type Leg } from '../../../shared/fares/types'
import { COMMON_PROBE, type SiteAdapter } from './types'

export type KayakRaw = { cards: { text: string; href: string | null }[] }

const RANGE = /^(\d{1,2}:\d{2}\s?[ap]m)\s*[–-]\s*(\d{1,2}:\d{2}\s?[ap]m)(?:\+(\d))?$/i
const PRICE = /^(?:[$€£]|C\$|A\$)\s?[\d,]+$/
const DURATION = /^\d+h(?:\s\d+m)?$|^\d+m$/

function readLeg(lines: string[], i: number): { leg: Leg; next: number } | null {
  const r = RANGE.exec(lines[i])
  if (!r) return null
  const departTime = to24h(r[1]), arriveTime = to24h(r[2])
  const airlineLine = lines[i + 1] || ''
  const stopsLine = (lines[i + 2] || '').toLowerCase()
  if (!departTime || !arriveTime || !airlineLine) return null
  const stops = stopsLine === 'nonstop' ? 0 : Number(/^(\d+) stops?$/.exec(stopsLine)?.[1] ?? NaN)
  if (!Number.isFinite(stops)) return null
  const layovers: string[] = []
  let j = i + 3
  for (; j < lines.length && !DURATION.test(lines[j]); j++) {
    if (/^[A-Z]{3}$/.test(lines[j])) layovers.push(lines[j])
  }
  const durationMin = parseDuration(lines[j] || '')
  if (durationMin === null) return null
  return {
    leg: { departTime, arriveTime, arriveDayOffset: Number(r[3] || 0), airlines: splitAirlines(airlineLine), stops, layovers, durationMin },
    next: j + 1,
  }
}

export function parseKayakCard(
  card: { text: string; href: string | null }, host: string, fallbackUrl: string, source: 'kayak' | 'momondo',
): FareOffer | null {
  const lines = card.text.split('\n').map(l => l.trim()).filter(Boolean)
  const legs: Leg[] = []
  let priceIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (PRICE.test(lines[i])) { priceIdx = i; break }
    const read = readLeg(lines, i)
    if (read) { legs.push(read.leg); i = read.next - 1 }
  }
  if (!legs.length || priceIdx < 0) return null
  const price = parseMoney(lines[priceIdx])
  if (price === null) return null
  const carry = lines[priceIdx - 2], checked = lines[priceIdx - 1]
  const bags = /^\d$/.test(carry || '') && /^\d$/.test(checked || '') ? { carry: Number(carry), checked: Number(checked) } : null
  const bookUrl = card.href && card.href.startsWith('/') ? `${host}${card.href}` : fallbackUrl
  return normalizeOffer({ source, price, currency: '', bags, bookUrl, ret: legs[1] ?? null, ...legs[0] })
}

function makeAdapter(id: 'kayak' | 'momondo', label: string, host: string, path: string): SiteAdapter<KayakRaw> {
  const adapter: SiteAdapter<KayakRaw> = {
    id, label,
    url: (q: FareQuery) => `${host}/${path}/${q.from}-${q.to}/${q.depart}/${q.ret}${q.adults > 1 ? `/${q.adults}adults` : ''}?sort=price_a&currency=${q.currency}`,
    script: `(() => {${COMMON_PROBE}
      const cards = [...document.querySelectorAll('[role="group"]')]
        .filter(e => /^Go to (next|previous) result/.test(e.innerText || ''))
        .slice(0, 60)
        .map(e => { const a = e.querySelector('a[href*="/book/"]'); return { text: (e.innerText || '').slice(0, 3000), href: a ? a.getAttribute('href') : null } });
      return { ready: cards.length >= 5, blocked: __blocked, pricesOnPage: __prices, raw: { cards } };
    })()`,
    parse(raw, q) {
      const url = adapter.url(q)
      return (raw?.cards || [])
        .map(c => parseKayakCard(c, host, url, id))
        .filter((o): o is FareOffer => !!o)
        .map(o => ({ ...o, currency: q.currency }))
    },
  }
  return adapter
}

export const kayakAdapter = makeAdapter('kayak', 'Kayak', 'https://www.kayak.com', 'flights')
export const momondoAdapter = makeAdapter('momondo', 'Momondo', 'https://www.momondo.com', 'flight-search')
