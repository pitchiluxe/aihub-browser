import { join } from 'path'
import { app, ipcMain, net } from 'electron'
import { createManagedJsonStore } from './jsonStore'
import { hostOf, faviconSourceUrl } from '../shared/favicon'

/**
 * Favicon fetching and caching, in the main process.
 *
 * The renderer used to point <img src> straight at Google's favicon service.
 * Every site Google had no icon for answered 404, and Chromium writes each of
 * those to the console before any onError handler can run — so a homepage of
 * bookmarks produced a wall of red that no renderer-side code could silence.
 *
 * Here a 404 is just a number. The renderer asks for a host and gets back
 * either a data URI that is known to render or null, and null means "draw the
 * generated tile" — which needs no network and therefore cannot fail.
 *
 * The cache is on disk and keyed by host, so the second launch draws icons
 * with no network at all. Failures are cached too: without that, every one of
 * those forty iconless bookmarks would re-request on every render forever.
 */

interface CacheEntry {
  /** data: URI, or null when the host has no icon we could fetch. */
  data: string | null
  ts: number
}

const CACHE_FILE = 'favicons.json'
/** Successes rarely change; a month keeps the cache useful without freezing a
 *  rebrand in place permanently. */
const HIT_TTL = 30 * 24 * 60 * 60 * 1000
/** Misses are re-checked sooner: a new site may gain an icon, and a fetch that
 *  failed because the machine was offline should not be believed for a month. */
const MISS_TTL = 24 * 60 * 60 * 1000
/** Anything larger is not a favicon; refuse it rather than inlining it into
 *  every render of the homepage. */
const MAX_BYTES = 64 * 1024
const FETCH_TIMEOUT_MS = 6000

let store: ReturnType<typeof createManagedJsonStore<Record<string, CacheEntry>>>

function cache() {
  if (!store) {
    store = createManagedJsonStore<Record<string, CacheEntry>>(
      join(app.getPath('userData'), CACHE_FILE), () => ({}))
  }
  return store
}

function fresh(entry: CacheEntry | undefined, now: number): boolean {
  if (!entry) return false
  return now - entry.ts < (entry.data ? HIT_TTL : MISS_TTL)
}

/**
 * In-flight requests, so twenty bookmarks on one domain make one fetch.
 *
 * Without this the homepage's first paint fires a request per card, and the
 * cache only starts helping after they have all already gone out.
 */
const inFlight = new Map<string, Promise<string | null>>()

function fetchIcon(host: string): Promise<string | null> {
  const existing = inFlight.get(host)
  if (existing) return existing

  const work = new Promise<string | null>(resolve => {
    let settled = false
    const done = (value: string | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const request = net.request(faviconSourceUrl(host))
    const timer = setTimeout(() => { try { request.abort() } catch {} ; done(null) }, FETCH_TIMEOUT_MS)

    request.on('response', response => {
      const status = response.statusCode
      const type = String(response.headers['content-type'] || '')
      if (status !== 200 || !/^image\//i.test(type)) {
        // The case this whole module exists for. Not an error, not logged —
        // just a host with no icon.
        clearTimeout(timer)
        response.on('data', () => {})
        response.on('end', () => done(null))
        response.on('error', () => done(null))
        return
      }

      const chunks: Buffer[] = []
      let total = 0
      response.on('data', (chunk: Buffer) => {
        total += chunk.length
        if (total > MAX_BYTES) { try { request.abort() } catch {} ; clearTimeout(timer); done(null); return }
        chunks.push(chunk)
      })
      response.on('end', () => {
        clearTimeout(timer)
        if (!chunks.length) return done(null)
        const mime = type.split(';')[0].trim()
        done(`data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`)
      })
      response.on('error', () => { clearTimeout(timer); done(null) })
    })

    request.on('error', () => { clearTimeout(timer); done(null) })
    try { request.end() } catch { clearTimeout(timer); done(null) }
  }).finally(() => { inFlight.delete(host) })

  inFlight.set(host, work)
  return work
}

/** A data URI for this URL's icon, or null when there isn't one. */
export async function faviconFor(rawUrl: string): Promise<string | null> {
  const host = hostOf(rawUrl)
  if (!host) return null

  const now = Date.now()
  const entry = cache().get()[host]
  if (fresh(entry, now)) return entry.data

  const data = await fetchIcon(host)
  cache().update(c => { c[host] = { data, ts: now } })
  return data
}

export function registerFaviconIpc(): void {
  cache()

  ipcMain.handle('favicon:get', async (_e, url: string) => {
    try {
      return { ok: true, data: await faviconFor(String(url ?? '')) }
    } catch {
      // Never let an icon take a render down with it.
      return { ok: true, data: null }
    }
  })

  /** Resolve several at once — the homepage asks for every bookmark it draws,
   *  and one round trip beats forty. */
  ipcMain.handle('favicon:getMany', async (_e, urls: string[]) => {
    const list = Array.isArray(urls) ? urls.slice(0, 500) : []
    const out: Record<string, string | null> = {}
    await Promise.all(list.map(async url => {
      try { out[url] = await faviconFor(String(url ?? '')) } catch { out[url] = null }
    }))
    return { ok: true, icons: out }
  })
}
