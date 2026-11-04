import { describe, it, expect } from 'vitest'
import { parseFeed, mergeStories, toPlainText, youtubeIdOf, normalizeMeal, decodeEntities, DESK_FEEDS, COUNTRIES, hdImage, extractShareImage, canResolveImage, countryTerms, mentionsAny, countryNewsroomFeeds, chooseDeskResult } from './news'

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
  it('drops image URLs that are not https', () => {
    const feed = (src: string) => `<rss><item><title>T</title><link>https://e.com/x</link><description><![CDATA[<img src="${src}">]]></description></item></rss>`
    expect(parseFeed(feed('file://evil/share/a.png'), 'X')[0].image).toBe('')
    expect(parseFeed(feed('//evil/share/a.png'), 'X')[0].image).toBe('')
    expect(parseFeed(feed('http://e.com/a.png'), 'X')[0].image).toBe('')
    expect(parseFeed(feed('https://e.com/a.png'), 'X')[0].image).toBe('https://e.com/a.png')
  })
  it('never throws on garbage', () => {
    expect(parseFeed('<<<not xml', 'x')).toEqual([])
    expect(parseFeed(undefined as any, 'x')).toEqual([])
  })
})

describe('mergeStories', () => {
  const now = Date.parse('2026-11-03T12:00:00Z')
  const base = { summary: '', image: '', site: '', publishedAt: now - 3_600_000 }
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

describe('pictures', () => {
  it('reads Bing News items: real link, outlet, HD thumbnail', () => {
    const xml = `<rss><channel><item><title>Kinshasa talks resume</title>
<link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3a%2f%2fwww.aol.com%2farticles%2fx.html&amp;c=1</link>
<description>Desc</description><pubDate>Tue, 03 Nov 2026 15:27:00 GMT</pubDate>
<News:Source>BBC on MSN</News:Source><News:Image>/th?id=ONUT.abc&amp;pid=News</News:Image></item></channel></rss>`
    const [s] = parseFeed(xml, 'Bing News')
    expect(s.url).toBe('https://www.aol.com/articles/x.html')
    expect(s.source).toBe('BBC')
    expect(s.site).toBe('aol.com')
    expect(s.image).toBe('https://www.bing.com/th?id=ONUT.abc&pid=News&w=1280&h=720&c=14')
  })
  it('upgrades BBC thumbnails to 976px', () => {
    expect(hdImage('https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/abc.jpg')).toBe('https://ichef.bbci.co.uk/ace/standard/976/cpsprodpb/abc.jpg')
    expect(hdImage('https://i.guim.co.uk/img/x.jpg?width=460&s=sig')).toBe('https://i.guim.co.uk/img/x.jpg?width=460&s=sig')
  })
  it('takes the publisher host from a Google News <source url>', () => {
    const [s] = parseFeed(GNEWS.replace('url="https://reuters.com"', 'url="https://www.reuters.com"'), 'Google News')
    expect(s.site).toBe('reuters.com')
  })
  it('extracts og:image in either attribute order, https only', () => {
    expect(extractShareImage('<head><meta property="og:image" content="https://a.com/p.jpg"></head>', 'https://a.com/x')).toBe('https://a.com/p.jpg')
    expect(extractShareImage('<meta content="/img/p.jpg?a=1&amp;b=2" name="twitter:image">', 'https://a.com/x')).toBe('https://a.com/img/p.jpg?a=1&b=2')
    expect(extractShareImage('<meta property="og:image" content="http://a.com/p.jpg">', 'http://a.com/x')).toBe('')
    expect(extractShareImage('<meta property="og:image" content="file:///c/p.jpg">', 'https://a.com/x')).toBe('')
    expect(extractShareImage('<p>none</p>', 'https://a.com/x')).toBe('')
  })
  it('only resolves public article links', () => {
    expect(canResolveImage('https://www.npr.org/2026/11/04/story')).toBe(true)
    expect(canResolveImage('https://news.google.com/rss/articles/abc')).toBe(false)
    for (const bad of ['http://localhost/x', 'http://127.0.0.1/x', 'http://10.0.0.5/x', 'http://[::1]/x', 'https://a.com:8443/x', 'file:///c/x', 'http://router.local/x', 'http://intranet/x']) {
      expect(canResolveImage(bad)).toBe(false)
    }
  })
})

describe('country desk and outages', () => {
  it('splits a country query into the names it listens for', () => {
    expect(countryTerms('"DR Congo" OR "Democratic Republic of Congo" OR Kinshasa OR Goma'))
      .toEqual(['DR Congo', 'Democratic Republic of Congo', 'Kinshasa', 'Goma'])
  })
  it('matches whole words only, any case', () => {
    const terms = ['UK', 'Goma', 'DR Congo']
    expect(mentionsAny({ title: 'Fighting near Goma intensifies', summary: '' }, terms)).toBe(true)
    expect(mentionsAny({ title: 'dr congo talks', summary: '' }, terms)).toBe(true)
    expect(mentionsAny({ title: 'Ukraine latest', summary: 'Bukavu' }, terms)).toBe(false)
    expect(mentionsAny({ title: 'Gomateam wins', summary: '' }, terms)).toBe(false)
  })
  it('the country newsrooms carry pictures (no Google News) and no duplicates', () => {
    const feeds = countryNewsroomFeeds()
    expect(feeds.some(f => f.name === 'Google News')).toBe(false)
    expect(new Set(feeds.map(f => f.url)).size).toBe(feeds.length)
  })
  it('serves the saved page, marked stale, when nobody answers', () => {
    const story = { id: '1', title: 'T', url: 'https://a', source: 'BBC', summary: '', image: '', site: '', publishedAt: 0, coverage: 1, alsoBy: [] }
    const failed = { ok: false, stories: [], fetchedAt: 9, sources: [{ name: 'BBC', ok: false }], error: 'x' }
    const saved = { ok: true, stories: [story], fetchedAt: 5, sources: [{ name: 'BBC', ok: true }] }
    expect(chooseDeskResult(failed, saved)).toMatchObject({ ok: true, stale: true, fetchedAt: 5, stories: [story] })
    expect(chooseDeskResult(failed, undefined)).toBe(failed)
    const fresh = { ...saved, fetchedAt: 10 }
    expect(chooseDeskResult(fresh, saved)).toBe(fresh)
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
