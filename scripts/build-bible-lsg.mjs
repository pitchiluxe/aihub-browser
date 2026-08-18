// Downloads the Louis Segond 1910 (public domain) once and writes compact
// per-book JSON into the renderer assets, alongside the World English Bible.
// Run manually via `npm run build:bible:lsg`; the output is committed so
// builds and the app never touch the network.
//
// The canon order is the app's own (scripts/lib/bible-canon.mjs). getbible
// numbers its books 1–66 in exactly that order, so the nth book upstream is
// BOOKS[n - 1] here — asserted below rather than assumed, because a silent
// off-by-one would put Genesis's text under Exodus's name.
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { BOOKS } from './lib/bible-canon.mjs'
import { normalizeGetBibleBook } from './lib/normalize-getbible.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'src', 'renderer', 'src', 'assets', 'bible', 'lsg')
const BASE = 'https://api.getbible.net/v2/ls1910'

// Chapter counts are fixed for the Protestant canon, so they double as a
// checksum on the download: a truncated response fails the build instead of
// shipping a book that stops halfway.
const EXPECTED_CHAPTERS = {
  GEN: 50, EXO: 40, LEV: 27, NUM: 36, DEU: 34, JOS: 24, JDG: 21, RUT: 4,
  '1SA': 31, '2SA': 24, '1KI': 22, '2KI': 25, '1CH': 29, '2CH': 36, EZR: 10,
  NEH: 13, EST: 10, JOB: 42, PSA: 150, PRO: 31, ECC: 12, SNG: 8, ISA: 66,
  JER: 52, LAM: 5, EZK: 48, DAN: 12, HOS: 14, JOL: 3, AMO: 9, OBA: 1, JON: 4,
  MIC: 7, NAM: 3, HAB: 3, ZEP: 3, HAG: 2, ZEC: 14, MAL: 4, MAT: 28, MRK: 16,
  LUK: 24, JHN: 21, ACT: 28, ROM: 16, '1CO': 16, '2CO': 13, GAL: 6, EPH: 6,
  PHP: 4, COL: 4, '1TH': 5, '2TH': 3, '1TI': 6, '2TI': 4, TIT: 3, PHM: 1,
  HEB: 13, JAS: 5, '1PE': 5, '2PE': 3, '1JN': 5, '2JN': 1, '3JN': 1, JUD: 1,
  REV: 22,
}

async function fetchJson(url, attempts = 3) {
  let lastError
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (e) {
      lastError = e
      await new Promise(r => setTimeout(r, 500 * (i + 1)))
    }
  }
  throw new Error(`${url}: ${lastError?.message || 'failed'}`)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const index = { translation: 'LSG', name: 'Louis Segond 1910', language: 'fr', books: [] }

  for (let i = 0; i < BOOKS.length; i++) {
    const book = BOOKS[i]
    const payload = await fetchJson(`${BASE}/${i + 1}.json`)
    const { chapters } = normalizeGetBibleBook(payload)

    const expected = EXPECTED_CHAPTERS[book.id]
    if (chapters.length !== expected) {
      throw new Error(`${book.id}: got ${chapters.length} chapters, expected ${expected}`)
    }
    for (let c = 0; c < chapters.length; c++) {
      if (!chapters[c]?.length) throw new Error(`${book.id} ${c + 1}: no verses`)
    }

    // The French name comes from the download; the English one stays available
    // so a reader who switches versions mid-chapter is not hunting for a book
    // they only know under one name.
    const name = typeof payload?.name === 'string' && payload.name.trim()
      ? payload.name.trim()
      : book.name

    writeFileSync(join(OUT, `${book.slug}.json`), JSON.stringify({ id: book.id, name, chapters }))
    index.books.push({ ...book, name, enName: book.name, chapters: chapters.length })
    console.log(`${name} (${book.id}): ${chapters.length} chapters`)
  }

  writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 2))
  console.log(`\nWrote ${index.books.length} books to ${OUT}`)
}

main().catch(e => { console.error(e); process.exit(1) })
