// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi } from 'vitest'
import DestinationGallery from './DestinationGallery'
import type { Trip } from './flightsRentals'
const trip: Trip = { kind: 'stays', origin: '', destination: 'Paris', start: '2099-06-10', end: '2099-06-17', travelers: 2, budget: '', currency: 'USD', flexible: true }
describe('destination gallery', () => {
  it('displays destination images, credits, and opens the source inside the browser', async () => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ query: { pages: { 1: { title: 'File:Paris.jpg', imageinfo: [{ thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/a/ab/Paris.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Paris.jpg', extmetadata: { Artist: { value: 'Photographer' }, LicenseShortName: { value: 'CC0' } } }] } } } }) }))
    const host = document.createElement('div'), root = createRoot(host), navigate = vi.fn()
    try {
      await act(async () => root.render(<DestinationGallery trip={trip} onNavigate={navigate} />))
      const image = host.querySelector('img')!
      expect(image.src).toContain('thumb.wikimedia.org')
      expect(image.alt).toBe('Paris')
      expect(host.querySelector('figcaption')?.textContent).toContain('Photographer · CC0')
      act(() => host.querySelector('button')!.click())
      expect(navigate).toHaveBeenCalledWith('https://commons.wikimedia.org/wiki/File:Paris.jpg')
      act(() => image.dispatchEvent(new Event('error')))
      expect(host.querySelector('img')).toBeNull()
      expect(host.textContent).toContain('photos are unavailable')
    } finally { act(() => root.unmount()); vi.unstubAllGlobals() }
  })
})
