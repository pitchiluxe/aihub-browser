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

function adapter(id: any, _probes: PageProbe<any>[], parsed: FareOffer[] = [offer(150, id)]): SiteAdapter<any> {
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
      return { evaluate: (async () => seq[Math.min(i++, seq.length - 1)]) as any, close: () => { d.closed++ } }
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

  it('uses a caller-supplied search id, so a renderer can recognise events that arrive before the call returns', async () => {
    const driver = fakeDriver(() => [ready()])
    const engine = createFareEngine({ driver, adapters: [adapter('google', [])], ...fast })
    const events: SiteProgress[] = []
    const { id, done } = engine.search(q, p => events.push(p), 'client-42')
    await done
    expect(id).toBe('client-42')
    expect(events.every(e => e.searchId === 'client-42')).toBe(true)
    expect(events[0].status).toBe('loading')
  })

  it('tells the renderer how many sites the search covers on every event', async () => {
    const driver = fakeDriver(() => [ready()])
    const engine = createFareEngine({ driver, adapters: [adapter('google', []), adapter('kayak', []), adapter('momondo', [])], ...fast })
    await engine.search(q, () => {}).done
    const events: SiteProgress[] = []
    await engine.search(q, p => events.push(p)).done  // all cached now
    expect(events.every(e => e.total === 3)).toBe(true)
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

  it('tags each day with the search id and stops when that search is cancelled', async () => {
    const driver = fakeDriver(() => [ready()])
    let engine!: ReturnType<typeof createFareEngine>
    const days: any[] = []
    engine = createFareEngine({ driver, adapters: [adapter('google', [])], ...fast, spacingMs: 0 })
    await engine.flexDates(q, d => { days.push(d); if (days.length === 2) engine.cancel('s-9') }, 's-9')
    expect(days.every(d => d.searchId === 's-9')).toBe(true)
    expect(days).toHaveLength(2)
    expect(driver.opened).toHaveLength(2)
  })

  it('shiftDate moves both directions across month ends', () => {
    expect(shiftDate('2026-11-30', 1)).toBe('2026-12-01')
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28')
  })
})
