import React, { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { refKey, getTranslationMeta, type Verse } from '../../services/bibleService'

export const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: 'rgba(250, 204, 21, 0.38)',
  green:  'rgba(52, 211, 153, 0.34)',
  blue:   'rgba(96, 165, 250, 0.32)',
  pink:   'rgba(244, 114, 182, 0.32)',
  purple: 'rgba(167, 139, 250, 0.32)',
}

// Every illustration, resolved to a URL at build time.
//
// Eager and synchronous on purpose. Resolving these per-verse inside an effect
// meant the picture arrived a frame or two after the words on every single
// page turn, and a storybook whose pictures pop in late reads as broken. The
// whole set is a couple of dozen small SVGs.
const ILLUSTRATIONS = import.meta.glob('../../assets/illustrations/*.svg', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

function illustrationUrl(id: string): string | null {
  return ILLUSTRATIONS[`../../assets/illustrations/${id}.svg`] ?? null
}

interface Props {
  bookId: string
  chapter: number
  verses: Verse[]
  highlights: Record<string, string>
  notes: Record<string, string>
  selectedRef: string | null
  showNumbers?: boolean
  onSelectVerse: (ref: string) => void
}

/**
 * A chapter, in one of two shapes.
 *
 * The ordinary versions render as inline spans inside one flowing column, so
 * the text wraps like a printed page rather than sitting in a list of rows.
 *
 * The kids editions are laid out as a picture book instead: one verse per
 * line, larger and more widely spaced type, and illustrations as full-width
 * plates rather than thumbnails tucked beside the words. A child reading over
 * a parent's shoulder should see a storybook, not a study Bible in a smaller
 * font.
 */
export default function VerseText({ showNumbers = true, bookId, chapter, verses, highlights, notes, selectedRef, onSelectVerse }: Props) {
  const [expandedImage, setExpandedImage] = useState<string | null>(null)
  const kids = !!getTranslationMeta().isKids

  // Bring the selected verse into view. Only the page whose chapter actually
  // contains the ref holds the matching element, so the effect on every other
  // page is a no-op. Deep-linking to a verse (the toolbar's verse picker, a
  // saved verse, an AI citation) can land far down a long chapter, so it must
  // scroll rather than leave the reader to hunt for the highlight.
  const selectedEl = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    if (selectedEl.current) selectedEl.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [selectedRef])

  return (
    <>
      <div
        className="bible-prose"
        style={kids ? { fontSize: '1.16em', lineHeight: 1.85, letterSpacing: '0.005em' } : undefined}
      >
        {verses.map(v => {
          const ref = refKey(bookId, chapter, v.v)
          const color = highlights[ref]
          const selected = selectedRef === ref
          const hasNote = !!notes[ref]
          // The WEB text keeps traditional verse numbers for a handful of verses
          // (e.g. Luke 17:36, Acts 8:37) that are absent from the oldest
          // manuscripts, so the verse body is legitimately empty. Render a quiet
          // editorial note instead of a bare number, which otherwise reads as a
          // rendering bug.
          const isOmitted = v.t.trim() === ''
          const art = v.img ? illustrationUrl(v.img) : null

          const body = (
            <span
              ref={selected ? selectedEl : undefined}
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
              {showNumbers && <sup className="mr-0.5 select-none opacity-50">{v.v}</sup>}
              {/* A note is otherwise invisible until the verse is selected, so
                  the verse carries a quiet marker of its own — same superscript
                  rhythm as the verse number, tinted like a highlight. */}
              {hasNote && (
                <sup title="This verse has a note" className="mr-0.5 select-none text-aihub-accent opacity-80">&#9679;</sup>
              )}
              {isOmitted ? (
                <span className="text-xs italic text-aihub-muted opacity-70">
                  (verse not in the earliest manuscripts)
                </span>
              ) : (
                <>{v.t}{' '}</>
              )}
            </span>
          )

          // Ordinary versions: keep the flowing column, exactly as before.
          if (!kids) return <React.Fragment key={v.v}>{body}</React.Fragment>

          return (
            <div key={v.v} className="mb-3">
              {body}
              {art && (
                <button
                  onClick={() => setExpandedImage(art)}
                  title="Look closer"
                  className="mt-2 block w-full overflow-hidden rounded-2xl transition-transform hover:scale-[1.01]"
                  style={{ border: '1px solid rgba(120,90,50,0.18)', boxShadow: '0 6px 18px rgba(80,60,30,0.13)' }}
                >
                  <img src={art} alt="" className="block w-full" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {expandedImage && (
        <div
          className="fixed inset-0 z-[500] flex items-center justify-center bg-black/80 p-6"
          role="dialog"
          onClick={() => setExpandedImage(null)}
        >
          <div className="relative w-full max-w-3xl" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setExpandedImage(null)}
              title="Close"
              className="absolute -top-11 right-0 text-white/90 transition-colors hover:text-white"
            >
              <X size={26} />
            </button>
            <img src={expandedImage} alt="" className="w-full rounded-2xl" />
          </div>
        </div>
      )}
    </>
  )
}
