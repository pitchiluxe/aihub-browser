// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StageMixer from './StageMixer'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

const deck = (id: string) => {
  // Like the real Deck: it notifies ITS OWN subscribers, not the engine's.
  const ls = new Set<() => void>(); let ver = 0
  const d: any = {
    id, track: { title: `song ${id}` }, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filterKnob: 0.5, volume: 1,
    subscribe: (l: () => void) => { ls.add(l); return () => ls.delete(l) }, getVersion: () => ver,
  }
  const emit = () => { ver++; ls.forEach(l => l()) }
  d.setEq = vi.fn((b: string, v: number) => { d.eq[b] = v; emit() })
  d.setFilterKnob = vi.fn((v: number) => { d.filterKnob = v; emit() })
  d.setVolume = vi.fn((v: number) => { d.volume = v; emit() })
  return d
}
function engine() {
  return { decks: { A: deck('A'), B: deck('B') }, crossfader: 0.5, masterVolume: 0.75, setCrossfader: vi.fn(), setMasterVolume: vi.fn(),
    subscribe: () => () => {}, getVersion: () => 1 } as any
}
/** Move a range input the way a person drags it. */
function slide(el: HTMLInputElement, v: number) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  set.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true }))
}
const range = (label: string) => host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement

describe('StageMixer — bass, mid, treble and more from the stage', () => {
  it('bass / mid / treble move each deck\'s EQ bands', () => {
    const e = engine()
    act(() => root.render(<StageMixer engine={e} onClose={() => {}} />))
    act(() => slide(range('Deck A bass'), 80)); expect(e.decks.A.setEq).toHaveBeenLastCalledWith('low', 0.8)
    act(() => slide(range('Deck A treble'), 20)); expect(e.decks.A.setEq).toHaveBeenLastCalledWith('high', 0.2)
    act(() => slide(range('Deck B mid'), 65)); expect(e.decks.B.setEq).toHaveBeenLastCalledWith('mid', 0.65)
  })
  it('the slider stays where it was moved (live: it snapped back to 0 dB)', () => {
    const e = engine()
    act(() => root.render(<StageMixer engine={e} onClose={() => {}} />))
    act(() => slide(range('Deck A bass'), 80))
    expect(range('Deck A bass').value).toBe('80')
    expect(host.textContent).toContain('+7 dB')
  })

  it('filter, volume, crossfader and master volume', () => {
    const e = engine()
    act(() => root.render(<StageMixer engine={e} onClose={() => {}} />))
    act(() => slide(range('Deck B filter'), 30)); expect(e.decks.B.setFilterKnob).toHaveBeenLastCalledWith(0.3)
    act(() => slide(range('Deck A volume'), 50)); expect(e.decks.A.setVolume).toHaveBeenLastCalledWith(0.5)
    act(() => slide(range('Crossfader'), 100)); expect(e.setCrossfader).toHaveBeenLastCalledWith(1)
    act(() => slide(range('Master volume'), 60)); expect(e.setMasterVolume).toHaveBeenLastCalledWith(0.6)
  })
  it('"Flat" resets a deck\'s EQ and filter', () => {
    const e = engine()
    act(() => root.render(<StageMixer engine={e} onClose={() => {}} />))
    act(() => (host.querySelector('[aria-label="Flatten deck A"]') as HTMLButtonElement).click())
    expect(e.decks.A.setEq.mock.calls).toEqual([['low', 0.5], ['mid', 0.5], ['high', 0.5]])
    expect(e.decks.A.setFilterKnob).toHaveBeenCalledWith(0.5)
  })
})
