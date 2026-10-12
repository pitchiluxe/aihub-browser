import { describe, it, expect } from 'vitest'
import { shownFlag } from './shownFlag'

/** A ResizeObserver stand-in the test can drive. */
function fakeRO() {
  let cb: ((entries: any[]) => void) | null = null
  let observed: unknown = null, disconnected = false
  class RO { constructor(c: any) { cb = c } observe(el: unknown) { observed = el } disconnect() { disconnected = true } }
  return { RO: RO as any, size: (w: number, h: number) => cb!([{ contentRect: { width: w, height: h } }]), observed: () => observed, disconnected: () => disconnected }
}

describe('shownFlag — "is this canvas on screen" without forcing layout each frame', () => {
  it('follows the element size the ResizeObserver reports (0×0 = display:none)', () => {
    const ro = fakeRO(); const el = {} as Element
    const f = shownFlag(el, ro.RO)
    expect(ro.observed()).toBe(el)
    ro.size(300, 200); expect(f.shown).toBe(true)
    ro.size(0, 0); expect(f.shown).toBe(false)
    ro.size(300, 0); expect(f.shown).toBe(false)
    f.dispose(); expect(ro.disconnected()).toBe(true)
  })
  it('assumes shown until the first report, so the first frame still draws', () => {
    expect(shownFlag({} as Element, fakeRO().RO).shown).toBe(true)
  })
})
