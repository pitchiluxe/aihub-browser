import { describe, it, expect } from 'vitest'
import {
  encryptJson, decryptJson, bookmarkKey, mergeBookmarks, syncableSettings, mergePayloads,
  type SyncBookmark,
} from './syncCrypto'

const bm = (url: string, addedAt: number, extra: Partial<SyncBookmark> = {}): SyncBookmark =>
  ({ id: url, url, title: url, addedAt, ...extra })

describe('encryptJson / decryptJson', () => {
  const secret = { bookmarks: [{ url: 'https://example.com' }], note: 'private' }

  it('round-trips a value', () => {
    expect(decryptJson(encryptJson(secret, 'correct horse'), 'correct horse')).toEqual(secret)
  })

  it('produces no readable plaintext', () => {
    const blob = encryptJson(secret, 'pw')
    expect(JSON.stringify(blob)).not.toContain('example.com')
    expect(JSON.stringify(blob)).not.toContain('private')
  })

  it('is different every time, even for identical input', () => {
    const a = encryptJson(secret, 'pw')
    const b = encryptJson(secret, 'pw')
    expect(a.data).not.toBe(b.data)
    expect(a.iv).not.toBe(b.iv)
    expect(a.salt).not.toBe(b.salt)
  })

  it('refuses the wrong passphrase instead of returning garbage', () => {
    const blob = encryptJson(secret, 'right')
    expect(() => decryptJson(blob, 'wrong')).toThrow()
  })

  it('detects tampering with the ciphertext', () => {
    const blob = encryptJson(secret, 'pw')
    const flipped = Buffer.from(blob.data, 'base64')
    flipped[0] ^= 0xff
    expect(() => decryptJson({ ...blob, data: flipped.toString('base64') }, 'pw')).toThrow()
  })

  it('rejects an unknown file version', () => {
    expect(() => decryptJson({ ...encryptJson(secret, 'pw'), v: 2 as 1 }, 'pw')).toThrow('Unrecognised sync file')
  })

  it('will not encrypt without a passphrase', () => {
    expect(() => encryptJson(secret, '')).toThrow(/passphrase/i)
  })
})

describe('bookmarkKey', () => {
  it('treats the same page as one entry regardless of www or trailing slash', () => {
    expect(bookmarkKey({ url: 'https://www.example.com/page/' })).toBe(bookmarkKey({ url: 'https://example.com/page' }))
  })
  it('keeps genuinely different pages apart', () => {
    expect(bookmarkKey({ url: 'https://example.com/a' })).not.toBe(bookmarkKey({ url: 'https://example.com/b' }))
    expect(bookmarkKey({ url: 'https://example.com/?q=1' })).not.toBe(bookmarkKey({ url: 'https://example.com/' }))
  })
  it('falls back to the raw string for non-urls', () => {
    expect(bookmarkKey({ url: 'not a url' })).toBe('not a url')
  })
})

describe('mergeBookmarks', () => {
  it('unions both devices', () => {
    const merged = mergeBookmarks([bm('https://a.com', 1)], [bm('https://b.com', 2)])
    expect(merged.map(b => b.url).sort()).toEqual(['https://a.com', 'https://b.com'])
  })

  it('keeps the newer copy of the same bookmark', () => {
    const merged = mergeBookmarks(
      [bm('https://a.com', 100, { title: 'old' })],
      [bm('https://a.com', 200, { title: 'new' })],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].title).toBe('new')
  })

  it('honours a deletion made on the other device', () => {
    const merged = mergeBookmarks(
      [bm('https://a.com', 100)],
      [bm('https://a.com', 100, { deletedAt: 200 })],
    )
    expect(merged).toEqual([])
  })

  it('lets a re-add after a deletion win', () => {
    const merged = mergeBookmarks(
      [bm('https://a.com', 300)],
      [bm('https://a.com', 100, { deletedAt: 200 })],
    )
    expect(merged).toHaveLength(1)
  })

  it('returns newest first and ignores entries with no url', () => {
    const merged = mergeBookmarks([bm('https://a.com', 1), { id: 'x', url: '', title: '', addedAt: 9 }], [bm('https://b.com', 5)])
    expect(merged.map(b => b.url)).toEqual(['https://b.com', 'https://a.com'])
  })

  it('handles empty and missing lists', () => {
    expect(mergeBookmarks([], [])).toEqual([])
    expect(mergeBookmarks(undefined as any, undefined as any)).toEqual([])
  })
})

describe('syncableSettings', () => {
  it('never uploads API keys or machine-local paths', () => {
    const out = syncableSettings({
      theme: 'dark', openrouterKey: 'sk-secret', ollamaUrl: 'http://127.0.0.1:11434',
      obsidianVault: 'C:/Users/erick/Vault', containers: [{ id: 'work' }], restoreSession: true,
    })
    expect(out).toEqual({ theme: 'dark', restoreSession: true })
  })
  it('tolerates an empty settings object', () => {
    expect(syncableSettings({})).toEqual({})
    expect(syncableSettings(undefined as any)).toEqual({})
  })
})

describe('mergePayloads', () => {
  const local = { bookmarks: [bm('https://a.com', 10)], settings: { theme: 'dark' }, updatedAt: 100 }

  it('returns local unchanged when there is nothing in the cloud yet', () => {
    expect(mergePayloads(local, null)).toBe(local)
  })

  it('takes the newer side settings and merges bookmarks from both', () => {
    const remote = { bookmarks: [bm('https://b.com', 20)], settings: { theme: 'light' }, updatedAt: 200 }
    const merged = mergePayloads(local, remote)
    expect(merged.settings.theme).toBe('light')
    expect(merged.bookmarks).toHaveLength(2)
    expect(merged.updatedAt).toBe(200)
  })

  it('keeps local settings when the cloud copy is older', () => {
    const remote = { bookmarks: [], settings: { theme: 'light' }, updatedAt: 50 }
    expect(mergePayloads(local, remote).settings.theme).toBe('dark')
  })
})
