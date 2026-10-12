// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../VideoMonitor', () => ({ default: () => <div data-testid="video" /> }))
import StagePage from './StagePage'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

function fakeConductor(over: any = {}) {
  const listeners = new Set<() => void>()
  return {
    state: { active: false, paused: false, brief: null, upNext: [], rules: [], message: '', startedAt: 0, played: [], ...over },
    subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l) },
    getVersion: () => 1,
    start: vi.fn(async () => {}), skip: vi.fn(), steer: vi.fn(), setDiscovery: vi.fn(), removeRule: vi.fn(),
  } as any
}
const engine = { decks: { A: { track: null, time: 0, duration: 0, active: false }, B: { track: null, time: 0, duration: 0, active: false } }, subscribe: () => () => {}, getVersion: () => 1, crossfader: 0 } as any
const btn = (t: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes(t)) as HTMLButtonElement

describe('StagePage', () => {
  it('shows the start screen and starts a set from a preset', async () => {
    const c = fakeConductor()
    act(() => root.render(<StagePage engine={engine} conductor={c} onTakeDecks={() => {}} onAsk={() => {}} />))
    expect(host.textContent).toContain("What's the vibe?")
    await act(async () => btn('Warm-up').click())
    expect(c.start).toHaveBeenCalledTimes(1)
    expect(c.start.mock.calls[0][0].durationMin).toBeGreaterThan(0)
  })

  it('shows up-next with its reason, rules as removable chips, and the confirmation', () => {
    const track = { title: 'Lonely at the Top', artist: 'Asake', youtubeId: 'abcdefghijk' }
    const c = fakeConductor({
      active: true, brief: { vibe: 'afrobeats', durationMin: 60, curve: [{ atMin: 0, level: 0.4 }, { atMin: 60, level: 0.8 }], discoveryShare: 0.25, seeds: [], rules: [] },
      upNext: [{ candidate: { track, facts: { bpm: 104, camelot: '9A' }, known: false }, why: 'new to you · compatible key', transition: 'beatmatch' }],
      rules: [{ kind: 'banArtist', artist: 'drake' }],
      message: 'Got it — no Drake for the rest of the set.',
    })
    act(() => root.render(<StagePage engine={engine} conductor={c} onTakeDecks={() => {}} onAsk={() => {}} />))
    expect(host.textContent).toContain('Lonely at the Top')
    expect(host.textContent).toContain('new to you')
    expect(host.textContent).toContain('No Drake')
    expect(host.textContent).toContain('no Drake for the rest of the set')
    act(() => (host.querySelector('[aria-label="Remove rule No Drake"]') as HTMLButtonElement).click())
    expect(c.removeRule).toHaveBeenCalledWith(0)
  })

  it('steering buttons and typed requests reach the conductor / instruction pipeline', async () => {
    const onAsk = vi.fn()
    const c = fakeConductor({ active: true, brief: { vibe: 'x', durationMin: 60, curve: [{ atMin: 0, level: 0.5 }], discoveryShare: 0.25, seeds: [], rules: [] } })
    act(() => root.render(<StagePage engine={engine} conductor={c} onTakeDecks={() => {}} onAsk={onAsk} />))
    act(() => btn('More energy').click())
    expect(c.steer).toHaveBeenCalledWith('more-energy')
    act(() => btn('Skip').click())
    expect(c.skip).toHaveBeenCalled()
    const input = host.querySelector('input[aria-label="Tell the DJ"]') as HTMLInputElement
    await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; set.call(input, 'no slow songs'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(onAsk).toHaveBeenCalledWith('no slow songs')
  })

  it('clicking the energy graph moves the peak', () => {
    const c = fakeConductor({ active: true, setPeak: vi.fn(), brief: { vibe: 'x', durationMin: 60, curve: [{ atMin: 0, level: 0.5 }], discoveryShare: 0.25, seeds: [], rules: [] } })
    c.setPeak = vi.fn()
    act(() => root.render(<StagePage engine={engine} conductor={c} onTakeDecks={() => {}} onAsk={() => {}} />))
    const svg = host.querySelector('svg.dj-energy') as SVGSVGElement
    svg.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 90, right: 200, bottom: 90, x: 0, y: 0, toJSON() {} }) as DOMRect
    act(() => { svg.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100 })) })
    expect(c.setPeak).toHaveBeenCalledWith(30)
  })

  it('Take the decks hands over to the console', () => {
    const onTake = vi.fn()
    act(() => root.render(<StagePage engine={engine} conductor={fakeConductor({ active: true, brief: { vibe: 'x', durationMin: 60, curve: [{ atMin: 0, level: 0.5 }], discoveryShare: 0.25, seeds: [], rules: [] } })} onTakeDecks={onTake} onAsk={() => {}} />))
    act(() => btn('Take the decks').click())
    expect(onTake).toHaveBeenCalled()
  })
})
