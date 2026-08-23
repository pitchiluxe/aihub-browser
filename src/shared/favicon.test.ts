import { describe, it, expect } from 'vitest'
import { hostOf, initialFor, letterTileDataUri, faviconSourceUrl } from './favicon'

describe('hostOf', () => {
  // The original bug: `domain=` was handed the whole URL, so two bookmarks to
  // the same site asked for icons under keys that could never match, and the
  // request itself was malformed.
  it('reduces a full URL to its host', () => {
    expect(hostOf('https://example.com/some/path?q=1#frag')).toBe('example.com')
    expect(hostOf('http://sub.example.co.uk/x')).toBe('sub.example.co.uk')
  })

  it('accepts a schemeless paste, which bookmarks are full of', () => {
    expect(hostOf('example.com/path')).toBe('example.com')
    expect(hostOf('www.example.com')).toBe('www.example.com')
  })

  it('lowercases, so one site is one cache key', () => {
    expect(hostOf('HTTPS://Example.COM/Path')).toBe('example.com')
  })

  it('keeps localhost, which is a legitimate target here', () => {
    expect(hostOf('http://localhost:5173/x')).toBe('localhost')
  })

  // Returning '' rather than throwing matters: this runs inside a render, over
  // bookmarks that accumulated over years.
  it('returns empty for input that has no host, instead of throwing', () => {
    for (const bad of ['', '   ', 'not a url', 'about:blank', 'javascript:void(0)']) {
      expect(() => hostOf(bad)).not.toThrow()
      expect(hostOf(bad)).toBe('')
    }
    expect(hostOf(undefined as any)).toBe('')
    expect(hostOf(null as any)).toBe('')
  })
})

describe('initialFor', () => {
  it('skips the www prefix that every site shares', () => {
    expect(initialFor('www.github.com')).toBe('G')
  })

  it('uppercases and falls back for input with no letters', () => {
    expect(initialFor('example.com')).toBe('E')
    expect(initialFor('')).toBe('?')
    expect(initialFor('...')).toBe('?')
  })

  it('takes a digit when the name starts with one', () => {
    expect(initialFor('4chan.org')).toBe('4')
  })
})

describe('letterTileDataUri', () => {
  // The whole point: a src that cannot 404, because it never leaves the page.
  it('is a self-contained data URI with no network reference', () => {
    const uri = letterTileDataUri('https://example.com')
    expect(uri.startsWith('data:image/svg+xml;utf8,')).toBe(true)
    // The w3.org xmlns is a namespace identifier, not a resource — nothing
    // fetches it. Any OTHER absolute URL would be a request that can fail.
    expect(decodeURIComponent(uri)).not.toMatch(/https?:\/\/(?!www\.w3\.org)/)
  })

  it('is stable for one site and different across sites', () => {
    expect(letterTileDataUri('https://example.com')).toBe(letterTileDataUri('https://example.com/other'))
    expect(letterTileDataUri('https://example.com')).not.toBe(letterTileDataUri('https://github.com'))
  })

  it('escapes the initial rather than injecting it into the SVG', () => {
    const uri = decodeURIComponent(letterTileDataUri('https://example.com'))
    expect(uri).toContain('>E<')
    // A hostile "initial" can never close the text element.
    expect(decodeURIComponent(letterTileDataUri('<script>'))).not.toContain('<script>')
  })

  it('survives input that is not a URL at all', () => {
    expect(() => letterTileDataUri('')).not.toThrow()
    expect(letterTileDataUri('').startsWith('data:image/svg+xml')).toBe(true)
  })
})

describe('faviconSourceUrl', () => {
  it('is keyed on the host and encodes it', () => {
    expect(faviconSourceUrl('example.com', 64))
      .toBe('https://www.google.com/s2/favicons?domain=example.com&sz=64')
  })

  it('encodes anything that would break the query', () => {
    expect(faviconSourceUrl('a b&c=d')).toContain('domain=a%20b%26c%3Dd')
  })
})
