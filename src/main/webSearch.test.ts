import { describe, it, expect, beforeEach } from 'vitest'
import { bingTarget, parseBing, parseBrave, parseDuckDuckGo, resetSearchEngines, searchWeb, type SearchEngine } from './webSearch'

const b64url = (s: string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

describe('parsers (markup as served on 2026-10-13)', () => {
  it('reads DuckDuckGo results, unwraps uddg links and skips ads', () => {
    const html = `
      <div class="result results_links"><h2><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.kayak.com%2Fflights&amp;rut=x">Cheap <b>flights</b> &amp; deals</a></h2>
      <a class="result__snippet" href="#">Compare <b>fares</b> from hundreds of sites.</a></div>
      <div class="result results_links"><a class="result__a" href="https://duckduckgo.com/y.js?ad_domain=x.com&amp;ad_provider=bing">Ad</a></div>
      <div class="result results_links"><a class="result__a" href="https://www.momondo.com/">Momondo</a></div>`
    expect(parseDuckDuckGo(html)).toEqual([
      { title: 'Cheap flights & deals', url: 'https://www.kayak.com/flights', snippet: 'Compare fares from hundreds of sites.' },
      { title: 'Momondo', url: 'https://www.momondo.com/', snippet: '' },
    ])
  })

  it('decodes Bing click-tracking links', () => {
    expect(bingTarget(`https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;u=a1${b64url('https://www.cheapflights.com/')}&amp;ntb=1`)).toBe('https://www.cheapflights.com/')
    expect(bingTarget('https://example.org/page')).toBe('https://example.org/page')
  })

  it('reads Bing organic results', () => {
    const html = `<ol><li class="b_algo" data-id><div class="b_tpcn"><a class="tilk" href="https://www.bing.com/ck/a?u=a1${b64url('https://www.orbitz.com/')}">orbitz</a></div>
      <h2><a target="_blank" href="https://www.bing.com/ck/a?!&amp;u=a1${b64url('https://www.orbitz.com/lp/flights')}&amp;ntb=1"><strong>Cheap</strong> Newark to Kinshasa flights</a></h2>
      <div class="b_caption"><p class="b_lineclamp2">The fastest flight takes 13 hours.</p></div></li>
      <li class="b_algo"><h2><a href="https://www.bing.com/search?q=more">Related</a></h2></li></ol>`
    expect(parseBing(html)).toEqual([{ title: 'Cheap Newark to Kinshasa flights', url: 'https://www.orbitz.com/lp/flights', snippet: 'The fastest flight takes 13 hours.' }])
  })

  it('reads Brave web results', () => {
    const html = `<div class="snippet svelte-x" data-pos="1" data-type="web"><a href="https://www.ethiopianairlines.com/en-us/flights" class="l1"><div class="title search-snippet-title line-clamp-1" title="t">Cheap Flights from Newark | Ethiopian Airlines™</div></a>
      <div class="generic-snippet"><div class="content desktop-default-regular t-primary">Free baggage allowance &amp; more.</div></div></div>`
    expect(parseBrave(html)).toEqual([{ title: 'Cheap Flights from Newark | Ethiopian Airlines™', url: 'https://www.ethiopianairlines.com/en-us/flights', snippet: 'Free baggage allowance & more.' }])
  })
})

describe('searchWeb fallback', () => {
  beforeEach(() => resetSearchEngines())
  const hit = { title: 'T', url: 'https://example.com/', snippet: '' }
  const engine = (name: string, behave: 'ok' | 'empty' | 'blocked' | 'error' | 'slow'): SearchEngine => ({
    name, url: q => `https://${name}/?q=${q}`, blocked: s => s === 202,
    parse: () => behave === 'ok' || behave === 'slow' ? [{ ...hit, title: name }] : [],
  })
  const getFor = (plan: Record<string, 'ok' | 'empty' | 'blocked' | 'error' | 'slow'>, calls: string[] = []) => async (url: string) => {
    const name = new URL(url).hostname
    calls.push(name)
    const b = plan[name]
    if (b === 'error') throw new Error('ERR_CONNECTION_RESET')
    if (b === 'slow') await new Promise(r => setTimeout(r, 60))
    return { status: b === 'blocked' ? 202 : 200, body: '' }
  }

  it('falls through a challenged and an empty engine to one that answers', async () => {
    const plan = { a: 'blocked', b: 'empty', c: 'ok' } as const
    const engines = Object.entries(plan).map(([n, b]) => engine(n, b))
    const r = await searchWeb('flights', getFor(plan), { engines, hedgeMs: 1000 })
    expect(r).toMatchObject({ success: true, engine: 'c', results: [{ title: 'c' }] })
  })

  it('starts the next engine when the first is slow, and the first answer wins', async () => {
    const plan = { a: 'slow', b: 'ok' } as const
    const calls: string[] = []
    const r = await searchWeb('flights', getFor(plan, calls), { engines: [engine('a', 'slow'), engine('b', 'ok')], hedgeMs: 10 })
    expect(r).toMatchObject({ success: true, engine: 'b' })
    expect(calls).toEqual(['a', 'b'])
  })

  it('rests a challenged engine for later searches', async () => {
    const plan = { a: 'blocked', b: 'ok' } as const
    const engines = [engine('a', 'blocked'), engine('b', 'ok')]
    await searchWeb('one', getFor(plan), { engines })
    const calls: string[] = []
    await searchWeb('two', getFor(plan, calls), { engines })
    expect(calls).toEqual(['b'])
  })

  it('rests an unreachable engine but keeps asking one that merely found nothing', async () => {
    const plan = { a: 'error', b: 'empty', c: 'ok' } as const
    const engines = [engine('a', 'error'), engine('b', 'empty'), engine('c', 'ok')]
    await searchWeb('one', getFor(plan), { engines })
    const calls: string[] = []
    await searchWeb('two', getFor(plan, calls), { engines })
    expect(calls).toEqual(['b', 'c'])
    // Ten minutes later it is tried again.
    const later = () => Date.now() + 11 * 60_000
    const again: string[] = []
    await searchWeb('three', getFor(plan, again), { engines, now: later })
    expect(again[0]).toBe('a')
  })

  it('reports every engine failure when nothing answers', async () => {
    const plan = { a: 'error', b: 'empty' } as const
    const r = await searchWeb('flights', getFor(plan), { engines: [engine('a', 'error'), engine('b', 'empty')] })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('a: ERR_CONNECTION_RESET; b: no results')
  })

  it('rejects an empty query without searching', async () => {
    const calls: string[] = []
    expect(await searchWeb('  ', getFor({}, calls))).toMatchObject({ success: false, error: 'query is required' })
    expect(calls).toEqual([])
  })
})
