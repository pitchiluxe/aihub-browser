// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  it('an image that fails to load falls back to the placeholder', async () => {
    act(() => root.render(<TrackThumb track={{ title: 'x', cover: 'https://bad/' } as any} />))
    await act(async () => { host.querySelector('img')!.dispatchEvent(new Event('error')) })
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('.dj-thumb-none')).not.toBeNull()
  })
  it('a local song with no artwork gets the cover YouTube has for it', async () => {
    localStorage.clear()
    const youtubeSearch = vi.fn(async () => ({ ok: true, videos: [{ thumbnail: 'https://i.ytimg.com/vi/abc/hqdefault.jpg' }] }))
    ;(window as any).electronAPI = { dj: { youtubeSearch } }
    await act(async () => root.render(<TrackThumb track={{ title: 'Jehovah', artist: "L'or Mbongo" } as any} />))
    await act(async () => {})
    expect(youtubeSearch).toHaveBeenCalledWith("l'or mbongo jehovah", 1)
    expect((host.querySelector('img') as HTMLImageElement).src).toContain('/vi/abc/')
    delete (window as any).electronAPI
  })
  it('a YouTube song whose thumbnail fails falls back to the standard one', async () => {
    act(() => root.render(<TrackThumb track={{ title: 'x', youtubeId: 'vid12345678', cover: 'https://i.ytimg.com/vi/vid12345678/maxresdefault.jpg' } as any} />))
    await act(async () => { host.querySelector('img')!.dispatchEvent(new Event('error')) })
    expect((host.querySelector('img') as HTMLImageElement).src).toBe('https://i.ytimg.com/vi/vid12345678/mqdefault.jpg')
  })
  it('shows YouTube\'s letterboxed 4:3 thumbnails as the bar-free 16:9 one', () => {
    act(() => root.render(<TrackThumb track={{ title: 'x', cover: 'https://i.ytimg.com/vi/vid12345678/hqdefault.jpg?sqp=abc' } as any} />))
    expect((host.querySelector('img') as HTMLImageElement).src).toBe('https://i.ytimg.com/vi/vid12345678/mqdefault.jpg')
  })
})
