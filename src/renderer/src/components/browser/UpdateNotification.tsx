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

// Dismissible update bar, driven by auto-update events from the main process
// (electron-updater against GitHub Releases). "Download" → progress →
// "Restart to update". Nothing installs without the user clicking, and it is
// completely silent when there is no update.
//
// It renders as a strip in the browser CHROME rather than a floating toast.
// It used to be positioned fixed in the bottom-right, which meant it was only
// ever visible on the app's own pages (Bible, Settings): a browsing tab is a
// native BrowserView painted over the entire content area, so host HTML in
// that region sits behind it. In the chrome column it is visible on every
// page — and because it occupies real layout space, the content area (and
// therefore the BrowserView's bounds) shrinks to fit rather than overlapping.
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

  const headline =
    state.phase === 'available' ? 'Update available'
    : state.phase === 'downloading' ? 'Downloading update…'
    : state.phase === 'downloaded' ? 'Update ready'
    : 'Update failed'

  const detail =
    state.phase === 'available' ? `Version ${state.version} is ready to download.`
    : state.phase === 'downloading' ? `${state.percent ?? 0}% — you can keep browsing.`
    : state.phase === 'downloaded' ? `Version ${state.version} will be applied on restart.`
    : state.message || ''

  return (
    <AnimatePresence>
      <motion.div
        key="update-bar"
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320 }}
        className="no-drag shrink-0 overflow-hidden border-b border-aihub-accent/25"
        style={{ background: 'linear-gradient(90deg, rgb(var(--ds-accent) / 0.16) 0%, rgb(var(--ds-accent) / 0.04) 60%, transparent 100%)' }}
      >
        <div className="flex items-center gap-3 px-4 py-2">
          <div className="w-7 h-7 rounded-lg bg-aihub-accent/20 flex items-center justify-center shrink-0">
            {state.phase === 'downloading'
              ? <Loader2 size={14} className="text-aihub-accent animate-spin" />
              : <ArrowUpCircle size={15} className="text-aihub-accent" />}
          </div>

          <div className="flex items-baseline gap-2 min-w-0 flex-1">
            <span className="text-[13px] font-semibold text-aihub-text shrink-0">{headline}</span>
            <span className="text-xs text-aihub-muted truncate">{detail}</span>
          </div>

          {state.phase === 'downloading' && (
            <div className="h-1.5 w-40 shrink-0 rounded-full bg-aihub-surface overflow-hidden">
              <div className="h-full bg-aihub-accent transition-all duration-200" style={{ width: `${state.percent ?? 0}%` }} />
            </div>
          )}

          {state.phase === 'available' && (
            <button
              onClick={download}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-aihub-accent/20 hover:bg-aihub-accent/30 text-aihub-text text-xs font-medium transition-colors"
            >
              <Download size={13} /> Download
            </button>
          )}
          {state.phase === 'downloaded' && (
            <button
              onClick={install}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-aihub-accent/20 hover:bg-aihub-accent/30 text-aihub-text text-xs font-medium transition-colors"
            >
              <RefreshCw size={13} /> Restart to update
            </button>
          )}

          <button
            onClick={() => setDismissed(true)}
            className="w-6 h-6 shrink-0 rounded-lg hover:bg-aihub-surface flex items-center justify-center"
            title="Dismiss"
          >
            <X size={13} className="text-aihub-muted" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
