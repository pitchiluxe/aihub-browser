import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, RefreshCw, X, ArrowUpCircle, Loader2 } from 'lucide-react'

type Phase = 'available' | 'downloading' | 'downloaded' | 'error'

interface State {
  phase: Phase
  version?: string
  percent?: number
  message?: string
}

// Small, dismissible toast in the bottom-right that reacts to auto-update
// events from the main process (electron-updater against GitHub Releases).
// "Download" → progress bar → "Restart to update". Nothing installs without
// the user clicking. Fully silent when there is no update.
export default function UpdateNotification() {
  const [state, setState] = useState<State | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const off = window.electronAPI?.updater?.onEvent?.((e: any) => {
      switch (e.type) {
        case 'available':
          setDismissed(false)
          setState({ phase: 'available', version: e.version })
          break
        case 'progress':
          setState(s => (s ? { ...s, phase: 'downloading', percent: e.percent } : { phase: 'downloading', percent: e.percent }))
          break
        case 'downloaded':
          setDismissed(false)
          setState({ phase: 'downloaded', version: e.version })
          break
        case 'error':
          // Only surface an error if the user was mid-flow; ignore silent
          // background-check failures (offline, no release yet, etc.).
          setState(s => (s ? { phase: 'error', message: e.message } : s))
          break
      }
    })
    return () => { try { off?.() } catch { /* noop */ } }
  }, [])

  if (!state || dismissed) return null

  const download = () => {
    setState(s => (s ? { ...s, phase: 'downloading', percent: 0 } : s))
    window.electronAPI.updater.download()
  }
  const install = () => window.electronAPI.updater.install()

  return (
    <AnimatePresence>
      <motion.div
        key="update-toast"
        initial={{ opacity: 0, y: 16, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.96 }}
        transition={{ type: 'spring', damping: 22, stiffness: 320 }}
        className="fixed bottom-5 right-5 z-[70] w-[320px] rounded-2xl glass border border-aihub-accent/30 shadow-2xl no-drag overflow-hidden"
      >
        <div className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-aihub-accent/20 flex items-center justify-center shrink-0">
              <ArrowUpCircle size={18} className="text-aihub-accent" />
            </div>
            <div className="flex-1 min-w-0">
              {state.phase === 'available' && (
                <>
                  <div className="text-sm font-semibold text-aihub-text">Update available</div>
                  <div className="text-xs text-aihub-muted mt-0.5">Version {state.version} is ready to download.</div>
                </>
              )}
              {state.phase === 'downloading' && (
                <>
                  <div className="text-sm font-semibold text-aihub-text">Downloading update…</div>
                  <div className="text-xs text-aihub-muted mt-0.5">{state.percent ?? 0}%</div>
                </>
              )}
              {state.phase === 'downloaded' && (
                <>
                  <div className="text-sm font-semibold text-aihub-text">Update ready</div>
                  <div className="text-xs text-aihub-muted mt-0.5">Version {state.version} will be applied on restart.</div>
                </>
              )}
              {state.phase === 'error' && (
                <>
                  <div className="text-sm font-semibold text-aihub-text">Update failed</div>
                  <div className="text-xs text-aihub-muted mt-0.5 break-words">{state.message}</div>
                </>
              )}
            </div>
            <button
              onClick={() => setDismissed(true)}
              className="w-6 h-6 rounded-lg hover:bg-aihub-surface flex items-center justify-center shrink-0"
              title="Dismiss"
            >
              <X size={13} className="text-aihub-muted" />
            </button>
          </div>

          {state.phase === 'downloading' && (
            <div className="mt-3 h-1.5 rounded-full bg-aihub-surface overflow-hidden">
              <div className="h-full bg-aihub-accent transition-all duration-200" style={{ width: `${state.percent ?? 0}%` }} />
            </div>
          )}

          {(state.phase === 'available' || state.phase === 'downloaded' || state.phase === 'error') && (
            <div className="mt-3 flex items-center gap-2">
              {state.phase === 'available' && (
                <button
                  onClick={download}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-aihub-accent/20 hover:bg-aihub-accent/30 text-aihub-text text-xs font-medium transition-colors"
                >
                  <Download size={14} /> Download update
                </button>
              )}
              {state.phase === 'downloaded' && (
                <button
                  onClick={install}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-aihub-accent/20 hover:bg-aihub-accent/30 text-aihub-text text-xs font-medium transition-colors"
                >
                  <RefreshCw size={14} /> Restart to update
                </button>
              )}
              {state.phase === 'error' && (
                <button
                  onClick={() => setDismissed(true)}
                  className="flex-1 py-2 rounded-xl bg-aihub-surface hover:bg-aihub-card text-aihub-text text-xs font-medium transition-colors"
                >
                  Dismiss
                </button>
              )}
            </div>
          )}
        </div>
        {state.phase === 'downloading' && (
          <div className="px-4 pb-3 -mt-1 flex items-center gap-1.5 text-[10px] text-aihub-muted">
            <Loader2 size={10} className="animate-spin" /> Downloading in the background — you can keep browsing.
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
