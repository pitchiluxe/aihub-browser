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
  notes: Record<string, string>
  selectedRef: string | null
  onSelectVerse: (ref: string) => void
}

// Verses render as inline spans inside one flowing column so the text wraps
// like a printed page rather than sitting in a list of rows.
export default function VerseText({ bookId, chapter, verses, highlights, notes, selectedRef, onSelectVerse }: Props) {
  return (
    <div className="bible-prose">
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
      })}
    </div>
  )
}
