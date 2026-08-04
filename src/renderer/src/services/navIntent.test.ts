import { describe, it, expect } from 'vitest'
import { parseOpenIntent, pageTypeForUrl, resolveNavTarget } from './navIntent'
import type { Bookmark } from '../store/browserStore'

const bm = (title: string, url: string): Bookmark =>
  ({ id: url, url, title, favicon: '', category: '', addedAt: 0, color: '' })

// Mirrors the shape of a real profile: the built-in apps sit first (they are
// seeded/pinned), which is exactly what made "first match wins" pick the Bible.
const BOOKMARKS: Bookmark[] = [
  bm('Bible',   'aihub://bible'),
  bm('Mail',    'aihub://mail'),
  bm('x',       'https://www.x.com'),
  bm('Youtube', 'https://www.youtube.com'),
  bm('netflix', 'https://www.netflix.com'),
  bm('GitHub',  'https://github.com'),
  bm('BibleGateway.com: A…', 'https://www.biblegateway.com/'),
]

describe('parseOpenIntent', () => {
  it('extracts the target from common phrasings', () => {
    expect(parseOpenIntent('open youtube')).toBe('youtube')
    expect(parseOpenIntent('Open YouTube for me')).toBe('youtube')
    expect(parseOpenIntent('open youtube please')).toBe('youtube')
    expect(parseOpenIntent('please open youtube')).toBe('youtube')
    expect(parseOpenIntent('can you open youtube in a new tab?')).toBe('youtube')
    expect(parseOpenIntent('go to youtube')).toBe('youtube')
    expect(parseOpenIntent('take me to youtube')).toBe('youtube')
    expect(parseOpenIntent('open the bible')).toBe('bible')
    expect(parseOpenIntent('open my bible app')).toBe('bible')
    expect(parseOpenIntent('launch the bible reader')).toBe('bible reader')
  })

  it('ignores messages that are not navigation requests', () => {
    expect(parseOpenIntent('what is youtube')).toBeNull()
    expect(parseOpenIntent('summarize this page')).toBeNull()
    expect(parseOpenIntent('open')).toBeNull()
    // Asking *about* opening something is a question, not a command.
    expect(parseOpenIntent('how do I open youtube in incognito?')).toBeNull()
  })
})

describe('pageTypeForUrl', () => {
  it('routes aihub:// urls to their in-app page', () => {
    expect(pageTypeForUrl('aihub://bible')).toBe('bible')
    expect(pageTypeForUrl('aihub://mail')).toBe('mail')
  })
  it('treats everything else as a browser tab', () => {
    expect(pageTypeForUrl('https://www.youtube.com')).toBe('browser')
    expect(pageTypeForUrl('home')).toBe('browser')
    expect(pageTypeForUrl('aihub://nope')).toBe('browser')
  })
})

describe('resolveNavTarget', () => {
  it('opens YouTube for every natural phrasing', () => {
    for (const msg of [
      'open youtube', 'Open YouTube for me', 'open youtube please',
      'go to youtube', 'take me to YouTube', 'open youtube.com',
    ]) {
      const t = resolveNavTarget(msg, BOOKMARKS)
      expect(t, msg).not.toBeNull()
      expect(t!.url, msg).toBe('https://www.youtube.com')
      expect(t!.pageType, msg).toBe('browser')
    }
  })

  it('never diverts a web request into a built-in app', () => {
    for (const msg of ['open youtube', 'open netflix', 'open github']) {
      expect(resolveNavTarget(msg, BOOKMARKS)!.url.startsWith('aihub://'), msg).toBe(false)
    }
  })

  it('opens the in-app Bible reader for bible requests', () => {
    for (const msg of ['open bible', 'open the bible', 'open my bible', 'open the bible app']) {
      const t = resolveNavTarget(msg, BOOKMARKS)
      expect(t, msg).not.toBeNull()
      expect(t!.url, msg).toBe('aihub://bible')
      expect(t!.pageType, msg).toBe('bible')
    }
  })

  it('opens the in-app Bible even when the bookmark is missing', () => {
    const t = resolveNavTarget('open the bible', [])
    expect(t).toEqual({ url: 'aihub://bible', title: 'Bible', pageType: 'bible' })
  })

  it('opens the in-app Mail page for mail requests', () => {
    const t = resolveNavTarget('open my mail', BOOKMARKS)
    expect(t!.url).toBe('aihub://mail')
    expect(t!.pageType).toBe('mail')
  })

  it('does not let a one-letter bookmark swallow other queries', () => {
    // "netflix" contains "x" — the old two-way substring match opened x.com.
    expect(resolveNavTarget('open netflix', BOOKMARKS)!.url).toBe('https://www.netflix.com')
    expect(resolveNavTarget('open x', BOOKMARKS)!.url).toBe('https://www.x.com')
  })

  it('falls back to a well-known site when nothing is bookmarked', () => {
    expect(resolveNavTarget('open youtube', [])!.url).toBe('https://www.youtube.com')
  })

  it('opens a bare domain that is not bookmarked', () => {
    expect(resolveNavTarget('open example.com', [])!.url).toBe('https://example.com')
  })

  it('returns null when there is nothing sensible to open', () => {
    expect(resolveNavTarget('open the pod bay doors', BOOKMARKS)).toBeNull()
    expect(resolveNavTarget('what is youtube', BOOKMARKS)).toBeNull()
  })
})
