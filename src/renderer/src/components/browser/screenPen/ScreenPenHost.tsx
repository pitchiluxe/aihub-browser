import { useEffect, useState } from 'react'
import { AppWindow, Loader2, Monitor, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useBrowserStore } from '../../../store/browserStore'
import { penSession } from '../../../services/screenPen/penSession'
import { usePenSession } from './usePenSession'

// Always mounted in the app shell. It owns the two things that must not depend
// on the pen being open: the screen picker, and the recording itself. A
// recording can be started from the pen or from the nav bar's record menu,
// keeps running across tabs with the pen closed, and is only finalised here
// if the window itself goes away.

interface Source { id: string; name: string; thumbnail: string; isScreen: boolean }

export default function ScreenPenHost() {
  const { pickerOpen } = usePenSession()

  useEffect(() => () => penSession.shutdown(), [])

  return pickerOpen ? <SourcePicker /> : null
}

/**
 * Which screen or window to record. Electron has no browser picker, so this is
 * the consent step: nothing is opened until something here is clicked.
 */
function SourcePicker() {
  const { pushHostOverlay, popHostOverlay } = useBrowserStore(useShallow(s => ({
    pushHostOverlay: s.pushHostOverlay,
    popHostOverlay: s.popHostOverlay,
  })))
  const [sources, setSources] = useState<Source[] | null>(null)
  const [error, setError] = useState('')

  // A tab is a BrowserView that paints above host HTML; hide it while the
  // picker is up or the picker would open invisibly behind the page.
  useEffect(() => {
    pushHostOverlay()
    return () => popHostOverlay()
  }, [pushHostOverlay, popHostOverlay])

  useEffect(() => {
    let cancelled = false
    window.electronAPI.recorder.screenSources()
      .then((result: { ok: boolean; error?: string; sources: Source[] }) => {
        if (cancelled) return
        if (result?.ok) setSources(result.sources ?? [])
        else setError(result?.error || 'Could not list your screens.')
      })
      .catch(() => { if (!cancelled) setError('Could not list your screens.') })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') void penSession.chooseSource(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 backdrop-blur-sm p-6"
      onMouseDown={e => { if (e.target === e.currentTarget) void penSession.chooseSource(null) }}
    >
      <div
        role="dialog"
        aria-label="Choose what to record"
        className="w-full max-w-[680px] max-h-[80vh] flex flex-col rounded-2xl border border-aihub-border bg-aihub-surface shadow-2xl"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-aihub-border">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]" />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-aihub-text">Choose what to record</h2>
            <p className="text-xs text-aihub-muted">Your camera and microphone join if you allow them.</p>
          </div>
          <button
            type="button"
            onClick={() => void penSession.chooseSource(null)}
            className="p-1.5 rounded-lg text-aihub-muted hover:text-aihub-text hover:bg-white/5"
            title="Cancel"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto">
          {error && <p className="text-sm text-red-400">{error}</p>}

          {!sources && !error && (
            <p className="flex items-center gap-2 py-8 text-sm text-aihub-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Looking for screens and windows…
            </p>
          )}

          {sources && !sources.length && (
            <p className="py-8 text-sm text-aihub-muted">
              Nothing available to record. On macOS, grant screen recording permission to AIHub in
              System Settings, then try again.
            </p>
          )}

          {!!sources?.length && (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
              {sources.map(source => (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => void penSession.chooseSource(source.id)}
                  className="overflow-hidden rounded-xl border border-aihub-border text-left transition-colors hover:border-aihub-accent/60 hover:bg-white/5"
                >
                  {source.thumbnail
                    ? <img src={source.thumbnail} alt="" className="h-24 w-full object-cover bg-black/40" />
                    : <div className="h-24 w-full bg-black/40" />}
                  <span className="flex items-center gap-1.5 px-2.5 py-2 text-xs text-aihub-text">
                    {source.isScreen ? <Monitor className="h-3.5 w-3.5 shrink-0" /> : <AppWindow className="h-3.5 w-3.5 shrink-0" />}
                    <span className="truncate">{source.name}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
