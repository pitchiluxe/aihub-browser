// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FlightsRentalsPage from './FlightsRentalsPage'
import { SAVED_TRIPS_KEY, FLIGHTS_PREFILL_KEY, type Trip } from './flightsRentals'
import { tripToQuery } from './FlightsRentalsPage'
import { pageTypeForUrl, resolveNavTarget } from '../../services/navIntent'

const trip: Trip = { kind: 'stays', origin: '', destination: 'Paris', start: '2099-06-10', end: '2099-06-17', travelers: 2, budget: '', currency: 'USD', flexible: true }
let host: HTMLDivElement, root: Root
const navigate = vi.fn()
const button = (text: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes(text))!
beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
  vi.spyOn(Math, 'random').mockReturnValue(0)
  localStorage.clear(); navigate.mockReset()
  localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify([{ id: 'test-trip', trip }]))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  act(() => root.render(<FlightsRentalsPage onNavigate={navigate} />))
})
afterEach(() => { act(() => root.unmount()); host.remove(); delete (window as any).electronAPI; vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('Flights & Rentals page', () => {
  it('provides airport dropdowns for both departure and destination', () => {
    expect(host.querySelectorAll('input[role="combobox"]')).toHaveLength(2)
  })
  it('resolves the internal page through URL and assistant navigation', () => {
    expect(pageTypeForUrl('aihub://flights-rentals')).toBe('flights-rentals')
    expect(resolveNavTarget('open flights and rentals', [])?.pageType).toBe('flights-rentals')
  })
  it('restores a saved trip and opens a dated booking search inside the browser', async () => {
    act(() => button('Paris').click())
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    const url = new URL(navigate.mock.calls[0][0])
    expect(url.hostname).toBe('www.booking.com')
    expect(url.searchParams.get('checkin')).toBe(trip.start)
    expect(url.searchParams.get('group_adults')).toBe('2')
  })
  it('opens another prefilled hotel site on the next comparison without clearing the trip', async () => {
    act(() => button('Paris').click())
    for (let i = 0; i < 2; i++) await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    const first = new URL(navigate.mock.calls[0][0]), second = new URL(navigate.mock.calls[1][0])
    expect(first.hostname).not.toBe(second.hostname)
    expect(second.pathname).toBe('/hotels/Paris/2099-06-10/2099-06-17/2adults')
    expect(host.querySelector<HTMLInputElement>('input[maxlength="150"]')?.value).toBe('Paris')
  })
  it('rejects incomplete searches and removes saved trips from storage', async () => {
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('destination')
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Remove saved trip to Paris"]')!.click())
    expect(JSON.parse(localStorage.getItem(SAVED_TRIPS_KEY)!)).toEqual([])
  })
  it('opens a prefilled flight route when Open a booking site is clicked', async () => {
    localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify([{ id: 'flight-trip', trip: { ...trip, kind: 'flights', origin: 'KJFK', destination: 'LFPG' } }]))
    act(() => root.unmount()); root = createRoot(host)
    act(() => root.render(<FlightsRentalsPage onNavigate={navigate} />))
    act(() => button('LFPG').click())
    await act(async () => button('Open a booking site').click())
    expect(new URL(navigate.mock.calls[0][0]).pathname).toBe('/flights/JFK-CDG/2099-06-10/2099-06-17/2adults')
  })
  it('keeps provider comparison available when AI research fails', async () => {
    ;(window as any).electronAPI = { ai: { webSearch: vi.fn().mockResolvedValue({ success: false }), chat: vi.fn() } }
    act(() => button('Paris').click())
    await act(async () => button('AI deal research').click())
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('sources')
    expect(button('Booking.com')).toBeDefined()
    expect(button('AI deal research').disabled).toBe(false)
  })
  it('does not display stale research after switching the search mode', async () => {
    let finish!: (value: any) => void
    ;(window as any).electronAPI = { ai: { webSearch: () => new Promise(resolve => { finish = resolve }), chat: vi.fn().mockResolvedValue({ content: 'Old trip advice', provider: 'ollama' }) } }
    act(() => button('Paris').click())
    act(() => button('AI deal research').click())
    act(() => button('Car rentals').click())
    await act(async () => finish({ success: true, results: [{ title: 'Source', url: 'https://example.com', snippet: '' }] }))
    expect(host.textContent).not.toContain('Old trip advice')
    expect(button('AI deal research').disabled).toBe(false)
  })
  it('opens a saved trip cost board and persists entered estimates without guessing unknown fees', async () => {
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Open cost board for Paris"]')!.click())
    expect(host.textContent).toContain('Known subtotal')
    expect(host.textContent).toContain('7 unknown')
    await act(async () => {
      const input = host.querySelector<HTMLInputElement>('[aria-label="Flight fare · all travelers amount"]')!
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '245.75'); input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const stored = JSON.parse(localStorage.getItem(SAVED_TRIPS_KEY)!)
    expect(stored[0].estimate.lines.find((line: any) => line.id === 'flights').amount).toBe('245.75')
    expect(host.textContent).toContain('6 unknown')
    expect(host.textContent).toContain('245.75')
  })
})

describe('live fares', () => {
  const remount = () => { act(() => root.unmount()); root = createRoot(host); act(() => root.render(<FlightsRentalsPage onNavigate={navigate} />)) }

  it('turns a flights trip into an IATA fare query', () => {
    expect(tripToQuery({ kind: 'flights', origin: 'ATL', destination: 'LAX', start: '2099-11-10', end: '2099-11-17', travelers: 2, budget: '', currency: 'USD', flexible: true }))
      .toEqual({ from: 'ATL', to: 'LAX', depart: '2099-11-10', ret: '2099-11-17', adults: 2, currency: 'USD' })
    expect(tripToQuery({ ...trip, kind: 'stays' })).toBeNull()
  })

  it('prefills the destination handed over from Travel the World', () => {
    localStorage.setItem(FLIGHTS_PREFILL_KEY, 'NRT')
    remount()
    const combos = host.querySelectorAll<HTMLInputElement>('input[role="combobox"]')  // [From, Destination]
    expect(combos[1].value).toBe('NRT')
    expect(localStorage.getItem(FLIGHTS_PREFILL_KEY)).toBeNull()
  })

  it('keeps the prefill when React discards a render and mounts again (lazy page inside Suspense)', async () => {
    localStorage.setItem(FLIGHTS_PREFILL_KEY, 'NRT')
    let resolve!: () => void
    const gate = new Promise<void>(r => { resolve = r })
    let suspended = false
    // A sibling that suspends on the first attempt makes React throw away the
    // page's first render, exactly like a lazy chunk still loading in the app.
    const SuspendOnce = () => { if (!suspended) { suspended = true; throw gate } return null }
    act(() => root.unmount()); root = createRoot(host)
    await act(async () => root.render(<React.Suspense fallback={null}><FlightsRentalsPage onNavigate={navigate} /><SuspendOnce /></React.Suspense>))
    await act(async () => { resolve(); await gate })
    const combos = host.querySelectorAll<HTMLInputElement>('input[role="combobox"]')
    expect(combos[1].value).toBe('NRT')
    expect(localStorage.getItem(FLIGHTS_PREFILL_KEY)).toBeNull()
  })

  it('keeps progress events that arrive before the search call returns (real IPC ordering)', async () => {
    const listeners: any[] = []
    ;(window as any).electronAPI = { fares: {
      // Main emits each site's `loading` synchronously, ahead of the invoke reply.
      search: vi.fn(async (_q: any, id: string) => {
        listeners.forEach(cb => cb({ searchId: id, site: 'google', label: 'Google Flights', status: 'loading', offers: [], url: 'https://g', at: 1 }))
        listeners.forEach(cb => cb({ searchId: id, site: 'kayak', label: 'Kayak', status: 'loading', offers: [], url: 'https://k', at: 1 }))
        return { searchId: id }
      }),
      cancel: vi.fn(), flex: vi.fn(async () => []), handoff: vi.fn(async () => []), openSite: vi.fn(),
      onProgress: (cb: any) => { listeners.push(cb); return () => {} }, onFlexDay: () => () => {},
    } }
    localStorage.setItem(FLIGHTS_PREFILL_KEY, 'LAX')
    remount()
    const from = host.querySelector('input[role="combobox"]') as HTMLInputElement
    await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; set.call(from, 'ATL'); from.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { button('Find live fares').click() })
    const id = (window as any).electronAPI.fares.search.mock.calls[0][1]
    expect(typeof id).toBe('string')
    expect(host.querySelectorAll('.fare-chip')).toHaveLength(2)
    expect(host.textContent).toContain('searching')
    // Kayak finishing alone must not end the search while Google is still loading.
    await act(async () => { listeners.forEach(cb => cb({ searchId: id, site: 'kayak', label: 'Kayak', status: 'blocked', offers: [], url: 'https://k', at: 2 })) })
    expect(host.textContent).toContain('searching')
  })

  // Shared harness for the review-fix tests below.
  const offer = (over: any = {}) => ({ source: 'google', price: 178, currency: 'USD', airlines: ['Delta'], stops: 0, layovers: [], departTime: '07:05', arriveTime: '09:10', arriveDayOffset: 0, durationMin: 305, bags: { carry: 1, checked: 0 }, bookUrl: 'https://g.example', ret: null, ...over })
  async function liveHarness(chat?: any) {
    const progress: any[] = [], flexDay: any[] = []
    const api = {
      search: vi.fn(async (_q: any, id: string) => ({ searchId: id })), cancel: vi.fn(), flex: vi.fn(async (_q: any, _id?: string) => []),
      handoff: vi.fn(async () => []), openSite: vi.fn(),
      onProgress: (cb: any) => { progress.push(cb); return () => {} }, onFlexDay: (cb: any) => { flexDay.push(cb); return () => {} },
    }
    ;(window as any).electronAPI = { fares: api, ...(chat ? { ai: { chat } } : {}) }
    localStorage.setItem(FLIGHTS_PREFILL_KEY, 'LAX')
    remount()
    const from = host.querySelector('input[role="combobox"]') as HTMLInputElement
    await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; set.call(from, 'ATL'); from.dispatchEvent(new Event('input', { bubbles: true })) })
    const search = async () => { await act(async () => { button('Find live fares').click() }); return api.search.mock.calls.at(-1)![1] as string }
    const emit = async (ev: any) => { await act(async () => { progress.forEach(cb => cb(ev)) }) }
    const emitDay = async (d: any) => { await act(async () => { flexDay.forEach(cb => cb(d)) }) }
    const finish = async (id: string, offers = [offer(), offer({ airlines: ['Frontier'], price: 152, departTime: '21:32' })]) =>
      emit({ searchId: id, site: 'google', label: 'Google Flights', status: 'done', offers, url: 'https://g', at: 1, total: 1 })
    return { api, search, emit, emitDay, finish }
  }

  it('asks for live fares in USD whatever the form currency (USD-first; UI prints $)', () => {
    expect(tripToQuery({ kind: 'flights', origin: 'ATL', destination: 'LAX', start: '2099-11-10', end: '2099-11-17', travelers: 1, budget: '', currency: 'EUR', flexible: true })!.currency).toBe('USD')
  })

  it('starts the flex strip once, for this search id, only after every site is final', async () => {
    const h = await liveHarness()
    const id = await h.search()
    expect(h.api.flex).not.toHaveBeenCalled()
    await h.finish(id)
    expect(h.api.flex).toHaveBeenCalledTimes(1)
    expect(h.api.flex.mock.calls[0][1]).toBe(id)
  })

  it('drops flex days that belong to an older search', async () => {
    const h = await liveHarness()
    const id = await h.search()
    await h.finish(id)
    await h.emitDay({ searchId: 'old-search', depart: '2099-01-01', ret: '2099-01-08', price: 99 })
    expect(host.querySelector('.fare-flex-strip')).toBeNull()
    await h.emitDay({ searchId: id, depart: '2099-01-02', ret: '2099-01-09', price: 120 })
    expect(host.querySelector('.fare-flex-strip')).not.toBeNull()
  })

  it('a late AI reply from a previous search does not block the next search\'s pick', async () => {
    let releaseFirst!: (v: any) => void
    const chat = vi.fn()
      .mockImplementationOnce(() => new Promise(r => { releaseFirst = r }))
      .mockImplementation(async () => ({ provider: 'ollama', content: '{"key":"none","reason":"x"}' }))
    const h = await liveHarness(chat)
    const id1 = await h.search()
    await h.finish(id1)
    expect(chat).toHaveBeenCalledTimes(1)
    const id2 = await h.search()
    await act(async () => { releaseFirst({ provider: 'ollama', content: '{"key":"delta|07:05|09:10|0","reason":"old"}' }) })
    await h.finish(id2)
    expect(chat).toHaveBeenCalledTimes(2)
  })

  it('starts a live search for flights and shows hand-off links when every site fails', async () => {
    const listeners: any[] = []
    ;(window as any).electronAPI = { fares: {
      search: vi.fn(async () => ({ searchId: 's1' })), cancel: vi.fn(), flex: vi.fn(async () => []),
      handoff: vi.fn(async () => [{ name: 'Expedia', url: 'https://www.expedia.com/x' }]), openSite: vi.fn(),
      onProgress: (cb: any) => { listeners.push(cb); return () => {} }, onFlexDay: () => () => {},
    } }
    localStorage.setItem(FLIGHTS_PREFILL_KEY, 'LAX')
    remount()
    const from = host.querySelector('input[role="combobox"]') as HTMLInputElement
    await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; set.call(from, 'ATL'); from.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { button('Find live fares').click() })
    expect((window as any).electronAPI.fares.search.mock.calls[0][0]).toEqual(expect.objectContaining({ from: 'ATL', to: 'LAX' }))
    await act(async () => { listeners.forEach(cb => cb({ searchId: 's1', site: 'google', label: 'Google Flights', status: 'blocked', offers: [], url: 'https://www.google.com/travel/flights', at: 1 })) })
    expect(host.textContent).toContain('needs a human check')
    expect(host.textContent).toContain('Expedia')
  })
})
