import { describe, it, expect } from 'vitest'
import {
  hostOf, isSameOrSubdomain, matchBlocklist, decideRequest,
  emptyStats, recordBlock, DEFAULT_ADBLOCK_CONFIG, type AdblockConfig,
} from './index'
import { DEFAULT_BLOCKLIST, BLOCKLIST_SIZE } from './adblockList'

const FOCUS_PAGE = 'https://landing-sooty-omega-22.vercel.app/blocked'
const on: AdblockConfig = { ...DEFAULT_ADBLOCK_CONFIG }
const sub = (url: string, id = 1) => ({ url, resourceType: 'script', webContentsId: id })

describe('hostOf', () => {
  it('lowercases and drops www', () => {
    expect(hostOf('https://WWW.Example.COM/path?q=1')).toBe('example.com')
  })
  it('returns empty string for junk instead of throwing', () => {
    expect(hostOf('not a url')).toBe('')
    expect(hostOf('')).toBe('')
  })
})

describe('isSameOrSubdomain', () => {
  it('matches the domain itself and its subdomains', () => {
    expect(isSameOrSubdomain('evil.com', 'evil.com')).toBe(true)
    expect(isSameOrSubdomain('ads.evil.com', 'evil.com')).toBe(true)
  })
  it('does not match a domain that merely ends with the same text', () => {
    expect(isSameOrSubdomain('notevil.com', 'evil.com')).toBe(false)
    expect(isSameOrSubdomain('evil.com.attacker.net', 'evil.com')).toBe(false)
  })
})

describe('matchBlocklist', () => {
  const list = new Set(['doubleclick.net', 'google-analytics.com'])
  it('matches an exact host', () => {
    expect(matchBlocklist('doubleclick.net', list)).toBe('doubleclick.net')
  })
  it('matches deep subdomains via the parent domain', () => {
    expect(matchBlocklist('stats.g.doubleclick.net', list)).toBe('doubleclick.net')
  })
  it('leaves unrelated hosts alone', () => {
    expect(matchBlocklist('example.com', list)).toBeNull()
    expect(matchBlocklist('mydoubleclick.net', list)).toBeNull()
  })
})

describe('decideRequest — ad blocking', () => {
  it('cancels a third-party tracker subresource', () => {
    expect(decideRequest(sub('https://www.google-analytics.com/collect'), on, null, 'news.example', FOCUS_PAGE))
      .toEqual({ cancel: true })
  })

  it('cancels deep subdomains of a listed domain', () => {
    expect(decideRequest(sub('https://securepubads.g.doubleclick.net/tag.js'), on, null, 'news.example', FOCUS_PAGE))
      .toEqual({ cancel: true })
  })

  it('leaves ordinary requests alone', () => {
    expect(decideRequest(sub('https://cdn.example.com/app.js'), on, null, 'example.com', FOCUS_PAGE)).toEqual({})
  })

  it('never cancels a top-level navigation, even to a blocked domain', () => {
    const nav = { url: 'https://www.google-analytics.com/', resourceType: 'mainFrame' }
    expect(decideRequest(nav, on, null, '', FOCUS_PAGE)).toEqual({})
  })

  it('allows a page to talk to its own domain even when listed', () => {
    const req = sub('https://analytics.google.com/g/collect')
    expect(decideRequest(req, on, null, 'analytics.google.com', FOCUS_PAGE)).toEqual({})
  })

  it('does nothing when blocking is switched off', () => {
    const off = { ...on, enabled: false }
    expect(decideRequest(sub('https://doubleclick.net/x.js'), off, null, 'news.example', FOCUS_PAGE)).toEqual({})
  })

  it('honours a per-site allowlist entry, including its subdomains', () => {
    const cfg = { ...on, allowlist: ['news.example'] }
    expect(decideRequest(sub('https://doubleclick.net/x.js'), cfg, null, 'news.example', FOCUS_PAGE)).toEqual({})
    expect(decideRequest(sub('https://doubleclick.net/x.js'), cfg, null, 'sport.news.example', FOCUS_PAGE)).toEqual({})
    // …but only for that site.
    expect(decideRequest(sub('https://doubleclick.net/x.js'), cfg, null, 'other.example', FOCUS_PAGE))
      .toEqual({ cancel: true })
  })

  it('blocks user-added custom domains', () => {
    const cfg = { ...on, custom: ['Annoying.Example'] }
    expect(decideRequest(sub('https://cdn.annoying.example/a.js'), cfg, null, 'news.example', FOCUS_PAGE))
      .toEqual({ cancel: true })
  })

  it('ignores unparseable urls', () => {
    expect(decideRequest(sub('data:text/html,hi'), on, null, 'news.example', FOCUS_PAGE)).toEqual({})
  })
})

