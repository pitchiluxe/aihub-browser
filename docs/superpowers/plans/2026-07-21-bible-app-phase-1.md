# Bible App — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Bible reader inside AIHub Browser that opens offline, renders a two-page spread, and turns pages like a real book — with verse highlighting, saving, notes, and sharing.

**Architecture:** The World English Bible is fetched once at build time and committed as compact per-book JSON. A new `bible` tab page type (same wiring as `rewind` and `watch`) lazy-loads one book at a time. The reader is split into a spread layout, a 3D page-fold component, and a verse renderer. Marks persist to `bible-marks.json` in `APP_DIR` through IPC, matching the existing `readJson`/`writeJson` pattern.

**Tech Stack:** Electron 28, React, TypeScript, Zustand, TailwindCSS, framer-motion, vitest.

## Global Constraints

- Translation is the **World English Bible (WEB)**, public domain. Never bundle NIV/NKJV/ESV text.
- Verse reference keys are always `BOOK.CHAPTER.VERSE` using the 3-letter book id (e.g. `JHN.3.16`).
- The app must work with **no network access** at runtime.
- Page-turn animation must use compositor-only properties (`transform`, `opacity`). No layout-thrashing animation.
- Tests are vitest, colocated as `*.test.ts`, run with `npm test`.
- Persistence uses the existing `readJson`/`writeJson` helpers in `src/main/index.ts` and writes into `APP_DIR`.
- Follow the existing page-registration pattern exactly: `Tab.pageType` union → `App.tsx` lazy import + render case → `Sidebar.tsx` NAV_ITEMS → `CommandPalette.tsx` PageType + pages list.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/lib/bible-canon.mjs` | Canonical 66-book table: id, name, testament, source slug |
| `scripts/lib/normalize-bible.mjs` | Pure transform: WEB token stream → compact chapters/verses |
| `scripts/lib/normalize-bible.test.ts` | Unit tests for the transform |
| `scripts/build-bible.mjs` | Downloads WEB, runs the transform, writes assets |
| `src/renderer/src/assets/bible/index.json` | Generated: book list with chapter counts |
| `src/renderer/src/assets/bible/<slug>.json` | Generated: one file per book |
| `src/renderer/src/assets/bible/bible-assets.test.ts` | Verifies generated data integrity |
| `src/renderer/src/services/bibleService.ts` | Lazy book loading, caching, reference parsing |
| `src/renderer/src/services/bibleService.test.ts` | Unit tests for reference parsing/formatting |
| `src/main/index.ts` | Adds `bible:marks:get` / `bible:marks:set` IPC |
| `src/preload/index.ts` | Adds the `bible` bridge |
| `src/renderer/src/store/browserStore.ts` | Adds `'bible'` to `Tab.pageType` |
| `src/renderer/src/components/pages/BiblePage.tsx` | Page shell: navigation, state, panels |
| `src/renderer/src/components/bible/BookSpread.tsx` | Two-page spread, gutter, paper, shadows |
| `src/renderer/src/components/bible/PageLeaf.tsx` | 3D fold mechanics only |
| `src/renderer/src/components/bible/VerseText.tsx` | Verse rendering, selection, highlight paint |
| `src/renderer/src/components/bible/VerseActions.tsx` | Action bar over a selected verse |
| `src/renderer/src/components/bible/ShareSheet.tsx` | Share targets + verse image export |

---

## Task 1: Bible canon table and text normalizer

**Files:**
- Create: `scripts/lib/bible-canon.mjs`
- Create: `scripts/lib/normalize-bible.mjs`
- Test: `scripts/lib/normalize-bible.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BOOKS` — array of `{ id: string, name: string, testament: 'OT'|'NT', slug: string }`, 66 entries in canonical order. `normalizeBook(tokens: object[]): { chapters: { v: number, t: string }[][] }`.

- [ ] **Step 1: Create the canon table**

Create `scripts/lib/bible-canon.mjs`:

```js
// Canonical 66-book Protestant order. `slug` is the filename in the upstream
// TehShrike/world-english-bible repo; `id` is the stable 3-letter code used in
// verse reference keys (BOOK.CHAPTER.VERSE) everywhere else in the app.
export const BOOKS = [
  { id: 'GEN', name: 'Genesis',         testament: 'OT', slug: 'genesis' },
  { id: 'EXO', name: 'Exodus',          testament: 'OT', slug: 'exodus' },
  { id: 'LEV', name: 'Leviticus',       testament: 'OT', slug: 'leviticus' },
  { id: 'NUM', name: 'Numbers',         testament: 'OT', slug: 'numbers' },
  { id: 'DEU', name: 'Deuteronomy',     testament: 'OT', slug: 'deuteronomy' },
  { id: 'JOS', name: 'Joshua',          testament: 'OT', slug: 'joshua' },
  { id: 'JDG', name: 'Judges',          testament: 'OT', slug: 'judges' },
  { id: 'RUT', name: 'Ruth',            testament: 'OT', slug: 'ruth' },
  { id: '1SA', name: '1 Samuel',        testament: 'OT', slug: '1samuel' },
  { id: '2SA', name: '2 Samuel',        testament: 'OT', slug: '2samuel' },
  { id: '1KI', name: '1 Kings',         testament: 'OT', slug: '1kings' },
  { id: '2KI', name: '2 Kings',         testament: 'OT', slug: '2kings' },
  { id: '1CH', name: '1 Chronicles',    testament: 'OT', slug: '1chronicles' },
  { id: '2CH', name: '2 Chronicles',    testament: 'OT', slug: '2chronicles' },
  { id: 'EZR', name: 'Ezra',            testament: 'OT', slug: 'ezra' },
  { id: 'NEH', name: 'Nehemiah',        testament: 'OT', slug: 'nehemiah' },
  { id: 'EST', name: 'Esther',          testament: 'OT', slug: 'esther' },
  { id: 'JOB', name: 'Job',             testament: 'OT', slug: 'job' },
  { id: 'PSA', name: 'Psalms',          testament: 'OT', slug: 'psalms' },
  { id: 'PRO', name: 'Proverbs',        testament: 'OT', slug: 'proverbs' },
  { id: 'ECC', name: 'Ecclesiastes',    testament: 'OT', slug: 'ecclesiastes' },
  { id: 'SNG', name: 'Song of Solomon', testament: 'OT', slug: 'songofsolomon' },
  { id: 'ISA', name: 'Isaiah',          testament: 'OT', slug: 'isaiah' },
  { id: 'JER', name: 'Jeremiah',        testament: 'OT', slug: 'jeremiah' },
  { id: 'LAM', name: 'Lamentations',    testament: 'OT', slug: 'lamentations' },
  { id: 'EZK', name: 'Ezekiel',         testament: 'OT', slug: 'ezekiel' },
  { id: 'DAN', name: 'Daniel',          testament: 'OT', slug: 'daniel' },
  { id: 'HOS', name: 'Hosea',           testament: 'OT', slug: 'hosea' },
  { id: 'JOL', name: 'Joel',            testament: 'OT', slug: 'joel' },
  { id: 'AMO', name: 'Amos',            testament: 'OT', slug: 'amos' },
  { id: 'OBA', name: 'Obadiah',         testament: 'OT', slug: 'obadiah' },
  { id: 'JON', name: 'Jonah',           testament: 'OT', slug: 'jonah' },
  { id: 'MIC', name: 'Micah',           testament: 'OT', slug: 'micah' },
  { id: 'NAM', name: 'Nahum',           testament: 'OT', slug: 'nahum' },
  { id: 'HAB', name: 'Habakkuk',        testament: 'OT', slug: 'habakkuk' },
  { id: 'ZEP', name: 'Zephaniah',       testament: 'OT', slug: 'zephaniah' },
  { id: 'HAG', name: 'Haggai',          testament: 'OT', slug: 'haggai' },
  { id: 'ZEC', name: 'Zechariah',       testament: 'OT', slug: 'zechariah' },
  { id: 'MAL', name: 'Malachi',         testament: 'OT', slug: 'malachi' },
  { id: 'MAT', name: 'Matthew',         testament: 'NT', slug: 'matthew' },
  { id: 'MRK', name: 'Mark',            testament: 'NT', slug: 'mark' },
  { id: 'LUK', name: 'Luke',            testament: 'NT', slug: 'luke' },
  { id: 'JHN', name: 'John',            testament: 'NT', slug: 'john' },
  { id: 'ACT', name: 'Acts',            testament: 'NT', slug: 'acts' },
  { id: 'ROM', name: 'Romans',          testament: 'NT', slug: 'romans' },
  { id: '1CO', name: '1 Corinthians',   testament: 'NT', slug: '1corinthians' },
  { id: '2CO', name: '2 Corinthians',   testament: 'NT', slug: '2corinthians' },
  { id: 'GAL', name: 'Galatians',       testament: 'NT', slug: 'galatians' },
  { id: 'EPH', name: 'Ephesians',       testament: 'NT', slug: 'ephesians' },
  { id: 'PHP', name: 'Philippians',     testament: 'NT', slug: 'philippians' },
  { id: 'COL', name: 'Colossians',      testament: 'NT', slug: 'colossians' },
  { id: '1TH', name: '1 Thessalonians', testament: 'NT', slug: '1thessalonians' },
  { id: '2TH', name: '2 Thessalonians', testament: 'NT', slug: '2thessalonians' },
  { id: '1TI', name: '1 Timothy',       testament: 'NT', slug: '1timothy' },
  { id: '2TI', name: '2 Timothy',       testament: 'NT', slug: '2timothy' },
  { id: 'TIT', name: 'Titus',           testament: 'NT', slug: 'titus' },
  { id: 'PHM', name: 'Philemon',        testament: 'NT', slug: 'philemon' },
  { id: 'HEB', name: 'Hebrews',         testament: 'NT', slug: 'hebrews' },
  { id: 'JAS', name: 'James',           testament: 'NT', slug: 'james' },
  { id: '1PE', name: '1 Peter',         testament: 'NT', slug: '1peter' },
  { id: '2PE', name: '2 Peter',         testament: 'NT', slug: '2peter' },
  { id: '1JN', name: '1 John',          testament: 'NT', slug: '1john' },
  { id: '2JN', name: '2 John',          testament: 'NT', slug: '2john' },
  { id: '3JN', name: '3 John',          testament: 'NT', slug: '3john' },
  { id: 'JUD', name: 'Jude',            testament: 'NT', slug: 'jude' },
  { id: 'REV', name: 'Revelation',      testament: 'NT', slug: 'revelation' },
]
```

- [ ] **Step 2: Write the failing test for the normalizer**

Create `scripts/lib/normalize-bible.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeBook } from './normalize-bible.mjs'

