import React, { useEffect, useState } from 'react'
import { StickyNote, Trash2, X, Download, Upload } from 'lucide-react'
import { formatRef } from '../../services/bibleService'
import { mergeLocalJsonArrays } from '../../services/backupLocal'

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
  const [busy, setBusy] = useState(false)
  const [transferMsg, setTransferMsg] = useState('')

  // Both buttons drive the same whole-app backup used in Settings: a reader
  // who exports "their verses" almost always means their whole study, and a
  // second, verses-only format would be one more thing to keep compatible.
  const LOCAL_KEYS = ['aihub-custom-themes', 'aihub-custom-window-styles', 'aihub-custom-exts']

  const exportAll = async () => {
    setBusy(true); setTransferMsg('')
    const local: Record<string, string> = {}
    for (const key of LOCAL_KEYS) {
      const value = localStorage.getItem(key)
      if (value) local[key] = value
    }
    const res = await window.electronAPI.backup.export(local)
    setBusy(false)
    if (res?.cancelled) return
    setTransferMsg(res?.ok
      ? `Saved ${res.summary.verses} verses, ${res.summary.highlights} highlights and ${res.summary.bookmarks} bookmarks.`
      : (res?.error || 'Export failed'))
  }

  const importAll = async () => {
    setBusy(true); setTransferMsg('')
    const preview = await window.electronAPI.backup.preview()
    if (preview?.cancelled) { setBusy(false); return }
    if (!preview?.ok) { setBusy(false); setTransferMsg(preview?.error || 'Could not read that file'); return }

    const res = await window.electronAPI.backup.apply()
    setBusy(false)
    if (!res?.ok) { setTransferMsg(res?.error || 'Import failed'); return }
    for (const [key, incoming] of Object.entries(res.local || {})) {
      const merged = mergeLocalJsonArrays(localStorage.getItem(key) || undefined, incoming as string)
      if (merged) localStorage.setItem(key, merged)
    }
    setTransferMsg(`Imported ${res.summary.verses} verses and ${res.summary.bookmarks} bookmarks from ${preview.device}. Reloading…`)
    setTimeout(() => window.location.reload(), 1400)
  }

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
          <div className="flex items-center gap-1.5">
            {/* Right where the verses are — the same whole-app backup as
                Settings, offered at the moment someone is looking at the thing
                they would hate to lose. */}
            <button
              onClick={exportAll}
              disabled={busy}
              title="Save everything (verses, highlights, notes, bookmarks) to a file you can carry to another computer"
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-aihub-muted hover:bg-aihub-border/30 hover:text-aihub-text disabled:opacity-50"
            >
              <Download size={12} /> Export
            </button>
            <button
              onClick={importAll}
              disabled={busy}
              title="Bring verses and bookmarks in from another computer's backup file"
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-aihub-muted hover:bg-aihub-border/30 hover:text-aihub-text disabled:opacity-50"
            >
              <Upload size={12} /> Import
            </button>
            <button onClick={onClose} className="text-aihub-muted hover:text-aihub-text"><X size={16} /></button>
          </div>
        </div>

        {!!transferMsg && (
          <div className="mb-2 shrink-0 rounded-lg px-3 py-2 text-[11px]"
            style={{ background: 'rgb(var(--ds-accent) / 0.1)', color: 'rgb(var(--ds-accent-soft))' }}>
            {transferMsg}
          </div>
        )}

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
