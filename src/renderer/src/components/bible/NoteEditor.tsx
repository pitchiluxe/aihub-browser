import React, { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { formatRef } from '../../services/bibleService'

interface Props {
  verseRef: string
  initial: string
  onSave: (text: string) => void
  onClose: () => void
}

// An in-app editor rather than window.prompt(): Electron replaces prompt()
// with a stub that throws ("prompt() is and will not be supported."), so the
// dialog never appeared and the click handler died mid-way. Nothing here
// touches prompt/alert/confirm.
export default function NoteEditor({ verseRef, initial, onSave, onClose }: Props) {
  const [text, setText] = useState(initial)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { areaRef.current?.focus() }, [])

  // Escape dismisses without saving. Bound on window so it fires whether or
  // not focus is still inside the textarea.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[420px] rounded-2xl border border-aihub-border/40 bg-aihub-surface p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-aihub-text">Note on {formatRef(verseRef)}</h3>
          <button onClick={onClose} className="text-aihub-muted hover:text-aihub-text"><X size={16} /></button>
        </div>

        <textarea
          ref={areaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          rows={6}
          placeholder="What does this verse say to you?"
          className="w-full resize-none rounded-xl border border-aihub-border/40 bg-aihub-bg/60 p-3 text-xs leading-relaxed text-aihub-text outline-none placeholder:text-aihub-muted/60 focus:border-aihub-accent/50"
        />

        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onSave('')}
            disabled={!initial}
            className="flex-1 rounded-xl bg-aihub-border/20 py-2.5 text-xs font-semibold text-aihub-text hover:bg-aihub-border/30 disabled:opacity-40"
          >
            Clear note
          </button>
          <button
            onClick={() => onSave(text)}
            className="flex-1 rounded-xl bg-aihub-accent py-2.5 text-xs font-bold text-white hover:bg-aihub-accent-glow"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
