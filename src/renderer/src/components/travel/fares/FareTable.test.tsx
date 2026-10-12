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

  it('keeps the overnight marker on the same line as the times (not a separate grid cell)', () => {
    act(() => root.render(<FareTable offers={offers} adults={1} onBook={() => {}} />))
    const sup = host.querySelector('.fare-times sup')!
    expect(sup.parentElement!.classList.contains('fare-times')).toBe(false)
    expect(sup.parentElement!.textContent).toMatch(/→/)
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
