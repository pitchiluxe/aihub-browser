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
