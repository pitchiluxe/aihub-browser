/**
 * AIHub Browser — the Page Vault.
 *
 * A bookmark is a promise the internet does not keep. Pages get rewritten,
 * moved behind a paywall, quietly edited, or simply deleted, and the sphere is
 * left holding a node that points at a 404. Rewind already keeps the *text* of
 * everything read, which answers "what did that say?" — it cannot answer "show
 * me the page as it was", because the text has no layout, no images and no
 * links.
 *
 * So: when a page is bookmarked, it is also archived, as a single MHTML file.
 * MHTML rather than Chromium's HTMLComplete because HTMLComplete writes a file
 * plus a sibling `_files` directory — two things to keep in step, and a folder
 * a user will eventually move or delete on its own. One file per snapshot is a
 * thing that can be counted, pruned, backed up and handed to somebody.
 *
 * Everything that decides *what* happens — naming, eligibility, throttling,
 * pruning — is a pure function here, so the policy can be tested without a
 * disk, a network or a window. Only `captureSnapshot` touches Electron.
 */

import { join } from 'path'
import fs from 'fs'
import { createManagedJsonStore } from './jsonStore'

export interface Snapshot {
  id: string
  /** The URL as it was navigated, kept verbatim for display. */
  url: string
  /** Normalised URL — what lookups match on. */
  key: string
  title: string
  favicon: string
  /** Absolute path of the .mhtml file. */
  path: string
  bytes: number
  createdAt: number
  /** 'auto' when a bookmark triggered it, 'manual' when the user asked. */
  origin: 'auto' | 'manual'
}

/** Re-archiving the same page more often than this is noise, not history. */
export const MIN_RESNAPSHOT_MS = 12 * 60 * 60 * 1000 // 12 hours

/** Keep a short history per page — enough to see a change, not a filesystem. */
export const MAX_PER_URL = 3

/** A vault that grows without bound is a disk-space bug with a nice name. */
export const MAX_TOTAL_BYTES = 750 * 1024 * 1024 // 750 MB

/**
 * Matching key for a URL. Deliberately the same shape the bookmark bar uses —
 * trailing slash and case folded — so a snapshot taken for a bookmark is found
 * again when the user navigates to the "same" page typed slightly differently.
 * The hash is dropped: `#section-3` is a scroll position, not a document.
 */
export function urlKey(url: string): string {
  const raw = String(url || '').trim()
  if (!raw) return ''
  const withoutHash = raw.split('#')[0]
  return withoutHash.replace(/\/+$/, '').toLowerCase()
}

/**
 * Whether a URL is worth archiving at all. The app's own pages, local files
 * and blobs either cannot be re-fetched or were never remote to begin with —
 * archiving them stores a copy of something that is already local.
 */
export function isArchivable(url: string): boolean {
  const u = String(url || '').trim().toLowerCase()
  if (!u) return false
  return /^https?:\/\//.test(u)
}

