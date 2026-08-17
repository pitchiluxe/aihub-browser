/**
 * AIHub Browser — moving everything you have made to another computer.
 *
 * Sync (see syncCrypto) keeps bookmarks and preferences in step between
 * machines you own, continuously, through your own Drive. This is the other
 * half of the problem: one file you can carry on a USB stick, mail to
 * yourself, or keep as a backup — holding the things you cannot recreate.
 *
 * What travels, and why:
 *   - Bible marks. Highlights, notes and saved verses are the single most
 *     irreplaceable thing in this app: nobody can re-read a year of study.
 *   - Bookmarks. The sphere has no stored layout — its nodes, clusters and
 *     colours are DERIVED from each bookmark's category and colour — so
 *     carrying the bookmarks carries the graph exactly as it looked.
 *   - Sticky notes and per-site memory, which are notes attached to pages.
 *   - Watches, custom extensions and their settings, custom themes.
 *
 * What deliberately does NOT travel: API keys, OAuth tokens, cookies, and
 * anything else that is a credential or is specific to one machine. A backup
 * file is something people email to themselves; it must be safe to lose.
 */

export const BACKUP_APP = 'aihub-browser'
export const BACKUP_VERSION = 1
export const BACKUP_EXTENSION = '.aihub'

export interface BibleMarksData {
  highlights: Record<string, string>
  saved: { ref: string; ts: number }[]
  notes: Record<string, string>
  lastRead: { book: string; chapter: number } | null
}

/** Everything the study room remembers — see bible-study.json in the main
 *  process. Kept separate from BibleMarksData on purpose: a corrupt study file
 *  must never cost someone their highlights and notes, and the reverse holds
 *  too. */
export interface BibleStudyData {
  /** Verse reference → Leitner box and next due date. */
  verses: Record<string, { box: number; dueAt: number; lastResult?: string; reviews?: number }>
  /** `course-id/lesson-id` → when it was finished and how the quiz went. */
  lessons: Record<string, { completedAt: number; score: number; total: number }>
  streak: { days: string[]; best: number }
  badges: string[]
  /** `plan-id` → how many days of it have been read. */
  plans: Record<string, { day: number; startedAt: number }>
}

export interface BackupSections {
  bible?: BibleMarksData
  bibleStudy?: BibleStudyData
  bookmarks?: any[]
  stickyNotes?: Record<string, any>
  siteMemory?: Record<string, any>
  watches?: any[]
  extensions?: { customExts?: any[]; states?: Record<string, any> }
  /** Renderer-only data that lives in localStorage (themes, window styles). */
  local?: Record<string, string>
  /** Preferences worth carrying — never credentials. */
  settings?: Record<string, unknown>
}

export interface Backup {
  app: typeof BACKUP_APP
  version: number
  createdAt: number
  device: string
  appVersion: string
  sections: BackupSections
}

/** Settings that are meaningless or unsafe on another machine. */
const SETTINGS_BLOCKLIST = new Set([
  'openrouterKey', 'openrouterBase', 'openrouterModel', 'ollamaUrl',
  'obsidianVault',   // a filesystem path from the other computer
  'containers',      // cookie jars are per-machine
  'lastSyncAt',
])

export function portableSettings(settings: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(settings || {})) {
    if (SETTINGS_BLOCKLIST.has(key)) continue
    out[key] = value
  }
  return out
}

export function buildBackup(sections: BackupSections, meta: { device: string; appVersion: string }): Backup {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    createdAt: Date.now(),
    device: meta.device || 'unknown',
    appVersion: meta.appVersion || '',
    sections: {
      ...sections,
      settings: sections.settings ? portableSettings(sections.settings) : undefined,
    },
  }
}

export interface BackupSummary {
  verses: number
  highlights: number
  bibleNotes: number
  /** Verses being memorised in the Lab — distinct from `verses` (saved ones). */
  versesLearning: number
  bookmarks: number
  notePages: number
  rememberedSites: number
  watches: number
  extensions: number
  themes: number
}

export function summarize(backup: Backup): BackupSummary {
  const s = backup?.sections || {}
  let themes = 0
  try {
    const raw = s.local?.['aihub-custom-themes']
    if (raw) themes = (JSON.parse(raw) as any[]).length
  } catch { themes = 0 }

  return {
    verses: s.bible?.saved?.length || 0,
    highlights: Object.keys(s.bible?.highlights || {}).length,
    bibleNotes: Object.keys(s.bible?.notes || {}).length,
    versesLearning: Object.keys(s.bibleStudy?.verses || {}).length,
    bookmarks: s.bookmarks?.length || 0,
    notePages: Object.keys(s.stickyNotes || {}).length,
    rememberedSites: Object.keys(s.siteMemory || {}).length,
    watches: s.watches?.length || 0,
    extensions: s.extensions?.customExts?.length || 0,
    themes,
  }
}

export interface ValidationResult {
  ok: boolean
  error?: string
  backup?: Backup
  summary?: BackupSummary
}

/**
 * Check a file before letting it near the user's data. An import that silently
 * accepts the wrong file and overwrites a year of Bible study would be the
 * worst bug this app could have, so this refuses anything it does not
 * positively recognise.
 */
export function validateBackup(raw: unknown): ValidationResult {
  let parsed: any = raw
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw) } catch { return { ok: false, error: 'That file is not a valid AIHub backup (unreadable JSON)' } }
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'That file is empty or not a backup' }
  if (parsed.app !== BACKUP_APP) return { ok: false, error: 'That file was not made by AIHub Browser' }
  if (typeof parsed.version !== 'number') return { ok: false, error: 'That backup has no version and cannot be read safely' }
  if (parsed.version > BACKUP_VERSION) {
    return { ok: false, error: `That backup was made by a newer AIHub Browser (format v${parsed.version}). Update this copy first.` }
  }
  if (!parsed.sections || typeof parsed.sections !== 'object') return { ok: false, error: 'That backup contains no data' }

  const backup = parsed as Backup
  return { ok: true, backup, summary: summarize(backup) }
}

