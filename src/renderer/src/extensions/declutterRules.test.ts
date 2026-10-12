// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildDeclutterStyleScript,
  loadDeclutterRules,
  normalizeOrigin,
  normalizeSelectors,
  saveDeclutterRules,
  selectorsForOrigin,
  type DeclutterRule,
} from './declutterRules'

const key = 'aihub-site-declutter-v1'
const validRule: DeclutterRule = {
  id: 'rule-1', origin: 'https://example.com', selectors: ['.sidebar'], enabled: true, updatedAt: 1,
}

describe('site declutter rule model', () => {
  beforeEach(() => localStorage.clear())

  it('normalizes only valid HTTP(S) origins including default ports', () => {
    expect(normalizeOrigin('HTTPS://Example.COM:443/path?q=1')).toBe('https://example.com')
    expect(normalizeOrigin('http://example.com:80/')).toBe('http://example.com')
    expect(normalizeOrigin('https://example.com:8443/')).toBe('https://example.com:8443')
    expect(normalizeOrigin('file:///C:/notes.html')).toBeNull()
    expect(normalizeOrigin('javascript:alert(1)')).toBeNull()
    expect(normalizeOrigin('not a url')).toBeNull()
  })

  it('trims and de-duplicates valid CSS selectors and enforces bounds', () => {
    expect(normalizeSelectors([' .sidebar ', '.sidebar', 'aside[aria-label="promo"]'])).toEqual({
      ok: true, selectors: ['.sidebar', 'aside[aria-label="promo"]'],
    })
    expect(normalizeSelectors([])).toMatchObject({ ok: false })
    expect(normalizeSelectors(['.x'.repeat(151)])).toMatchObject({ ok: false })
    expect(normalizeSelectors(Array.from({ length: 31 }, (_, i) => `.selector-${i}`))).toMatchObject({ ok: false })
  })

  it('rejects malformed selectors and CSS declaration or block injection', () => {
    expect(normalizeSelectors(['div:not('])).toMatchObject({ ok: false })
    expect(normalizeSelectors(['.ad} body'])).toMatchObject({ ok: false })
    expect(normalizeSelectors(['.ad; body'])).toMatchObject({ ok: false })
  })

  it('loads valid versioned rules and recovers from malformed or untrusted storage', () => {
    localStorage.setItem(key, JSON.stringify([validRule]))
    expect(loadDeclutterRules()).toEqual([validRule])

    localStorage.setItem(key, '{broken')
    expect(loadDeclutterRules()).toEqual([])

    localStorage.setItem(key, JSON.stringify([{ ...validRule, origin: 'javascript:alert(1)' }]))
    expect(loadDeclutterRules()).toEqual([])
  })

  it('persists valid rules and reports storage failures', () => {
    expect(saveDeclutterRules([validRule])).toBe(true)
    expect(JSON.parse(localStorage.getItem(key) || 'null')).toEqual([validRule])
    expect(saveDeclutterRules([{ ...validRule, selectors: ['body{}'] }])).toBe(false)
    expect(saveDeclutterRules([validRule], { setItem: () => { throw new Error('quota') } })).toBe(false)
  })

  it('returns selectors only for enabled exact-origin matches', () => {
    const otherOrigin = { ...validRule, id: 'rule-2', origin: 'https://other.example.com' }
    expect(selectorsForOrigin('https://example.com/path', [validRule, otherOrigin])).toEqual(['.sidebar'])
    expect(selectorsForOrigin('http://example.com', [validRule])).toEqual([])
    expect(selectorsForOrigin('https://example.com:8443', [validRule])).toEqual([])
    expect(selectorsForOrigin('https://example.com', [{ ...validRule, enabled: false }])).toEqual([])
  })

  it('replaces or removes only its own stylesheet and embeds selectors as data', () => {
    document.head.innerHTML = '<style id="site-theme">body{color:purple}</style><style data-aihub-declutter>old{}</style>'
    document.body.innerHTML = '<aside class="sidebar">Side</aside>'
    const apply = new Function(buildDeclutterStyleScript(['.sidebar'])) as () => void
    apply()
    expect(document.querySelectorAll('style[data-aihub-declutter]')).toHaveLength(1)
    expect((document.querySelector('style[data-aihub-declutter]') as HTMLStyleElement).textContent).toContain('.sidebar { display: none !important; }')
    expect(document.getElementById('site-theme')).not.toBeNull()

    const clear = new Function(buildDeclutterStyleScript([])) as () => void
    clear()
    expect(document.querySelector('style[data-aihub-declutter]')).toBeNull()
  })
})
