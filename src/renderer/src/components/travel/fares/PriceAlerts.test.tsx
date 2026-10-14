// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AlertForm, AlertList, fareAlertsFrom, suggestTarget, targetProblem } from './PriceAlerts'
import { alertTitle } from '../FlightsRentalsPage'
import type { FareQuery } from '../../../../../shared/fares/types'

const q: FareQuery = { from: 'EWR', to: 'FIH', depart: '2099-11-01', ret: '2099-11-15', adults: 1, currency: 'USD' }

describe('alert rules', () => {
  it('suggests about 10% under today’s lowest fare, else the budget', () => {
    expect(suggestTarget(1234, '')).toBe(1110)
    expect(suggestTarget(null, '900')).toBe(900)
    expect(suggestTarget(null, '')).toBeNull()
  })
  it('refuses a target the fare already meets, or a nonsense one', () => {
    expect(targetProblem(1300, 1234)).toMatch(/already \$1234/)
    expect(targetProblem(10, null)).toMatch(/above \$20/)
    expect(targetProblem(1100, 1234)).toBeNull()
  })
  it('keeps only fare watches from the watch list', () => {
    const alerts = fareAlertsFrom([
      { id: 'p', mode: 'change', url: 'https://x' },
      { id: 'f', mode: 'fare', title: 'EWR → FIH', active: true, triggered: true, lastChecked: 5, fare: { query: q, target: 900, lastPrice: 880 } },
      { id: 'bad', mode: 'fare' },
    ])
    expect(alerts).toEqual([{ id: 'f', title: 'EWR → FIH', target: 900, lastPrice: 880, lastChecked: 5, triggered: true, active: true, query: q }])
    expect(fareAlertsFrom(null)).toEqual([])
  })
  it('names an alert by route and dates', () => {
    expect(alertTitle(q)).toBe('EWR → FIH · Nov 1–Nov 15')
  })
})

describe('alert screens', () => {
  let host: HTMLDivElement, root: Root
  beforeEach(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  })
  afterEach(() => { act(() => root.unmount()); host.remove(); delete (window as any).electronAPI })

  it('sets an alert with today’s lowest fare as the starting point', async () => {
    const watch = vi.fn().mockResolvedValue({ ok: true, id: 'w1' })
    ;(window as any).electronAPI = { fares: { watch } }
    const done = vi.fn()
    act(() => root.render(<AlertForm query={q} title="EWR → FIH" lowest={1234} budget="" onDone={done} />))
    expect((host.querySelector('input') as HTMLInputElement).value).toBe('1110')
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(watch).toHaveBeenCalledWith(q, 1110, 'EWR → FIH', 1234)
    expect(done.mock.calls[0][0]).toMatch(/Alert on.*\$1110 or less/)
  })

  it('will not submit a target the fare already meets', async () => {
    const watch = vi.fn()
    ;(window as any).electronAPI = { fares: { watch } }
    act(() => root.render(<AlertForm query={q} title="t" lowest={500} budget="900" onDone={vi.fn()} />))
    const input = host.querySelector('input') as HTMLInputElement
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '600'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(host.querySelector('[role=alert]')?.textContent).toMatch(/already \$500/)
    expect((host.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(true)
    expect(watch).not.toHaveBeenCalled()
  })

  it('lists alerts, shows a drop, and removes one', async () => {
    const remove = vi.fn().mockResolvedValue({ ok: true })
    ;(window as any).electronAPI = { watch: {
      list: vi.fn().mockResolvedValue([{ id: 'f', mode: 'fare', title: 'EWR → FIH', active: true, triggered: true, fare: { query: q, target: 900, lastPrice: 880 } }]),
      onChanged: () => () => {}, remove, checkNow: vi.fn(),
    } }
    const open = vi.fn()
    await act(async () => root.render(<AlertList onOpen={open} />))
    expect(host.textContent).toContain('Price dropped!')
    expect(host.textContent).toContain('Target $900 · now $880')
    act(() => (host.querySelector('[aria-label="Remove alert EWR → FIH"]') as HTMLButtonElement).click())
    expect(remove).toHaveBeenCalledWith('f')
    act(() => (host.querySelector('.fare-alert-main') as HTMLButtonElement).click())
    expect(open).toHaveBeenCalledWith(q)
  })
})
