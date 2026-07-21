import React, { useEffect } from 'react'
import { StickyNote, Trash2, X } from 'lucide-react'
import { formatRef } from '../../services/bibleService'

interface Props {
  saved: { ref: string; ts: number }[]
  notes: Record<string, string>
  onOpen: (ref: string) => void
  onRemove: (ref: string) => void
  onClose: () => void
}

// The read side of `marks.saved` — without it a saved verse could never be
// found again. Entries are already stored newest-first by the save action.
export default function SavedVerses({ saved, notes, onOpen, onRemove, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="flex max-h-[70vh] w-[420px] flex-col rounded-2xl border border-aihub-border/40 bg-aihub-surface p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <h3 className="text-sm font-bold text-aihub-text">Saved verses</h3>
          <button onClick={onClose} className="text-aihub-muted hover:text-aihub-text"><X size={16} /></button>
        </div>

        {saved.length === 0 ? (
          <p className="py-6 text-center text-xs text-aihub-muted">
            Nothing saved yet. Select a verse and tap the bookmark to keep it here.
          </p>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {saved.map(s => (
              <div key={s.ref} className="group flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-aihub-border/15">
                <button
                  onClick={() => onOpen(s.ref)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="truncate text-xs font-semibold text-aihub-text">{formatRef(s.ref)}</span>
                  {notes[s.ref] && <StickyNote size={12} className="shrink-0 text-aihub-accent" />}
                  <span className="ml-auto shrink-0 text-[10px] text-aihub-muted/70">
                    {new Date(s.ts).toLocaleDateString()}
                  </span>
                </button>
                <button
                  onClick={() => onRemove(s.ref)}
                  title="Remove from saved"
                  className="shrink-0 rounded-lg p-1 text-aihub-muted opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
