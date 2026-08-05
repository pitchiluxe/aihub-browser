import { describe, it, expect } from 'vitest'
import { rankBookmarks, groupByCategory, flattenGroups, sortAlphabetically } from './bookmarkSearch'
import type { Bookmark } from '../store/browserStore'

const bm = (id: string, title: string, url: string, category = 'Development'): Bookmark =>
  ({ id, title, url, category, favicon: '', addedAt: 0, color: '' })

const library: Bookmark[] = [
  bm('1', 'GitHub', 'https://github.com'),
  bm('2', 'My gist collection', 'https://gist.github.com/mine'),
  bm('3', 'Awesome Lists', 'https://github.com/sindresorhus/awesome'),
  bm('4', 'TradingView', 'https://tradingview.com', 'Finance'),
  bm('5', 'Git tutorial', 'https://git-scm.com/docs', 'Education'),
]

describe('rankBookmarks', () => {
  it('lists everything alphabetically when there is no query', () => {
    expect(rankBookmarks(library, '').map(b => b.title))
      .toEqual(['Awesome Lists', 'Git tutorial', 'GitHub', 'My gist collection', 'TradingView'])
    expect(rankBookmarks(library, '   ').map(b => b.title)).toEqual(rankBookmarks(library, '').map(b => b.title))
  })

  it('puts titles that START with the query first, alphabetically among themselves', () => {
    const ranked = rankBookmarks(library, 'git')
    // Both begin with "Git", so relevance ties and the alphabet decides.
    expect(ranked.slice(0, 2).map(b => b.title)).toEqual(['Git tutorial', 'GitHub'])
    // Pages that merely mention git in their url come after.
    expect(ranked.slice(2).map(b => b.title)).toEqual(['Awesome Lists', 'My gist collection'])
  })

  it('ranks a title match above a url-only match', () => {
    const ranked = rankBookmarks(library, 'github')
    // GitHub (title prefix) → My gist collection (title? no: url) — the two
    // url matches then follow alphabetically.
    expect(ranked[0].title).toBe('GitHub')
    expect(ranked.slice(1).map(b => b.title)).toEqual(['Awesome Lists', 'My gist collection'])
  })

  it('finds bookmarks by category when nothing else matches', () => {
    expect(rankBookmarks(library, 'finance').map(b => b.id)).toEqual(['4'])
  })

  it('is case-insensitive', () => {
    expect(rankBookmarks(library, 'TRADINGVIEW')[0].id).toBe('4')
  })

  it('returns nothing when nothing matches', () => {
    expect(rankBookmarks(library, 'zzzzz')).toEqual([])
  })

  it('never lists the same bookmark twice, however many fields match', () => {
    const ranked = rankBookmarks([bm('1', 'GitHub', 'https://github.com', 'github')], 'github')
    expect(ranked).toHaveLength(1)
  })

  it('orders equally good matches alphabetically, not by when they were saved', () => {
    const ties = [bm('a', 'Zebra docs', 'https://z.com'), bm('b', 'Alpha docs', 'https://a.com')]
    expect(rankBookmarks(ties, 'docs').map(b => b.title)).toEqual(['Alpha docs', 'Zebra docs'])
  })

  it('survives empty and malformed entries', () => {
    expect(rankBookmarks([], 'git')).toEqual([])
    expect(rankBookmarks(undefined as any, 'git')).toEqual([])
    expect(() => rankBookmarks([null as any, bm('1', '', '')], 'git')).not.toThrow()
  })
})

describe('groupByCategory', () => {
  it('groups alphabetically by category', () => {
    expect(groupByCategory(library).map(([c]) => c)).toEqual(['Development', 'Education', 'Finance'])
  })

  it('sorts bookmarks alphabetically inside each group', () => {
    const [, dev] = groupByCategory(library)[0]
    expect(dev.map(b => b.title)).toEqual(['Awesome Lists', 'GitHub', 'My gist collection'])
  })

  it('files uncategorised bookmarks under Other', () => {
    const groups = groupByCategory([{ ...bm('9', 'Loose', 'https://x.com'), category: '' }])
    expect(groups[0][0]).toBe('Other')
  })

  it('handles an empty list', () => {
    expect(groupByCategory([])).toEqual([])
  })
})

describe('sortAlphabetically', () => {
  it('is case-insensitive, so "apple" and "Apple" sort together', () => {
    const mixed = [bm('1', 'banana', 'https://b.com'), bm('2', 'Apple', 'https://a.com'), bm('3', 'apricot', 'https://ap.com')]
    expect(sortAlphabetically(mixed).map(b => b.title)).toEqual(['Apple', 'apricot', 'banana'])
  })
  it('falls back to the url when a bookmark has no title', () => {
    const list = [bm('1', '', 'https://zzz.com'), bm('2', 'Aardvark', 'https://a.com')]
    expect(sortAlphabetically(list).map(b => b.id)).toEqual(['2', '1'])
  })
  it('does not mutate the array it was given', () => {
    const original = [bm('1', 'Zed', 'https://z.com'), bm('2', 'Alpha', 'https://a.com')]
    sortAlphabetically(original)
    expect(original.map(b => b.title)).toEqual(['Zed', 'Alpha'])
  })
})

describe('flattenGroups', () => {
  it('matches exactly what the grouped view draws, so arrow keys and Enter agree', () => {
    const groups = groupByCategory(rankBookmarks(library, 'git'))
    const flat = flattenGroups(groups)
    expect(flat).toHaveLength(rankBookmarks(library, 'git').length)
    // The order is the drawn order: group by group, top to bottom.
    expect(flat.map(b => b.id)).toEqual(groups.flatMap(([, items]) => items.map(b => b.id)))
  })
})
