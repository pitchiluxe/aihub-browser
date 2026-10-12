# Live Flight Fares — Design

Date: 2026-10-12
Status: approved in conversation (sections 1–4), pending written-spec review

## Intent

**What the user asked for:** make Flights & Rentals and Travel the World "best
features, professional looks, like never seen before in terms of result and
use." Chose option A (live fares in-app), scope C (flights deep now, stays and
cars live in phase 2), and approach 1 (per-site adapters + shared parser).

**Problem today:** `aihub://flights` never shows a price. "Compare" opens one
booking site per click; "AI research" summarises search snippets.

**Success:** a flight search inside AIHub shows a single ranked table of real,
current fares merged from several booking sites, with true total cost, a
cross-site agreement signal and an AI best pick, within ~40 s, without
freezing the app, and degrades to today's hand-off when sites cannot be read.

**Assumptions (not stated by the user):** USD-first presentation (currency
selector kept); economy, round trip, 1–9 adults as today; multi-city and cabin
classes beyond economy are out of scope for this build.

## Feasibility evidence (spike, 2026-10-12, user's connection)

Route ATL→LAX, Nov 10–17 2026, hidden Electron windows, real Chrome UA:

| Site | Result | Structure |
|---|---|---|
| Google Flights | 20 prices, 8 s, lowest $152 | 38 per-offer aria-labels with price, stops, airline, times, duration, layover airport, bags included |
| Kayak | 98 prices, 21–32 s, lowest $150 | ~116 result cards, plain text |
| Momondo | 69–88 prices, 8–9 s, lowest $150 | same platform/layout as Kayak |
| Expedia | 120 prices on run 1, 0 on run 2 | flaky — secondary |
| Skyscanner | redirected to a car-hire page | link-only hand-off |

No site blocked. Lowest fares agreed across sites ($150–$152).

## Architecture

```
Renderer (FlightsRentalsPage)                 Main process (src/main/fares/)
search ──► fares:search(trip) ──IPC──►        FareEngine
                                                ├─ cache (15 min, key = route+dates+adults+currency)
                                                ├─ adapters in parallel (≤ 3 hidden windows)
                                                │    HiddenPage → adapter.url(trip)
                                                │    poll adapter.ready() until 35 s deadline
                                                │    raw = adapter.extract()   (runs in page, read-only)
                                                │    offers = adapter.parse(raw) (pure, tested)
results ◄── fares:progress {site,status,offers} ┤
        ◄── fares:done {offers ranked}          └─ merge → dedupe → rank
```

### Units

| Unit | File | Responsibility |
|---|---|---|
| Types + normalize | `src/main/fares/types.ts` | `FareOffer` = `{ id, price, currency, airlines[], stops, departAt, arriveAt, durationMin, layovers[], bags: { carry, checked } \| null, source, bookUrl, foundAt }`; `normalize()` rejects price ≤ 20 or > 50,000, arrive ≤ depart, unknown currency, missing airline |
| Google adapter | `src/main/fares/adapters/google.ts` | URL builder; extract = per-offer aria-labels; parse the "From N US dollars round trip total. …" sentence grammar |
| Kayak/Momondo adapter | `src/main/fares/adapters/kayak.ts` | One adapter, two hosts; extract = result-card innerText blocks; parse card text |
| Expedia adapter | `src/main/fares/adapters/expedia.ts` | Secondary; same contract; failures never block results |
| Adapter contract | `src/main/fares/adapters/index.ts` | `{ id, label, url(trip), readyScript, extractScript, blockedScript, parse(raw): FareOffer[] }` |
| Hidden page pool | `src/main/fares/hiddenPage.ts` | Off-screen `BrowserWindow`, partition `persist:fares`, sandbox on, no preload, no nodeIntegration, real Chrome UA, max 3 alive, 60 s watchdog, destroyed after each search |
| Merge + rank | `src/main/fares/rank.ts` | Same flight across sites (airline + departAt + arriveAt) → one row with per-site prices; true total = fare + bag fees not included; sort modes best-value / cheapest / fastest / fewest-stops |
| Engine | `src/main/fares/engine.ts` | Orchestration, cache, per-site rate limit (≥ 20 s between loads), cancellation, progress events; depends on adapters + pool through injected interfaces |
| Flex-date strip | in engine | ±3 days (6 extra loads), Google adapter only, runs after the main search finishes, sequential with a 3 s gap (its own budget, not the 20 s per-site spacing), cached like main results, stops at first block |
| IPC | `src/main/index.ts`, `src/preload/index.ts` | `fares:search(trip) → searchId`, `fares:cancel(searchId)`, events `fares:progress`, `fares:done` |
| Bag fees | `src/main/fares/bagFees.ts` | Static per-airline first-checked / carry-on fee table (US carriers), labelled "estimated" in UI |
| UI | `src/renderer/src/components/travel/` | `FareSearchBar`, `SourceChips`, `FlexDateStrip`, `AiPickCard`, `FareTable`, `FareRow`; page composes them |
| AI pick | `src/renderer/src/components/travel/aiPick.ts` | Prompt built from normalized rows only; reply must name an offer id present in the table, else discarded |
| Price watch | reuse existing watch scheduler | Saved trip + target price; re-check every 6 h via engine (Google only); notify on drop below target |