// ── Merging ────────────────────────────────────────────────────────────────
// Import defaults to MERGE, never replace: someone importing their old laptop
// onto a machine they have already been using must not lose today's work.

export function mergeBibleMarks(current: BibleMarksData | null, incoming: BibleMarksData | null): BibleMarksData {
  const base: BibleMarksData = current || { highlights: {}, saved: [], notes: {}, lastRead: null }
  if (!incoming) return base

  // Highlights and notes are keyed by verse reference. The local value wins on
  // a genuine clash — this machine's copy is the one being looked at.
  const highlights = { ...(incoming.highlights || {}), ...(base.highlights || {}) }
  const notes = { ...(incoming.notes || {}), ...(base.notes || {}) }

  const byRef = new Map<string, { ref: string; ts: number }>()
  for (const verse of [...(incoming.saved || []), ...(base.saved || [])]) {
    if (!verse?.ref) continue
    const existing = byRef.get(verse.ref)
    // Keep the EARLIEST timestamp: the date you first saved a verse is the
    // true one, and an import should not make old verses look new.
    if (!existing || (verse.ts || 0) < (existing.ts || 0)) byRef.set(verse.ref, verse)
  }

  return {
    highlights,
    notes,
    saved: [...byRef.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)),
    lastRead: base.lastRead || incoming.lastRead || null,
  }
}

export const EMPTY_BIBLE_STUDY = (): BibleStudyData => ({
  verses: {}, lessons: {}, streak: { days: [], best: 0 }, badges: [], plans: {},
})

/**
 * Merge study progress.
 *
 * The rule everywhere here is "keep the better of the two", not "local wins".
 * Progress is monotonic — you do not un-learn a verse by importing an old
 * laptop — so a verse takes the higher box, a lesson keeps its completion, and
 * the streak takes the union of the days actually lived through.
 */
export function mergeBibleStudy(current: BibleStudyData | null, incoming: BibleStudyData | null): BibleStudyData {
  const base: BibleStudyData = current || EMPTY_BIBLE_STUDY()
  if (!incoming) return base

  const verses = { ...(incoming.verses || {}) }
  for (const [ref, mine] of Object.entries(base.verses || {})) {
    const theirs = verses[ref]
    // Higher box wins; on a tie the later due date does, so a verse is never
    // pulled back into a queue it has already been cleared from.
    verses[ref] = !theirs || (mine.box ?? 0) > (theirs.box ?? 0)
      || ((mine.box ?? 0) === (theirs.box ?? 0) && (mine.dueAt ?? 0) >= (theirs.dueAt ?? 0))
      ? mine : theirs
  }

  const lessons = { ...(incoming.lessons || {}) }
  for (const [key, mine] of Object.entries(base.lessons || {})) {
    const theirs = lessons[key]
    lessons[key] = !theirs || (mine.score ?? 0) >= (theirs.score ?? 0) ? mine : theirs
  }

  const days = Array.from(new Set([...(base.streak?.days || []), ...(incoming.streak?.days || [])])).sort()
  const plans = { ...(incoming.plans || {}) }
  for (const [id, mine] of Object.entries(base.plans || {})) {
    const theirs = plans[id]
    plans[id] = !theirs || (mine.day ?? 0) >= (theirs.day ?? 0) ? mine : theirs
  }

  return {
    verses,
    lessons,
    streak: { days, best: Math.max(base.streak?.best || 0, incoming.streak?.best || 0) },
    badges: Array.from(new Set([...(base.badges || []), ...(incoming.badges || [])])),
    plans,
  }
}

/** Same page = same normalised URL, so a re-saved bookmark is not duplicated. */
export function bookmarkKey(bookmark: { url?: string }): string {
  const raw = String(bookmark?.url || '').trim().toLowerCase()
  try {
    const u = new URL(raw)
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}${u.search}`
  } catch {
    return raw.replace(/\/$/, '')
  }
}

export function mergeBookmarks(current: any[], incoming: any[]): any[] {
  const byKey = new Map<string, any>()
  // Local first, so an existing bookmark keeps its own category and colour —
  // the sphere the user is looking at should not rearrange itself on import.
  for (const bookmark of [...(current || []), ...(incoming || [])]) {
    if (!bookmark?.url) continue
    const key = bookmarkKey(bookmark)
    if (!byKey.has(key)) byKey.set(key, bookmark)
  }
  return [...byKey.values()]
}

/** Generic keyed-record merge (sticky notes, site memory) — local wins. */
export function mergeRecords<T>(current: Record<string, T> | undefined, incoming: Record<string, T> | undefined): Record<string, T> {
  return { ...(incoming || {}), ...(current || {}) }
}

/** Merge a list of objects by a chosen id field, local winning on a clash. */
export function mergeById<T extends Record<string, any>>(current: T[] | undefined, incoming: T[] | undefined, idField: string): T[] {
  const byId = new Map<string, T>()
  for (const item of [...(current || []), ...(incoming || [])]) {
    const id = item?.[idField]
    if (id === undefined || id === null) continue
    if (!byId.has(String(id))) byId.set(String(id), item)
  }
  return [...byId.values()]
}

/** A filename that says what it is and when it was made. */
export function backupFileName(date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10)
  return `AIHub-Browser-${stamp}${BACKUP_EXTENSION}`
}
