import { ipcMain } from 'electron'
import {
  DESK_FEEDS, COUNTRIES, countryFeed, parseFeed, mergeStories, normalizeMeal,
  type DeskId, type DeskResult, type FeedSource, type RawStory, type Recipe,
} from '../../shared/news'

/**
 * AIHub News — the main-process half of aihub://news.
 *
 * Feeds are fetched here, not in the page: news sites do not send CORS
 * headers, and Chromium's network stack (through `get`) keeps a slow outlet
 * from freezing the main thread. Every outlet is asked independently and a
 * failure costs only that outlet. Answers are cached for a few minutes so
 * flicking between desks is instant and nobody's feed is hammered.
 */

type Get = (url: string, timeoutMs: number) => Promise<{ status: number; body: string }>

const FEED_TTL = 8 * 60_000
const feedCache = new Map<string, { at: number; stories: RawStory[] }>()
const inFlight = new Map<string, Promise<RawStory[]>>()

async function readFeed(get: Get, feed: FeedSource): Promise<RawStory[]> {
  const cached = feedCache.get(feed.url)
  if (cached && Date.now() - cached.at < FEED_TTL) return cached.stories
  const pending = inFlight.get(feed.url)
  if (pending) return pending
  const job = (async () => {
    try {
      const { status, body } = await get(feed.url, 9000)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const stories = parseFeed(body, feed.name)
      if (!stories.length) throw new Error('empty feed')
      feedCache.set(feed.url, { at: Date.now(), stories })
      return stories
    } catch (e) {
      // A stale copy beats an empty column when an outlet hiccups.
      if (cached) return cached.stories
      throw e
    } finally {
      inFlight.delete(feed.url)
    }
  })()
  inFlight.set(feed.url, job)
  return job
}

async function readDesk(get: Get, feeds: FeedSource[], limit: number): Promise<DeskResult> {
  const settled = await Promise.allSettled(feeds.map(f => readFeed(get, f)))
  const raw: RawStory[] = []
  const sources = settled.map((r, i) => {
    if (r.status === 'fulfilled') raw.push(...r.value)
    return { name: feeds[i].name, ok: r.status === 'fulfilled' }
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

async function randomRecipes(get: Get, count: number): Promise<{ ok: boolean; recipes: Recipe[]; error?: string }> {
  const n = Math.max(1, Math.min(8, Math.floor(count) || 4))
  // Ask for a few extra: TheMealDB's random endpoint repeats itself now and then.
  const settled = await Promise.allSettled(
    Array.from({ length: n + 2 }, () => get('https://www.themealdb.com/api/json/v1/1/random.php', 8000)),
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

export function registerNewsIpc(deps: { get: Get }) {
  ipcMain.handle('news:desk', (_e, id: unknown) => {
    const feeds = typeof id === 'string' && Object.prototype.hasOwnProperty.call(DESK_FEEDS, id) ? DESK_FEEDS[id as DeskId] : null
    if (!feeds) return { ok: false, stories: [], fetchedAt: Date.now(), sources: [], error: 'Unknown desk.' }
    return readDesk(deps.get, feeds, 80)
  })
  ipcMain.handle('news:country', (_e, code: unknown) => {
    const country = COUNTRIES.find(c => c.code === code)
    if (!country) return { ok: false, stories: [], fetchedAt: Date.now(), sources: [], error: 'Unknown country.' }
    return readDesk(deps.get, [countryFeed(country)], 60)
  })
  ipcMain.handle('news:recipes', (_e, count: unknown) => randomRecipes(deps.get, Number(count)))
  // Pull to refresh: drop the cache for the next reads.
  ipcMain.handle('news:refresh', () => { feedCache.clear(); return true })
}
