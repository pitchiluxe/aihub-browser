import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ net: { fetch: vi.fn() }, protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() } }))
import { emulatorCachePath } from './emulatorCache'

describe('emulator cache paths', () => {
  it('accepts files inside the emulator data folder', () => {
    expect(emulatorCachePath('/data/loader.js')).toBe('data/loader.js')
    expect(emulatorCachePath('/data/cores/fceumm-legacy-wasm.data')).toBe('data/cores/fceumm-legacy-wasm.data')
  })
  it('refuses traversal and anything outside data/', () => {
    for (const bad of ['/data/../secrets.json', '/data/%2e%2e/x.js', '/etc/passwd', '/data/cores/..', '/', '/data/a b.js', '/data/c:/x']) expect(emulatorCachePath(bad)).toBeNull()
  })
})
