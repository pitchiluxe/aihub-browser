// src/main/fares/adapters/google.ts
// Google Flights renders every offer with a full screen-reader sentence:
// "From 162 US dollars round trip total. 1 stop flight with Frontier. Leaves …".
// Accessibility labels change far less often than Google's obfuscated class
// names, so this parser reads the sentence, not the layout.
import { normalizeOffer, parseDuration, parseMoney, splitAirlines, to24h, type FareOffer } from '../../../shared/fares/types'
import { COMMON_PROBE, type SiteAdapter } from './types'

const CURRENCY_WORDS: Record<string, string> = {
  'US dollars': 'USD', euros: 'EUR', 'British pounds': 'GBP', 'Canadian dollars': 'CAD', 'Australian dollars': 'AUD',
}

const LABEL = new RegExp(
  '^From ([\\d,]+) (US dollars|euros|British pounds|Canadian dollars|Australian dollars) round trip total\\. ' +
  '(Nonstop|(\\d+) stops?) flight with (.+?)\\. ' +
  'Leaves .+? at (\\d{1,2}:\\d{2}\\s?[AP]M) on [A-Za-z]+, ([A-Za-z]+ \\d{1,2}) ' +
  'and arrives at .+? at (\\d{1,2}:\\d{2}\\s?[AP]M) on [A-Za-z]+, ([A-Za-z]+ \\d{1,2})\\. ' +
  'Total duration ([^.]+)\\.',
)

function dayOffset(departDay: string, arriveDay: string): number {
  const a = Date.parse(`${departDay} 2001`), b = Date.parse(`${arriveDay} 2001`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  const diff = Math.round((b - a) / 86_400_000)
  return diff < 0 ? diff + 365 : diff  // Dec 31 → Jan 1
}

export function parseGoogleLabel(label: string, bookUrl: string): FareOffer | null {
  const m = LABEL.exec(label.replace(/\s+/g, ' ').trim())
  if (!m) return null
  const departTime = to24h(m[6]), arriveTime = to24h(m[8])
  const durationMin = parseDuration(m[10])
  const price = parseMoney(m[1])
  if (!departTime || !arriveTime || durationMin === null || price === null) return null
  const layovers = [...label.matchAll(/layover at .+? in ([^.]+)\./g)].map(x => x[1].trim())
  const carry = /(\d+) carry-on bags? included/.exec(label)
  const checked = /(\d+) checked bags? included/.exec(label)
  return normalizeOffer({
    source: 'google', price, currency: CURRENCY_WORDS[m[2]],
    airlines: splitAirlines(m[5]), stops: m[3] === 'Nonstop' ? 0 : Number(m[4]), layovers,
    departTime, arriveTime, arriveDayOffset: dayOffset(m[7], m[9]), durationMin,
    bags: carry && checked ? { carry: Number(carry[1]), checked: Number(checked[1]) } : null,
    bookUrl, ret: null,
  })
}

export const googleAdapter: SiteAdapter<{ labels: string[] }> = {
  id: 'google',
  label: 'Google Flights',
  url: q => `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${q.from} to ${q.to} on ${q.depart} through ${q.ret}${q.adults > 1 ? ` for ${q.adults} adults` : ''}`)}&curr=${q.currency}&hl=en`,
  script: `(() => {${COMMON_PROBE}
    const labels = [...document.querySelectorAll('[aria-label]')]
      .map(e => e.getAttribute('aria-label') || '')
      .filter(l => /round trip total/.test(l)).slice(0, 120);
    return { ready: labels.length >= 5, blocked: __blocked, pricesOnPage: __prices, raw: { labels } };
  })()`,
  parse(raw, q) {
    const url = googleAdapter.url(q)
    const seen = new Set<string>()
    const out: FareOffer[] = []
    for (const label of raw?.labels || []) {
      if (seen.has(label)) continue
      seen.add(label)
      const o = parseGoogleLabel(label, url)
      if (o) out.push(o)
    }
    return out
  },
}
