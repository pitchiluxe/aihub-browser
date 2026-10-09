import { describe, it, expect } from 'vitest'
import {
  urlKey, isArchivable, snapshotFileName, snapshotsFor, latestFor,
  shouldSnapshot, selectForPruning, vaultBytes,
  MIN_RESNAPSHOT_MS, type Snapshot,
} from './vault'

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  id: over.id || 's1',
  url: over.url || 'https://example.com/a',
  key: over.key ?? urlKey(over.url || 'https://example.com/a'),
  title: 'A', favicon: '',
  path: `C:/vault/${over.id || 's1'}.mhtml`,
  bytes: 1000, createdAt: 0, origin: 'auto',
  ...over,
})

describe('urlKey', () => {
  it('folds case and a trailing slash so the same page matches itself', () => {
    expect(urlKey('https://Example.com/Page/')).toBe(urlKey('https://example.com/page'))
  })
  it('drops the fragment, which is a scroll position and not a document', () => {
    expect(urlKey('https://example.com/a#section-3')).toBe('https://example.com/a')
  })
  it('is empty for empty input', () => {
    expect(urlKey('')).toBe('')
    expect(urlKey('   ')).toBe('')
  })
  it('keeps the query, which does change the document', () => {
    expect(urlKey('https://example.com/s?q=1')).not.toBe(urlKey('https://example.com/s?q=2'))
  })
})

describe('isArchivable', () => {
  it('accepts real remote pages', () => {
    expect(isArchivable('https://example.com/a')).toBe(true)
    expect(isArchivable('http://example.com')).toBe(true)
  })
  it('refuses anything that is already local or has nothing to fetch', () => {
    for (const u of ['aihub://downloads', 'file:///C:/x.html', 'about:blank', 'data:text/html,hi', 'chrome://settings', '']) {
      expect(isArchivable(u)).toBe(false)
    }
  })
})

describe('snapshotFileName', () => {
  const ts = Date.parse('2026-03-14T10:00:00Z')
  it('is recognisable: host, last path segment, date', () => {
    expect(snapshotFileName('https://www.example.com/docs/getting-started', ts, 'abcde'))
      .toBe('example.com-getting-started-2026-03-14-abcde.mhtml')
  })
  it('survives a URL with no path', () => {
    expect(snapshotFileName('https://example.com', ts, 'xy')).toBe('example.com-2026-03-14-xy.mhtml')
  })
  it('strips characters a filesystem would refuse', () => {
    const name = snapshotFileName('https://example.com/a b?c*d', ts, 'z')
    expect(name).not.toMatch(/[\\/:*?"<>|]/)
    expect(name.endsWith('.mhtml')).toBe(true)
  })
  it('still produces a file for an unparseable URL', () => {
    expect(snapshotFileName('not a url', ts, 'q')).toBe('page-2026-03-14-q.mhtml')
  })
  it('is unique across calls for the same page', () => {
    const a = snapshotFileName('https://example.com/a', ts)
    const b = snapshotFileName('https://example.com/a', ts)
    expect(a).not.toBe(b)
  })
})

describe('snapshotsFor / latestFor', () => {
  const all = [
    snap({ id: 'old', createdAt: 100 }),
    snap({ id: 'new', createdAt: 300 }),
    snap({ id: 'other', url: 'https://other.com/z', createdAt: 500 }),
  ]
  it('returns only that page, newest first', () => {
    expect(snapshotsFor('https://example.com/a', all).map(s => s.id)).toEqual(['new', 'old'])
  })
  it('matches a URL written differently', () => {
    expect(latestFor('https://EXAMPLE.com/a/', all)?.id).toBe('new')
  })
  it('is null when the page was never archived', () => {
    expect(latestFor('https://nowhere.test/x', all)).toBeNull()
  })
})

describe('shouldSnapshot', () => {
  const now = 1_000_000_000
  it('archives a page it has never seen', () => {
    expect(shouldSnapshot('https://example.com/a', [], now)).toBe(true)
  })
  it('refuses a page that cannot be archived at all', () => {
    expect(shouldSnapshot('aihub://downloads', [], now, 'manual')).toBe(false)
  })
  it('throttles automatic re-archiving of the same page', () => {
    const recent = [snap({ createdAt: now - 60_000 })]
    expect(shouldSnapshot('https://example.com/a', recent, now)).toBe(false)
  })
  it('archives again once the throttle window has passed', () => {
    const old = [snap({ createdAt: now - MIN_RESNAPSHOT_MS - 1 })]
    expect(shouldSnapshot('https://example.com/a', old, now)).toBe(true)
  })
  it('lets an explicit request through regardless', () => {
    const recent = [snap({ createdAt: now - 1000 })]
    expect(shouldSnapshot('https://example.com/a', recent, now, 'manual')).toBe(true)
  })
})

describe('selectForPruning', () => {
  it('keeps nothing beyond the per-page limit, dropping the oldest copies', () => {
    const all = [
      snap({ id: 'a', createdAt: 400 }), snap({ id: 'b', createdAt: 300 }),
      snap({ id: 'c', createdAt: 200 }), snap({ id: 'd', createdAt: 100 }),
    ]
    expect(selectForPruning(all, 3, 1e12).map(s => s.id)).toEqual(['d'])
  })
  it('counts each page separately', () => {
    const all = [
      snap({ id: 'a1', createdAt: 3 }), snap({ id: 'a2', createdAt: 2 }),
      snap({ id: 'b1', url: 'https://b.com/', createdAt: 3 }),
      snap({ id: 'b2', url: 'https://b.com/', createdAt: 2 }),
    ]
    expect(selectForPruning(all, 2, 1e12)).toEqual([])
  })
  it('evicts the oldest across all pages once the vault is over its size cap', () => {
    const all = [
      snap({ id: 'oldest', url: 'https://a.com/', createdAt: 1, bytes: 500 }),
      snap({ id: 'middle', url: 'https://b.com/', createdAt: 2, bytes: 500 }),
      snap({ id: 'newest', url: 'https://c.com/', createdAt: 3, bytes: 500 }),
    ]
    expect(selectForPruning(all, 3, 1000).map(s => s.id)).toEqual(['oldest'])
  })
  it('applies both rules together without double-counting', () => {
    const all = [
      snap({ id: 'keep', createdAt: 9, bytes: 400 }),
      snap({ id: 'extra', createdAt: 1, bytes: 400 }),
      snap({ id: 'big', url: 'https://b.com/', createdAt: 2, bytes: 400 }),
    ]
    // 'extra' goes on the per-page rule; that alone brings the total to 800,
    // so the size rule has nothing further to do at a 1000-byte cap.
    expect(selectForPruning(all, 1, 1000).map(s => s.id)).toEqual(['extra'])
  })
  it('leaves a vault inside both limits completely alone', () => {
    expect(selectForPruning([snap({ bytes: 10 })], 3, 1000)).toEqual([])
  })
})

describe('vaultBytes', () => {
  it('totals the archive, tolerating rows written before sizes were recorded', () => {
    expect(vaultBytes([snap({ bytes: 100 }), snap({ id: 's2', bytes: undefined as any })])).toBe(100)
  })
})
