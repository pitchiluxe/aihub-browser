# Live Flight Fares Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show real, current round-trip flight fares from Google Flights, Kayak and Momondo inside `aihub://flights-rentals`, merged into one ranked table with true total cost, cross-site agreement, a flexible-date strip, an AI best pick and price watches.

**Architecture:** The main process loads each booking site in a sandboxed hidden window (`persist:fares` partition), runs a read-only in-page script, and hands the raw text to a pure per-site parser that emits normalized `FareOffer`s. A `FareEngine` orchestrates sites in parallel with cache, rate limits and cancellation, streaming progress to the renderer over IPC. Pure shared modules (`src/shared/fares/`) merge offers into outbound-flight rows and rank them; the renderer re-ranks locally when the user changes sort or bag needs.

**Tech Stack:** Electron 44 (BrowserWindow, session partitions, IPC), TypeScript, React 18, Vitest (+ jsdom for UI), plain CSS in `flightsRentals.css`.

**Spec:** `docs/superpowers/specs/2026-10-12-live-flight-fares-design.md`

## Global Constraints

- Sites: Google Flights, Kayak, Momondo are live sources. Expedia and Skyscanner are hand-off links only (Expedia returned 0 prices on 2 of 3 spike runs; Skyscanner redirected to car hire).
- At most 3 hidden windows alive at once; every hidden window destroyed after its site finishes; 60 s watchdog kills any survivor.
- Per-site deadline 35 s. Result cache 15 min, key = from+to+depart+return+adults+currency+site. Spacing ≥ 20 s between loads of the same site (cache hits exempt). Flex-date strip: ±3 days, Google only, after the main search, sequential with 3 s gaps, stops at first block.
- Hidden windows: `show: false`, `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, no preload, partition `persist:fares`, Chrome UA with the `Electron/x` token removed. Scripts only read the DOM — no clicks, input, or navigation.
- Extracted raw text capped at 200 KB per site.
- `normalizeOffer` rejects price ≤ 20 or > 50,000, missing airline, unparseable times, duration ≤ 0.
- AI pick prompt contains only normalized fields (airline, times, stops, duration, prices, bags) — never page text. A pick naming a row key not in the table is discarded.
- Every price shows its source and age. No "guaranteed" wording. Booking opens the provider site in a normal AIHub tab.
- Fare search channels are refused from Incognito windows (registered through `handlePersistent` and listed in `PRIVATE_BLOCKED_CHANNELS`).
- No synchronous disk I/O on the search path. Live e2e: no main-process stall > 250 ms during a search.
- Bag fees are a static per-airline table, labelled "est." in the UI.

## Review Focus

1. **Same airline, same times, different sites with different currencies/formats ("$1,204")** — thousands separators must parse; a $1,204 fare must not become $1.
2. **Overnight arrivals ("9:19 am+1", "arrives … on Wednesday, November 11")** — `arriveDayOffset` must be 1 and merging must still match Google's and Kayak's copies of the same flight.
3. **The user edits the form while a search is streaming** — late `fares:progress` events from the old search must not appear in the new table.
4. **A site answers with prices on the page but none parse (layout change)** — chip must say "couldn't read", never "0 results", and other sites' rows must still show.
5. **Multi-airline itineraries ("Delta, Alaska" / "flight with Delta and Alaska")** — airlines split into a list; merge key uses the first carrier; table shows all.

Each is pinned by a test in the owning task (Tasks 2, 3, 2, 6/8, 2/3 respectively).

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/fares/types.ts` | `FareQuery`, `FareOffer`, `SiteId`, time/duration helpers, `normalizeOffer` |
| `src/shared/fares/bagFees.ts` | Static estimated bag fees per airline |
| `src/shared/fares/rank.ts` | `mergeOffers`, `rankRows`, true total, agreement |
| `src/main/fares/adapters/types.ts` | `SiteAdapter` contract + `PageProbe` |
| `src/main/fares/adapters/google.ts` | Google URL, in-page script, label parser |
| `src/main/fares/adapters/kayak.ts` | Kayak + Momondo (one parser, two hosts) |
| `src/main/fares/adapters/index.ts` | `FARE_ADAPTERS`, `handoffLinks(q)` |
| `src/main/fares/__fixtures__/atl-lax.json` | Real page samples from the 2026-10-12 spike |
| `src/main/fares/hiddenPage.ts` | `PageDriver` interface + Electron implementation |
| `src/main/fares/engine.ts` | `createFareEngine`: parallel sites, cache, spacing, cancel, flex dates |
| `src/main/index.ts` | IPC wiring, watch `fare` mode |
| `src/main/incognito.ts` | Add fare channels to `PRIVATE_BLOCKED_CHANNELS` |
| `src/preload/index.ts` | `electronAPI.fares` bridge |
| `src/renderer/src/components/travel/fares/useFareSearch.ts` | Search state machine (generation-safe) |
| `src/renderer/src/components/travel/fares/aiPick.ts` | Prompt builder + reply validation |
| `src/renderer/src/components/travel/fares/SourceChips.tsx` | Per-site status chips |
| `src/renderer/src/components/travel/fares/FlexDateStrip.tsx` | ±3-day price strip |
| `src/renderer/src/components/travel/fares/AiPickCard.tsx` | Best-pick card |
| `src/renderer/src/components/travel/fares/FareTable.tsx` | Sort/filter bar + rows |
| `src/renderer/src/components/travel/FlightsRentalsPage.tsx` | Compose live results for `kind === 'flights'`; prefill from Travel |
| `src/renderer/src/components/travel/flightsRentals.css` | Styles for new components |
| `src/renderer/src/components/travel/TravelPage.tsx` | "Fly here" button |

---

### Task 1: Shared fare types and normalization

**Files:**
- Create: `src/shared/fares/types.ts`
- Test: `src/shared/fares/types.test.ts`

**Interfaces:**
- Produces:
  - `type SiteId = 'google' | 'kayak' | 'momondo'`
  - `interface FareQuery { from: string; to: string; depart: string; ret: string; adults: number; currency: 'USD'|'EUR'|'GBP'|'CAD'|'AUD' }` (IATA codes, `YYYY-MM-DD`)
  - `interface Leg { departTime: string; arriveTime: string; arriveDayOffset: number; airlines: string[]; stops: number; layovers: string[]; durationMin: number }`
  - `interface FareOffer extends Leg { source: SiteId; price: number; currency: string; bags: { carry: number; checked: number } | null; bookUrl: string; ret: Leg | null }`
  - `to24h(t: string): string | null`, `parseDuration(s: string): number | null`, `splitAirlines(s: string): string[]`, `parseMoney(s: string): number | null`, `normalizeOffer(o: FareOffer): FareOffer | null`, `offerKey(o: Pick<Leg,'airlines'|'departTime'|'arriveTime'|'arriveDayOffset'>): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/fares/types.test.ts
import { describe, it, expect } from 'vitest'
import { to24h, parseDuration, splitAirlines, parseMoney, normalizeOffer, offerKey, type FareOffer } from './types'

const base: FareOffer = {
  source: 'google', price: 152, currency: 'USD', airlines: ['Frontier'], stops: 1, layovers: ['Las Vegas'],
  departTime: '21:32', arriveTime: '09:19', arriveDayOffset: 1, durationMin: 887,
  bags: { carry: 0, checked: 0 }, bookUrl: 'https://www.google.com/travel/flights', ret: null,
}

describe('to24h', () => {
  it('handles AM/PM in both cases and spacing', () => {
    expect(to24h('10:29 AM')).toBe('10:29')
    expect(to24h('9:32 pm')).toBe('21:32')
    expect(to24h('12:26 am')).toBe('00:26')
    expect(to24h('12:19 PM')).toBe('12:19')
    expect(to24h('25:00 PM')).toBeNull()
  })
})

describe('parseDuration', () => {
  it('reads Google and Kayak formats', () => {
    expect(parseDuration('8 hr 47 min')).toBe(527)
    expect(parseDuration('5 hr')).toBe(300)
    expect(parseDuration('14h 47m')).toBe(887)
    expect(parseDuration('45 min')).toBe(45)
    expect(parseDuration('soon')).toBeNull()
  })
})

describe('splitAirlines', () => {
  it('splits multi-carrier itineraries', () => {
    expect(splitAirlines('Delta and Alaska')).toEqual(['Delta', 'Alaska'])
    expect(splitAirlines('Delta, Alaska')).toEqual(['Delta', 'Alaska'])
    expect(splitAirlines('Frontier')).toEqual(['Frontier'])
  })
})

describe('parseMoney', () => {
  it('keeps thousands separators intact', () => {
    expect(parseMoney('$1,204')).toBe(1204)
    expect(parseMoney('1,204')).toBe(1204)
    expect(parseMoney('€ 89')).toBe(89)
    expect(parseMoney('free')).toBeNull()
  })
})

describe('normalizeOffer', () => {
  it('accepts a sane offer', () => { expect(normalizeOffer(base)).toEqual(base) })
  it('rejects junk prices, times and airlines', () => {
    expect(normalizeOffer({ ...base, price: 12 })).toBeNull()
    expect(normalizeOffer({ ...base, price: 60_000 })).toBeNull()
    expect(normalizeOffer({ ...base, airlines: [] })).toBeNull()
    expect(normalizeOffer({ ...base, departTime: 'x' })).toBeNull()
    expect(normalizeOffer({ ...base, durationMin: 0 })).toBeNull()
  })
})

describe('offerKey', () => {
  it('matches the same flight across sites regardless of case', () => {
    expect(offerKey(base)).toBe(offerKey({ ...base, airlines: ['frontier'] }))
    expect(offerKey(base)).not.toBe(offerKey({ ...base, arriveDayOffset: 0 }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/fares/types.test.ts`
Expected: FAIL — cannot resolve `./types`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/fares/types.ts
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

