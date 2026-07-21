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
