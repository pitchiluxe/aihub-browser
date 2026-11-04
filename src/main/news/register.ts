import { ipcMain, net } from 'electron'
import { join } from 'path'
import { createManagedJsonStore } from '../jsonStore'
import {
  COUNTRIES, deskFeeds, countryFeeds, parseFeed, mergeStories, normalizeMeal,
  extractShareImage, canResolveImage, DESK_FEEDS,
  countryTerms, mentionsAny, countryNewsroomFeeds, chooseDeskResult,
  type DeskId, type DeskResult, type FeedSource, type RawStory, type Recipe,
} from '../../shared/news'

/**
 * AIHub News — the main-process half of aihub://news.
 *
 * Feeds are fetched here, not in the page: news sites do not send CORS
 * headers, and Chromium's network stack (through `get`) keeps a slow outlet
 * from freezing the main thread. Every outlet is asked independently, gets
 * one retry, and a failure costs only that outlet. The last good copy of
 * every desk is kept on disk, so a dropped connection shows yesterday's
 * front page with a "saved" note instead of an empty newsroom.
 */

type Get = (url: string, timeoutMs: number) => Promise<{ status: number; body: string }>
/** Reads the start of a page — enough for its <head> — and reports where it ended up. */
type GetHead = (url: string, timeoutMs: number) => Promise<{ status: number; body: string; url: string }>

const FEED_TTL = 8 * 60_000
const feedCache = new Map<string, { at: number; stories: RawStory[] }>()
const inFlight = new Map<string, Promise<RawStory[]>>()

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function readFeed(get: Get, feed: FeedSource): Promise<RawStory[]> {
  const cached = feedCache.get(feed.url)
  if (cached && Date.now() - cached.at < FEED_TTL) return cached.stories
  const pending = inFlight.get(feed.url)
  if (pending) return pending
  const job = (async () => {
    let lastError: unknown
    // One retry: most failures on a flaky connection are a single dropped
    // handshake, and a second try a moment later usually lands.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { status, body } = await get(feed.url, 12_000)
        if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
        const stories = parseFeed(body, feed.name)
        if (!stories.length) throw new Error('empty feed')
        feedCache.set(feed.url, { at: Date.now(), stories })
        return stories
      } catch (e) {
        lastError = e
        if (attempt === 0) await sleep(1200)
      }
    }
    // A stale copy beats an empty column when an outlet hiccups.
    if (cached) return cached.stories
    throw lastError
  })().finally(() => inFlight.delete(feed.url))
  inFlight.set(feed.url, job)
  return job
}

async function readDesk(get: Get, feeds: FeedSource[], limit: number, extra?: { feeds: FeedSource[]; keep: (s: RawStory) => boolean }): Promise<DeskResult> {
  const [settled, extraSettled] = await Promise.all([
    Promise.allSettled(feeds.map(f => readFeed(get, f))),
    Promise.allSettled((extra?.feeds || []).map(f => readFeed(get, f))),
  ])
  const raw: RawStory[] = []
  const sources = settled.map((r, i) => {
    if (r.status === 'fulfilled') raw.push(...r.value)
    return { name: feeds[i].name, ok: r.status === 'fulfilled' }
  })
  // Newsrooms read for a filter (the country desk): only matching stories
  // join, and an outlet is listed only if it contributed something.
  extraSettled.forEach((r, i) => {
    if (r.status !== 'fulfilled' || !extra) return
    const kept = r.value.filter(extra.keep)
    if (!kept.length) return
    raw.push(...kept)
    const name = extra.feeds[i].name
    if (!sources.some(s => s.name === name)) sources.push({ name, ok: true })
  })
  const stories = mergeStories(raw, Date.now(), limit)
  return {
    ok: stories.length > 0,
    stories,
    fetchedAt: Date.now(),
    sources,
    error: stories.length ? undefined : 'No newsroom answered. Check the connection and try again.',
  }
}

// ── Share pictures for stories whose feed carried none ─────────────────────

const IMAGE_CACHE_MAX = 800
const imageCache = new Map<string, string>() // url → https image, or '' when the page has none
const imageJobs = new Map<string, Promise<string>>()
let imageActive = 0
const imageQueue: (() => void)[] = []
const IMAGE_CONCURRENCY = 4

const HEAD_LIMIT = 400_000

/**
 * The start of an article page, through Chromium's network stack. Redirects
 * are followed by hand so every hop is checked like the first: a feed must
 * not be able to bounce this request onto this machine or a private network.
 * Reading stops at </head> — the share picture lives there — or 400 KB.
 */
