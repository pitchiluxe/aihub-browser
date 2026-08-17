import { describe, it, expect } from 'vitest'
import {
  collectVideoRenderers, extractInitialData, isVideoId, parseSearchResults,
  searchUrl, shuffleSeeded, thumbnailFor, GOSPEL_QUERIES,
} from './youtubeSearch'

// A miniature of the payload shape YouTube embeds in a search page: results
// nested several levels deep, mixed in with shelves and non-video renderers.
function page(renderers: any[]): string {
  const data = {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [
              { itemSectionRenderer: { contents: renderers } },
              { continuationItemRenderer: {} },
            ],
          },
        },
      },
    },
  }
  return `<!doctype html><script>var ytInitialData = ${JSON.stringify(data)};</script></body>`
}

const video = (id: string, title: string, duration = '4:21') => ({
  videoRenderer: {
    videoId: id,
    title: { runs: [{ text: title }] },
    ownerText: { runs: [{ text: 'A Choir' }] },
    lengthText: { simpleText: duration },
    shortViewCountText: { simpleText: '1.2M views' },
  },
})

describe('video ids', () => {
  it('accepts an eleven-character url-safe id', () => {
    expect(isVideoId('dQw4w9WgXcQ')).toBe(true)
    expect(isVideoId('_-aBcDeF123')).toBe(true)
  })

  it('rejects anything else, so a malformed entry never becomes a card', () => {
    expect(isVideoId('short')).toBe(false)
    expect(isVideoId('waytoolongforanid')).toBe(false)
    expect(isVideoId('has space!!')).toBe(false)
    expect(isVideoId(null)).toBe(false)
    expect(isVideoId(undefined)).toBe(false)
  })

  it('builds a thumbnail url from the id', () => {
    expect(thumbnailFor('dQw4w9WgXcQ')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
  })
})

describe('extracting the embedded payload', () => {
  it('reads ytInitialData out of a page', () => {
    const data = extractInitialData(page([video('aaaaaaaaaaa', 'Hymn')]))
    expect(data).toBeTruthy()
  })

  it('handles the window["ytInitialData"] variant', () => {
    const html = `<script>window["ytInitialData"] = {"ok":true};</script>`
    expect(extractInitialData(html)).toEqual({ ok: true })
  })

  it('is not fooled by braces inside string values', () => {
    // A greedy regex ending at the first `}` gets this wrong, and a title
    // containing a brace is not unusual.
    const html = `<script>var ytInitialData = {"title":"a } brace { inside","n":1};</script>`
    expect(extractInitialData(html)).toEqual({ title: 'a } brace { inside', n: 1 })
  })

  it('is not fooled by an escaped quote inside a string', () => {
    const html = `<script>var ytInitialData = {"t":"he said \\"amen\\"","n":2};</script>`
    expect(extractInitialData(html)).toEqual({ t: 'he said "amen"', n: 2 })
  })

  it('returns null rather than throwing on a page with no payload', () => {
    expect(extractInitialData('<html>nothing here</html>')).toBeNull()
  })

  it('returns null rather than throwing on truncated json', () => {
    expect(extractInitialData('var ytInitialData = {"a":1')).toBeNull()
  })
})

describe('collecting renderers', () => {
  it('finds videos however deeply they are nested', () => {
    const deep = { a: { b: [{ c: { d: [video('aaaaaaaaaaa', 'Deep')] } }] } }
    expect(collectVideoRenderers(deep)).toHaveLength(1)
  })

  it('ignores a renderer with a malformed id', () => {
    expect(collectVideoRenderers({ videoRenderer: { videoId: 'nope' } })).toHaveLength(0)
  })

  it('survives a cyclic-looking deep structure without hanging', () => {
    let nested: any = { videoRenderer: { videoId: 'aaaaaaaaaaa' } }
    for (let i = 0; i < 60; i++) nested = { wrap: nested }
    // Past the depth cap the search simply stops; it must not throw.
    expect(() => collectVideoRenderers(nested)).not.toThrow()
  })
})

describe('parsing a search page', () => {
  it('reads title, channel, duration, views and thumbnail', () => {
    const [v] = parseSearchResults(page([video('aaaaaaaaaaa', 'Great Is Thy Faithfulness')]))
    expect(v).toMatchObject({
      id: 'aaaaaaaaaaa',
      title: 'Great Is Thy Faithfulness',
      channel: 'A Choir',
      duration: '4:21',
      views: '1.2M views',
      thumbnail: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg',
      url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
    })
  })

  it('drops live streams and premieres, which have no length', () => {
    // A "gospel music" search returns a lot of 24/7 radio streams, and a
    // theatre listing of things with no runtime is not what was asked for.
    const results = parseSearchResults(page([
      { videoRenderer: { videoId: 'bbbbbbbbbbb', title: { simpleText: '24/7 Gospel Radio' } } },
      video('aaaaaaaaaaa', 'A Hymn'),
    ]))
    expect(results.map(r => r.id)).toEqual(['aaaaaaaaaaa'])
  })

  it('drops an entry with no title rather than rendering a blank card', () => {
    const results = parseSearchResults(page([
      { videoRenderer: { videoId: 'bbbbbbbbbbb', lengthText: { simpleText: '3:00' } } },
    ]))
    expect(results).toEqual([])
  })

  it('de-duplicates a video that appears in more than one shelf', () => {
    const results = parseSearchResults(page([
      video('aaaaaaaaaaa', 'Once'),
      video('aaaaaaaaaaa', 'Again'),
    ]))
    expect(results).toHaveLength(1)
  })

  it('honours the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      video(`aaaaaaaaaa${String.fromCharCode(97 + (i % 26))}`, `Song ${i}`))
    expect(parseSearchResults(page(many), 5)).toHaveLength(5)
  })

  it('returns an empty list, not an error, when the page shape is unknown', () => {
    // Scraping breaks. It must degrade to "nothing to show" rather than
    // taking the room down with it.
    expect(parseSearchResults('<html>redesigned</html>')).toEqual([])
    expect(parseSearchResults('')).toEqual([])
  })
})

describe('search url', () => {
  it('encodes the query and restricts to videos', () => {
    const url = searchUrl('gospel choir & organ')
    expect(url).toContain('search_query=gospel%20choir%20%26%20organ')
    expect(url).toContain('sp=EgIQAQ')
  })
})

describe('shuffling', () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8]

  it('is stable for a given seed, so a re-render does not reshuffle', () => {
    expect(shuffleSeeded(items, 42)).toEqual(shuffleSeeded(items, 42))
  })

  it('differs between seeds', () => {
    expect(shuffleSeeded(items, 1)).not.toEqual(shuffleSeeded(items, 2))
  })

  it('keeps every item exactly once', () => {
    expect(shuffleSeeded(items, 7).sort((a, b) => a - b)).toEqual(items)
  })

  it('does not mutate the input', () => {
    const original = [...items]
    shuffleSeeded(items, 3)
    expect(items).toEqual(original)
  })
})

describe('the gospel queries', () => {
  it('spread across traditions rather than one playlist', () => {
    expect(GOSPEL_QUERIES.length).toBeGreaterThanOrEqual(8)
    expect(new Set(GOSPEL_QUERIES).size).toBe(GOSPEL_QUERIES.length)
  })
})
