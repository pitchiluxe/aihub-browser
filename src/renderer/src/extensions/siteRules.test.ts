import { describe, it, expect } from 'vitest'
import {
  hostOfUrl, normalizePattern, matchesPattern, shouldRunOn, describeRules,
  addSite, removeSite, DEFAULT_SITE_RULES, type SiteRules,
} from './siteRules'

describe('hostOfUrl', () => {
  it('reads the site from a web url', () => {
    expect(hostOfUrl('https://www.GitHub.com/a/b?c=1')).toBe('github.com')
    expect(hostOfUrl('http://docs.github.com')).toBe('docs.github.com')
  })
  it('is empty for anything that is not a web page', () => {
    expect(hostOfUrl('aihub://settings')).toBe('')
    expect(hostOfUrl('about:blank')).toBe('')
    expect(hostOfUrl('data:text/html,hi')).toBe('')
    expect(hostOfUrl('')).toBe('')
  })
})

describe('normalizePattern', () => {
  it('accepts what a user actually types or pastes', () => {
    expect(normalizePattern('https://www.github.com/foo/bar')).toBe('github.com')
    expect(normalizePattern('  GitHub.com  ')).toBe('github.com')
    expect(normalizePattern('github.com:8080')).toBe('github.com')
    expect(normalizePattern('*.github.com')).toBe('*.github.com')
  })
  it('rejects things that are not sites', () => {
    expect(normalizePattern('')).toBe('')
    expect(normalizePattern('localhost')).toBe('')
    expect(normalizePattern('not a site')).toBe('')
    expect(normalizePattern('*.')).toBe('')
  })
})

describe('matchesPattern', () => {
  it('matches the site and its subdomains', () => {
    expect(matchesPattern('github.com', 'github.com')).toBe(true)
    expect(matchesPattern('docs.github.com', 'github.com')).toBe(true)
  })
  it('never matches a lookalike domain', () => {
    expect(matchesPattern('notgithub.com', 'github.com')).toBe(false)
    expect(matchesPattern('github.com.evil.net', 'github.com')).toBe(false)
  })
  it('treats *.site as subdomains only', () => {
    expect(matchesPattern('docs.github.com', '*.github.com')).toBe(true)
    expect(matchesPattern('github.com', '*.github.com')).toBe(false)
  })
  it('is false on junk rather than throwing', () => {
    expect(matchesPattern('', 'github.com')).toBe(false)
    expect(matchesPattern('github.com', '')).toBe(false)
  })
})

describe('shouldRunOn', () => {
  const only: SiteRules = { mode: 'only', patterns: ['github.com'] }
  const except: SiteRules = { mode: 'except', patterns: ['bank.example'] }

  it('runs everywhere by default', () => {
    expect(shouldRunOn('https://anything.com', DEFAULT_SITE_RULES)).toBe(true)
    expect(shouldRunOn('https://anything.com', null)).toBe(true)
    expect(shouldRunOn('https://anything.com', undefined)).toBe(true)
  })

  it('never runs on the app’s own pages', () => {
    expect(shouldRunOn('aihub://settings', DEFAULT_SITE_RULES)).toBe(false)
    expect(shouldRunOn('about:blank', DEFAULT_SITE_RULES)).toBe(false)
    expect(shouldRunOn('data:text/html,crash', DEFAULT_SITE_RULES)).toBe(false)
  })

  it('honours an allow list, subdomains included', () => {
    expect(shouldRunOn('https://github.com/x', only)).toBe(true)
    expect(shouldRunOn('https://docs.github.com/x', only)).toBe(true)
    expect(shouldRunOn('https://example.com', only)).toBe(false)
  })

  it('honours a block list', () => {
    expect(shouldRunOn('https://bank.example/login', except)).toBe(false)
    expect(shouldRunOn('https://secure.bank.example/login', except)).toBe(false)
    expect(shouldRunOn('https://example.com', except)).toBe(true)
  })

  it('does not run everywhere just because an allow list is still empty', () => {
    expect(shouldRunOn('https://example.com', { mode: 'only', patterns: [] })).toBe(false)
    expect(shouldRunOn('https://example.com', { mode: 'except', patterns: [] })).toBe(true)
  })

  it('ignores unusable patterns in the list', () => {
    expect(shouldRunOn('https://github.com', { mode: 'only', patterns: ['not a site', 'github.com'] })).toBe(true)
  })
})

describe('describeRules', () => {
  it('says what the user will actually see happen', () => {
    expect(describeRules(DEFAULT_SITE_RULES)).toBe('Runs on every site')
    expect(describeRules({ mode: 'only', patterns: ['github.com'] })).toBe('Only on github.com')
    expect(describeRules({ mode: 'except', patterns: ['bank.example'] })).toBe('Everywhere except bank.example')
    expect(describeRules({ mode: 'only', patterns: [] })).toContain('No sites chosen yet')
  })
  it('summarises a long list', () => {
    const rules: SiteRules = { mode: 'only', patterns: ['a.com', 'b.com', 'c.com', 'd.com', 'e.com'] }
    expect(describeRules(rules)).toContain('+2 more')
  })
})

describe('addSite / removeSite', () => {
  it('adds a normalised pattern', () => {
    expect(addSite(DEFAULT_SITE_RULES, 'https://www.GitHub.com/x').patterns).toEqual(['github.com'])
  })
  it('never adds the same site twice', () => {
    const once = addSite(DEFAULT_SITE_RULES, 'github.com')
    expect(addSite(once, 'https://www.github.com/').patterns).toEqual(['github.com'])
  })
  it('ignores an unusable entry', () => {
    expect(addSite(DEFAULT_SITE_RULES, 'nonsense').patterns).toEqual([])
  })
  it('removes regardless of how the site was typed', () => {
    const rules = addSite(DEFAULT_SITE_RULES, 'github.com')
    expect(removeSite(rules, 'https://www.github.com').patterns).toEqual([])
  })
})