function makeGetHead(userAgent: string): GetHead {
  return (url, timeoutMs) => new Promise((resolve, reject) => {
    let current = url
    let hops = 0
    let settled = false
    const req = net.request({ url, redirect: 'manual', useSessionCookies: false, credentials: 'omit' } as any)
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
      try { req.abort() } catch { /* already done */ }
    }
    const timer = setTimeout(() => finish(() => reject(new Error('timeout'))), timeoutMs)
    req.setHeader('User-Agent', userAgent)
    req.setHeader('Accept', 'text/html,application/xhtml+xml')
    req.on('redirect', (_status, _method, redirectUrl) => {
      if (++hops > 4 || !canResolveImage(redirectUrl)) { finish(() => reject(new Error('redirect refused'))); return }
      current = redirectUrl
      try { req.followRedirect() } catch (e) { finish(() => reject(e)) }
    })
    req.on('response', res => {
      const chunks: Buffer[] = []
      let size = 0
      const done = () => finish(() => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), url: current }))
      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
        size += chunk.length
        if (size >= HEAD_LIMIT || /<\/head>/i.test(chunk.toString('latin1'))) done()
      })
      res.on('end', done)
      res.on('error', (e: Error) => finish(() => reject(e)))
    })
    req.on('error', e => finish(() => reject(e)))
    req.end()
  })
}

function rememberImage(url: string, image: string) {
  imageCache.set(url, image)
  if (imageCache.size > IMAGE_CACHE_MAX) imageCache.delete(imageCache.keys().next().value as string)
}

async function withImageSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (imageActive >= IMAGE_CONCURRENCY) await new Promise<void>(r => imageQueue.push(r))
  imageActive++
  try { return await fn() } finally {
    imageActive--
    imageQueue.shift()?.()
  }
}

function resolveImage(getHead: GetHead, url: string): Promise<string> {
  if (imageCache.has(url)) return Promise.resolve(imageCache.get(url) as string)
  const pending = imageJobs.get(url)
  if (pending) return pending
  const job = withImageSlot(async () => {
    try {
      const res = await getHead(url, 8000)
      // A redirect must not carry the request somewhere a feed could not aim it directly.
      if (res.status < 200 || res.status >= 300 || !canResolveImage(res.url || url)) return ''
      return extractShareImage(res.body, res.url || url)
    } catch {
      return ''
    }
  }).then(image => { rememberImage(url, image); return image })
    .finally(() => imageJobs.delete(url))
  imageJobs.set(url, job)
  return job
}

async function randomRecipes(get: Get, count: number): Promise<{ ok: boolean; recipes: Recipe[]; error?: string }> {
  const n = Math.max(1, Math.min(8, Math.floor(count) || 4))
  // Ask for a few extra: TheMealDB's random endpoint repeats itself now and then.
  const settled = await Promise.allSettled(
    Array.from({ length: n + 2 }, () => get('https://www.themealdb.com/api/json/v1/1/random.php', 10_000)),
  )
  const seen = new Set<string>()
  const recipes: Recipe[] = []
  for (const r of settled) {
    if (r.status !== 'fulfilled' || r.value.status !== 200) continue
    try {
      const meal = normalizeMeal(JSON.parse(r.value.body)?.meals?.[0])
      if (meal && !seen.has(meal.id)) { seen.add(meal.id); recipes.push(meal) }
    } catch { /* skip */ }
    if (recipes.length >= n) break
  }
  return recipes.length
    ? { ok: true, recipes }
    : { ok: false, recipes: [], error: 'The recipe kitchen did not answer. Try again in a moment.' }
}

export function registerNewsIpc(deps: { get: Get; appDir: string; userAgent: string }) {
  const getHead = makeGetHead(deps.userAgent)
  // The last good front page of every desk, so an outage still has a paper.
  const saved = createManagedJsonStore<Record<string, DeskResult>>(join(deps.appDir, 'news-cache.json'), () => ({}))

  const serve = async (key: string, feeds: FeedSource[], limit: number, extra?: Parameters<typeof readDesk>[3]): Promise<DeskResult> => {
    const fresh = await readDesk(deps.get, feeds, limit, extra)
    if (fresh.ok) saved.update(all => { all[key] = fresh })
    return chooseDeskResult(fresh, saved.get()[key])
  }

  ipcMain.handle('news:desk', (_e, id: unknown) => {
    if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(DESK_FEEDS, id)) {
      return { ok: false, stories: [], fetchedAt: Date.now(), sources: [], error: 'Unknown desk.' }
    }
    return serve(`desk:${id}`, deskFeeds(id as DeskId), 80)
  })
  ipcMain.handle('news:country', (_e, code: unknown) => {
    const country = COUNTRIES.find(c => c.code === code)
    if (!country) return { ok: false, stories: [], fetchedAt: Date.now(), sources: [], error: 'Unknown country.' }
    const terms = countryTerms(country.query)
    return serve(`country:${country.code}`, countryFeeds(country), 60, {
      feeds: countryNewsroomFeeds(),
      keep: s => mentionsAny(s, terms),
    })
  })
  ipcMain.handle('news:image', (_e, url: unknown) => {
    if (typeof url !== 'string' || url.length > 2048 || !canResolveImage(url)) return ''
    return resolveImage(getHead, url)
  })
  ipcMain.handle('news:recipes', (_e, count: unknown) => randomRecipes(deps.get, Number(count)))
  // Pull to refresh: drop the cache for the next reads.
  ipcMain.handle('news:refresh', () => { feedCache.clear(); return true })
}
