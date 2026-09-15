import { describe, it, expect } from 'vitest'
import { isBookmarkProtected, shortenBookmarkName } from './bookmarkService'
import { getInternalBookmarkIcon } from '../components/homepage/InternalBookmarkIcons'

// The permanent tiles. This list is mirrored from the main process — which is
// the authority and refuses the delete regardless — so what's being pinned here
// is that the UI agrees with it and hides the remove badge, rather than
// offering a button that silently does nothing.
describe('protected bookmarks', () => {
  it('protects the Community lounge and the Bible reader', () => {
    expect(isBookmarkProtected('aihub://community')).toBe(true)
    expect(isBookmarkProtected('aihub://bible')).toBe(true)
  })

  it('leaves every other bookmark deletable', () => {
    expect(isBookmarkProtected('aihub://mail')).toBe(false)
    expect(isBookmarkProtected('https://www.google.com')).toBe(false)
    expect(isBookmarkProtected(undefined)).toBe(false)
    // Not a prefix match: a different page whose url merely starts the same way
    // must not inherit the protection.
    expect(isBookmarkProtected('aihub://community-notes')).toBe(false)
  })
})

// aihub:// bookmarks have no favicon to fetch, so a missing entry here is a
// blank tile on the home grid — the failure the artwork exists to prevent.
describe('internal bookmark icons', () => {
  it('gives the pinned internal pages artwork and a tile accent', () => {
    for (const url of ['aihub://community', 'aihub://bible', 'aihub://mail']) {
      const icon = getInternalBookmarkIcon(url)
      expect(icon, url).toBeDefined()
      expect(icon!.accent, url).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('matches the Community tile to the sidebar entry', () => {
    expect(getInternalBookmarkIcon('aihub://community')!.accent).toBe('#34d399')
  })

  it('claims nothing for real websites', () => {
    expect(getInternalBookmarkIcon('https://www.google.com')).toBeUndefined()
    expect(getInternalBookmarkIcon(undefined)).toBeUndefined()
  })
})

describe('shortenBookmarkName', () => {
  it('falls back to the domain when there is no title', () => {
    expect(shortenBookmarkName('', 'https://www.github.com/x')).toBe('Github')
  })

  it('keeps the leading segment of a "Title — Brand" heading', () => {
    expect(shortenBookmarkName('Release notes — Acme', 'https://acme.dev')).toBe('Release notes')
  })

  it('caps long titles on a word boundary', () => {
    const out = shortenBookmarkName('An extremely long page heading that will not fit', 'https://x.dev')
    expect(out.length).toBeLessThanOrEqual(25)
    expect(out.endsWith('…')).toBe(true)
    expect(out).not.toMatch(/ …$/)
  })
})
