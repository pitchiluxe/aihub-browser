import { describe, it, expect } from 'vitest'
import { parseFeed, mergeStories, toPlainText, youtubeIdOf, normalizeMeal, decodeEntities, DESK_FEEDS, COUNTRIES } from './news'

const RSS = `<?xml version="1.0"?><rss xmlns:media="http://search.yahoo.com/mrss/"><channel>
<item><title><![CDATA[Polls open across the country]]></title><link>https://example.com/a</link>
<description><![CDATA[<p>Voters &amp; officials <b>gather</b> early.</p>]]></description>
<pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate>
<media:thumbnail width="240" url="https://img.example.com/small.jpg"/>
<media:content url="https://img.example.com/big.jpg" medium="image" width="1200"/></item>
<item><title>No link here</title></item>
<item><title>Bad &amp;amp; link</title><link>javascript:alert(1)</link></item>
</channel></rss>`

const GNEWS = `<rss><channel><item><title>Ceasefire talks resume in Goma - Reuters</title>
<link>https://news.google.com/rss/articles/abc</link><source url="https://reuters.com">Reuters</source>
<description>&lt;a href="x"&gt;Ceasefire talks resume in Goma&lt;/a&gt;</description>
<pubDate>Tue, 03 Nov 2026 09:00:00 GMT</pubDate></item></channel></rss>`

const ATOM = `<feed><entry><title>Atom story</title><link rel="alternate" href="https://example.org/atom"/>
<updated>2026-11-03T08:00:00Z</updated><summary>Short &lt;i&gt;summary&lt;/i&gt;</summary></entry></feed>`

describe('parseFeed', () => {
  it('reads RSS items, prefers the largest image, cleans HTML and skips bad links', () => {
    const items = parseFeed(RSS, 'Example')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      title: 'Polls open across the country', url: 'https://example.com/a', source: 'Example',
      summary: 'Voters & officials gather early.', image: 'https://img.example.com/big.jpg',
    })
    expect(items[0].publishedAt).toBe(Date.parse('2026-11-03T10:00:00Z'))
  })
  it('uses the Google News <source> and strips it from the title', () => {
    const [s] = parseFeed(GNEWS, 'Google News')
    expect(s.source).toBe('Reuters')
    expect(s.title).toBe('Ceasefire talks resume in Goma')
    expect(s.summary).toBe('')
  })
  it('reads Atom entries', () => {
    const [s] = parseFeed(ATOM, 'Org')
    expect(s).toMatchObject({ title: 'Atom story', url: 'https://example.org/atom', summary: 'Short summary' })
  })
  it('never throws on garbage', () => {
    expect(parseFeed('<<<not xml', 'x')).toEqual([])
    expect(parseFeed(undefined as any, 'x')).toEqual([])
  })
})

describe('mergeStories', () => {
  const now = Date.parse('2026-11-03T12:00:00Z')
  const base = { summary: '', image: '', publishedAt: now - 3_600_000 }
  it('folds the same story from several outlets and counts them', () => {
    const merged = mergeStories([
      { ...base, title: 'Congo rebels agree ceasefire in Goma talks', url: 'https://a/1', source: 'BBC' },
      { ...base, title: 'Rebels in Congo agree to Goma ceasefire', url: 'https://b/1', source: 'Guardian', image: 'https://i/x.jpg' },
      { ...base, title: 'Stock markets rally on rate cut hopes', url: 'https://c/1', source: 'NPR' },
    ], now)
    expect(merged).toHaveLength(2)
    expect(merged[0].coverage).toBe(2)
    expect(merged[0].image).toBe('https://i/x.jpg')
    expect(merged[0].alsoBy).toHaveLength(1)
  })
  it('drops stories older than five days', () => {
    expect(mergeStories([{ ...base, publishedAt: now - 6 * 86_400_000, title: 'Old news story here', url: 'https://o', source: 'X' }], now)).toEqual([])
  })
})

describe('helpers', () => {
  it('decodes numeric and named entities', () => {
    expect(decodeEntities('A &#8217; B &#x2014; C &hellip;')).toBe('A ’ B — C …')
    expect(toPlainText('<![CDATA[<script>x()</script>Hi <b>there</b>]]>')).toBe('Hi there')
  })
  it('finds YouTube ids', () => {
    expect(youtubeIdOf('https://www.youtube.com/watch?v=4aZr5hZXP_s')).toBe('4aZr5hZXP_s')
    expect(youtubeIdOf('https://youtu.be/4aZr5hZXP_s')).toBe('4aZr5hZXP_s')
    expect(youtubeIdOf('')).toBe('')
  })
  it('normalizes a TheMealDB meal', () => {
    const r = normalizeMeal({ idMeal: '1', strMeal: 'Jollof Rice', strArea: 'Nigerian', strIngredient1: 'Rice', strMeasure1: '2 cups', strIngredient2: ' ', strYoutube: 'https://www.youtube.com/watch?v=abcdefghijk', strMealThumb: 'https://x/y.jpg' })
    expect(r).toMatchObject({ name: 'Jollof Rice', youtubeId: 'abcdefghijk', ingredients: [{ name: 'Rice', measure: '2 cups' }] })
    expect(normalizeMeal(null)).toBeNull()
  })
  it('every desk and country has https feeds', () => {
    for (const feeds of Object.values(DESK_FEEDS)) for (const f of feeds) expect(f.url).toMatch(/^https:\/\//)
    expect(COUNTRIES.some(c => c.code === 'cd')).toBe(true)
  })
})