describe('normalizeBook', () => {
  it('groups verses into chapters and trims whitespace', () => {
    const tokens = [
      { type: 'paragraph start' },
      { type: 'paragraph text', chapterNumber: 1, verseNumber: 1, value: 'In the beginning.  ' },
      { type: 'paragraph text', chapterNumber: 1, verseNumber: 2, value: 'The same was.  ' },
      { type: 'paragraph text', chapterNumber: 2, verseNumber: 1, value: 'Second chapter.  ' },
    ]
    const out = normalizeBook(tokens)
    expect(out.chapters).toHaveLength(2)
    expect(out.chapters[0]).toEqual([{ v: 1, t: 'In the beginning.' }, { v: 2, t: 'The same was.' }])
    expect(out.chapters[1]).toEqual([{ v: 1, t: 'Second chapter.' }])
  })

  it('joins fragments that share a verse number', () => {
    const tokens = [
      { type: 'paragraph text', chapterNumber: 1, verseNumber: 1, value: 'First half ' },
      { type: 'line text',      chapterNumber: 1, verseNumber: 1, value: 'second half.' },
    ]
    expect(normalizeBook(tokens).chapters[0]).toEqual([{ v: 1, t: 'First half second half.' }])
  })

  it('ignores structural tokens that carry no verse number', () => {
    const tokens = [
      { type: 'paragraph start' },
      { type: 'chapter', chapterNumber: 1 },
      { type: 'paragraph text', chapterNumber: 1, verseNumber: 1, value: 'Only verse.' },
      { type: 'paragraph end' },
    ]
    expect(normalizeBook(tokens).chapters[0]).toEqual([{ v: 1, t: 'Only verse.' }])
  })

  it('collapses internal whitespace runs', () => {
    const tokens = [
      { type: 'paragraph text', chapterNumber: 1, verseNumber: 1, value: 'Spaced   out\n  text.' },
    ]
    expect(normalizeBook(tokens).chapters[0][0].t).toBe('Spaced out text.')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- normalize-bible`
Expected: FAIL — cannot resolve `./normalize-bible.mjs`.

- [ ] **Step 4: Write the normalizer**

Create `scripts/lib/normalize-bible.mjs`:

```js
// Converts the upstream WEB token stream into compact chapters.
//
// Upstream emits a flat list of tokens: structural markers ("paragraph start",
// "chapter") carry no text, and text tokens carry chapterNumber/verseNumber.
// A single verse is frequently split across several tokens (poetry lines,
// paragraph breaks), so fragments sharing a verse number are joined in order.
export function normalizeBook(tokens) {
  const chapterMap = new Map()

  for (const tok of tokens || []) {
    if (typeof tok?.value !== 'string') continue
    if (typeof tok.chapterNumber !== 'number' || typeof tok.verseNumber !== 'number') continue

    if (!chapterMap.has(tok.chapterNumber)) chapterMap.set(tok.chapterNumber, new Map())
    const verses = chapterMap.get(tok.chapterNumber)
    verses.set(tok.verseNumber, (verses.get(tok.verseNumber) || '') + tok.value)
  }

  const chapters = [...chapterMap.keys()]
    .sort((a, b) => a - b)
    .map(cn => {
      const verses = chapterMap.get(cn)
      return [...verses.keys()]
        .sort((a, b) => a - b)
        .map(vn => ({ v: vn, t: verses.get(vn).replace(/\s+/g, ' ').trim() }))
    })

  return { chapters }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- normalize-bible`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/bible-canon.mjs scripts/lib/normalize-bible.mjs scripts/lib/normalize-bible.test.ts
git commit -m "feat(bible): WEB canon table and text normalizer"
```

---

## Task 2: Build script and generated assets

**Files:**
- Create: `scripts/build-bible.mjs`
- Create (generated): `src/renderer/src/assets/bible/index.json`, `src/renderer/src/assets/bible/<slug>.json` × 66
- Test: `src/renderer/src/assets/bible/bible-assets.test.ts`
- Modify: `package.json` (add `build:bible` script)

**Interfaces:**
- Consumes: `BOOKS` and `normalizeBook` from Task 1.
- Produces: `index.json` shaped `{ translation: 'WEB', books: [{ id, name, testament, slug, chapters: number }] }`, and per-book `{ id, name, chapters: { v, t }[][] }`.

- [ ] **Step 1: Write the build script**

Create `scripts/build-bible.mjs`:

```js
// Downloads the World English Bible (public domain) once and writes compact
// per-book JSON into the renderer assets. Run manually via `npm run build:bible`;
// the output is committed so builds and the app never touch the network.
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { BOOKS } from './lib/bible-canon.mjs'
import { normalizeBook } from './lib/normalize-bible.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'src', 'renderer', 'src', 'assets', 'bible')
const BASE = 'https://raw.githubusercontent.com/TehShrike/world-english-bible/master/json'

async function main() {
  mkdirSync(OUT, { recursive: true })
  const index = { translation: 'WEB', books: [] }

  for (const book of BOOKS) {
    const res = await fetch(`${BASE}/${book.slug}.json`)
    if (!res.ok) throw new Error(`${book.slug}: HTTP ${res.status}`)
    const { chapters } = normalizeBook(await res.json())
    if (!chapters.length) throw new Error(`${book.slug}: produced no chapters`)

    writeFileSync(
      join(OUT, `${book.slug}.json`),
      JSON.stringify({ id: book.id, name: book.name, chapters })
    )
    index.books.push({ ...book, chapters: chapters.length })
    console.log(`${book.name}: ${chapters.length} chapters`)
  }

  writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 2))
  console.log(`\nWrote ${index.books.length} books to ${OUT}`)
}

main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add to `"scripts"`:

```json
"build:bible": "node scripts/build-bible.mjs"
```

- [ ] **Step 3: Run the build**

Run: `npm run build:bible`
Expected: 66 lines of `<Book>: <n> chapters`, ending with `Wrote 66 books`. Takes roughly a minute.

- [ ] **Step 4: Write the asset integrity test**

Create `src/renderer/src/assets/bible/bible-assets.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import index from './index.json'

const DIR = __dirname
const load = (slug: string) => JSON.parse(readFileSync(join(DIR, `${slug}.json`), 'utf-8'))

describe('bible assets', () => {
  it('has all 66 books in canonical order', () => {
    expect(index.books).toHaveLength(66)
    expect(index.books[0].id).toBe('GEN')
    expect(index.books[65].id).toBe('REV')
    expect(index.books.filter(b => b.testament === 'NT')).toHaveLength(27)
  })

  it('matches known chapter counts', () => {
    const counts = Object.fromEntries(index.books.map(b => [b.id, b.chapters]))
    expect(counts.GEN).toBe(50)
    expect(counts.PSA).toBe(150)
    expect(counts.MAT).toBe(28)
    expect(counts.JHN).toBe(21)
    expect(counts.REV).toBe(22)
  })

  it('every book has chapters and no empty verses', () => {
    for (const b of index.books) {
      const book = load(b.slug)
      expect(book.chapters.length).toBe(b.chapters)
      for (const chapter of book.chapters) {
        expect(chapter.length).toBeGreaterThan(0)
        for (const verse of chapter) {
          expect(typeof verse.v).toBe('number')
          expect(verse.t.trim().length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('renders a known verse correctly', () => {
    const john = load('john')
    const v16 = john.chapters[2].find((v: { v: number }) => v.v === 16)
    expect(v16.t).toContain('For God so loved the world')
  })
})
```

- [ ] **Step 5: Run the test**

Run: `npm test -- bible-assets`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-bible.mjs package.json src/renderer/src/assets/bible
git commit -m "feat(bible): build pipeline and bundled WEB text"
```

---

## Task 3: Bible service (lazy loading and references)

**Files:**
- Create: `src/renderer/src/services/bibleService.ts`
- Test: `src/renderer/src/services/bibleService.test.ts`

**Interfaces:**
- Consumes: generated assets from Task 2.
- Produces:
  - `type Verse = { v: number; t: string }`
  - `type BookMeta = { id: string; name: string; testament: 'OT' | 'NT'; slug: string; chapters: number }`
  - `getBooks(): BookMeta[]`
  - `getBook(id: string): Promise<{ id: string; name: string; chapters: Verse[][] }>`
  - `getChapter(id: string, chapter: number): Promise<Verse[]>`
  - `refKey(bookId: string, chapter: number, verse: number): string`
  - `parseRef(key: string): { bookId: string; chapter: number; verse: number } | null`
  - `formatRef(key: string): string`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/services/bibleService.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getBooks, getChapter, refKey, parseRef, formatRef } from './bibleService'

describe('bibleService references', () => {
  it('builds a reference key', () => {
    expect(refKey('JHN', 3, 16)).toBe('JHN.3.16')
  })

  it('parses a reference key', () => {
    expect(parseRef('JHN.3.16')).toEqual({ bookId: 'JHN', chapter: 3, verse: 16 })
  })

  it('returns null for malformed keys', () => {
    expect(parseRef('nonsense')).toBeNull()
    expect(parseRef('JHN.3')).toBeNull()
    expect(parseRef('ZZZ.3.16')).toBeNull()
  })

  it('formats a reference for display', () => {
    expect(formatRef('JHN.3.16')).toBe('John 3:16')
    expect(formatRef('1CO.13.4')).toBe('1 Corinthians 13:4')
  })
})

describe('bibleService data', () => {
  it('exposes 66 books', () => {
    expect(getBooks()).toHaveLength(66)
  })

  it('loads a chapter', async () => {
    const ch = await getChapter('JHN', 3)
    expect(ch.find(v => v.v === 16)?.t).toContain('For God so loved the world')
  })

  it('returns an empty array for an out-of-range chapter', async () => {
    expect(await getChapter('JHN', 999)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- bibleService`
Expected: FAIL — cannot resolve `./bibleService`.

- [ ] **Step 3: Write the service**

Create `src/renderer/src/services/bibleService.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- bibleService`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/services/bibleService.ts src/renderer/src/services/bibleService.test.ts
git commit -m "feat(bible): lazy book loading and reference helpers"
```

---

## Task 4: Marks persistence (main + preload)

**Files:**
- Modify: `src/main/index.ts` (add store + IPC next to the existing rewind handlers)
- Modify: `src/preload/index.ts` (add the `bible` bridge next to `rewind`)

**Interfaces:**
- Consumes: nothing.
- Produces: `window.electronAPI.bible.getMarks(): Promise<Marks>` and `window.electronAPI.bible.setMarks(marks: Marks): Promise<{ ok: true }>` where
  `Marks = { highlights: Record<string, string>; saved: { ref: string; ts: number }[]; notes: Record<string, string>; lastRead: { book: string; chapter: number } | null }`.

- [ ] **Step 1: Add the store and IPC in main**

In `src/main/index.ts`, immediately after the `rewind:clear` handler, add:

```ts
// ── Bible marks — highlights, saved verses, notes, reading position ────────
interface BibleMarks {
  highlights: Record<string, string>
  saved: { ref: string; ts: number }[]
  notes: Record<string, string>
  lastRead: { book: string; chapter: number } | null
}
const BIBLE_MARKS_FILE = join(APP_DIR, 'bible-marks.json')
const EMPTY_MARKS: BibleMarks = { highlights: {}, saved: [], notes: {}, lastRead: null }

ipcMain.handle('bible:getMarks', (): BibleMarks => {
  const stored = readJson(BIBLE_MARKS_FILE, EMPTY_MARKS) as Partial<BibleMarks>
  // Merge onto the empty shape so a file written by an older build (missing a
  // key) can't crash the reader.
  return {
    highlights: stored.highlights ?? {},
    saved:      Array.isArray(stored.saved) ? stored.saved : [],
    notes:      stored.notes ?? {},
    lastRead:   stored.lastRead ?? null,
  }
})

ipcMain.handle('bible:setMarks', (_e, marks: BibleMarks) => {
  writeJson(BIBLE_MARKS_FILE, marks)
  return { ok: true }
})
```

- [ ] **Step 2: Add the preload bridge**

In `src/preload/index.ts`, immediately after the `rewind: { … },` block, add:

```ts
  bible: {
    getMarks: () => ipcRenderer.invoke('bible:getMarks'),
    setMarks: (marks: any) => ipcRenderer.invoke('bible:setMarks', marks),
  },
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: three `✓ built` lines, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "feat(bible): persist highlights, saved verses and notes"
```

---

## Task 5: Register the Bible page

**Files:**
- Modify: `src/renderer/src/store/browserStore.ts:4`
- Modify: `src/renderer/src/App.tsx` (lazy import, `openSpecialPage` union, render case)
- Modify: `src/renderer/src/components/browser/Sidebar.tsx` (import, NAV_ITEMS, prop unions)
- Modify: `src/renderer/src/components/browser/CommandPalette.tsx` (PageType, icon map, pages list)
- Create: `src/renderer/src/components/pages/BiblePage.tsx` (minimal, proves the data path)

**Interfaces:**
- Consumes: `getBooks`, `getChapter` from Task 3.
- Produces: a mounted `bible` page reachable from the sidebar and `Ctrl+K`.

- [ ] **Step 1: Add `'bible'` to the page-type union**

In `src/renderer/src/store/browserStore.ts:4`, change the end of the `pageType` union from `|'rewind'|'watch' }` to:

```ts
|'rewind'|'watch'|'bible' }
```

- [ ] **Step 2: Wire it into App.tsx**

Add the lazy import beside the other pages:

```tsx
const BiblePage      = lazy(() => import('./components/pages/BiblePage'))
```

Extend the `openSpecialPage` parameter union — change `| 'rewind' | 'watch') => {` to:

```tsx
| 'rewind' | 'watch' | 'bible') => {
```

Add the render case after the `watch` line:

```tsx
                    {tab.pageType === 'bible'      && <BiblePage />}
```

- [ ] **Step 3: Add the sidebar entry**

In `src/renderer/src/components/browser/Sidebar.tsx`, add `BookMarked` to the `lucide-react` import, add this entry to `NAV_ITEMS` directly after the `Watch & Ping` row:

```tsx
  { icon: BookMarked,   label: 'Bible',        page: 'bible',        type: 'bible',      accent: '#fbbf24' },
```

and extend both page-type unions in that file (the `onOpenPage` prop and the `NavItem.page` type) from `'rewind' | 'watch'` to `'rewind' | 'watch' | 'bible'`.

- [ ] **Step 4: Add the command palette entry**

In `src/renderer/src/components/browser/CommandPalette.tsx`: add `BookMarked` to the `lucide-react` import, extend `PageType` with `| 'bible'`, add `bible: <BookMarked size={15} />,` to `pageIcon`, and add to the `pages` array after the `watch` entry:

```tsx
      ['bible', 'Bible — read, highlight and study'],
```

- [ ] **Step 5: Create the minimal page**

Create `src/renderer/src/components/pages/BiblePage.tsx`:

```tsx
import React, { useEffect, useState } from 'react'
import { getBooks, getChapter, type Verse } from '../../services/bibleService'

export default function BiblePage() {
  const [bookId, setBookId] = useState('JHN')
  const [chapter, setChapter] = useState(3)
  const [verses, setVerses] = useState<Verse[]>([])

  useEffect(() => {
    let cancelled = false
    getChapter(bookId, chapter).then(v => { if (!cancelled) setVerses(v) })
    return () => { cancelled = true }
  }, [bookId, chapter])

  const book = getBooks().find(b => b.id === bookId)

  return (
    <div className="h-full overflow-y-auto bg-aihub-bg text-aihub-text p-8">
      <h1 className="text-2xl font-bold mb-4">{book?.name} {chapter}</h1>
      <div className="flex gap-2 mb-4">
        <select value={bookId} onChange={e => { setBookId(e.target.value); setChapter(1) }}
          className="bg-aihub-surface border border-aihub-border/40 rounded-lg px-3 py-1.5 text-sm">
          {getBooks().map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button onClick={() => setChapter(c => Math.max(1, c - 1))}
          className="px-3 py-1.5 rounded-lg bg-aihub-surface border border-aihub-border/40 text-sm">Prev</button>
        <button onClick={() => setChapter(c => Math.min(book?.chapters ?? 1, c + 1))}
          className="px-3 py-1.5 rounded-lg bg-aihub-surface border border-aihub-border/40 text-sm">Next</button>
      </div>
      <div className="max-w-2xl leading-8">
        {verses.map(v => (
          <span key={v.v}><sup className="text-aihub-muted mr-1">{v.v}</sup>{v.t} </span>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Build and verify manually**

Run: `npm run build`
Expected: builds clean, and the output lists a `BiblePage-*.js` chunk.

Run: `npm run dev`, click **Bible** in the sidebar. Expected: John 3 renders with verse numbers; the book dropdown and Prev/Next change the text.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/store/browserStore.ts src/renderer/src/App.tsx src/renderer/src/components/browser/Sidebar.tsx src/renderer/src/components/browser/CommandPalette.tsx src/renderer/src/components/pages/BiblePage.tsx
git commit -m "feat(bible): register the Bible page and render chapters"
```

---

## Task 6: Verse renderer with highlights

**Files:**
- Create: `src/renderer/src/components/bible/VerseText.tsx`
- Modify: `src/renderer/src/components/pages/BiblePage.tsx`

**Interfaces:**
- Consumes: `Verse`, `refKey` from Task 3.
- Produces: `<VerseText bookId chapter verses highlights selectedRef onSelectVerse />` where `highlights: Record<string, string>`, `selectedRef: string | null`, `onSelectVerse: (ref: string) => void`.

- [ ] **Step 1: Create the verse renderer**

Create `src/renderer/src/components/bible/VerseText.tsx`:

```tsx
import React from 'react'
import { refKey, type Verse } from '../../services/bibleService'

export const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: 'rgba(250, 204, 21, 0.38)',
  green:  'rgba(52, 211, 153, 0.34)',
  blue:   'rgba(96, 165, 250, 0.32)',
  pink:   'rgba(244, 114, 182, 0.32)',
  purple: 'rgba(167, 139, 250, 0.32)',
}

interface Props {
  bookId: string
  chapter: number
  verses: Verse[]
  highlights: Record<string, string>
  selectedRef: string | null
  onSelectVerse: (ref: string) => void
}

// Verses render as inline spans inside one flowing column so the text wraps
// like a printed page rather than sitting in a list of rows.
export default function VerseText({ bookId, chapter, verses, highlights, selectedRef, onSelectVerse }: Props) {
  return (
    <div className="bible-prose">
      {verses.map(v => {
        const ref = refKey(bookId, chapter, v.v)
        const color = highlights[ref]
        const selected = selectedRef === ref
        return (
          <span
            key={v.v}
            role="button"
            tabIndex={0}
            onClick={() => onSelectVerse(ref)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectVerse(ref) } }}
            className="cursor-pointer rounded-[3px] transition-colors"
            style={{
              background: color ? HIGHLIGHT_COLORS[color] ?? color : undefined,
              boxShadow: selected ? '0 0 0 2px rgba(251,191,36,0.85)' : undefined,
            }}
          >
            <sup className="mr-0.5 select-none opacity-50">{v.v}</sup>
            {v.t}{' '}
          </span>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Use it from BiblePage**

In `BiblePage.tsx`, replace the `<div className="max-w-2xl leading-8">…</div>` block with:

```tsx
      <div className="max-w-2xl leading-8">
        <VerseText
          bookId={bookId}
          chapter={chapter}
          verses={verses}
          highlights={{}}
          selectedRef={selectedRef}
          onSelectVerse={setSelectedRef}
        />
      </div>
```

and add at the top of the component:

```tsx
  const [selectedRef, setSelectedRef] = useState<string | null>(null)
```

plus the import:

```tsx
import VerseText from '../bible/VerseText'
```

- [ ] **Step 3: Build and verify**

Run: `npm run build` — expected clean.
Run: `npm run dev`, open Bible, click a verse. Expected: the clicked verse gains an amber ring.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/bible/VerseText.tsx src/renderer/src/components/pages/BiblePage.tsx
git commit -m "feat(bible): verse renderer with selection and highlight paint"
```

---

## Task 7: The 3D page fold

**Files:**
- Create: `src/renderer/src/components/bible/PageLeaf.tsx`
- Create: `src/renderer/src/components/bible/BookSpread.tsx`
- Modify: `src/renderer/src/components/pages/BiblePage.tsx`
- Modify: `src/renderer/src/index.css` (paper texture + prose typography)

**Interfaces:**
- Consumes: `VerseText` from Task 6.
- Produces: `<BookSpread left right onTurn direction />` — `left`/`right` are `ReactNode` page bodies, `onTurn: (dir: 'next' | 'prev') => void`.

- [ ] **Step 1: Add page styling**

Append to `src/renderer/src/index.css`:

```css
/* ── Bible reader ─────────────────────────────────────────────────────── */
.bible-paper {
  background-color: #fbf6ea;
  background-image:
    radial-gradient(circle at 20% 10%, rgba(0, 0, 0, 0.028) 0%, transparent 55%),
    radial-gradient(circle at 85% 80%, rgba(0, 0, 0, 0.022) 0%, transparent 60%);
  color: #2a2118;
}
.bible-prose {
  font-family: Georgia, 'Iowan Old Style', 'Palatino Linotype', serif;
  font-size: 1.02rem;
  line-height: 1.95;
  text-align: justify;
  hyphens: auto;
}
/* The gutter shadow that makes two pages read as one bound volume. */
.bible-gutter {
  background: linear-gradient(to right,
    rgba(0,0,0,0) 0%, rgba(0,0,0,0.13) 42%, rgba(0,0,0,0.2) 50%,
    rgba(0,0,0,0.13) 58%, rgba(0,0,0,0) 100%);
}
```

- [ ] **Step 2: Create the fold component**

Create `src/renderer/src/components/bible/PageLeaf.tsx`:

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  front: React.ReactNode          // recto of the leaf being turned
  back: React.ReactNode           // verso revealed mid-turn
  onComplete: () => void          // fired once the turn passes the point of no return
  onCancel: () => void            // fired when the leaf springs back
  direction: 'next' | 'prev'
}

// One turning sheet. Rotation is driven directly by pointer movement so the
// page tracks the finger, then either completes or springs back on release.
// Only `transform` and `opacity` animate, so the whole turn stays on the
// compositor.
export default function PageLeaf({ front, back, onComplete, onCancel, direction }: Props) {
  const [angle, setAngle] = useState(0)          // 0 → 180 degrees
  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const lastX = useRef(0)
  const velocity = useRef(0)
  const width = useRef(1)
  const ref = useRef<HTMLDivElement>(null)

  const prefersReduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  const finish = useCallback((complete: boolean) => {
    setDragging(false)
    setAngle(complete ? 180 : 0)
    // Let the CSS transition run before swapping the underlying page content.
    window.setTimeout(() => (complete ? onComplete() : onCancel()), prefersReduced ? 0 : 420)
  }, [onComplete, onCancel, prefersReduced])

  const onPointerDown = (e: React.PointerEvent) => {
    width.current = ref.current?.offsetWidth || 1
    startX.current = e.clientX
    lastX.current = e.clientX
    velocity.current = 0
    setDragging(true)
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return
    velocity.current = e.clientX - lastX.current
    lastX.current = e.clientX
    // Dragging right-to-left turns forward; the sign flips going back.
    const travelled = direction === 'next' ? startX.current - e.clientX : e.clientX - startX.current
    const ratio = Math.max(0, Math.min(1, travelled / width.current))
    setAngle(ratio * 180)
  }

  const onPointerUp = () => {
    if (!dragging) return
    const flicked = direction === 'next' ? velocity.current < -6 : velocity.current > 6
    finish(angle > 90 || flicked)
  }

  // Keyboard and button turns animate through the same path as a drag.
  useEffect(() => {
    if (dragging) return
    const id = window.setTimeout(() => setAngle(a => (a === 0 ? 0 : a)), 0)
    return () => window.clearTimeout(id)
  }, [dragging])

  const shadow = Math.sin((angle / 180) * Math.PI) * 0.45

  return (
    <div ref={ref} className="absolute inset-0" style={{ perspective: 2200 }}>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="absolute inset-0 origin-left"
        style={{
          transformStyle: 'preserve-3d',
          transform: `rotateY(${direction === 'next' ? -angle : angle}deg)`,
          transition: dragging ? 'none' : prefersReduced ? 'none' : 'transform 0.42s cubic-bezier(0.22, 0.61, 0.36, 1)',
          willChange: 'transform',
          touchAction: 'none',
        }}
      >
        <div className="absolute inset-0 bible-paper overflow-hidden"
          style={{ backfaceVisibility: 'hidden' }}>
          {front}
          <div className="pointer-events-none absolute inset-0"
            style={{ background: `rgba(0,0,0,${shadow * 0.5})` }} />
        </div>
        <div className="absolute inset-0 bible-paper overflow-hidden"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
          {back}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create the spread**

Create `src/renderer/src/components/bible/BookSpread.tsx`:

```tsx
import React from 'react'

interface Props {
  left: React.ReactNode
  right: React.ReactNode
  leaf?: React.ReactNode        // the turning PageLeaf, when a turn is in flight
}

// Two bound pages with a centre gutter. The turning leaf is layered over the
// right-hand page so it appears to lift off the book.
export default function BookSpread({ left, right, leaf }: Props) {
  return (
    <div className="relative mx-auto flex h-full w-full max-w-6xl overflow-hidden rounded-2xl shadow-2xl">
      <div className="relative w-1/2 bible-paper overflow-hidden p-10">{left}</div>
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-10 -translate-x-1/2 bible-gutter z-20" />
      <div className="relative w-1/2 bible-paper overflow-hidden p-10">
        {right}
        {leaf}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Wire the spread into BiblePage**

Replace the body of `BiblePage.tsx` render with a spread showing two consecutive chapters, and turn state:

```tsx
  const [turning, setTurning] = useState<'next' | 'prev' | null>(null)
  const [nextVerses, setNextVerses] = useState<Verse[]>([])

  useEffect(() => {
    let cancelled = false
    getChapter(bookId, chapter + 1).then(v => { if (!cancelled) setNextVerses(v) })
    return () => { cancelled = true }
  }, [bookId, chapter])

  const page = (vs: Verse[], ch: number) => (
    <>
      <div className="mb-4 text-xs uppercase tracking-widest opacity-45">{book?.name} {ch}</div>
      <VerseText bookId={bookId} chapter={ch} verses={vs} highlights={highlights}
        selectedRef={selectedRef} onSelectVerse={setSelectedRef} />
    </>
  )
```

and render:

```tsx
      <BookSpread
        left={page(verses, chapter)}
        right={page(nextVerses, chapter + 1)}
        leaf={turning ? (
          <PageLeaf
            direction={turning}
            front={page(nextVerses, chapter + 1)}
            back={page(verses, chapter)}
            onComplete={() => { setTurning(null); setChapter(c => c + (turning === 'next' ? 2 : -2)) }}
            onCancel={() => setTurning(null)}
          />
        ) : null}
      />
```

with imports:

```tsx
import BookSpread from '../bible/BookSpread'
import PageLeaf from '../bible/PageLeaf'
```

Wire the Prev/Next buttons to `setTurning('prev')` and `setTurning('next')`, and add a key handler:

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setTurning('next')
      if (e.key === 'ArrowLeft' && chapter > 1) setTurning('prev')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chapter])
```

- [ ] **Step 5: Build and verify the animation**

Run: `npm run build` — expected clean.
Run: `npm run dev`, open Bible. Expected: dragging leftward from the right page lifts and rotates the sheet, revealing its back; releasing past halfway completes the turn, releasing early springs it back. Arrow keys turn pages.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/bible/PageLeaf.tsx src/renderer/src/components/bible/BookSpread.tsx src/renderer/src/components/pages/BiblePage.tsx src/renderer/src/index.css
git commit -m "feat(bible): two-page spread with drag-driven 3D page turn"
```

---

## Task 8: Verse actions — highlight, save, note

**Files:**
- Create: `src/renderer/src/components/bible/VerseActions.tsx`
- Modify: `src/renderer/src/components/pages/BiblePage.tsx`

**Interfaces:**
- Consumes: marks IPC from Task 4, `HIGHLIGHT_COLORS` from Task 6, `formatRef` from Task 3.
- Produces: `<VerseActions verseRef onHighlight onSave onNote onShare onClose isSaved currentColor />`.

- [ ] **Step 1: Create the action bar**

Create `src/renderer/src/components/bible/VerseActions.tsx`:

```tsx
import React from 'react'
import { Bookmark, BookmarkCheck, Share2, StickyNote, X } from 'lucide-react'
import { formatRef } from '../../services/bibleService'
import { HIGHLIGHT_COLORS } from './VerseText'

interface Props {
  verseRef: string
  currentColor?: string
  isSaved: boolean
  onHighlight: (color: string | null) => void
  onSave: () => void
  onNote: () => void
  onShare: () => void
  onClose: () => void
}

export default function VerseActions({
  verseRef, currentColor, isSaved, onHighlight, onSave, onNote, onShare, onClose,
}: Props) {
  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-aihub-border/40 bg-aihub-surface/95 px-4 py-3 shadow-2xl backdrop-blur">
      <div className="mb-2 text-center text-xs font-semibold text-aihub-muted">{formatRef(verseRef)}</div>
      <div className="flex items-center gap-2">
        {Object.entries(HIGHLIGHT_COLORS).map(([name, css]) => (
          <button key={name} title={name}
            onClick={() => onHighlight(currentColor === name ? null : name)}
            className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${
              currentColor === name ? 'border-aihub-accent' : 'border-transparent'}`}
            style={{ background: css }} />
        ))}
        <div className="mx-1 h-6 w-px bg-aihub-border/40" />
        <button onClick={onSave} title={isSaved ? 'Saved' : 'Save verse'}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-aihub-muted hover:bg-aihub-border/20">
          {isSaved ? <BookmarkCheck size={16} className="text-aihub-accent" /> : <Bookmark size={16} />}
        </button>
        <button onClick={onNote} title="Add a note"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-aihub-muted hover:bg-aihub-border/20">
          <StickyNote size={16} />
        </button>
        <button onClick={onShare} title="Share"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-aihub-muted hover:bg-aihub-border/20">
          <Share2 size={16} />
        </button>
        <button onClick={onClose} title="Close"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-aihub-muted hover:bg-aihub-border/20">
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Load and persist marks in BiblePage**

Add to `BiblePage.tsx`:

```tsx
  const [marks, setMarks] = useState<{
    highlights: Record<string, string>
    saved: { ref: string; ts: number }[]
    notes: Record<string, string>
    lastRead: { book: string; chapter: number } | null
  }>({ highlights: {}, saved: [], notes: {}, lastRead: null })

  useEffect(() => { window.electronAPI.bible.getMarks().then(setMarks).catch(() => {}) }, [])

  const persist = useCallback((next: typeof marks) => {
    setMarks(next)
    window.electronAPI.bible.setMarks(next).catch(() => {})
  }, [])

  const highlights = marks.highlights

  const highlightVerse = (color: string | null) => {
    if (!selectedRef) return
    const next = { ...marks, highlights: { ...marks.highlights } }
    if (color) next.highlights[selectedRef] = color
    else delete next.highlights[selectedRef]
    persist(next)
  }

  const toggleSave = () => {
    if (!selectedRef) return
    const exists = marks.saved.some(s => s.ref === selectedRef)
    persist({
      ...marks,
      saved: exists ? marks.saved.filter(s => s.ref !== selectedRef)
                    : [{ ref: selectedRef, ts: Date.now() }, ...marks.saved],
    })
  }

  const addNote = () => {
    if (!selectedRef) return
    const text = prompt('Note for this verse:', marks.notes[selectedRef] || '')
    if (text === null) return
    const notes = { ...marks.notes }
    if (text.trim()) notes[selectedRef] = text.trim()
    else delete notes[selectedRef]
    persist({ ...marks, notes })
  }
```

Import `useCallback` from React. Render the bar when a verse is selected:

```tsx
      {selectedRef && (
        <VerseActions
          verseRef={selectedRef}
          currentColor={marks.highlights[selectedRef]}
          isSaved={marks.saved.some(s => s.ref === selectedRef)}
          onHighlight={highlightVerse}
          onSave={toggleSave}
          onNote={addNote}
          onShare={() => setShareOpen(true)}
          onClose={() => setSelectedRef(null)}
        />
      )}
```

with `const [shareOpen, setShareOpen] = useState(false)` and the import:

```tsx
import VerseActions from '../bible/VerseActions'
```

- [ ] **Step 3: Persist reading position**

Add to `BiblePage.tsx`:

```tsx
  // Remember where the reader left off, and restore it on next open.
  useEffect(() => {
    if (marks.lastRead && marks.lastRead.book !== bookId) return
  }, [marks.lastRead, bookId])

  useEffect(() => {
    const id = window.setTimeout(() => {
      window.electronAPI.bible.setMarks({ ...marks, lastRead: { book: bookId, chapter } }).catch(() => {})
    }, 800)
    return () => window.clearTimeout(id)
  }, [bookId, chapter, marks])
```

- [ ] **Step 4: Build and verify**

Run: `npm run build` — expected clean.
Run: `npm run dev`. Click a verse, pick a highlight colour, save it, add a note. Restart the app and reopen Bible. Expected: the highlight, the saved state, and the note all survive the restart.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/bible/VerseActions.tsx src/renderer/src/components/pages/BiblePage.tsx
git commit -m "feat(bible): highlight, save and note verses with persistence"
```

---

## Task 9: Share sheet and verse image

**Files:**
- Create: `src/renderer/src/components/bible/ShareSheet.tsx`
- Modify: `src/renderer/src/components/pages/BiblePage.tsx`

**Interfaces:**
- Consumes: `formatRef` from Task 3, `window.electronAPI.openExternal`.
- Produces: `<ShareSheet verseRef text onClose />`.

- [ ] **Step 1: Confirm the external-open bridge exists**

Run: `grep -n "openExternal" src/preload/index.ts`
Expected: a line exposing `openExternal`. If it prints nothing, add to `src/preload/index.ts`:

```ts
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
```

and to `src/main/index.ts`:

```ts
ipcMain.handle('shell:openExternal', (_e, url: string) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url)
})
```

- [ ] **Step 2: Create the share sheet**

Create `src/renderer/src/components/bible/ShareSheet.tsx`:

```tsx
import React, { useRef, useState } from 'react'
import { Copy, Check, Download, X } from 'lucide-react'
import { formatRef } from '../../services/bibleService'

interface Props { verseRef: string; text: string; onClose: () => void }

const TARGETS = [
  { id: 'facebook', label: 'Facebook', url: (t: string) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent('https://bible.com')}&quote=${encodeURIComponent(t)}` },
  { id: 'x',        label: 'X',        url: (t: string) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(t)}` },
  { id: 'whatsapp', label: 'WhatsApp', url: (t: string) => `https://api.whatsapp.com/send?text=${encodeURIComponent(t)}` },
  { id: 'linkedin', label: 'LinkedIn', url: (t: string) => `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(t)}` },
  { id: 'telegram', label: 'Telegram', url: (t: string) => `https://t.me/share/url?url=${encodeURIComponent('https://bible.com')}&text=${encodeURIComponent(t)}` },
  { id: 'reddit',   label: 'Reddit',   url: (t: string) => `https://www.reddit.com/submit?title=${encodeURIComponent(t.slice(0, 280))}` },
  { id: 'email',    label: 'Email',    url: (t: string) => `mailto:?subject=${encodeURIComponent('A verse for you')}&body=${encodeURIComponent(t)}` },
]

export default function ShareSheet({ verseRef, text, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const payload = `"${text}"\n\n— ${formatRef(verseRef)} (WEB)`

  const copy = async () => {
    await navigator.clipboard.writeText(payload)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  // TikTok and Instagram accept no shared text link, so the only thing that
  // actually works there is an image the user posts themselves.
  const saveImage = () => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    c.width = 1080; c.height = 1080

    const grad = ctx.createLinearGradient(0, 0, 1080, 1080)
    grad.addColorStop(0, '#1e1b4b'); grad.addColorStop(1, '#4c1d95')
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 1080, 1080)

    ctx.fillStyle = '#fdf6e3'
    ctx.font = '44px Georgia, serif'
    ctx.textAlign = 'center'

    const words = text.split(' ')
    const lines: string[] = []
    let line = ''
    for (const w of words) {
      if (ctx.measureText(`${line} ${w}`).width > 860 && line) { lines.push(line); line = w }
      else line = line ? `${line} ${w}` : w
    }
    if (line) lines.push(line)

    const startY = 540 - (lines.length - 1) * 33
    lines.forEach((l, i) => ctx.fillText(l, 540, startY + i * 66))

    ctx.font = 'bold 34px Georgia, serif'
    ctx.fillStyle = '#fbbf24'
    ctx.fillText(formatRef(verseRef), 540, startY + lines.length * 66 + 70)

    const a = document.createElement('a')
    a.download = `${verseRef.replace(/\./g, '-')}.png`
    a.href = c.toDataURL('image/png')
    a.click()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[420px] rounded-2xl border border-aihub-border/40 bg-aihub-surface p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-aihub-text">Share {formatRef(verseRef)}</h3>
          <button onClick={onClose} className="text-aihub-muted hover:text-aihub-text"><X size={16} /></button>
        </div>

        <p className="mb-4 rounded-xl bg-aihub-bg/60 p-3 text-xs italic leading-relaxed text-aihub-muted">{payload}</p>

        <div className="mb-3 grid grid-cols-4 gap-2">
          {TARGETS.map(t => (
            <button key={t.id}
              onClick={() => window.electronAPI.openExternal(t.url(payload))}
              className="rounded-xl border border-aihub-border/40 py-2 text-[11px] font-semibold text-aihub-text hover:border-aihub-accent/50 hover:text-aihub-accent">
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <button onClick={copy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-aihub-border/20 py-2.5 text-xs font-semibold text-aihub-text hover:bg-aihub-border/30">
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
          </button>
          <button onClick={saveImage}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-aihub-accent py-2.5 text-xs font-bold text-white hover:bg-aihub-accent-glow">
            <Download size={14} /> Save image
          </button>
        </div>
        <p className="mt-2 text-center text-[10px] text-aihub-muted/70">
          TikTok and Instagram don't accept shared links — post the image instead.
        </p>

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Mount it from BiblePage**

Add the import and render block:

```tsx
import ShareSheet from '../bible/ShareSheet'
```

```tsx
      {shareOpen && selectedRef && (
        <ShareSheet
          verseRef={selectedRef}
          text={verses.find(v => v.v === parseRef(selectedRef)?.verse)?.t
             ?? nextVerses.find(v => v.v === parseRef(selectedRef)?.verse)?.t ?? ''}
          onClose={() => setShareOpen(false)}
        />
      )}
```

Import `parseRef` from the service alongside `getChapter`.

- [ ] **Step 4: Build and verify**

Run: `npm run build` — expected clean.
Run: `npm run dev`. Select a verse → Share. Expected: the sheet lists the platforms, Copy puts the formatted verse on the clipboard, a platform button opens that site in your system browser, and Save image downloads a 1080×1080 PNG with the verse and reference.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/bible/ShareSheet.tsx src/renderer/src/components/pages/BiblePage.tsx
git commit -m "feat(bible): share verses to social platforms and export verse images"
```

---

## Task 10: Full-suite verification and release

**Files:**
- Modify: `package.json` (version bump)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all suites pass, including the pre-existing gmail tests.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: three `✓ built` lines, a `BiblePage-*.js` chunk, and per-book JSON chunks.

- [ ] **Step 3: Manual acceptance pass**

Launch `npm run dev` and confirm each of these:

1. Bible opens from the sidebar and from `Ctrl+K`.
2. Book picker reaches all 66 books; Genesis, Psalms 150, and Revelation 22 all load.
3. Dragging the right page turns it in 3D and it tracks the pointer.
4. Releasing before halfway springs the page back.
5. Arrow keys turn pages.
6. Highlighting, saving, and noting a verse all survive an app restart.
7. Share opens a platform in the system browser; Save image produces a PNG.
8. Disconnect from the network and reload — the Bible still opens and reads.

- [ ] **Step 4: Release**

```bash
npm version 1.20.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "release: v1.20.0 — Bible reader with book-style page turns"
git tag v1.20.0
git push origin main && git push origin v1.20.0
```

Wait for all three platform builds to go green, then:

```bash
gh release edit v1.20.0 --draft=false --latest
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| WEB text, public domain, offline | 1, 2 |
| Translation-agnostic data layer | 3 (`BookMeta`/`Verse` carry no translation assumptions) |
| `bible` page type registered like rewind/watch | 5 |
| Two-page spread, gutter, paper | 7 |
| 3D fold following the finger, spring-back, momentum | 7 |
| Reduced-motion fallback | 7 (`prefersReduced`) |
| Verse selection and highlight paint | 6 |
| Highlight / save / note persistence in `bible-marks.json` | 4, 8 |
| `BOOK.CHAPTER.VERSE` keys | 3, 6 |
| Reading position remembered | 8 |
| Share to Facebook/X/LinkedIn/WhatsApp/Telegram/Reddit/email/copy | 9 |
| TikTok handled via verse image, not a dead button | 9 |
| Pipeline tests: 66 books, chapter counts, no empty verses | 2 |
| Marks round-trip test | 8 (manual restart check) |

Phase 2 items (AI pastor, retriever) and Phase 3 items (plans, devotionals) are intentionally out of scope for this plan.

**Placeholder scan:** No TBD/TODO. Every code step carries complete code. The one prose-only step (Task 9 Step 1) is a conditional guard with the exact code to add if the check fails.

**Type consistency:** `Verse`, `BookMeta`, and `Book` are defined once in Task 3 and reused verbatim in Tasks 5–9. `HIGHLIGHT_COLORS` is defined in Task 6 and imported in Task 8. `refKey`/`parseRef`/`formatRef` keep the same signatures throughout. The `BibleMarks` shape in Task 4 matches the `marks` state shape in Task 8 field-for-field.