describe('decideRequest — focus mode', () => {
  const focus = ['reddit.com']

  it('redirects a top-level navigation to a focus-blocked site', () => {
    const nav = { url: 'https://www.reddit.com/r/all', resourceType: 'mainFrame' }
    const out = decideRequest(nav, on, focus, '', FOCUS_PAGE)
    expect(out.redirectURL).toContain(FOCUS_PAGE)
    expect(out.redirectURL).toContain('reddit.com')
  })

  it('never redirects the block page itself, which would loop', () => {
    const nav = { url: FOCUS_PAGE + '?site=reddit.com', resourceType: 'mainFrame' }
    expect(decideRequest(nav, on, ['landing-sooty-omega-22.vercel.app'], '', FOCUS_PAGE)).toEqual({})
  })

  it('leaves subresources of a focus-blocked domain to the ad rules', () => {
    const req = sub('https://reddit.com/static/app.js')
    expect(decideRequest(req, on, focus, 'reddit.com', FOCUS_PAGE)).toEqual({})
  })

  it('still applies focus blocking while ad blocking is off', () => {
    const nav = { url: 'https://reddit.com/', resourceType: 'mainFrame' }
    const out = decideRequest(nav, { ...on, enabled: false }, focus, '', FOCUS_PAGE)
    expect(out.redirectURL).toBeTruthy()
  })
})

describe('stats', () => {
  it('counts totals, per tab and per domain', () => {
    const stats = emptyStats()
    recordBlock(stats, 'doubleclick.net', 7)
    recordBlock(stats, 'doubleclick.net', 7)
    recordBlock(stats, 'hotjar.com', 9)
    expect(stats.total).toBe(3)
    expect(stats.perTab).toEqual({ 7: 2, 9: 1 })
    expect(stats.topDomains).toEqual({ 'doubleclick.net': 2, 'hotjar.com': 1 })
  })
})

describe('the shipped blocklist', () => {
  it('covers the majors', () => {
    for (const d of ['doubleclick.net', 'google-analytics.com', 'criteo.com', 'hotjar.com', 'taboola.com']) {
      expect(DEFAULT_BLOCKLIST.has(d)).toBe(true)
    }
    expect(BLOCKLIST_SIZE).toBeGreaterThan(150)
  })

  it('does not block consent, captcha, payment or CDN infrastructure', () => {
    for (const d of [
      'onetrust.com', 'cookielaw.org', 'cookiebot.com', 'recaptcha.net', 'hcaptcha.com',
      'stripe.com', 'paypal.com', 'cloudflare.com', 'jsdelivr.net', 'unpkg.com', 'gstatic.com',
      'accounts.google.com', 'sentry.io',
    ]) {
      expect(DEFAULT_BLOCKLIST.has(d)).toBe(false)
    }
  })

  it('holds only lowercase bare domains — no scheme, path or wildcard', () => {
    for (const d of DEFAULT_BLOCKLIST) {
      expect(d).toBe(d.toLowerCase())
      expect(d).not.toMatch(/[/:*]/)
      expect(d).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/)
    }
  })
})
