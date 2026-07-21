import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, Loader2, CornerDownLeft } from 'lucide-react'
import { getBooks, refKey } from '../../services/bibleService'
import { buildIndex, isReady, search, expandQuery, type Hit } from '../../services/bibleSearch'

interface Props {
  open: boolean
  onClose: () => void
  onGoto: (ref: string) => void
}

// "John 3:16", "1 cor 13", "Psalm 23:1-6", "Jn 3:16"
const REF_RE = /^\s*((?:[1-3]\s*)?[a-z]{2,}(?:\s+[a-z]+)?)\.?\s*(\d{1,3})(?:\s*[:.]\s*(\d{1,3}))?/i

// Common shorthands readers actually type. Anything not here still resolves by
// prefix match against the full book names.
const ABBREV: Record<string, string> = {
  gen: 'GEN', ex: 'EXO', exod: 'EXO', lev: 'LEV', num: 'NUM', deut: 'DEU', dt: 'DEU',
  josh: 'JOS', judg: 'JDG', ruth: 'RUT', ps: 'PSA', psalm: 'PSA', psalms: 'PSA',
  prov: 'PRO', prv: 'PRO', eccl: 'ECC', isa: 'ISA', jer: 'JER', lam: 'LAM',
  ezek: 'EZK', dan: 'DAN', hos: 'HOS', mic: 'MIC', hab: 'HAB', zech: 'ZEC', mal: 'MAL',
  matt: 'MAT', mt: 'MAT', mk: 'MRK', mark: 'MRK', lk: 'LUK', luke: 'LUK',
  jn: 'JHN', john: 'JHN', acts: 'ACT', rom: 'ROM', rm: 'ROM',
  phil: 'PHP', php: 'PHP', col: 'COL', heb: 'HEB', jas: 'JAS', james: 'JAS',
  rev: 'REV', gal: 'GAL', eph: 'EPH', tit: 'TIT', titus: 'TIT',
}

// Resolve the book part of a typed reference to a book id.
function resolveBook(raw: string): string | null {
  const name = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  if (ABBREV[name.replace(/\s/g, '')]) return ABBREV[name.replace(/\s/g, '')]
  const books = getBooks()
  // Numbered books ("1 john") need the digit to match too, so compare on the
  // normalised full name first, then fall back to a prefix match.
  const exact = books.find(b => b.name.toLowerCase() === name)
  if (exact) return exact.id
  const starts = books.filter(b => b.name.toLowerCase().startsWith(name))
  if (starts.length === 1) return starts[0].id
  // "1 cor" → normalise "1 " prefix and try again against numbered books.
  const m = name.match(/^([1-3])\s*(.+)$/)
  if (m) {
    const cands = books.filter(b => {
      const n = b.name.toLowerCase()
      return n.startsWith(`${m[1]} `) && n.slice(2).startsWith(m[2])
    })
    if (cands.length >= 1) return cands[0].id
  }
  return starts.length ? starts[0].id : null
}

export interface ParsedRef { bookId: string; chapter: number; verse: number | null }

// Exported so the AI panel can answer "open John 3:16" without a round trip.
export function parseTypedRef(input: string): ParsedRef | null {
  const m = input.match(REF_RE)
  if (!m) return null
  const bookId = resolveBook(m[1])
  if (!bookId) return null
  const chapter = parseInt(m[2], 10)
  if (!chapter) return null
  const verse = m[3] ? parseInt(m[3], 10) : null
  const meta = getBooks().find(b => b.id === bookId)
  if (!meta || chapter > meta.chapters) return null
  return { bookId, chapter, verse }
}

export default function VerseSearch({ open, onClose, onGoto }: Props) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [busy, setBusy] = useState(false)
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open) return
    setQ(''); setHits([]); setSel(0)
    setTimeout(() => inputRef.current?.focus(), 40)
    if (!isReady()) buildIndex().catch(() => {})
  }, [open])

  const typedRef = useMemo(() => (q.trim() ? parseTypedRef(q) : null), [q])
  const books = getBooks()
  const refBook = typedRef ? books.find(b => b.id === typedRef.bookId) : null

  // Free-text search, debounced. A typed reference is resolved instantly above
  // and does not need the index.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    const term = q.trim()
    if (term.length < 3) { setHits([]); setBusy(false); return }
    setBusy(true)
    debounce.current = setTimeout(async () => {
      if (!isReady()) await buildIndex().catch(() => {})
      setHits(search(expandQuery(term), 40))
      setBusy(false)
      setSel(0)
    }, 200)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [q])

  const go = useCallback((ref: string) => { onGoto(ref); onClose() }, [onGoto, onClose])

  const goTyped = useCallback(() => {
    if (!typedRef) return
    go(refKey(typedRef.bookId, typedRef.chapter, typedRef.verse ?? 1))
  }, [typedRef, go])

  if (!open) return null

  const rows = hits.length
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (typedRef && sel === 0) goTyped()
      else if (rows) go(hits[Math.max(0, sel - (typedRef ? 1 : 0))].ref)
      return
    }
    const total = rows + (typedRef ? 1 : 0)
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, total - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)) }
  }

  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center pt-20"
      style={{ background: 'rgba(0,0,0,0.45)' }} onClick={onClose}>
      <div
        className="w-[min(620px,90%)] overflow-hidden rounded-2xl shadow-2xl"
        style={{ background: 'var(--ds-page-bg, #16161c)', border: '1px solid var(--ds-border-sm)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--ds-border-sm)' }}>
          <Search size={16} className="opacity-50" />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search a reference or any words — John 3:16, or “love your enemies”"
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ userSelect: 'text' }}
          />
          {busy && <Loader2 size={14} className="animate-spin opacity-50" />}
          <button onClick={onClose} className="rounded p-1 opacity-50 hover:opacity-100"><X size={15} /></button>
        </div>

        <div className="max-h-[52vh] overflow-y-auto">
          {typedRef && refBook && (
            <button
              onClick={goTyped}
              className="flex w-full items-center gap-2 px-4 py-3 text-left"
              style={{ background: sel === 0 ? 'rgb(var(--ds-accent) / 0.14)' : 'transparent' }}
            >
              <CornerDownLeft size={13} className="opacity-50" />
              <span className="text-sm font-semibold" style={{ color: 'rgb(var(--ds-accent-soft))' }}>
                Go to {refBook.name} {typedRef.chapter}{typedRef.verse ? `:${typedRef.verse}` : ''}
              </span>
            </button>
          )}

          {hits.map((h, i) => {
            const idx = i + (typedRef ? 1 : 0)
            return (
              <button
                key={h.ref}
                onClick={() => go(h.ref)}
                className="block w-full px-4 py-2.5 text-left"
                style={{ background: sel === idx ? 'rgb(var(--ds-accent) / 0.12)' : 'transparent' }}
              >
                <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgb(var(--ds-accent-soft))' }}>
                  {h.book} {h.chapter}:{h.verse}
                </div>
                <div className="mt-0.5 text-[13px] leading-snug opacity-80">{h.text}</div>
              </button>
            )
          })}

          {!busy && q.trim().length >= 3 && !rows && !typedRef && (
            <div className="px-4 py-8 text-center text-xs opacity-55">
              Nothing found for “{q.trim()}”.
            </div>
          )}
          {q.trim().length < 3 && !typedRef && (
            <div className="px-4 py-8 text-center text-xs opacity-50">
              Type a reference like <strong>John 3:16</strong>, or words from a verse you half-remember.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
