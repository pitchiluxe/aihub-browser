// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import TrackThumb from './TrackThumb'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('TrackThumb — the cover beside a song in the set list', () => {
  it('shows the song\'s thumbnail', () => {
    act(() => root.render(<TrackThumb track={{ title: 'Halo', cover: 'https://i.ytimg.com/vi/x/hqdefault.jpg' } as any} />))
    const img = host.querySelector('img') as HTMLImageElement
    expect(img.src).toContain('i.ytimg.com')
    expect(img.alt).toBe('')            // decorative: the title is right beside it
  })
  it('a song without artwork gets a placeholder, never a broken image', () => {
    act(() => root.render(<TrackThumb track={{ title: 'demo.mp3' } as any} />))
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('.dj-thumb-none')).not.toBeNull()
  })
  it('an image that fails to load falls back to the placeholder', () => {
    act(() => root.render(<TrackThumb track={{ title: 'x', cover: 'https://bad/' } as any} />))
    act(() => { host.querySelector('img')!.dispatchEvent(new Event('error')) })
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('.dj-thumb-none')).not.toBeNull()
  })
})
