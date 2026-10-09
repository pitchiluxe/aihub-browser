// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FlightsRentalsPage from './FlightsRentalsPage'
import { SAVED_TRIPS_KEY, type Trip } from './flightsRentals'
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
  it('opens a prefilled flight route when Compare providers is clicked', async () => {
    localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify([{ id: 'flight-trip', trip: { ...trip, kind: 'flights', origin: 'KJFK', destination: 'LFPG' } }]))
    act(() => root.unmount()); root = createRoot(host)
    act(() => root.render(<FlightsRentalsPage onNavigate={navigate} />))
    act(() => button('LFPG').click())
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
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
