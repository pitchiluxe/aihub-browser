// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { createOverlayStorage, installPrivateStorage } from './privateStorage'

describe('private storage overlay', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('reads preferences the normal windows saved', () => {
    window.localStorage.setItem('aihub-theme', 'midnight')
    const overlay = createOverlayStorage(window.localStorage)
    expect(overlay.getItem('aihub-theme')).toBe('midnight')
    expect(overlay.getItem('missing')).toBeNull()
  })

  it('never writes through to the real storage', () => {
    window.localStorage.setItem('aihub-focus-days-v1', '[]')
    const overlay = createOverlayStorage(window.localStorage)
    overlay.setItem('aihub-focus-days-v1', '[{"lastUrl":{"private.example":"https://private.example/x"}}]')
    overlay.setItem('new-key', 'v')
    expect(overlay.getItem('aihub-focus-days-v1')).toContain('private.example')
    expect(window.localStorage.getItem('aihub-focus-days-v1')).toBe('[]')
    expect(window.localStorage.getItem('new-key')).toBeNull()
  })

  it('shadows removals and clear() without touching the real values', () => {
    window.localStorage.setItem('a', '1')
    window.localStorage.setItem('b', '2')
    const overlay = createOverlayStorage(window.localStorage)
    overlay.removeItem('a')
    expect(overlay.getItem('a')).toBeNull()
    expect(overlay.length).toBe(1)
    overlay.clear()
    expect(overlay.getItem('b')).toBeNull()
    expect(overlay.length).toBe(0)
    overlay.setItem('c', '3')
    expect(overlay.key(0)).toBe('c')
    expect(window.localStorage.getItem('a')).toBe('1')
    expect(window.localStorage.getItem('b')).toBe('2')
    expect(window.localStorage.getItem('c')).toBeNull()
  })

  it('reports keys and length as the union seen by this window', () => {
    window.localStorage.setItem('x', '1')
    const overlay = createOverlayStorage(window.localStorage)
    overlay.setItem('y', '2')
    overlay.setItem('x', 'shadowed')
    expect(overlay.length).toBe(2)
    expect(new Set([overlay.key(0), overlay.key(1)])).toEqual(new Set(['x', 'y']))
    expect(overlay.key(5)).toBeNull()
  })

  it('keeps property-style access inside the overlay', () => {
    const overlay = createOverlayStorage(window.localStorage) as any
    overlay.prop = 'value'
    expect(overlay.prop).toBe('value')
    expect(overlay.getItem('prop')).toBe('value')
    expect(window.localStorage.getItem('prop')).toBeNull()
    delete overlay.prop
    expect(overlay.getItem('prop')).toBeNull()
  })

  it('still works when there is no real storage at all', () => {
    const overlay = createOverlayStorage(null)
    overlay.setItem('k', 'v')
    expect(overlay.getItem('k')).toBe('v')
    expect(overlay.length).toBe(1)
  })

  it('replaces window.localStorage for code that runs afterwards', () => {
    window.localStorage.setItem('pref', 'kept')
    const real = window.localStorage
    const fakeWindow = { localStorage: real } as unknown as Window
    expect(installPrivateStorage(fakeWindow)).toBe(true)
    expect(fakeWindow.localStorage).not.toBe(real)
    expect(fakeWindow.localStorage.getItem('pref')).toBe('kept')
    fakeWindow.localStorage.setItem('pref', 'changed-privately')
    expect(real.getItem('pref')).toBe('kept')
  })
})
