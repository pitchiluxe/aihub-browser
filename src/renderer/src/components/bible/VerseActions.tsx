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