/** Filesystem-safe, collision-proof, and still recognisable in a file list. */
export function snapshotFileName(url: string, createdAt: number, rand = ''): string {
  let host = 'page'
  let path = ''
  try {
    const parsed = new URL(url)
    host = parsed.hostname.replace(/^www\./, '') || 'page'
    path = parsed.pathname
  } catch {
    // Unparseable URLs still deserve a file; the timestamp keeps it unique.
  }
  const slug = path.split('/').filter(Boolean).pop() || ''
  const stem = [host, slug].filter(Boolean).join('-')
    .replace(/[^a-z0-9.-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'page'
  const stamp = new Date(createdAt).toISOString().slice(0, 10)
  const suffix = rand || Math.random().toString(36).slice(2, 7)
  return `${stem}-${stamp}-${suffix}.mhtml`
}

/** Every snapshot of one page, newest first. */
export function snapshotsFor(url: string, all: Snapshot[]): Snapshot[] {
  const key = urlKey(url)
  if (!key) return []
  return all.filter(s => s.key === key).sort((a, b) => b.createdAt - a.createdAt)
}

/** The copy to offer when the live page is gone. */
export function latestFor(url: string, all: Snapshot[]): Snapshot | null {
  return snapshotsFor(url, all)[0] || null
}

/**
 * Whether to take a new snapshot now.
 *
 * A manual request always wins — the user pressing "save a copy" has a reason
 * we do not know about, usually that the page is about to change. Automatic
 * captures are throttled per page, because bookmarking, un-bookmarking and
 * re-bookmarking a page in one sitting is normal behaviour and should not
 * write three near-identical files.
 */
export function shouldSnapshot(
  url: string,
  all: Snapshot[],
  now: number,
  origin: 'auto' | 'manual' = 'auto',
): boolean {
  if (!isArchivable(url)) return false
  if (origin === 'manual') return true
  const latest = latestFor(url, all)
  if (!latest) return true
  return now - latest.createdAt >= MIN_RESNAPSHOT_MS
}

/**
 * Which snapshots to delete, given the limits. Returns them oldest-first so a
 * caller that stops early still frees the least useful copies.
 *
 * Two rules, applied in order: no page keeps more than MAX_PER_URL copies, and
 * the vault as a whole stays under MAX_TOTAL_BYTES. The second rule evicts the
 * oldest snapshots across every page — a vault at its size limit should shed
 * last year's copy of something, not this morning's.
 */
export function selectForPruning(
  all: Snapshot[],
  maxPerUrl = MAX_PER_URL,
  maxTotalBytes = MAX_TOTAL_BYTES,
): Snapshot[] {
  const doomed = new Set<string>()

  const byKey = new Map<string, Snapshot[]>()
  for (const s of all) {
    const list = byKey.get(s.key) || []
    list.push(s)
    byKey.set(s.key, list)
  }
  for (const list of byKey.values()) {
    list.sort((a, b) => b.createdAt - a.createdAt)
    for (const extra of list.slice(maxPerUrl)) doomed.add(extra.id)
  }

  const survivors = all.filter(s => !doomed.has(s.id)).sort((a, b) => a.createdAt - b.createdAt)
  let total = survivors.reduce((sum, s) => sum + (s.bytes || 0), 0)
  for (const s of survivors) {
    if (total <= maxTotalBytes) break
    doomed.add(s.id)
    total -= s.bytes || 0
  }

  return all.filter(s => doomed.has(s.id)).sort((a, b) => a.createdAt - b.createdAt)
}

export function vaultBytes(all: Snapshot[]): number {
  return all.reduce((sum, s) => sum + (s.bytes || 0), 0)
}

// ── Everything below touches the disk ──────────────────────────────────────

export function createVault(appDir: string) {
  const dir = join(appDir, 'vault')
  const store = createManagedJsonStore<Snapshot[]>(join(appDir, 'vault.json'), () => [])

  const ensureDir = () => { try { fs.mkdirSync(dir, { recursive: true }) } catch {} }

  const list = (): Snapshot[] => store.get().slice().sort((a, b) => b.createdAt - a.createdAt)

  /** Delete a snapshot's file and its index row. Missing file is not an error. */
  const remove = (id: string): boolean => {
    const all = store.get()
    const found = all.find(s => s.id === id)
    if (!found) return false
    try { fs.unlinkSync(found.path) } catch {}
    store.set(all.filter(s => s.id !== id))
    return true
  }

  /** Apply the size and per-page limits, deleting what falls outside them. */
  const prune = (): number => {
    const doomed = selectForPruning(store.get())
    for (const s of doomed) {
      try { fs.unlinkSync(s.path) } catch {}
    }
    if (doomed.length) {
      const gone = new Set(doomed.map(s => s.id))
      store.set(store.get().filter(s => !gone.has(s.id)))
    }
    return doomed.length
  }

  /**
   * Archive what a live webContents is currently showing.
   *
   * Returns null rather than throwing when the page is not worth archiving or
   * the capture fails: a snapshot is a background courtesy, and a bookmark
   * must still succeed when the archive does not.
   */
  const capture = async (
    wc: Electron.WebContents,
    meta: { url: string; title?: string; favicon?: string; origin?: 'auto' | 'manual' },
  ): Promise<Snapshot | null> => {
    const origin = meta.origin || 'auto'
    if (!shouldSnapshot(meta.url, store.get(), Date.now(), origin)) return null

    ensureDir()
    const createdAt = Date.now()
    const path = join(dir, snapshotFileName(meta.url, createdAt))
    try {
      await wc.savePage(path, 'MHTML')
    } catch {
      return null
    }

    let bytes = 0
    try { bytes = fs.statSync(path).size } catch { return null }
    // A save that produced nothing is a failure Chromium reported as success.
    if (!bytes) { try { fs.unlinkSync(path) } catch {}; return null }

    const snap: Snapshot = {
      id: `vs-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
      url: meta.url,
      key: urlKey(meta.url),
      title: meta.title || meta.url,
      favicon: meta.favicon || '',
      path,
      bytes,
      createdAt,
      origin,
    }
    store.set([snap, ...store.get()])
    prune()
    return snap
  }

  const clear = (): number => {
    const all = store.get()
    for (const s of all) { try { fs.unlinkSync(s.path) } catch {} }
    store.set([])
    return all.length
  }

  return { dir, list, remove, prune, capture, clear, latestFor: (url: string) => latestFor(url, store.get()) }
}