export function offerKey(o: Pick<Leg, 'airlines' | 'departTime' | 'arriveTime' | 'arriveDayOffset'>): string {
  return `${o.airlines[0].toLowerCase()}|${o.departTime}|${o.arriveTime}|${o.arriveDayOffset}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/fares/types.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/shared/fares/types.ts src/shared/fares/types.test.ts
git commit -m "feat(fares): shared fare offer types and normalization"
```

---

### Task 2: Google Flights adapter + fixtures

**Files:**
- Create: `src/main/fares/adapters/types.ts`, `src/main/fares/adapters/google.ts`, `src/main/fares/__fixtures__/atl-lax.json`
- Test: `src/main/fares/adapters/google.test.ts`

**Interfaces:**
- Consumes: Task 1 (`FareQuery`, `FareOffer`, `to24h`, `parseDuration`, `splitAirlines`, `parseMoney`, `normalizeOffer`).
- Produces:
  - `interface PageProbe<Raw> { ready: boolean; blocked: boolean; pricesOnPage: number; raw: Raw }`
  - `interface SiteAdapter<Raw> { id: SiteId; label: string; url(q: FareQuery): string; script: string; parse(raw: Raw, q: FareQuery): FareOffer[] }` — `script` is a JS expression string evaluated in the page that returns `PageProbe<Raw>`.
  - `googleAdapter: SiteAdapter<{ labels: string[] }>`
  - `parseGoogleLabel(label: string, bookUrl: string): FareOffer | null`

- [ ] **Step 1: Create the fixture file** (real labels and cards captured 2026-10-12, ATL→LAX Nov 10–17 2026)

```json
{
  "google": {
    "labels": [
      "From 162 US dollars round trip total. 1 stop flight with Frontier. Leaves Hartsfield-Jackson Atlanta International Airport at 10:29 AM on Tuesday, November 10 and arrives at Los Angeles International Airport at 4:16 PM on Tuesday, November 10. Total duration 8 hr 47 min.  Layover (1 of 1) is a 2 hr 43 min layover at Harry Reid International Airport in Las Vegas. 0 carry-on bags included. 0 checked bags included.  Select flight",
      "From 178 US dollars round trip total. Nonstop flight with Frontier. Leaves Hartsfield-Jackson Atlanta International Airport at 10:19 AM on Tuesday, November 10 and arrives at Los Angeles International Airport at 12:19 PM on Tuesday, November 10. Total duration 5 hr.   0 carry-on bags included. 0 checked bags included.  Select flight",
      "From 198 US dollars round trip total. Nonstop flight with Frontier. Leaves Hartsfield-Jackson Atlanta International Airport at 3:45 PM on Tuesday, November 10 and arrives at Los Angeles International Airport at 5:53 PM on Tuesday, November 10. Total duration 5 hr 8 min.   0 carry-on bags included. 0 checked bags included.  Select flight",
      "From 152 US dollars round trip total. 1 stop flight with Frontier. Leaves Hartsfield-Jackson Atlanta International Airport at 9:32 PM on Tuesday, November 10 and arrives at Los Angeles International Airport at 9:19 AM on Wednesday, November 11. Total duration 14 hr 47 min.  Layover (1 of 1) is a 8 hr 52 min layover at Harry Reid International Airport in Las Vegas. 0 carry-on bags included. 0 checked bags included.  Select flight",
      "From 196 US dollars round trip total. 1 stop flight with Frontier. Leaves Hartsfield-Jackson Atlanta International Airport at 7:57 PM on Tuesday, November 10 and arrives at Los Angeles International Airport at 12:23 AM on Wednesday, November 11. Total duration 7 hr 26 min.  Layover (1 of 1) is a 1 hr 23 min layover at Denver International Airport in Denver. 0 carry-on bags included. 0 checked bags included.  Select flight",
      "From 205 US dollars round trip total. 1 stop flight with Frontier. Leaves Hartsfield-Jackson Atlanta International Airport at 10:27 AM on Tuesday, November 10 and arrives at Los Angeles International Airport at 2:53 PM on Tuesday, November 10. Total duration 7 hr 26 min.  Layover (1 of 1) is a 1 hr 8 min layover at Dallas Fort Worth International Airport in Dallas. 0 carry-on bags included. 0 checked bags included.  Select flight"
    ]
  },
  "kayak": {
    "cards": [
      { "text": "Go to next result\nGo to price section\nGo to result details\n9:32 pm – 9:19 am+1\nFrontier\n1 stop\nLAS\n 8h 52m layover, Las Vegas Harry Reid Intl\n14h 47m\nATL\n-\nLAX\n1:20 pm – 8:59 pm\nFrontier\nnonstop\n4h 39m\nLAX\n-\nATL\n0\n0\n$150\nBasic\nSelect", "href": "/book/flight?code=FIXTURE1" },
      { "text": "Go to next result\nGo to previous result\nGo to price section\nGo to result details\n9:32 pm – 9:19 am+1\nFrontier\n1 stop\nLAS\n 8h 52m layover, Las Vegas Harry Reid Intl\n14h 47m\nATL\n-\nLAX\n12:26 am – 8:06 am\nFrontier\nnonstop\n4h 40m\nLAX\n-\nATL\n0\n0\n$150\nBasic\nSelect", "href": "/book/flight?code=FIXTURE2" },
      { "text": "Go to next result\nGo to previous result\nGo to price section\nGo to result details\n9:32 pm – 4:16 pm+1\nFrontier\n1 stop\nLAS\n 15h 47m layover, Las Vegas Harry Reid Intl\n21h 44m\nATL\n-\nLAX\n1:20 pm – 8:59 pm\nFrontier\nnonstop\n4h 39m\nLAX\n-\nATL\n0\n0\n$150\nBasic\nSelect", "href": null },
      { "text": "Go to next result\nGo to previous result\nGo to price section\nGo to result details\n10:29 am – 4:16 pm\nFrontier\n1 stop\nLAS\n 2h 43m layover, Las Vegas Harry Reid Intl\n8h 47m\nATL\n-\nLAX\n1:20 pm – 8:59 pm\nFrontier\nnonstop\n4h 39m\nLAX\n-\nATL\n0\n0\n$160\nBasic\nSelect", "href": "/book/flight?code=FIXTURE4" }
    ]
  },
  "momondo": {
    "cards": [
      { "text": "Go to next result\nGo to price section\nGo to result details\n9:32 pm – 9:19 am+1\nFrontier\n1 stop\nLAS\n 8h 52m layover, Las Vegas Harry Reid Intl\n14h 47m\nATL\n-\nLAX\n1:20 pm – 8:59 pm\nFrontier\nnonstop\n4h 39m\nLAX\n-\nATL\n$145\nBasic\nSelect", "href": "/book/flight?code=FIXTUREM1" }
    ]
  }
}
```

Save as `src/main/fares/__fixtures__/atl-lax.json`.

- [ ] **Step 2: Write the failing test**

```ts
// src/main/fares/adapters/google.test.ts
import { describe, it, expect } from 'vitest'
import fixture from '../__fixtures__/atl-lax.json'
import { googleAdapter, parseGoogleLabel } from './google'
import type { FareQuery } from '../../../shared/fares/types'

const q: FareQuery = { from: 'ATL', to: 'LAX', depart: '2026-11-10', ret: '2026-11-17', adults: 1, currency: 'USD' }
const URL0 = googleAdapter.url(q)

describe('googleAdapter.url', () => {
  it('builds a search for the route, dates and currency', () => {
    expect(URL0).toContain('google.com/travel/flights')
    expect(decodeURIComponent(URL0)).toContain('from ATL to LAX on 2026-11-10 through 2026-11-17')
    expect(URL0).toContain('curr=USD')
  })
})

describe('parseGoogleLabel', () => {
  it('reads a one-stop label fully', () => {
    const o = parseGoogleLabel(fixture.google.labels[0], URL0)!
    expect(o).toMatchObject({
      source: 'google', price: 162, currency: 'USD', airlines: ['Frontier'], stops: 1,
      layovers: ['Las Vegas'], departTime: '10:29', arriveTime: '16:16', arriveDayOffset: 0,
      durationMin: 527, bags: { carry: 0, checked: 0 }, ret: null,
    })
  })

  it('reads nonstop with an hours-only duration', () => {
    const o = parseGoogleLabel(fixture.google.labels[1], URL0)!
    expect(o.stops).toBe(0)
    expect(o.durationMin).toBe(300)
    expect(o.layovers).toEqual([])
  })

  it('detects overnight arrival', () => {
    const o = parseGoogleLabel(fixture.google.labels[3], URL0)!
    expect(o.arriveDayOffset).toBe(1)
    expect(o.departTime).toBe('21:32')
    expect(o.arriveTime).toBe('09:19')
  })

  it('handles thousands separators and multi-carrier itineraries', () => {
    const label = fixture.google.labels[1].replace('From 178 US dollars', 'From 1,204 US dollars').replace('flight with Frontier', 'flight with Delta and Alaska')
    const o = parseGoogleLabel(label, URL0)!
    expect(o.price).toBe(1204)
    expect(o.airlines).toEqual(['Delta', 'Alaska'])
  })

  it('returns null for unrelated aria-labels', () => {
    expect(parseGoogleLabel('Select flight', URL0)).toBeNull()
  })
})

describe('googleAdapter.parse', () => {
  it('parses every fixture label', () => {
    const offers = googleAdapter.parse({ labels: fixture.google.labels }, q)
    expect(offers).toHaveLength(6)
    expect(Math.min(...offers.map(o => o.price))).toBe(152)
  })

  it('dedupes repeated labels (Google renders each offer twice)', () => {
    const labels = [...fixture.google.labels, ...fixture.google.labels]
    expect(googleAdapter.parse({ labels }, q)).toHaveLength(6)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/fares/adapters/google.test.ts`
Expected: FAIL — cannot resolve `./google`.

- [ ] **Step 4: Write the adapter contract**

```ts
// src/main/fares/adapters/types.ts
import type { FareOffer, FareQuery, SiteId } from '../../../shared/fares/types'

/** What an adapter's in-page script reports on each poll. */
export interface PageProbe<Raw> {
  /** The page has rendered enough results to read. */
  ready: boolean
  /** A bot wall / CAPTCHA is showing. */
  blocked: boolean
  /** Price-looking strings anywhere on the page — tells "unreadable" from "empty". */
  pricesOnPage: number
  raw: Raw
}

export interface SiteAdapter<Raw> {
  id: SiteId
  label: string
  url(q: FareQuery): string
  /** A self-contained JS expression, evaluated in the page, returning PageProbe<Raw>.
   *  It must only READ the DOM. */
  script: string
  /** Pure: raw page data → normalized offers. Tested against fixtures. */
  parse(raw: Raw, q: FareQuery): FareOffer[]
}

/** Shared in-page snippet: bot-wall and price-count detection. */
export const COMMON_PROBE = `
  const __t = (document.body && document.body.innerText || '').slice(0, 200000);
  const __blocked = /unusual traffic|verify you are human|are you a robot|press & hold|captcha/i.test(__t);
  const __prices = (__t.match(/[$€£]\\s?\\d{2,5}/g) || []).length;
`
```

- [ ] **Step 5: Write the Google adapter**

```ts
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/main/fares/adapters/google.test.ts`
Expected: PASS. If `import fixture from '...json'` fails, check `resolveJsonModule` in `tsconfig.node.json`; vitest itself imports JSON natively.

- [ ] **Step 7: Commit**

```bash
git add src/main/fares/adapters/types.ts src/main/fares/adapters/google.ts src/main/fares/adapters/google.test.ts src/main/fares/__fixtures__/atl-lax.json
git commit -m "feat(fares): Google Flights adapter parsing accessibility labels"
```

---

### Task 3: Kayak / Momondo adapter

**Files:**
- Create: `src/main/fares/adapters/kayak.ts`, `src/main/fares/adapters/index.ts`
- Test: `src/main/fares/adapters/kayak.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers; Task 2 `SiteAdapter`, `PageProbe`, `COMMON_PROBE`, `googleAdapter`.
- Produces:
  - `type KayakRaw = { cards: { text: string; href: string | null }[] }`
  - `parseKayakCard(card: { text: string; href: string | null }, host: string, fallbackUrl: string, source: 'kayak'|'momondo'): FareOffer | null`
  - `kayakAdapter: SiteAdapter<KayakRaw>`, `momondoAdapter: SiteAdapter<KayakRaw>`
  - `FARE_ADAPTERS: SiteAdapter<any>[]` (google, kayak, momondo)
  - `handoffLinks(q: FareQuery): { name: string; url: string }[]` (Expedia, Skyscanner)

- [ ] **Step 1: Write the failing test**

```ts
// src/main/fares/adapters/kayak.test.ts
import { describe, it, expect } from 'vitest'
import fixture from '../__fixtures__/atl-lax.json'
import { kayakAdapter, momondoAdapter, parseKayakCard } from './kayak'
import { FARE_ADAPTERS, handoffLinks } from './index'
import type { FareQuery } from '../../../shared/fares/types'

const q: FareQuery = { from: 'ATL', to: 'LAX', depart: '2026-11-10', ret: '2026-11-17', adults: 1, currency: 'USD' }

describe('kayakAdapter.url', () => {
  it('requests the route sorted by price', () => {
    expect(kayakAdapter.url(q)).toBe('https://www.kayak.com/flights/ATL-LAX/2026-11-10/2026-11-17?sort=price_a&currency=USD')
    expect(momondoAdapter.url(q)).toContain('https://www.momondo.com/flight-search/ATL-LAX/2026-11-10/2026-11-17')
  })
  it('adds adults when more than one', () => {
    expect(kayakAdapter.url({ ...q, adults: 2 })).toContain('/2026-11-17/2adults?')
  })
})

describe('parseKayakCard', () => {
  it('reads outbound, return, bags, price and deep link', () => {
    const o = parseKayakCard(fixture.kayak.cards[0], 'https://www.kayak.com', kayakAdapter.url(q), 'kayak')!
    expect(o).toMatchObject({
      source: 'kayak', price: 150, airlines: ['Frontier'], stops: 1, layovers: ['LAS'],
      departTime: '21:32', arriveTime: '09:19', arriveDayOffset: 1, durationMin: 887,
      bags: { carry: 0, checked: 0 }, bookUrl: 'https://www.kayak.com/book/flight?code=FIXTURE1',
    })
    expect(o.ret).toMatchObject({ departTime: '13:20', arriveTime: '20:59', stops: 0, durationMin: 279, airlines: ['Frontier'] })
  })

  it('falls back to the search URL when a card has no link', () => {
    const o = parseKayakCard(fixture.kayak.cards[2], 'https://www.kayak.com', 'https://www.kayak.com/flights/X', 'kayak')!
    expect(o.bookUrl).toBe('https://www.kayak.com/flights/X')
  })

  it('reports unknown bags when the counts are missing (Momondo)', () => {
    const o = parseKayakCard(fixture.momondo.cards[0], 'https://www.momondo.com', momondoAdapter.url(q), 'momondo')!
    expect(o.price).toBe(145)
    expect(o.bags).toBeNull()
  })

  it('keeps thousands separators', () => {
    const card = { ...fixture.kayak.cards[0], text: fixture.kayak.cards[0].text.replace('$150', '$1,204') }
    expect(parseKayakCard(card, 'https://www.kayak.com', 'https://www.kayak.com', 'kayak')!.price).toBe(1204)
  })

  it('splits multi-carrier itineraries', () => {
    const card = { ...fixture.kayak.cards[0], text: fixture.kayak.cards[0].text.replace('am+1\nFrontier', 'am+1\nDelta, Alaska') }
    expect(parseKayakCard(card, 'https://www.kayak.com', 'https://www.kayak.com', 'kayak')!.airlines).toEqual(['Delta', 'Alaska'])
  })

  it('rejects the filter sidebar and other non-result blocks', () => {
    expect(parseKayakCard({ text: 'Stops\nNonstop\n$175\n1 stop\n$183', href: null }, 'https://www.kayak.com', 'https://www.kayak.com', 'kayak')).toBeNull()
  })
})

describe('adapter registry', () => {
  it('lists the live sources in priority order', () => {
    expect(FARE_ADAPTERS.map(a => a.id)).toEqual(['google', 'kayak', 'momondo'])
  })
  it('keeps Expedia and Skyscanner as hand-off links', () => {
    expect(handoffLinks(q).map(l => l.name)).toEqual(['Expedia', 'Skyscanner'])
  })
  it('parses every Kayak fixture card', () => {
    expect(kayakAdapter.parse(fixture.kayak, q)).toHaveLength(4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/fares/adapters/kayak.test.ts`
Expected: FAIL — cannot resolve `./kayak`.

- [ ] **Step 3: Write the adapter**

```ts
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
```

`normalizeOffer` runs before `currency` is filled; it does not check `currency`, so this order is fine.

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/fares/adapters/`
Expected: PASS (google + kayak suites).

- [ ] **Step 5: Commit**

```bash
git add src/main/fares/adapters/kayak.ts src/main/fares/adapters/index.ts src/main/fares/adapters/kayak.test.ts
git commit -m "feat(fares): Kayak/Momondo adapter and hand-off links"
```

---

### Task 4: Bag fees, merging and ranking

**Files:**
- Create: `src/shared/fares/bagFees.ts`, `src/shared/fares/rank.ts`
- Test: `src/shared/fares/rank.test.ts`

**Interfaces:**
- Consumes: Task 1 `FareOffer`, `offerKey`, `SiteId`.
- Produces:
  - `estimatedBagFee(airline: string, kind: 'carry' | 'checked'): number` (round trip, per traveller, USD)
  - `interface BagNeeds { carry: boolean; checked: boolean }`
  - `interface SitePrice { source: SiteId; price: number; bookUrl: string; verify: boolean }`
  - `interface FareRow { key: string; offer: FareOffer; prices: SitePrice[]; best: number; bagFee: number; trueTotal: number; agreement: number }`
  - `type SortMode = 'best' | 'cheapest' | 'fastest' | 'stops'`
  - `mergeOffers(offers: FareOffer[]): FareRow[]`
  - `rankRows(rows: FareRow[], mode: SortMode, needs: BagNeeds, adults: number, filters?: { nonstop?: boolean }): FareRow[]`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/fares/rank.test.ts
import { describe, it, expect } from 'vitest'
import { mergeOffers, rankRows } from './rank'
import { estimatedBagFee } from './bagFees'
import type { FareOffer } from './types'

const offer = (over: Partial<FareOffer>): FareOffer => ({
  source: 'google', price: 200, currency: 'USD', airlines: ['Delta'], stops: 0, layovers: [],
  departTime: '07:05', arriveTime: '09:10', arriveDayOffset: 0, durationMin: 305,
  bags: { carry: 1, checked: 0 }, bookUrl: 'https://g.example', ret: null, ...over,
})

describe('mergeOffers', () => {
  it('merges the same outbound flight seen on several sites into one row', () => {
    const rows = mergeOffers([
      offer({ source: 'google', price: 178 }),
      offer({ source: 'kayak', price: 178, bookUrl: 'https://k.example' }),
      offer({ source: 'momondo', price: 181, bookUrl: 'https://m.example' }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].best).toBe(178)
    expect(rows[0].prices.map(p => p.source)).toEqual(['google', 'kayak', 'momondo'])
    expect(rows[0].agreement).toBe(3)
  })

  it('keeps each site\'s cheapest price for an outbound (Kayak lists several returns)', () => {
    const rows = mergeOffers([offer({ source: 'kayak', price: 160 }), offer({ source: 'kayak', price: 150 })])
    expect(rows[0].prices).toHaveLength(1)
    expect(rows[0].prices[0].price).toBe(150)
  })

  it('flags a price far above the others as verify-on-site', () => {
    const rows = mergeOffers([offer({ source: 'google', price: 150 }), offer({ source: 'kayak', price: 240 })])
    expect(rows[0].prices.find(p => p.source === 'kayak')!.verify).toBe(true)
    expect(rows[0].agreement).toBe(1)
  })

  it('matches overnight flights across sites and keeps different days apart', () => {
    const rows = mergeOffers([
      offer({ source: 'google', departTime: '21:32', arriveTime: '09:19', arriveDayOffset: 1 }),
      offer({ source: 'kayak', departTime: '21:32', arriveTime: '09:19', arriveDayOffset: 1 }),
      offer({ source: 'kayak', departTime: '21:32', arriveTime: '09:19', arriveDayOffset: 0 }),
    ])
    expect(rows).toHaveLength(2)
  })
})

describe('rankRows', () => {
  const cheapNoBags = offer({ airlines: ['Frontier'], price: 162, bags: { carry: 0, checked: 0 }, stops: 1, durationMin: 527, departTime: '10:29' })
  const deltaNonstop = offer({ airlines: ['Delta'], price: 190, bags: { carry: 1, checked: 0 }, departTime: '07:05' })

  it('adds bag fees the traveller would actually pay to the true total', () => {
    const [row] = rankRows(mergeOffers([cheapNoBags]), 'cheapest', { carry: true, checked: false }, 1)
    expect(row.bagFee).toBe(estimatedBagFee('Frontier', 'carry'))
    expect(row.trueTotal).toBe(162 + row.bagFee)
  })

  it('multiplies bag fees by travellers', () => {
    const [row] = rankRows(mergeOffers([cheapNoBags]), 'cheapest', { carry: true, checked: true }, 2)
    expect(row.bagFee).toBe((estimatedBagFee('Frontier', 'carry') + estimatedBagFee('Frontier', 'checked')) * 2)
  })

  it('sorts cheapest by true total, not the teaser price', () => {
    const rows = rankRows(mergeOffers([cheapNoBags, deltaNonstop]), 'cheapest', { carry: true, checked: false }, 1)
    expect(rows[0].offer.airlines[0]).toBe('Delta')
  })

  it('sorts fastest and fewest stops', () => {
    const rows = mergeOffers([cheapNoBags, deltaNonstop])
    expect(rankRows(rows, 'fastest', { carry: false, checked: false }, 1)[0].offer.airlines[0]).toBe('Delta')
    expect(rankRows(rows, 'stops', { carry: false, checked: false }, 1)[0].offer.stops).toBe(0)
  })

  it('filters to nonstop', () => {
    const rows = rankRows(mergeOffers([cheapNoBags, deltaNonstop]), 'best', { carry: false, checked: false }, 1, { nonstop: true })
    expect(rows.every(r => r.offer.stops === 0)).toBe(true)
  })
})

describe('estimatedBagFee', () => {
  it('knows low-cost carriers charge for carry-ons and legacy ones do not', () => {
    expect(estimatedBagFee('Frontier', 'carry')).toBeGreaterThan(0)
    expect(estimatedBagFee('Delta', 'carry')).toBe(0)
    expect(estimatedBagFee('Unknown Air', 'checked')).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/fares/rank.test.ts`
Expected: FAIL — cannot resolve `./rank`.

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/fares/bagFees.ts
// Estimated ROUND-TRIP bag fees per traveller, USD, for the first bag paid at
// booking. Airlines change these; the UI labels every figure "est.". The point
// is ordering — a $162 fare that needs $130 of bags is not cheaper than $190
// with a carry-on included — not to quote an exact fee.
const FEES: Record<string, { carry: number; checked: number }> = {
  frontier: { carry: 130, checked: 120 },
  spirit:   { carry: 120, checked: 110 },
  allegiant:{ carry: 100, checked: 100 },
  'sun country': { carry: 80, checked: 80 },
  breeze:   { carry: 70, checked: 80 },
  avelo:    { carry: 70, checked: 80 },
  delta:    { carry: 0, checked: 80 },
  american: { carry: 0, checked: 80 },
  'american airlines': { carry: 0, checked: 80 },
  united:   { carry: 0, checked: 80 },
  alaska:   { carry: 0, checked: 80 },
  jetblue:  { carry: 0, checked: 90 },
  southwest:{ carry: 0, checked: 70 },
  hawaiian: { carry: 0, checked: 60 },
}
const UNKNOWN = { carry: 0, checked: 80 }

export function estimatedBagFee(airline: string, kind: 'carry' | 'checked'): number {
  return (FEES[airline.trim().toLowerCase()] ?? UNKNOWN)[kind]
}
```

```ts
// src/shared/fares/rank.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/fares/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/fares/bagFees.ts src/shared/fares/rank.ts src/shared/fares/rank.test.ts
git commit -m "feat(fares): merge offers across sites and rank by true total"
```

---

### Task 5: Hidden page driver

**Files:**
- Create: `src/main/fares/hiddenPage.ts`
- Test: `src/main/fares/hiddenPage.test.ts`

**Interfaces:**
- Produces:
  - `interface PageHandle { evaluate<T>(script: string): Promise<T>; close(): void }`
  - `interface PageDriver { open(url: string): Promise<PageHandle>; openVisible(url: string): void; alive(): number }`
  - `createSemaphore(max: number): { acquire(): Promise<() => void> }`
  - `createElectronDriver(opts?: { max?: number; watchdogMs?: number }): PageDriver`
  - `chromeUserAgent(ua: string): string`
  - `FARES_PARTITION = 'persist:fares'`

- [ ] **Step 1: Write the failing test** (pure parts only — Electron glue is covered by the live e2e in Task 12)

```ts
// src/main/fares/hiddenPage.test.ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('electron', () => ({ BrowserWindow: class {}, session: { fromPartition: () => ({ getUserAgent: () => '' }) } }))
import { createSemaphore, chromeUserAgent } from './hiddenPage'

describe('createSemaphore', () => {
  it('never lets more than max holders run at once', async () => {
    const sem = createSemaphore(2)
    let running = 0, peak = 0
    await Promise.all([1, 2, 3, 4, 5].map(async () => {
      const release = await sem.acquire()
      running++; peak = Math.max(peak, running)
      await new Promise(r => setTimeout(r, 5))
      running--; release()
    }))
    expect(peak).toBe(2)
  })

  it('a release called twice frees only one slot', async () => {
    const sem = createSemaphore(1)
    const r1 = await sem.acquire()
    r1(); r1()
    const r2 = await sem.acquire()
    let third = false
    void sem.acquire().then(() => { third = true })
    await new Promise(r => setTimeout(r, 5))
    expect(third).toBe(false)
    r2()
  })
})

describe('chromeUserAgent', () => {
  it('drops the Electron and app tokens so sites see plain Chrome', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) aihub-browser/1.75.2 Chrome/152.0.0.0 Electron/44.0.0 Safari/537.36'
    expect(chromeUserAgent(ua)).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/fares/hiddenPage.test.ts`
Expected: FAIL — cannot resolve `./hiddenPage`.

- [ ] **Step 3: Write the implementation**

```ts
// src/main/fares/hiddenPage.ts
// Off-screen pages for reading fare sites. Isolated on their own partition so
// booking-site cookies and trackers never touch the user's browsing profile,
// sandboxed with no preload so a hostile page cannot reach the app, capped so
// a search can never pile windows into RAM (the freeze class fixed in the
// 2026-10-12 audit), and watched so a hung page cannot outlive its search.
import { BrowserWindow, session } from 'electron'

export const FARES_PARTITION = 'persist:fares'

export interface PageHandle { evaluate<T>(script: string): Promise<T>; close(): void }
export interface PageDriver { open(url: string): Promise<PageHandle>; openVisible(url: string): void; alive(): number }

export function createSemaphore(max: number) {
  let active = 0
  const waiters: (() => void)[] = []
  return {
    acquire(): Promise<() => void> {
      return new Promise(resolve => {
        const grant = () => {
          active++
          let released = false
          resolve(() => {
            if (released) return
            released = true
            active--
            waiters.shift()?.()
          })
        }
        if (active < max) grant()
        else waiters.push(grant)
      })
    },
  }
}

export function chromeUserAgent(ua: string): string {
  return ua.replace(/\s?Electron\/\S+/, '').replace(/\s?aihub-browser\/\S+/i, '').replace(/\s{2,}/g, ' ').trim()
}

export function createElectronDriver(opts: { max?: number; watchdogMs?: number } = {}): PageDriver {
  const sem = createSemaphore(opts.max ?? 3)
  const live = new Set<BrowserWindow>()
  const webPreferences = { partition: FARES_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  const ua = () => chromeUserAgent(session.fromPartition(FARES_PARTITION).getUserAgent())

  return {
    alive: () => live.size,
    async open(url) {
      const release = await sem.acquire()
      const win = new BrowserWindow({ show: false, width: 1366, height: 900, webPreferences })
      live.add(win)
      win.webContents.setUserAgent(ua())
      // Read-only: the page may not open windows or start downloads.
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      win.webContents.session.on('will-download', e => e.preventDefault())
      let closed = false
      const close = () => {
        if (closed) return
        closed = true
        clearTimeout(watchdog)
        live.delete(win)
        if (!win.isDestroyed()) win.destroy()
        release()
      }
      const watchdog = setTimeout(close, opts.watchdogMs ?? 60_000)
      // Single-page apps reject loadURL on their own redirects; the poll decides.
      win.loadURL(url).catch(() => {})
      return {
        evaluate: <T>(script: string) => win.isDestroyed()
          ? Promise.reject(new Error('page closed'))
          : (win.webContents.executeJavaScript(script, false) as Promise<T>),
        close,
      }
    },
    openVisible(url) {
      // For a human check (CAPTCHA): same partition, so solving it once
      // unblocks later hidden searches.
      const win = new BrowserWindow({ show: true, width: 1200, height: 860, title: 'Verify — AIHub fares', webPreferences })
      win.webContents.setUserAgent(ua())
      win.loadURL(url).catch(() => {})
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/fares/hiddenPage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/fares/hiddenPage.ts src/main/fares/hiddenPage.test.ts
git commit -m "feat(fares): sandboxed, capped hidden page driver"
```

---

### Task 6: Fare engine

**Files:**
- Create: `src/main/fares/engine.ts`
- Test: `src/main/fares/engine.test.ts`

**Interfaces:**
- Consumes: Task 1 types; Task 2 `SiteAdapter`, `PageProbe`; Task 5 `PageDriver`, `PageHandle`.
- Produces:
  - `type SiteStatus = 'loading' | 'done' | 'cached' | 'blocked' | 'unreadable' | 'empty' | 'timeout' | 'error'`
  - `interface SiteProgress { searchId: string; site: SiteId; label: string; status: SiteStatus; offers: FareOffer[]; url: string; at: number }`
  - `interface FlexDay { depart: string; ret: string; price: number | null }`
  - `createFareEngine(deps: EngineDeps): { search(q: FareQuery, onProgress: (p: SiteProgress) => void): { id: string; done: Promise<FareOffer[]> }; cancel(id: string): void; flexDates(q: FareQuery, onDay: (d: FlexDay) => void): Promise<FlexDay[]> }`
  - `interface EngineDeps { driver: PageDriver; adapters: SiteAdapter<any>[]; now?: () => number; sleep?: (ms: number) => Promise<void>; pollMs?: number; deadlineMs?: number; cacheMs?: number; spacingMs?: number; flexGapMs?: number }`
  - `shiftDate(iso: string, days: number): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/fares/engine.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createFareEngine, shiftDate, type SiteProgress } from './engine'
import type { SiteAdapter, PageProbe } from './adapters/types'
import type { PageDriver } from './hiddenPage'
import type { FareOffer, FareQuery } from '../../shared/fares/types'

const q: FareQuery = { from: 'ATL', to: 'LAX', depart: '2026-11-10', ret: '2026-11-17', adults: 1, currency: 'USD' }
const offer = (price: number, source: any = 'google'): FareOffer => ({
  source, price, currency: 'USD', airlines: ['Delta'], stops: 0, layovers: [], departTime: '07:05', arriveTime: '09:10',
  arriveDayOffset: 0, durationMin: 305, bags: null, bookUrl: 'https://x.example', ret: null,
})

function adapter(id: any, probes: PageProbe<any>[], parsed: FareOffer[] = [offer(150, id)]): SiteAdapter<any> {
  return { id, label: id, url: x => `https://${id}.example/${x.depart}`, script: `probe:${id}`, parse: () => parsed }
}

function fakeDriver(byUrl: (url: string) => PageProbe<any>[]): PageDriver & { opened: string[]; closed: number } {
  const d = {
    opened: [] as string[], closed: 0,
    alive: () => 0,
    openVisible: vi.fn(),
    async open(url: string) {
      d.opened.push(url)
      const seq = byUrl(url); let i = 0
      return { evaluate: async () => seq[Math.min(i++, seq.length - 1)], close: () => { d.closed++ } }
    },
  }
  return d
}

const ready = (n = 3): PageProbe<any> => ({ ready: true, blocked: false, pricesOnPage: n, raw: {} })
const notYet: PageProbe<any> = { ready: false, blocked: false, pricesOnPage: 0, raw: {} }
const fast = { sleep: async () => {}, pollMs: 1 }

describe('createFareEngine.search', () => {
  it('streams loading then done per site and resolves with all offers', async () => {
    const driver = fakeDriver(() => [notYet, ready()])
    const engine = createFareEngine({ driver, adapters: [adapter('google', []), adapter('kayak', [])], ...fast })
    const events: SiteProgress[] = []
    const { done } = engine.search(q, p => events.push(p))
    const offers = await done
    expect(offers.map(o => o.source).sort()).toEqual(['google', 'kayak'])
    expect(events.filter(e => e.status === 'loading')).toHaveLength(2)
    expect(events.filter(e => e.status === 'done')).toHaveLength(2)
    expect(driver.closed).toBe(2)
  })

  it('reports a bot wall as blocked', async () => {
    const driver = fakeDriver(() => [{ ready: false, blocked: true, pricesOnPage: 0, raw: {} }])
    const engine = createFareEngine({ driver, adapters: [adapter('kayak', [])], ...fast })
    const events: SiteProgress[] = []
    await engine.search(q, p => events.push(p)).done
    expect(events.at(-1)!.status).toBe('blocked')
  })

  it('says unreadable when the page never became ready but shows prices (layout changed)', async () => {
    let t = 0
    const driver = fakeDriver(() => [{ ready: false, blocked: false, pricesOnPage: 30, raw: {} }])
    const engine = createFareEngine({ driver, adapters: [adapter('kayak', [], [])], now: () => t, sleep: async ms => { t += ms }, pollMs: 1000, deadlineMs: 3000 })
    const events: SiteProgress[] = []
    await engine.search(q, p => events.push(p)).done
    expect(events.at(-1)!.status).toBe('unreadable')
  })

  it('says unreadable — not empty — when prices are on the page but none parse', async () => {
    const driver = fakeDriver(() => [ready(40)])
    const engine = createFareEngine({ driver, adapters: [adapter('momondo', [], [])], ...fast })
    const events: SiteProgress[] = []
    await engine.search(q, p => events.push(p)).done
    expect(events.at(-1)!.status).toBe('unreadable')
  })

  it('times out a site that never becomes ready, without failing the others', async () => {
    let t = 0
    const driver = fakeDriver(url => url.includes('kayak') ? [notYet] : [ready()])
    const engine = createFareEngine({
      driver, adapters: [adapter('google', []), adapter('kayak', [], [])],
      now: () => t, sleep: async ms => { t += ms }, pollMs: 1000, deadlineMs: 5000,
    })
    const events: SiteProgress[] = []
    const offers = await engine.search(q, p => events.push(p)).done
    expect(events.find(e => e.site === 'kayak' && e.status === 'timeout')).toBeTruthy()
    expect(offers.map(o => o.source)).toEqual(['google'])
  })

  it('serves a repeat search from cache without opening pages', async () => {
    const driver = fakeDriver(() => [ready()])
    const engine = createFareEngine({ driver, adapters: [adapter('google', [])], ...fast })
    await engine.search(q, () => {}).done
    const events: SiteProgress[] = []
    await engine.search(q, p => events.push(p)).done
    expect(driver.opened).toHaveLength(1)
    expect(events.at(-1)!.status).toBe('cached')
  })

  it('cancel stops progress events and closes pages', async () => {
    const driver = fakeDriver(() => [notYet, notYet, notYet, ready()])
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const engine = createFareEngine({ driver, adapters: [adapter('google', [])], sleep: () => gate, pollMs: 1 })
    const events: SiteProgress[] = []
    const { id, done } = engine.search(q, p => events.push(p))
    await Promise.resolve()
    engine.cancel(id)
    release()
    expect(await done).toEqual([])
    expect(events.every(e => e.status === 'loading')).toBe(true)
  })

  it('waits out the per-site spacing before reloading the same site', async () => {
    let t = 0
    const slept: number[] = []
    const driver = fakeDriver(() => [ready()])
    const engine = createFareEngine({ driver, adapters: [adapter('google', [])], now: () => t, sleep: async ms => { slept.push(ms); t += ms }, pollMs: 1, spacingMs: 20_000, cacheMs: 0 })
    await engine.search(q, () => {}).done
    await engine.search({ ...q, depart: '2026-11-11' }, () => {}).done
    expect(slept.some(ms => ms >= 19_000)).toBe(true)
  })
})

describe('flexDates', () => {
  it('probes ±3 days on Google only and stops at the first block', async () => {
    let calls = 0
    const driver = fakeDriver(() => { calls++; return calls === 3 ? [{ ready: false, blocked: true, pricesOnPage: 0, raw: {} }] : [ready()] })
    const engine = createFareEngine({ driver, adapters: [adapter('google', []), adapter('kayak', [])], ...fast, spacingMs: 0 })
    const days = await engine.flexDates(q, () => {})
    expect(driver.opened.every(u => u.startsWith('https://google.example'))).toBe(true)
    expect(days.filter(d => d.price !== null)).toHaveLength(2)
    expect(driver.opened).toHaveLength(3)
  })

  it('shiftDate moves both directions across month ends', () => {
    expect(shiftDate('2026-11-30', 1)).toBe('2026-12-01')
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/fares/engine.test.ts`
Expected: FAIL — cannot resolve `./engine`.

- [ ] **Step 3: Write the implementation**

```ts
// src/main/fares/engine.ts
// Runs one fare search across every live site: pages in parallel (the driver
// caps how many), results streamed per site as they land, a cache so a
// re-run costs nothing, and spacing so the app never hammers a site into
// showing it a CAPTCHA.
import type { FareOffer, FareQuery, SiteId } from '../../shared/fares/types'
import type { PageProbe, SiteAdapter } from './adapters/types'
import type { PageDriver } from './hiddenPage'

export type SiteStatus = 'loading' | 'done' | 'cached' | 'blocked' | 'unreadable' | 'empty' | 'timeout' | 'error'
export interface SiteProgress { searchId: string; site: SiteId; label: string; status: SiteStatus; offers: FareOffer[]; url: string; at: number }
export interface FlexDay { depart: string; ret: string; price: number | null }
export interface EngineDeps {
  driver: PageDriver
  adapters: SiteAdapter<any>[]
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  pollMs?: number
  deadlineMs?: number
  cacheMs?: number
  spacingMs?: number
  flexGapMs?: number
}

export function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const keyOf = (q: FareQuery, site: SiteId) => `${site}|${q.from}|${q.to}|${q.depart}|${q.ret}|${q.adults}|${q.currency}`

export function createFareEngine(deps: EngineDeps) {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const pollMs = deps.pollMs ?? 1500
  const deadlineMs = deps.deadlineMs ?? 35_000
  const cacheMs = deps.cacheMs ?? 15 * 60_000
  const spacingMs = deps.spacingMs ?? 20_000
  const flexGapMs = deps.flexGapMs ?? 3000

  const cache = new Map<string, { at: number; offers: FareOffer[] }>()
  const lastLoad = new Map<SiteId, number>()
  const cancelled = new Set<string>()
  let seq = 0

  /** Load one site and read it. Never throws. */
  async function runSite(adapter: SiteAdapter<any>, q: FareQuery, isLive: () => boolean, spaced = true): Promise<{ status: SiteStatus; offers: FareOffer[] }> {
    if (spaced) {
      const wait = (lastLoad.get(adapter.id) ?? -Infinity) + spacingMs - now()
      if (wait > 0) await sleep(wait)
    }
    if (!isLive()) return { status: 'loading', offers: [] }
    lastLoad.set(adapter.id, now())
    let page
    try { page = await deps.driver.open(adapter.url(q)) } catch { return { status: 'error', offers: [] } }
    try {
      const started = now()
      let last: PageProbe<any> | null = null
      while (now() - started < deadlineMs) {
        if (!isLive()) return { status: 'loading', offers: [] }
        try { last = await page.evaluate<PageProbe<any>>(adapter.script) } catch { last = null }
        if (last?.blocked) return { status: 'blocked', offers: [] }
        if (last?.ready) break
        await sleep(pollMs)
      }
      if (!last) return { status: 'timeout', offers: [] }
      let offers: FareOffer[] = []
      try { offers = adapter.parse(last.raw, q) } catch { offers = [] }
      // Partial results beat none: a page that rendered 3 cards before the
      // deadline still yields 3 offers. Prices on the page that nothing could
      // parse means the layout moved — say so, never "no flights".
      if (offers.length) return { status: 'done', offers }
      if (last.pricesOnPage > 0) return { status: 'unreadable', offers: [] }
      return { status: last.ready ? 'empty' : 'timeout', offers: [] }
    } finally {
      page.close()
    }
  }

  function search(q: FareQuery, onProgress: (p: SiteProgress) => void) {
    const id = `fs-${now()}-${++seq}`
    const isLive = () => !cancelled.has(id)
    const emit = (adapter: SiteAdapter<any>, status: SiteStatus, offers: FareOffer[]) => {
      if (isLive()) onProgress({ searchId: id, site: adapter.id, label: adapter.label, status, offers, url: adapter.url(q), at: now() })
    }
    const done = Promise.all(deps.adapters.map(async adapter => {
      const k = keyOf(q, adapter.id)
      const hit = cache.get(k)
      if (hit && now() - hit.at < cacheMs) { emit(adapter, 'cached', hit.offers); return hit.offers }
      emit(adapter, 'loading', [])
      const r = await runSite(adapter, q, isLive)
      if (!isLive()) return []
      if (r.status === 'done') cache.set(k, { at: now(), offers: r.offers })
      emit(adapter, r.status, r.offers)
      return r.offers
    })).then(lists => isLive() ? lists.flat() : [])
      .finally(() => { cancelled.delete(id) })
    return { id, done }
  }

  async function flexDates(q: FareQuery, onDay: (d: FlexDay) => void): Promise<FlexDay[]> {
    const google = deps.adapters.find(a => a.id === 'google')
    if (!google) return []
    const out: FlexDay[] = []
    for (const shift of [-3, -2, -1, 1, 2, 3]) {
      const day = { ...q, depart: shiftDate(q.depart, shift), ret: shiftDate(q.ret, shift) }
      const k = keyOf(day, 'google')
      const hit = cache.get(k)
      let price: number | null
      if (hit && now() - hit.at < cacheMs) {
        price = hit.offers.length ? Math.min(...hit.offers.map(o => o.price)) : null
      } else {
        const r = await runSite(google, day, () => true, false)
        if (r.status === 'blocked') break
        if (r.status === 'done') cache.set(k, { at: now(), offers: r.offers })
        price = r.offers.length ? Math.min(...r.offers.map(o => o.price)) : null
        await sleep(flexGapMs)
      }
      const d = { depart: day.depart, ret: day.ret, price }
      out.push(d)
      onDay(d)
    }
    return out
  }

  return { search, flexDates, cancel: (id: string) => { cancelled.add(id) } }
}
```

Note on the flex test: the 3rd opened page is blocked → loop breaks; days 1 and 2 have prices → `filter(price !== null)` = 2, `opened` = 3. ✔

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/fares/engine.test.ts`
Expected: PASS. If the cancel test hangs, check that `runSite` checks `isLive()` after every `sleep`.

- [ ] **Step 5: Commit**

```bash
git add src/main/fares/engine.ts src/main/fares/engine.test.ts
git commit -m "feat(fares): fare engine with streaming, cache, spacing and cancel"
```

---

### Task 7: IPC, preload and Incognito guard

**Files:**
- Modify: `src/main/index.ts` (imports near line 35; new section after the `rewind:clear` handler)
- Modify: `src/main/incognito.ts:52-61` (`PRIVATE_BLOCKED_CHANNELS`)
- Modify: `src/preload/index.ts` (after the `rewind` block, ~line 455)
- Test: `src/main/incognito.test.ts` (existing — must keep passing)

**Interfaces:**
- Consumes: Tasks 3, 5, 6.
- Produces (renderer-visible, `window.electronAPI.fares`):
  - `search(q: FareQuery): Promise<{ searchId: string } | { error: 'private' }>`
  - `cancel(searchId: string): Promise<void>`
  - `flex(q: FareQuery): Promise<FlexDay[] | { error: 'private' }>`
  - `handoff(q: FareQuery): Promise<{ name: string; url: string }[]>`
  - `openSite(url: string): Promise<void>` — visible window in `persist:fares` for a human check
  - `onProgress(cb: (p: SiteProgress) => void): () => void`
  - `onFlexDay(cb: (d: FlexDay) => void): () => void`

- [ ] **Step 1: Add the channels to the Incognito guard list (test drives it)**

In `src/main/incognito.ts`, append to `PRIVATE_BLOCKED_CHANNELS`:

```ts
  'fares:search',           // loads booking sites into the persistent fares partition
  'fares:flex',             // same, for the flexible-date strip
```

- [ ] **Step 2: Run the guard test to see it fail**

Run: `npx vitest run src/main/incognito.test.ts`
Expected: FAIL — `fares:search` is not registered through `handlePersistent`.

- [ ] **Step 3: Wire the main process**

Add imports at the top of `src/main/index.ts`:

```ts
import { createFareEngine } from './fares/engine'
import { createElectronDriver, FARES_PARTITION } from './fares/hiddenPage'
import { FARE_ADAPTERS, handoffLinks } from './fares/adapters'
import type { FareQuery } from '../shared/fares/types'
```

Add after the `rewind:clear` handler:

```ts
// ── Live flight fares ──────────────────────────────────────────────────────
// Booking sites are read in sandboxed hidden pages on their own partition;
// see src/main/fares/. Created lazily: most sessions never search a flight.
let _fareDriver: ReturnType<typeof createElectronDriver> | null = null
let _fareEngine: ReturnType<typeof createFareEngine> | null = null
function fareEngine() {
  if (!_fareEngine) {
    _fareDriver = createElectronDriver({ max: 3 })
    _fareEngine = createFareEngine({ driver: _fareDriver, adapters: FARE_ADAPTERS })
  }
  return _fareEngine
}

const IATA = /^[A-Z]{3}$/
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
function validFareQuery(q: any): q is FareQuery {
  return !!q && IATA.test(q.from) && IATA.test(q.to) && q.from !== q.to
    && ISO_DAY.test(q.depart) && ISO_DAY.test(q.ret) && q.ret > q.depart
    && Number.isInteger(q.adults) && q.adults >= 1 && q.adults <= 9
    && ['USD', 'EUR', 'GBP', 'CAD', 'AUD'].includes(q.currency)
}

handlePersistent('fares:search', (e, q: FareQuery) => {
  if (!validFareQuery(q)) return { error: 'invalid' }
  const sender = e.sender
  const { id, done } = fareEngine().search(q, p => { if (!sender.isDestroyed()) sender.send('fares:progress', p) })
  void done.catch(() => {})
  return { searchId: id }
}, () => ({ error: 'private' }))

handlePersistent('fares:flex', async (e, q: FareQuery) => {
  if (!validFareQuery(q)) return []
  const sender = e.sender
  return fareEngine().flexDates(q, d => { if (!sender.isDestroyed()) sender.send('fares:flexDay', d) })
}, () => ({ error: 'private' }))

ipcMain.handle('fares:cancel', (_e, searchId: string) => { _fareEngine?.cancel(String(searchId)) })
ipcMain.handle('fares:handoff', (_e, q: FareQuery) => validFareQuery(q) ? handoffLinks(q) : [])
ipcMain.handle('fares:openSite', (_e, url: string) => {
  // Only the sites the engine itself loads — never an arbitrary URL.
  if (!/^https:\/\/www\.(google\.com\/travel\/flights|kayak\.com|momondo\.com)\//.test(String(url))) return
  fareEngine(); _fareDriver!.openVisible(String(url))
})
```

- [ ] **Step 4: Expose it in the preload**

In `src/preload/index.ts`, add after the `rewind: { … },` block:

```ts
  fares: {
    search:   (q: any) => ipcRenderer.invoke('fares:search', q),
    cancel:   (searchId: string) => ipcRenderer.invoke('fares:cancel', searchId),
    flex:     (q: any) => ipcRenderer.invoke('fares:flex', q),
    handoff:  (q: any) => ipcRenderer.invoke('fares:handoff', q),
    openSite: (url: string) => ipcRenderer.invoke('fares:openSite', url),
    onProgress: (cb: (p: any) => void) => { const h = (_: any, p: any) => cb(p); ipcRenderer.on('fares:progress', h); return () => ipcRenderer.removeListener('fares:progress', h) },
    onFlexDay:  (cb: (d: any) => void) => { const h = (_: any, d: any) => cb(d); ipcRenderer.on('fares:flexDay', h); return () => ipcRenderer.removeListener('fares:flexDay', h) },
  },
```

- [ ] **Step 5: Clear the fares partition with the rest of browsing data**

In the `cache:clear` handler (`src/main/index.ts`, ~line 4043), booking-site cookies must go too. Replace its `Promise.all([...])` with:

```ts
  const faresSession = session.fromPartition(FARES_PARTITION)
  await Promise.all([
    session.defaultSession.clearCache(),
    tabSession.clearCache(),
    tabSession.clearStorageData(),
    faresSession.clearCache(),
    faresSession.clearStorageData(),
  ])
```

and add `FARES_PARTITION` to the `./fares/hiddenPage` import.

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run src/main/incognito.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/index.ts src/main/incognito.ts src/preload/index.ts
git commit -m "feat(fares): IPC bridge with Incognito guard and allow-listed visible verify"
```

---

### Task 8: Renderer search state hook

**Files:**
- Create: `src/renderer/src/components/travel/fares/useFareSearch.ts`
- Test: `src/renderer/src/components/travel/fares/useFareSearch.test.ts`

**Interfaces:**
- Consumes: Task 7 `window.electronAPI.fares`; Task 1 types; Task 6 `SiteProgress`, `FlexDay` (re-declared structurally — the renderer cannot import from `src/main`).
- Produces:
  - `type SiteState = { site: SiteId; label: string; status: SiteStatus; count: number; url: string; at: number }`
  - `interface FareSearchState { phase: 'idle' | 'searching' | 'done' | 'private' | 'error'; sites: SiteState[]; offers: FareOffer[]; flex: FlexDay[] }`
  - `reduceProgress(state: FareSearchState, p: SiteProgress, activeId: string | null): FareSearchState` (pure)
  - `useFareSearch(): { state: FareSearchState; start(q: FareQuery): void; cancel(): void }`

- [ ] **Step 1: Write the failing test** (the reducer carries the logic; the hook is thin)

```ts
// src/renderer/src/components/travel/fares/useFareSearch.test.ts
import { describe, it, expect } from 'vitest'
import { reduceProgress, initialFareState, type SiteProgress } from './useFareSearch'
import type { FareOffer } from '../../../../../shared/fares/types'

const o = (price: number, source: any): FareOffer => ({ source, price, currency: 'USD', airlines: ['Delta'], stops: 0, layovers: [], departTime: '07:05', arriveTime: '09:10', arriveDayOffset: 0, durationMin: 305, bags: null, bookUrl: 'https://x.example', ret: null })
const p = (over: Partial<SiteProgress>): SiteProgress => ({ searchId: 's1', site: 'google', label: 'Google Flights', status: 'loading', offers: [], url: 'https://g', at: 1, ...over })

describe('reduceProgress', () => {
  it('adds offers as sites finish and marks done when every site is final', () => {
    let s = { ...initialFareState(), phase: 'searching' as const }
    s = reduceProgress(s, p({ status: 'loading' }), 's1')
    s = reduceProgress(s, p({ site: 'kayak', label: 'Kayak', status: 'loading' }), 's1')
    s = reduceProgress(s, p({ status: 'done', offers: [o(150, 'google')] }), 's1')
    expect(s.phase).toBe('searching')
    expect(s.offers).toHaveLength(1)
    s = reduceProgress(s, p({ site: 'kayak', label: 'Kayak', status: 'blocked' }), 's1')
    expect(s.phase).toBe('done')
    expect(s.sites.find(x => x.site === 'kayak')!.status).toBe('blocked')
  })

  it('ignores events from a stale search (form edited mid-search)', () => {
    const s0 = { ...initialFareState(), phase: 'searching' as const }
    const s1 = reduceProgress(s0, p({ searchId: 'old', status: 'done', offers: [o(99, 'google')] }), 's2')
    expect(s1).toBe(s0)
  })

  it('replaces a site\'s offers rather than duplicating them on a repeat event', () => {
    let s = { ...initialFareState(), phase: 'searching' as const }
    s = reduceProgress(s, p({ status: 'done', offers: [o(150, 'google')] }), 's1')
    s = reduceProgress(s, p({ status: 'done', offers: [o(149, 'google')] }), 's1')
    expect(s.offers.map(x => x.price)).toEqual([149])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/travel/fares/useFareSearch.test.ts`
Expected: FAIL — cannot resolve `./useFareSearch`.

- [ ] **Step 3: Write the implementation**

```ts
// src/renderer/src/components/travel/fares/useFareSearch.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FareOffer, FareQuery, SiteId } from '../../../../../shared/fares/types'

export type SiteStatus = 'loading' | 'done' | 'cached' | 'blocked' | 'unreadable' | 'empty' | 'timeout' | 'error'
export interface SiteProgress { searchId: string; site: SiteId; label: string; status: SiteStatus; offers: FareOffer[]; url: string; at: number }
export interface FlexDay { depart: string; ret: string; price: number | null }
export interface SiteState { site: SiteId; label: string; status: SiteStatus; count: number; url: string; at: number }
export interface FareSearchState { phase: 'idle' | 'searching' | 'done' | 'private' | 'error'; sites: SiteState[]; offers: FareOffer[]; flex: FlexDay[] }

export const initialFareState = (): FareSearchState => ({ phase: 'idle', sites: [], offers: [], flex: [] })

/** Pure: fold one progress event into the state. Stale searches are ignored. */
export function reduceProgress(state: FareSearchState, p: SiteProgress, activeId: string | null): FareSearchState {
  if (!activeId || p.searchId !== activeId) return state
  const site: SiteState = { site: p.site, label: p.label, status: p.status, count: p.offers.length, url: p.url, at: p.at }
  const sites = state.sites.some(s => s.site === p.site)
    ? state.sites.map(s => s.site === p.site ? site : s)
    : [...state.sites, site]
  const offers = p.status === 'loading' ? state.offers : [...state.offers.filter(o => o.source !== p.site), ...p.offers]
  const allFinal = sites.length > 0 && sites.every(s => s.status !== 'loading')
  return { ...state, sites, offers, phase: allFinal ? 'done' : state.phase }
}

export function useFareSearch() {
  const [state, setState] = useState<FareSearchState>(initialFareState)
  const active = useRef<string | null>(null)
  const api = (window as any).electronAPI?.fares

  useEffect(() => {
    if (!api) return
    const offP = api.onProgress((p: SiteProgress) => setState(s => reduceProgress(s, p, active.current)))
    const offF = api.onFlexDay((d: FlexDay) => setState(s => s.phase === 'idle' ? s : { ...s, flex: [...s.flex.filter(x => x.depart !== d.depart), d].sort((a, b) => a.depart.localeCompare(b.depart)) }))
    return () => { offP(); offF(); if (active.current) void api.cancel(active.current) }
  }, [api])

  const cancel = useCallback(() => {
    if (active.current && api) void api.cancel(active.current)
    active.current = null
    setState(initialFareState())
  }, [api])

  const start = useCallback(async (q: FareQuery) => {
    if (!api) { setState({ ...initialFareState(), phase: 'error' }); return }
    if (active.current) void api.cancel(active.current)
    active.current = null
    setState({ ...initialFareState(), phase: 'searching' })
    const res = await api.search(q)
    if (res?.error === 'private') { setState({ ...initialFareState(), phase: 'private' }); return }
    if (!res?.searchId) { setState({ ...initialFareState(), phase: 'error' }); return }
    active.current = res.searchId
    // Flex strip runs after the main search; failures just leave it empty.
    void (async () => {
      const id = res.searchId
      while (active.current === id) {
        await new Promise(r => setTimeout(r, 1000))
        let finished = false
        setState(s => { finished = s.phase === 'done'; return s })
        if (finished) break
      }
      if (active.current === id) void api.flex(q).catch(() => {})
    })()
  }, [api])

  return { state, start, cancel }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/travel/fares/useFareSearch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/travel/fares/useFareSearch.ts src/renderer/src/components/travel/fares/useFareSearch.test.ts
git commit -m "feat(fares): renderer search state with stale-event protection"
```

---

### Task 9: AI best pick

**Files:**
- Create: `src/renderer/src/components/travel/fares/aiPick.ts`
- Test: `src/renderer/src/components/travel/fares/aiPick.test.ts`

**Interfaces:**
- Consumes: Task 4 `FareRow`.
- Produces:
  - `buildPickPrompt(rows: FareRow[], ctx: { adults: number; needs: BagNeeds }): { role: string; content: string }[]`
  - `parsePick(reply: string, rows: FareRow[]): { key: string; reason: string } | null`
  - `fetchAiPick(rows: FareRow[], ctx, chat: (m: any[]) => Promise<any>): Promise<{ key: string; reason: string } | null>`

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/components/travel/fares/aiPick.test.ts
import { describe, it, expect } from 'vitest'
import { buildPickPrompt, parsePick, fetchAiPick } from './aiPick'
import { mergeOffers, rankRows } from '../../../../../shared/fares/rank'
import type { FareOffer } from '../../../../../shared/fares/types'

const o = (over: Partial<FareOffer>): FareOffer => ({ source: 'google', price: 178, currency: 'USD', airlines: ['Delta'], stops: 0, layovers: [], departTime: '07:05', arriveTime: '09:10', arriveDayOffset: 0, durationMin: 305, bags: { carry: 1, checked: 0 }, bookUrl: 'https://x.example', ret: null, ...over })
const rows = rankRows(mergeOffers([o({}), o({ airlines: ['Frontier'], price: 152, stops: 1, durationMin: 887, departTime: '21:32', bags: { carry: 0, checked: 0 } })]), 'best', { carry: true, checked: false }, 1)

describe('buildPickPrompt', () => {
  it('sends normalized fields only, keyed by row id', () => {
    const msgs = buildPickPrompt(rows, { adults: 1, needs: { carry: true, checked: false } })
    const text = msgs.map(m => m.content).join('\n')
    expect(text).toContain(rows[0].key)
    expect(text).not.toContain('https://')
  })
})

describe('parsePick', () => {
  it('accepts a reply naming a real row', () => {
    const reply = JSON.stringify({ key: rows[1].key, reason: 'Nonstop, carry-on included.' })
    expect(parsePick(`Sure!\n${reply}`, rows)).toEqual({ key: rows[1].key, reason: 'Nonstop, carry-on included.' })
  })
  it('discards a pick for a row that does not exist', () => {
    expect(parsePick(JSON.stringify({ key: 'made|up|key|0', reason: 'x' }), rows)).toBeNull()
  })
  it('discards non-JSON replies', () => {
    expect(parsePick('I recommend Delta.', rows)).toBeNull()
  })
})

describe('fetchAiPick', () => {
  it('returns null when the AI provider failed', async () => {
    expect(await fetchAiPick(rows, { adults: 1, needs: { carry: true, checked: false } }, async () => ({ provider: 'none', content: 'AI providers are currently unavailable.' }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/travel/fares/aiPick.test.ts`
Expected: FAIL — cannot resolve `./aiPick`.

- [ ] **Step 3: Write the implementation**

```ts
// src/renderer/src/components/travel/fares/aiPick.ts
// The AI never sees a booking page. It gets the normalized table — numbers the
// parsers already validated — and must answer with one row key from it. A
// pick for a row that isn't there is a hallucination and is dropped.
import type { BagNeeds, FareRow } from '../../../../../shared/fares/rank'

const MAX_ROWS = 15

export function buildPickPrompt(rows: FareRow[], ctx: { adults: number; needs: BagNeeds }) {
  const table = rows.slice(0, MAX_ROWS).map(r => ({
    key: r.key,
    airlines: r.offer.airlines.join(' + '),
    depart: r.offer.departTime, arrive: `${r.offer.arriveTime}${r.offer.arriveDayOffset ? ` +${r.offer.arriveDayOffset}d` : ''}`,
    stops: r.offer.stops, hours: +(r.offer.durationMin / 60).toFixed(1),
    fare: r.best, bagFeesEst: r.bagFee, trueTotal: r.trueTotal, sitesAgreeing: r.agreement,
  }))
  return [
    { role: 'system', content: 'You pick the best-value flight from a table. Reply with ONLY a JSON object {"key": "<row key>", "reason": "<one sentence, max 25 words, citing numbers from the table>"}. The key must be copied exactly from the table. Never invent prices.' },
    { role: 'user', content: `Travellers: ${ctx.adults}. Bringing: ${ctx.needs.carry ? 'carry-on' : 'no carry-on'}, ${ctx.needs.checked ? 'checked bag' : 'no checked bag'}.\nTable (JSON):\n${JSON.stringify(table)}` },
  ]
}

export function parsePick(reply: string, rows: FareRow[]): { key: string; reason: string } | null {
  const m = /\{[\s\S]*\}/.exec(reply || '')
  if (!m) return null
  try {
    const j = JSON.parse(m[0])
    const key = String(j?.key || '')
    const reason = String(j?.reason || '').replace(/\s+/g, ' ').trim().slice(0, 200)
    if (!reason || !rows.some(r => r.key === key)) return null
    return { key, reason }
  } catch { return null }
}

export async function fetchAiPick(rows: FareRow[], ctx: { adults: number; needs: BagNeeds }, chat: (m: any[]) => Promise<any>) {
  if (rows.length < 2) return null
  try {
    const res = await chat(buildPickPrompt(rows, ctx))
    if (!res?.content || res.provider === 'none') return null
    return parsePick(String(res.content), rows)
  } catch { return null }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/travel/fares/aiPick.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/travel/fares/aiPick.ts src/renderer/src/components/travel/fares/aiPick.test.ts
git commit -m "feat(fares): AI best pick grounded in the normalized table"
```

---

### Task 10: Results UI components and page integration

**Files:**
- Create: `src/renderer/src/components/travel/fares/SourceChips.tsx`, `FlexDateStrip.tsx`, `AiPickCard.tsx`, `FareTable.tsx`
- Modify: `src/renderer/src/components/travel/FlightsRentalsPage.tsx`
- Modify: `src/renderer/src/components/travel/flightsRentals.css` (append)
- Test: `src/renderer/src/components/travel/fares/FareTable.test.tsx`; extend `src/renderer/src/components/travel/FlightsRentalsPage.test.tsx`

**Interfaces:**
- Consumes: Tasks 4, 8, 9; `resolveAirport` from `../airports`.
- Produces:
  - `SourceChips({ sites, onOpenSite, onOpenVisible }: { sites: SiteState[]; onOpenSite: (url: string) => void; onOpenVisible: (url: string) => void })`
  - `FlexDateStrip({ days, current, currentPrice, onPick }: { days: FlexDay[]; current: string; currentPrice: number | null; onPick: (depart: string, ret: string) => void })`
  - `AiPickCard({ row, reason, loading }: { row: FareRow | null; reason: string; loading: boolean })`
  - `FareTable({ offers, adults, onBook }: { offers: FareOffer[]; adults: number; onBook: (url: string) => void; onRowsRanked?: (rows: FareRow[]) => void })`
  - `tripToQuery(t: Trip): FareQuery | null` exported from `FlightsRentalsPage.tsx`
  - `FLIGHTS_PREFILL_KEY = 'aihub-flights-prefill'` exported from `flightsRentals.ts`

- [ ] **Step 1: Write the failing component test**

```tsx
// src/renderer/src/components/travel/fares/FareTable.test.tsx
// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FareTable from './FareTable'
import SourceChips from './SourceChips'
import type { FareOffer } from '../../../../../shared/fares/types'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const o = (over: Partial<FareOffer>): FareOffer => ({ source: 'google', price: 178, currency: 'USD', airlines: ['Delta'], stops: 0, layovers: [], departTime: '07:05', arriveTime: '09:10', arriveDayOffset: 0, durationMin: 305, bags: { carry: 1, checked: 0 }, bookUrl: 'https://g.example', ret: null, ...over })
let host: HTMLDivElement, root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('FareTable', () => {
  const offers = [
    o({}), o({ source: 'kayak', bookUrl: 'https://k.example' }),
    o({ airlines: ['Frontier'], price: 152, stops: 1, durationMin: 887, departTime: '21:32', arriveTime: '09:19', arriveDayOffset: 1, bags: { carry: 0, checked: 0 } }),
  ]

  it('renders one row per outbound flight with agreement and true total', () => {
    act(() => root.render(<FareTable offers={offers} adults={1} onBook={() => {}} />))
    const rows = host.querySelectorAll('[data-fare-row]')
    expect(rows).toHaveLength(2)
    expect(host.textContent).toContain('2 sites')
    expect(host.textContent).toContain('+1')           // overnight marker
    expect(host.textContent).toMatch(/est\./)          // bag fee labelled
  })

  it('re-sorts when the user picks Cheapest and filters Nonstop', () => {
    act(() => root.render(<FareTable offers={offers} adults={1} onBook={() => {}} />))
    const btn = (t: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === t)!
    act(() => btn('Nonstop').click())
    expect(host.querySelectorAll('[data-fare-row]')).toHaveLength(1)
  })

  it('books through the chosen site link', () => {
    const onBook = vi.fn()
    act(() => root.render(<FareTable offers={offers} adults={1} onBook={onBook} />))
    const kayak = Array.from(host.querySelectorAll('a,button')).find(b => b.textContent?.includes('Kayak'))! as HTMLElement
    act(() => kayak.click())
    expect(onBook).toHaveBeenCalledWith('https://k.example')
  })
})

describe('SourceChips', () => {
  it('offers a human check for a blocked site and a plain link for unreadable', () => {
    const onOpenVisible = vi.fn(), onOpenSite = vi.fn()
    act(() => root.render(<SourceChips onOpenSite={onOpenSite} onOpenVisible={onOpenVisible} sites={[
      { site: 'kayak', label: 'Kayak', status: 'blocked', count: 0, url: 'https://www.kayak.com/x', at: 0 },
      { site: 'momondo', label: 'Momondo', status: 'unreadable', count: 0, url: 'https://www.momondo.com/x', at: 0 },
      { site: 'google', label: 'Google Flights', status: 'done', count: 19, url: 'https://g', at: 0 },
    ]} />))
    expect(host.textContent).toContain('needs a human check')
    expect(host.textContent).toContain("couldn't read")
    expect(host.textContent).toContain('19')
    act(() => (Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('human check')) as HTMLElement).click())
    expect(onOpenVisible).toHaveBeenCalledWith('https://www.kayak.com/x')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/travel/fares/FareTable.test.tsx`
Expected: FAIL — cannot resolve `./FareTable`.

- [ ] **Step 3: Write the components**

```tsx
// src/renderer/src/components/travel/fares/SourceChips.tsx
import React from 'react'
import { Check, Loader2, ShieldAlert, Clock, AlertTriangle, ExternalLink, Database } from 'lucide-react'
import type { SiteState } from './useFareSearch'

const TEXT: Record<SiteState['status'], string> = {
  loading: 'searching…', done: 'offers', cached: 'cached', blocked: 'needs a human check',
  unreadable: "couldn't read", empty: 'no flights', timeout: 'timed out', error: 'failed',
}

export default function SourceChips({ sites, onOpenSite, onOpenVisible }: { sites: SiteState[]; onOpenSite: (url: string) => void; onOpenVisible: (url: string) => void }) {
  return <div className="fare-chips" role="status" aria-live="polite">
    {sites.map(s => {
      const icon = s.status === 'loading' ? <Loader2 size={13} className="fare-spin" />
        : s.status === 'done' ? <Check size={13} /> : s.status === 'cached' ? <Database size={13} />
        : s.status === 'blocked' ? <ShieldAlert size={13} /> : s.status === 'timeout' ? <Clock size={13} /> : <AlertTriangle size={13} />
      const ok = s.status === 'done' || s.status === 'cached'
      return <span key={s.site} className={`fare-chip is-${s.status}`}>
        {icon}<b>{s.label}</b>
        <span>{ok ? `${s.count} ${TEXT[s.status]}` : TEXT[s.status]}</span>
        {s.status === 'blocked' && <button onClick={() => onOpenVisible(s.url)}>Open for a human check</button>}
        {['unreadable', 'timeout', 'error', 'empty'].includes(s.status) && <button onClick={() => onOpenSite(s.url)}>Open site <ExternalLink size={11} /></button>}
      </span>
    })}
  </div>
}
```

```tsx
// src/renderer/src/components/travel/fares/FlexDateStrip.tsx
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
```

```tsx
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
```

```tsx
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
        <div className="fare-times">{t12(r.offer.departTime)} → {t12(r.offer.arriveTime)}{r.offer.arriveDayOffset ? <sup>+{r.offer.arriveDayOffset}</sup> : null}<small>{hm(r.offer.durationMin)}</small></div>
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
```

- [ ] **Step 4: Run component tests**

Run: `npx vitest run src/renderer/src/components/travel/fares/FareTable.test.tsx`
Expected: PASS.

- [ ] **Step 5: Integrate into the page — write the failing page test first**

Append to `src/renderer/src/components/travel/FlightsRentalsPage.test.tsx`:

```tsx
import { tripToQuery } from './FlightsRentalsPage'
import { FLIGHTS_PREFILL_KEY } from './flightsRentals'

describe('live fares', () => {
  it('turns a flights trip into an IATA fare query', () => {
    expect(tripToQuery({ kind: 'flights', origin: 'ATL', destination: 'LAX', start: '2099-11-10', end: '2099-11-17', travelers: 2, budget: '', currency: 'USD', flexible: true }))
      .toEqual({ from: 'ATL', to: 'LAX', depart: '2099-11-10', ret: '2099-11-17', adults: 2, currency: 'USD' })
    expect(tripToQuery({ ...trip, kind: 'stays' })).toBeNull()
  })

  it('prefills the destination handed over from Travel the World', () => {
    localStorage.setItem(FLIGHTS_PREFILL_KEY, 'NRT')
    act(() => root.render(<FlightsRentalsPage onNavigate={navigate} />))
    const combos = host.querySelectorAll<HTMLInputElement>('input[role="combobox"]')  // [From, Destination]
    expect(combos[1].value).toBe('NRT')
    expect(localStorage.getItem(FLIGHTS_PREFILL_KEY)).toBeNull()
  })

  it('starts a live search for flights and shows hand-off links when every site fails', async () => {
    const listeners: any[] = []
    ;(window as any).electronAPI = { ...(window as any).electronAPI, fares: {
      search: vi.fn(async () => ({ searchId: 's1' })), cancel: vi.fn(), flex: vi.fn(async () => []),
      handoff: vi.fn(async () => [{ name: 'Expedia', url: 'https://www.expedia.com/x' }]), openSite: vi.fn(),
      onProgress: (cb: any) => { listeners.push(cb); return () => {} }, onFlexDay: () => () => {},
    } }
    localStorage.setItem(FLIGHTS_PREFILL_KEY, 'LAX')
    act(() => root.render(<FlightsRentalsPage onNavigate={navigate} />))
    // origin
    const from = host.querySelector('input[role="combobox"]') as HTMLInputElement
    await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; set.call(from, 'ATL'); from.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { button('Find live fares').click() })
    expect((window as any).electronAPI.fares.search).toHaveBeenCalled()
    await act(async () => { listeners.forEach(cb => cb({ searchId: 's1', site: 'google', label: 'Google Flights', status: 'blocked', offers: [], url: 'https://www.google.com/travel/flights', at: 1 })) })
    expect(host.textContent).toContain('needs a human check')
    expect(host.textContent).toContain('Expedia')
  })
})
```

Run: `npx vitest run src/renderer/src/components/travel/FlightsRentalsPage.test.tsx`
Expected: FAIL — `tripToQuery` / `FLIGHTS_PREFILL_KEY` not exported.

- [ ] **Step 6: Implement the page integration**

In `src/renderer/src/components/travel/flightsRentals.ts`, add:

```ts
/** Travel the World → Flights hand-over: an IATA code, read once on mount. */
export const FLIGHTS_PREFILL_KEY = 'aihub-flights-prefill'
```

In `src/renderer/src/components/travel/FlightsRentalsPage.tsx`:

1. Imports — add:

```tsx
import { useCallback } from 'react'
import { resolveAirport } from './airports'
import { FLIGHTS_PREFILL_KEY } from './flightsRentals'
import { useFareSearch } from './fares/useFareSearch'
import { fetchAiPick } from './fares/aiPick'
import SourceChips from './fares/SourceChips'
import FlexDateStrip from './fares/FlexDateStrip'
import AiPickCard from './fares/AiPickCard'
import FareTable from './fares/FareTable'
import type { FareRow } from '../../../../shared/fares/rank'
import type { FareQuery } from '../../../../shared/fares/types'
```

(Merge `useCallback` into the existing `react` import.)

2. Above the component:

```tsx
export function tripToQuery(t: Trip): FareQuery | null {
  if (t.kind !== 'flights') return null
  const from = resolveAirport(t.origin)?.iata, to = resolveAirport(t.destination)?.iata
  if (!from || !to || from === to) return null
  return { from, to, depart: t.start, ret: t.end, adults: t.travelers, currency: t.currency as FareQuery['currency'] }
}

function initialTripWithPrefill(): Trip {
  const t = initialTrip()
  try {
    const code = localStorage.getItem(FLIGHTS_PREFILL_KEY)
    if (code) { localStorage.removeItem(FLIGHTS_PREFILL_KEY); return { ...t, destination: code } }
  } catch {}
  return t
}
```

and change `useState<Trip>(initialTrip)` to `useState<Trip>(initialTripWithPrefill)`.

3. Inside the component, after the existing state:

```tsx
  const fares = useFareSearch()
  const [handoff, setHandoff] = useState<{ name: string; url: string }[]>([])
  const [rows, setRows] = useState<FareRow[]>([])
  const [pick, setPick] = useState<{ key: string; reason: string } | null>(null)
  const [picking, setPicking] = useState(false)
  const query = tripToQuery(trip)

  const runLive = () => {
    const err = validateTrip(trip); setError(err || '')
    if (err || !query) return
    setPick(null); setRows([]); setSearched({ ...trip })
    void fares.start(query)
    void (window as any).electronAPI?.fares?.handoff(query).then((l: any) => setHandoff(Array.isArray(l) ? l : [])).catch(() => setHandoff([]))
  }

  // One AI pick per finished search, from the ranked rows only.
  useEffect(() => {
    if (fares.state.phase !== 'done' || rows.length < 2 || pick || picking) return
    const chat = (window as any).electronAPI?.ai?.chat
    if (!chat) return
    setPicking(true)
    void fetchAiPick(rows, { adults: trip.travelers, needs: { carry: true, checked: false } }, m => chat(m))
      .then(p => setPick(p)).finally(() => setPicking(false))
  }, [fares.state.phase, rows, pick, picking, trip.travelers])

  const onRowsRanked = useCallback((r: FareRow[]) => setRows(r), [])
  const openVisible = (url: string) => { void (window as any).electronAPI?.fares?.openSite(url) }
  const allFailed = fares.state.phase === 'done' && fares.state.offers.length === 0
```

4. In `change()`, also cancel a running live search: add `fares.cancel(); setPick(null); setRows([])` to its body.

5. Primary action: for `trip.kind === 'flights'` the submit button runs `runLive` with label **"Find live fares"**; keep "Compare providers" as a secondary button that calls the existing `search()`. In the `<form onSubmit>` replace `search()` with `trip.kind === 'flights' ? runLive() : search()`, and render:

```tsx
<div className="fare-actions">
  <button className="fare-primary" type="submit">{trip.kind === 'flights' ? <>Find live fares <ArrowRight size={16} /></> : <>Compare providers <ArrowRight size={16} /></>}</button>
  {trip.kind === 'flights' && <button type="button" onClick={search}>Open a booking site</button>}
  {/* existing AI research + save buttons unchanged */}
</div>
```

6. Results — render above the existing `searched && <DestinationGallery …>` block:

```tsx
{trip.kind === 'flights' && fares.state.phase !== 'idle' && <section className="fare-live" aria-label="Live fares">
  {fares.state.phase === 'private' && <p className="fare-notice">Live fares are off in Incognito windows — booking sites would store cookies. Use “Open a booking site” instead.</p>}
  <SourceChips sites={fares.state.sites} onOpenSite={onOpenBooking} onOpenVisible={openVisible} />
  {query && <FlexDateStrip days={fares.state.flex} current={query.depart}
    currentPrice={rows.length ? Math.min(...rows.map(r => r.best)) : null}
    onPick={(depart, ret) => { change({ start: depart, end: ret }) }} />}
  <AiPickCard row={rows.find(r => r.key === pick?.key) ?? null} reason={pick?.reason ?? ''} loading={picking} />
  {fares.state.offers.length > 0 && <FareTable offers={fares.state.offers} adults={trip.travelers} onBook={onOpenBooking} onRowsRanked={onRowsRanked} />}
  {(allFailed || fares.state.phase === 'error') && <p className="fare-notice">No site could be read just now. These open with your trip filled in:</p>}
  {fares.state.phase !== 'searching' && handoff.length > 0 && <div className="fare-handoff">{handoff.map(h => <button key={h.name} onClick={() => onOpenBooking(h.url)}>{h.name} <ExternalLink size={12} /></button>)}</div>}
  <p className="fare-form-note">Prices found on each site moments ago. Final price and availability are confirmed on the booking site.</p>
</section>}
```

Keep the existing provider-comparison `searched && <section className="fare-results">` for `cars`/`stays` only: change its condition to `searched && trip.kind !== 'flights'`. Add `<span className="fare-soon">Live prices coming soon</span>` next to the Cars and Stays mode buttons.

7. Append to `flightsRentals.css`:

```css
/* ── Live fares ── built on the page's --fare-* tokens, so light mode follows automatically */
.fare-page{--fare-good:#7fd6a8;--fare-warn:#f1c76b}
body.light-mode .fare-page{--fare-good:#1f7a52;--fare-warn:#9a6212}
.fare-live{display:grid;gap:14px;margin-bottom:20px}
.fare-chips{display:flex;flex-wrap:wrap;gap:8px}
.fare-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 11px;border-radius:999px;font-size:12px;background:var(--fare-panel);border:1px solid var(--fare-line);color:var(--fare-muted)}
.fare-chip b{font-weight:600;color:var(--fare-ink)}
.fare-chip.is-done,.fare-chip.is-cached{border-color:var(--fare-good);color:var(--fare-good)}
.fare-chip.is-blocked,.fare-chip.is-unreadable,.fare-chip.is-timeout,.fare-chip.is-error,.fare-chip.is-empty{border-color:var(--fare-warn);color:var(--fare-warn)}
.fare-chip button{margin-left:2px;font-size:11px;text-decoration:underline;text-underline-offset:3px;background:none;border:0;padding:0}
.fare-flex-strip{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
.fare-flex-strip button{display:grid;gap:3px;padding:9px 4px;border-radius:10px;background:var(--fare-panel);border:1px solid var(--fare-line);font-size:11px;color:var(--fare-muted)}
.fare-flex-strip b{font-variant-numeric:tabular-nums;font-size:15px;color:var(--fare-ink)}
.fare-flex-strip .is-current{border-color:var(--fare-accent);box-shadow:inset 0 0 0 1px var(--fare-accent)}
.fare-flex-strip .is-cheapest b{color:var(--fare-good)}
.fare-pick{padding:16px 18px;border-radius:14px;background:linear-gradient(135deg,color-mix(in srgb,var(--fare-accent) 22%,var(--fare-panel)),var(--fare-panel));border:1px solid var(--fare-accent)}
.fare-pick.is-loading{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--fare-muted)}
.fare-pick-head{display:flex;align-items:center;gap:6px;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--fare-muted)}
.fare-pick-flight{margin-top:6px;font-weight:600;color:var(--fare-ink)}
.fare-pick-price{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--fare-ink)}
.fare-pick-price small{font-size:12px;font-weight:400;color:var(--fare-muted)}
.fare-pick p{margin:6px 0 0;font-size:13px;line-height:1.6;color:var(--fare-muted)}
.fare-sortbar{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px}
.fare-sortbar [role=group]{display:flex;gap:4px;flex-wrap:wrap}
.fare-sortbar button{padding:7px 11px;border-radius:8px;font-size:12px;background:transparent;border:1px solid var(--fare-line)}
.fare-sortbar button.selected{background:var(--fare-accent);color:#17392d;border-color:var(--fare-accent)}
.fare-table{display:grid;gap:8px}
.fare-row{padding:14px 16px;border-radius:12px;background:var(--fare-panel);border:1px solid var(--fare-line);transition:border-color .15s,transform .15s}
.fare-row:hover{border-color:var(--fare-accent);transform:translateY(-1px)}
.fare-row-main{display:grid;grid-template-columns:1.3fr 1.4fr 1fr auto;gap:14px;align-items:center}
.fare-airline,.fare-times{display:grid;gap:2px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--fare-ink)}
.fare-times sup{font-size:10px;color:var(--fare-warn);margin-left:2px}
.fare-airline small,.fare-times small,.fare-bags{font-weight:400;font-size:12px;color:var(--fare-muted)}
.fare-price{display:grid;justify-items:end;gap:2px;font-variant-numeric:tabular-nums}
.fare-price b{font-size:21px;color:var(--fare-ink)}
.fare-price small{font-size:11px}
.fare-agree{font-size:11px;color:var(--fare-good);letter-spacing:1px}
.fare-row-sites{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid var(--fare-line)}
.fare-row-sites button{padding:5px 10px;border-radius:7px;font-size:12px;background:var(--fare-bg);border:1px solid var(--fare-line);font-variant-numeric:tabular-nums}
.fare-row-sites button.is-verify{border-color:var(--fare-warn);color:var(--fare-warn)}
.fare-handoff{display:flex;gap:8px;flex-wrap:wrap}
.fare-handoff button{display:flex;align-items:center;gap:6px;padding:8px 12px;border-radius:8px;border:1px solid var(--fare-line);background:transparent;font-size:12px}
.fare-soon{font-size:10px;color:var(--fare-muted);margin-left:4px}
@media(max-width:720px){.fare-row-main{grid-template-columns:1fr 1fr}.fare-price{justify-items:start}.fare-flex-strip{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media(prefers-reduced-motion:reduce){.fare-row{transition:none}.fare-row:hover{transform:none}}
```

The `--fare-*` tokens are defined at the top of `flightsRentals.css` and already switch under `body.light-mode .fare-page`; only the two new tokens (`--fare-good`, `--fare-warn`) need their own light values, declared above.

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run src/renderer/src/components/travel/ && npm run typecheck`
Expected: PASS. Existing FlightsRentalsPage tests that assert the old flights "Compare providers" submit behaviour must be updated to click "Open a booking site" instead — same expectations otherwise.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/travel/
git commit -m "feat(fares): live fare table, source chips, flex dates and AI pick on Flights page"
```

---

### Task 11: Price watch and "Fly here"

**Files:**
- Modify: `src/main/index.ts` — `Watch` interface (~line 4914), `checkWatch` (~line 4972), new `fares:watch` handler
- Modify: `src/preload/index.ts` — `fares.watch`
- Modify: `src/renderer/src/components/travel/FlightsRentalsPage.tsx` — "Watch price" button on saved trips
- Modify: `src/renderer/src/components/travel/TravelPage.tsx:172` — "Fly here"
- Create: `src/shared/fares/watch.ts`; Test: `src/shared/fares/watch.test.ts`

**Interfaces:**
- Consumes: Task 6 engine (`search`), Task 1 `FareQuery`.
- Produces:
  - `fareWatchVerdict(prev: number | undefined, current: number | null, target: number): { notify: boolean; message: string } ` (pure)
  - `electronAPI.fares.watch(q: FareQuery, target: number, title: string): Promise<{ ok: boolean }>`
  - Watch gains `mode: 'fare'`, `fare?: { query: FareQuery; target: number; lastPrice?: number }`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/fares/watch.test.ts
import { describe, it, expect } from 'vitest'
import { fareWatchVerdict } from './watch'

describe('fareWatchVerdict', () => {
  it('notifies when the price first drops to or below target', () => {
    expect(fareWatchVerdict(180, 155, 160)).toEqual({ notify: true, message: 'Now $155 — at or below your $160 target (was $180).' })
  })
  it('stays quiet while it remains below target', () => {
    expect(fareWatchVerdict(155, 150, 160).notify).toBe(false)
  })
  it('stays quiet when no price could be read', () => {
    expect(fareWatchVerdict(180, null, 160).notify).toBe(false)
  })
  it('notifies on first check if already below target', () => {
    expect(fareWatchVerdict(undefined, 140, 160).notify).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/fares/watch.test.ts`
Expected: FAIL — cannot resolve `./watch`.

- [ ] **Step 3: Implement**

```ts
// src/shared/fares/watch.ts
/** Alert once when a watched fare crosses down to the target — not every check it stays there. */
export function fareWatchVerdict(prev: number | undefined, current: number | null, target: number): { notify: boolean; message: string } {
  if (current === null) return { notify: false, message: '' }
  const crossed = current <= target && (prev === undefined || prev > target)
  return crossed
    ? { notify: true, message: `Now $${current} — at or below your $${target} target${prev !== undefined ? ` (was $${prev})` : ''}.` }
    : { notify: false, message: '' }
}
```

In `src/main/index.ts`:

1. Extend the interface:

```ts
interface Watch {
  id: string; url: string; title: string
  mode: 'change' | 'contains' | 'fare'; keyword?: string
  /** mode 'fare': a flight route to re-price through the fare engine. */
  fare?: { query: FareQuery; target: number; lastPrice?: number }
  // …existing fields unchanged
```

2. At the top of `checkWatch`, before `fetchHtml`:

```ts
  if (w.mode === 'fare' && w.fare) {
    // Google only: one light page per check, never all three sites.
    const google = FARE_ADAPTERS.filter(a => a.id === 'google')
    const engine = createFareEngine({ driver: (fareEngine(), _fareDriver!), adapters: google })
    const offers = await engine.search(w.fare.query, () => {}).done.catch(() => [])
    const current = offers.length ? Math.min(...offers.map(o => o.price)) : null
    const verdict = fareWatchVerdict(w.fare.lastPrice, current, w.fare.target)
    if (current !== null) w.fare.lastPrice = current
    w.lastChecked = Date.now()
    if (verdict.notify) { w.triggered = true; w.lastChanged = Date.now(); notifyWatch(w, verdict.message) }
    saveWatches()
    return
  }
```

Add `import { fareWatchVerdict } from '../shared/fares/watch'` to the imports.

3. New handler next to the other fare handlers:

```ts
handlePersistent('fares:watch', (_e, q: FareQuery, target: number, title: string) => {
  if (!validFareQuery(q) || !Number.isFinite(target) || target <= 20) return { ok: false }
  const w: Watch = {
    id: `w-${Date.now()}`, url: googleAdapter.url(q), title: String(title || `${q.from} → ${q.to}`).slice(0, 120),
    mode: 'fare', fare: { query: q, target: Math.round(target) }, intervalMin: 360, active: true,
  }
  getWatches().unshift(w)
  saveWatches()
  return { ok: true }
}, () => ({ ok: false }))
```

Import `googleAdapter` from `./fares/adapters/google`, and add `'fares:watch'` to `PRIVATE_BLOCKED_CHANNELS` in `src/main/incognito.ts`.

4. Preload, inside `fares: { … }`:

```ts
    watch: (q: any, target: number, title: string) => ipcRenderer.invoke('fares:watch', q, target, title),
```

5. FlightsRentalsPage saved-trip list: for each saved flights trip with a valid `tripToQuery`, add:

```tsx
<button onClick={() => {
  const q = tripToQuery(s.trip); if (!q) return
  const target = Number(window.prompt('Alert me when the round-trip price is at or below ($):', s.trip.budget || ''))
  if (!Number.isFinite(target) || target <= 20) return
  void (window as any).electronAPI?.fares?.watch(q, target, `${q.from} → ${q.to} ${q.depart}`).then((r: any) => setNotice(r?.ok ? 'Price watch on — checked every 6 hours.' : 'Could not start a price watch here.'))
}}>Watch price</button>
```

6. TravelPage "Fly here" — replace line 172:

```tsx
<button onClick={() => {
  const city = facts?.capital[0] ?? ''
  const airport = searchAirports(city || name, 5).find(a => a.scheduled && a.country === name) ?? searchAirports(city || name, 1)[0]
  try { if (airport) localStorage.setItem(FLIGHTS_PREFILL_KEY, airport.iata) } catch {}
  open('aihub://flights-rentals')
}}><Plane size={13} /> Fly here</button>
```

Import `searchAirports` from `./airports` and `FLIGHTS_PREFILL_KEY` from `./flightsRentals`. Check `facts` is in scope at that line (it is declared at line 104 in `CountryView`); `name` is the country display name used at line 157.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/shared/fares/ src/main/incognito.test.ts src/renderer/src/components/travel/ && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/fares/watch.ts src/shared/fares/watch.test.ts src/main/index.ts src/main/incognito.ts src/preload/index.ts src/renderer/src/components/travel/
git commit -m "feat(fares): price watches on saved trips and Fly here from Travel the World"
```

---

### Task 12: Live end-to-end verification

**Files:**
- Create: `scripts/test-live-fares-e2e.mjs`

**Interfaces:**
- Consumes: the built app (`npx electron-vite build`), `~/node_modules/playwright-core`.

- [ ] **Step 1: Write the driver**

```js
// scripts/test-live-fares-e2e.mjs
// Real search in the built app against live sites. Isolated profile; asserts
// merged results, at least two sources, and no main-process freeze.
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { _electron } = require(path.join(os.homedir(), 'node_modules', 'playwright-core'))

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..')
const HOME = path.join(os.tmpdir(), 'aihub-fares-e2e')
fs.rmSync(HOME, { recursive: true, force: true }); fs.mkdirSync(HOME, { recursive: true })
const env = { ...process.env, USERPROFILE: HOME, HOME }
delete env.ELECTRON_RUN_AS_NODE

const depart = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
const ret = new Date(Date.now() + 37 * 86400000).toISOString().slice(0, 10)
const app = await _electron.launch({ executablePath: path.join(REPO, 'node_modules/electron/dist/electron.exe'), args: [REPO], cwd: REPO, env })
const userData = await app.evaluate(({ app }) => app.getPath('userData'))
if (!path.normalize(userData).startsWith(path.normalize(HOME))) throw new Error(`not isolated: ${userData}`)
const page = await app.firstWindow()
await page.waitForTimeout(8000)
await app.evaluate(() => { const g = globalThis; g.__lag = []; let l = Date.now(); g.__t = setInterval(() => { const n = Date.now(); g.__lag.push(n - l - 50); l = n }, 50) })

const t0 = Date.now()
const result = await page.evaluate(async ({ depart, ret }) => {
  const api = window.electronAPI.fares
  const events = []
  const off = api.onProgress(p => events.push({ site: p.site, status: p.status, n: p.offers.length }))
  const { searchId } = await api.search({ from: 'ATL', to: 'LAX', depart, ret, adults: 1, currency: 'USD' })
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    const finals = new Set(events.filter(e => e.status !== 'loading').map(e => e.site))
    if (finals.size >= 3) break
    await new Promise(r => setTimeout(r, 500))
  }
  off()
  return { searchId, events }
}, { depart, ret })
const lag = await app.evaluate(() => { clearInterval(globalThis.__t); return globalThis.__lag })
await app.close()

const done = result.events.filter(e => e.status === 'done')
const total = done.reduce((n, e) => n + e.n, 0)
const report = { seconds: Math.round((Date.now() - t0) / 1000), sites: result.events.filter(e => e.status !== 'loading'), offers: total, maxStallMs: Math.max(...lag) }
console.log(JSON.stringify(report, null, 2))
const ok = done.length >= 2 && total >= 10 && report.seconds <= 60 && report.maxStallMs <= 250
console.log(ok ? 'PASS' : 'FAIL')
process.exit(ok ? 0 : 1)
```

- [ ] **Step 2: Build and run**

Run: `npx electron-vite build && node scripts/test-live-fares-e2e.mjs`
Expected: `PASS` with ≥ 2 sites `done`, ≥ 10 offers, `maxStallMs` ≤ 250. If one site reports `blocked` or `unreadable`, record which in the commit message — that is the runtime fallback working, not a test failure, as long as two sites succeed.

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run && npm run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 4: Update the spec's Expedia line**

In `docs/superpowers/specs/2026-10-12-live-flight-fares-design.md`, change the Expedia unit row to: "Hand-off link only — returned 0 prices on 2 of 3 spike runs; no fixture to test a parser against."

- [ ] **Step 5: Commit**

```bash
git add scripts/test-live-fares-e2e.mjs docs/superpowers/specs/2026-10-12-live-flight-fares-design.md
git commit -m "test(fares): live end-to-end fare search check"
```
