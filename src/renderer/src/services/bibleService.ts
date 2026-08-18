import webIndex from '../assets/bible/index.json'
import lsgIndex from '../assets/bible/lsg/index.json'
import { loadBibleSettings, saveBibleSettings, onBibleSettingsChange } from './bibleSettings'

export type Verse = { v: number; t: string }
/** English name of the same book, when the translation is not in English. */
export type BookMeta = {
  id: string; name: string; testament: 'OT' | 'NT'; slug: string; chapters: number; enName?: string
}
export type Book = { id: string; name: string; chapters: Verse[][] }

export type TranslationId = 'WEB' | 'LSG'

export interface TranslationMeta {
  id: TranslationId
  /** How the version is named in its own language. */
  name: string
  /** Three letters for the toolbar, where a full name will not fit. */
  short: string
  language: string
  /** BCP 47, for `lang` attributes and speech synthesis. */
  locale: string
}

export const TRANSLATIONS: TranslationMeta[] = [
  { id: 'WEB', name: 'World English Bible', short: 'WEB', language: 'English',  locale: 'en' },
  { id: 'LSG', name: 'Louis Segond 1910',   short: 'LSG', language: 'Français', locale: 'fr' },
]

// Both indexes are a few KB of book names and chapter counts, so they are
// bundled outright; only the text itself is lazily fetched per book.
const INDEXES: Record<TranslationId, { books: BookMeta[]; dir: string }> = {
  WEB: { books: webIndex.books as BookMeta[], dir: '' },
  LSG: { books: lsgIndex.books as BookMeta[], dir: 'lsg/' },
}

const BY_ID: Record<TranslationId, Map<string, BookMeta>> = {
  WEB: new Map(INDEXES.WEB.books.map(b => [b.id, b])),
  LSG: new Map(INDEXES.LSG.books.map(b => [b.id, b])),
}

const isTranslation = (v: unknown): v is TranslationId =>
  v === 'WEB' || v === 'LSG'

// ── Which version is open ──────────────────────────────────────────────────
//
// Held here rather than threaded through props because scripture is read from
// this module by far more than the reader: search, the verse graph, the
// memorisation drills and the classroom all call `getBook` without ever
// knowing a version was chosen. The setting is still owned and persisted by
// bibleSettings; this is a mirror of it that non-React code can read
// synchronously.
let active: TranslationId = (() => {
  const saved = loadBibleSettings().translation
  return isTranslation(saved) ? saved : 'WEB'
})()

type Listener = (id: TranslationId) => void
const listeners = new Set<Listener>()

export function getTranslation(): TranslationId {
  return active
}

export function getTranslationMeta(id: TranslationId = active): TranslationMeta {
  return TRANSLATIONS.find(t => t.id === id) ?? TRANSLATIONS[0]
}

/** Switch versions. Persists through bibleSettings, which feeds back here. */
export function setTranslation(id: TranslationId) {
  if (!isTranslation(id) || id === active) return
  saveBibleSettings({ ...loadBibleSettings(), translation: id })
}

/**
 * Fires when the open version changes. Used by anything holding text derived
 * from scripture — the search index above all — to throw that work away and
 * rebuild it against the new translation.
 */
export function onTranslationChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

onBibleSettingsChange(next => {
  const id = isTranslation(next.translation) ? next.translation : 'WEB'
  if (id === active) return
  active = id
  for (const fn of listeners) fn(id)
})

// ── Books and text ─────────────────────────────────────────────────────────

// One book is a few hundred KB at most, so keeping opened books resident is
// cheap and makes flipping back and forth instant. Keyed by version as well as
// id — the same John in two languages is two different books.
const cache = new Map<string, Book>()

export function getBooks(translation: TranslationId = active): BookMeta[] {
  return INDEXES[translation].books
}

/** Sentinel for the "Cover" entry that leads the book list. Not a book id. */
export const COVER_OPTION = '__cover__'

export interface BookOption { value: string; label: string; isCover: boolean }

/**
 * The book list as the reader's dropdown shows it: the cover first, then
 * Genesis onward.
 *
 * The cover leads because it is the front of the book — and because once the
 * reader has opened it there is otherwise no way back to it short of
 * reloading the page. Kept here rather than inline in the JSX so the ordering
 * is testable; "cover before Genesis" is exactly the sort of thing a later
 * refactor reorders by accident.
 */
export function bookListOptions(translation: TranslationId = active): BookOption[] {
  return [
    { value: COVER_OPTION, label: '📕 Cover', isCover: true },
    ...getBooks(translation).map(b => ({ value: b.id, label: b.name, isCover: false })),
  ]
}

export function getBookMeta(id: string, translation: TranslationId = active): BookMeta | undefined {
  return BY_ID[translation].get(id)
}

export async function getBook(id: string, translation: TranslationId = active): Promise<Book> {
  const key = `${translation}:${id}`
  const cached = cache.get(key)
  if (cached) return cached

  const meta = BY_ID[translation].get(id)
  if (!meta) throw new Error(`Unknown book: ${id}`)

  // Vite resolves these globs at build time, so every book of every version is
  // a separate lazily fetched chunk rather than one 10MB import.
  const modules = import.meta.glob(['../assets/bible/*.json', '../assets/bible/lsg/*.json'])
  const loader = modules[`../assets/bible/${INDEXES[translation].dir}${meta.slug}.json`]
  if (!loader) throw new Error(`Missing asset for ${id} (${translation})`)

  const mod = (await loader()) as { default: Book }
  cache.set(key, mod.default)
  return mod.default
}

export async function getChapter(
  id: string, chapter: number, translation: TranslationId = active,
): Promise<Verse[]> {
  const book = await getBook(id, translation)
  return book.chapters[chapter - 1] ?? []
}

export function refKey(bookId: string, chapter: number, verse: number): string {
  return `${bookId}.${chapter}.${verse}`
}

export function parseRef(key: string): { bookId: string; chapter: number; verse: number } | null {
  const m = /^([A-Z0-9]{3})\.(\d+)\.(\d+)$/.exec(key || '')
  // Book ids are shared across versions — a reference saved while reading in
  // French still resolves in English, and vice versa.
  if (!m || !BY_ID.WEB.has(m[1])) return null
  return { bookId: m[1], chapter: Number(m[2]), verse: Number(m[3]) }
}

export function formatRef(key: string, translation: TranslationId = active): string {
  const parsed = parseRef(key)
  if (!parsed) return key
  const name = BY_ID[translation].get(parsed.bookId)?.name
    ?? BY_ID.WEB.get(parsed.bookId)!.name
  return `${name} ${parsed.chapter}:${parsed.verse}`
}
