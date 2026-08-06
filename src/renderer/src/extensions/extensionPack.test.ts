import { describe, it, expect } from 'vitest'
import { EXTENSION_PACK } from './extensionPack'
import { EXTENSION_DEFS } from './extensionDefs'

/** Settings object built from a definition's own defaults. */
const defaults = (def: typeof EXTENSION_PACK[number]) =>
  Object.fromEntries(def.settings.map(s => [s.key, s.default]))

describe('the built-in pack', () => {
  it('ships at least the twenty that were asked for', () => {
    expect(EXTENSION_PACK.length).toBeGreaterThanOrEqual(20)
  })

  it('is part of the library the Extensions page lists', () => {
    for (const def of EXTENSION_PACK) {
      expect(EXTENSION_DEFS.some(e => e.id === def.id)).toBe(true)
    }
  })

  it('has no duplicate ids or names, in the pack or against the originals', () => {
    const ids = EXTENSION_DEFS.map(e => e.id)
    const names = EXTENSION_DEFS.map(e => e.name.toLowerCase())
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(names).size).toBe(names.length)
  })

  it('covers a real spread of categories rather than twenty of one kind', () => {
    const cats = new Set(EXTENSION_PACK.map(e => e.category))
    expect(cats.size).toBeGreaterThanOrEqual(5)
  })

  it('describes every one properly — a card with no explanation is unusable', () => {
    for (const def of EXTENSION_PACK) {
      expect(def.name.length, def.id).toBeGreaterThan(2)
      expect(def.tagline.length, def.id).toBeGreaterThan(10)
      expect(def.description.length, def.id).toBeGreaterThan(60)
      expect(def.howTo.length, def.id).toBeGreaterThan(30)
      expect(def.icon, def.id).toBeTruthy()
      expect(def.color, def.id).toMatch(/^#[0-9a-f]{6}$/i)
      expect(def.version, def.id).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })

  it('gives every extension at least one setting to tune', () => {
    for (const def of EXTENSION_PACK) {
      expect(def.settings.length, def.id).toBeGreaterThan(0)
      for (const s of def.settings) {
        expect(s.key, def.id).toBeTruthy()
        expect(s.label.length, `${def.id}.${s.key}`).toBeGreaterThan(2)
        expect(['range', 'select', 'toggle']).toContain(s.type)
        expect(s.default, `${def.id}.${s.key}`).toBeDefined()
        if (s.type === 'range') {
          expect(typeof s.min).toBe('number')
          expect(typeof s.max).toBe('number')
          expect(s.default as number).toBeGreaterThanOrEqual(s.min!)
          expect(s.default as number).toBeLessThanOrEqual(s.max!)
        }
        if (s.type === 'select') {
          expect(s.options?.length, `${def.id}.${s.key}`).toBeGreaterThan(1)
          expect(s.options!.map(o => o.value)).toContain(s.default)
        }
        if (s.type === 'toggle') expect(typeof s.default).toBe('boolean')
      }
    }
  })
})

describe('the injected code is real, runnable JavaScript', () => {
  it('parses for every extension at its default settings', () => {
    for (const def of EXTENSION_PACK) {
      const code = def.inject(defaults(def))
      expect(() => new Function(code), `${def.id} inject`).not.toThrow()
      expect(() => new Function(def.remove), `${def.id} remove`).not.toThrow()
    }
  })

  it('parses at the extremes of every range and every select option', () => {
    for (const def of EXTENSION_PACK) {
      for (const s of def.settings) {
        const values = s.type === 'range' ? [s.min, s.max]
          : s.type === 'select' ? s.options!.map(o => o.value)
          : [true, false]
        for (const v of values) {
          const code = def.inject({ ...defaults(def), [s.key]: v })
          expect(() => new Function(code), `${def.id} with ${s.key}=${v}`).not.toThrow()
        }
      }
    }
  })

  it('survives missing settings — a first run has none stored', () => {
    for (const def of EXTENSION_PACK) {
      expect(() => new Function(def.inject({})), def.id).not.toThrow()
    }
  })
})

describe('injection hygiene', () => {
  it('guards against double injection, since navigation re-injects', () => {
    for (const def of EXTENSION_PACK) {
      const code = def.inject(defaults(def))
      expect(code, def.id).toContain(`__ext_${def.id}`)
      expect(code, def.id).toMatch(/if \(window\[K\]\) return/)
    }
  })

  it('cleans up everything it added when switched off', () => {
    for (const def of EXTENSION_PACK) {
      expect(def.remove, def.id).toContain(`__ext_${def.id}`)
      // The teardown runs the registered cleanups rather than hoping.
      expect(def.remove, def.id).toContain('clean.forEach')
      expect(def.remove, def.id).toContain(`${def.id}-style`)
    }
  })

  it('never throws out of the page — a broken extension must not break browsing', () => {
    for (const def of EXTENSION_PACK) {
      const code = def.inject(defaults(def))
      expect(code, def.id).toContain('try{')
      expect(code, def.id).toContain('catch(e)')
    }
  })

  it('declares needsPanel exactly when it uses the shared window', () => {
    for (const def of EXTENSION_PACK) {
      const usesPanel = def.inject(defaults(def)).includes('AIHubPanel.create')
      expect(!!def.needsPanel, `${def.id} needsPanel=${def.needsPanel}`).toBe(usesPanel)
    }
  })

  it('makes no network calls — everything is computed from the page', () => {
    for (const def of EXTENSION_PACK) {
      const code = def.inject(defaults(def))
      // fetch appears in Request Radar only because it WRAPS the page's own.
      if (def.id !== 'requestradar') {
        expect(code, def.id).not.toMatch(/\bfetch\s*\(/)
      }
      expect(code, def.id).not.toMatch(/new\s+WebSocket|importScripts|eval\s*\(/)
    }
  })

  it('escapes page-controlled text before putting it in markup', () => {
    // A hostile page must not be able to inject markup into a panel through
    // its own captions, JSON keys, font names or link text.
    for (const id of ['fontinspect', 'keyboardmap', 'tableport', 'jsonpeek', 'imageaudit']) {
      const def = EXTENSION_PACK.find(e => e.id === id)!
      const code = def.inject(defaults(def))
      expect(code, id).toContain('esc(')
    }
  })
})
