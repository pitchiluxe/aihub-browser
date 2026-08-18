import React, { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
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
  showNumbers?: boolean
  onSelectVerse: (ref: string) => void
}

// Verses render as inline spans inside one flowing column so the text wraps
// like a printed page rather than sitting in a list of rows.
export default function VerseText({ showNumbers = true, bookId, chapter, verses, highlights, notes, selectedRef, onSelectVerse }: Props) {
  const [expandedImage, setExpandedImage] = useState<string | null>(null)

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
            <div key={v.v}>
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
              {/* Display illustration if present, with a small clickable thumbnail */}
              {v.img && (
                <button
                  onClick={() => setExpandedImage(v.img || null)}
                  className="ml-2 inline-block align-middle rounded hover:opacity-80 transition-opacity"
                  title="View illustration"
                  style={{ maxWidth: '80px', maxHeight: '60px' }}
                >
                  <IllustrationImage id={v.img} style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: '4px' }} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Expanded illustration modal */}
      {expandedImage && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setExpandedImage(null)}>
          <div className="relative max-w-2xl max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setExpandedImage(null)}
              className="absolute -top-10 right-0 text-white hover:text-gray-300 transition-colors"
              title="Close"
            >
              <X size={24} />
            </button>
            <IllustrationImage id={expandedImage} style={{ maxWidth: '100%', maxHeight: '90vh' }} />
          </div>
        </div>
      )}
    </>
  )
}

// Helper component to load and display illustration images
function IllustrationImage({ id, style }: { id: string; style?: React.CSSProperties }) {
  // Illustrations are referenced by ID and loaded from assets
  // SVG illustrations are in src/renderer/src/assets/illustrations/
  const [imageSrc, setImageSrc] = React.useState<string>('')

  React.useEffect(() => {
    // Try to load the illustration SVG dynamically
    const loadIllustration = async () => {
      try {
        // Import the SVG file dynamically
        const modules = import.meta.glob(['../../assets/illustrations/*.svg'], { as: 'url' })
        const key = `../../assets/illustrations/${id}.svg`
        if (key in modules) {
          const url = await modules[key as keyof typeof modules]()
          setImageSrc(url as string)
        } else {
          setImageSrc('')
        }
      } catch {
        setImageSrc('')
      }
    }

    loadIllustration()
  }, [id])

  // Placeholder SVG for when illustration is not found
  const placeholderSvg = `data:image/svg+xml;base64,${btoa(`
    <svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
      <rect width="400" height="300" fill="#f0ede5"/>
      <text x="200" y="140" text-anchor="middle" font-family="serif" font-size="16" fill="#6b5f4f">
        Illustration: ${id}
      </text>
      <text x="200" y="170" text-anchor="middle" font-family="serif" font-size="12" fill="#9b8f7f">
        Coming soon...
      </text>
    </svg>
  `)}`

  return (
    <img
      src={imageSrc || placeholderSvg}
      alt={`Illustration for ${id}`}
      style={style}
      onError={(e) => {
        // If image fails to load, use placeholder
        (e.target as HTMLImageElement).src = placeholderSvg
      }}
    />
  )
}