Phase 2 (not in this build): stays and cars adapters behind `kind`, reusing
engine, pool and rank.

## UI

Sticky compact search bar → live source chips → flexible-date strip + AI pick
card → sort/filter bar → fare table. Rows show airline, stops (+ layover
airport), times, duration, bags, headline fare, **true total** when bag fees
apply, agreement dots (count of sites within $5 of each other), and a Book menu
with each site's deep link (opens a normal AIHub tab). Rows still loading
shimmer. Tabular-figure prices. Existing dark-glass palette, light theme
supported. Cars and Stays tabs keep the current hand-off flow, marked "live
prices coming soon". Travel the World country pages get a "Fly here" button
prefilling the destination's main airport.

## Failure handling

| Failure | Detection | User sees |
|---|---|---|
| CAPTCHA / bot wall | `blockedScript` matches unusual traffic / verify you are human / press & hold | Chip "needs a human check → Open site"; opens visibly in the same `persist:fares` session; app never solves CAPTCHAs |
| Layout change | prices on page > 0 but parsed = 0 | Chip "couldn't read → Open site"; logged with adapter id |
| Slow site | 35 s deadline | Chip "timed out"; other sites unaffected |
| All fail | zero offers | Falls back to current hand-off links + AI research with reason |
| Rate limit | ≥ 20 s per site, 15 min cache | "cached N min ago · Refresh" |
| Form edited mid-search | generation counter + `fares:cancel` | windows destroyed immediately |
| Junk data | `normalize` rejects | offer dropped |

## Security

- Extract scripts are read-only: no clicks, input, or navigation.
- Hidden pages: sandboxed, no preload, no nodeIntegration, isolated
  `persist:fares` partition; never created in incognito; partition data wiped
  by the existing clear-data path.
- Extracted text capped (200 KB per site) and treated as data.
- AI pick prompt contains only normalized numeric fields and airline names,
  never raw page text.
- Every price labelled with source and age; no "guaranteed" claims; booking
  and payment happen on the provider's site.

## Performance

- ≤ 3 hidden windows; destroyed after each search; 60 s watchdog.
- Parsing is pure string work on ≤ 200 KB per site in main — measured target
  < 20 ms per site; no synchronous disk I/O on the search path.
- Live e2e asserts no main-process stall > 250 ms during a search.

## Testing

- Parser fixtures from real pages in `src/main/fares/__fixtures__/` (Google
  aria-labels, Kayak, Momondo, Expedia); tests assert offer count, cheapest
  price, stops, airline, times.
- Unit: `normalize`, `mergeOffers`, `rankOffers` (true total, bag math, sort
  modes), engine cache/rate-limit/cancel with fake adapters and fake pool.
- UI: chips stream in, sort/filter, blocked chip, all-fail fallback.
- Live e2e driver: real search in the built app → ≥ 10 merged offers from
  ≥ 2 sites within 40 s; main-thread stall check.

## Out of scope

Multi-city, premium cabins, booking inside the app, payment, solving CAPTCHAs,
live stays/cars (phase 2), Travel the World redesign beyond the "Fly here"
entry point (separate design).
