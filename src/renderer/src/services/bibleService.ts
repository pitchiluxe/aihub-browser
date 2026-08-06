import index from '../assets/bible/index.json'

export type Verse = { v: number; t: string }
export type BookMeta = { id: string; name: string; testament: 'OT' | 'NT'; slug: string; chapters: number }
export type Book = { id: string; name: string; chapters: Verse[][] }

const BOOKS = index.books as BookMeta[]
const byId = new Map(BOOKS.map(b => [b.id, b]))

// One book is a few hundred KB at most, so keeping opened books resident is
// cheap and makes flipping back and forth instant.
const cache = new Map<string, Book>()

export function getBooks(): BookMeta[] {
  return BOOKS
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
export function bookListOptions(): BookOption[] {
  return [
    { value: COVER_OPTION, label: '📕 Cover', isCover: true },
    ...getBooks().map(b => ({ value: b.id, label: b.name, isCover: false })),
  ]
}

export function getBookMeta(id: string): BookMeta | undefined {
  return byId.get(id)
}

export async function getBook(id: string): Promise<Book> {
  const cached = cache.get(id)
  if (cached) return cached

  const meta = byId.get(id)
  if (!meta) throw new Error(`Unknown book: ${id}`)

  // Vite resolves this glob at build time, so every book is a separate lazily
  // fetched chunk rather than one 5MB import.
  const modules = import.meta.glob('../assets/bible/*.json')
  const loader = modules[`../assets/bible/${meta.slug}.json`]
  if (!loader) throw new Error(`Missing asset for ${id}`)

  const mod = (await loader()) as { default: Book }
  cache.set(id, mod.default)
  return mod.default
}

export async function getChapter(id: string, chapter: number): Promise<Verse[]> {
  const book = await getBook(id)
  return book.chapters[chapter - 1] ?? []
}

export function refKey(bookId: string, chapter: number, verse: number): string {
  return `${bookId}.${chapter}.${verse}`
}

export function parseRef(key: string): { bookId: string; chapter: number; verse: number } | null {
  const m = /^([A-Z0-9]{3})\.(\d+)\.(\d+)$/.exec(key || '')
  if (!m || !byId.has(m[1])) return null
  return { bookId: m[1], chapter: Number(m[2]), verse: Number(m[3]) }
}

export function formatRef(key: string): string {
  const parsed = parseRef(key)
  if (!parsed) return key
  return `${byId.get(parsed.bookId)!.name} ${parsed.chapter}:${parsed.verse}`
}
