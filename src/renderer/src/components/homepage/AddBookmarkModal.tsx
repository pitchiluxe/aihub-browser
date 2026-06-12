import React, { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Link, Loader2, AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { useBrowserStore } from '../../store/browserStore'
import { addBookmarkWithAI } from '../../services/bookmarkService'

export default function AddBookmarkModal() {
  const { isAddBookmarkOpen, setAddBookmarkOpen, bookmarks, addBookmark } = useBrowserStore()
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [warning, setWarning] = useState('')
  const urlRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isAddBookmarkOpen) {
      setTimeout(() => urlRef.current?.focus(), 100)
      setUrl('')
      setTitle('')
      setStatus('idle')
      setMessage('')
      setWarning('')
    }
  }, [isAddBookmarkOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return

    setStatus('loading')
    setMessage('AI is analyzing your bookmark…')
    setWarning('')

    const result = await addBookmarkWithAI(url, title, bookmarks)

    if (result.success && result.bookmark) {
      addBookmark(result.bookmark)
      setStatus('success')
      setMessage('Bookmark added to the sphere!')
      if (result.warning) setWarning(result.warning)
      setTimeout(() => setAddBookmarkOpen(false), 1800)
    } else {
      setStatus('error')
      setMessage(result.error || 'Failed to add bookmark')
    }
  }

  return (
    <AnimatePresence>
      {isAddBookmarkOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setAddBookmarkOpen(false)}
          />

          {/* Modal */}
          <motion.div
            className="relative w-full max-w-md mx-4 glass rounded-2xl shadow-2xl border border-aihub-accent/30"
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 pb-4 border-b border-aihub-border/40">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-aihub-accent/20 flex items-center justify-center">
                  <Link size={18} className="text-aihub-accent" />
                </div>
                <div>
                  <h2 className="font-semibold text-aihub-text">Add Bookmark</h2>
                  <p className="text-xs text-aihub-muted">AI will categorize & check for duplicates</p>
                </div>
              </div>
              <button
                onClick={() => setAddBookmarkOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-aihub-surface flex items-center justify-center transition-colors no-drag"
              >
                <X size={16} className="text-aihub-muted" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs text-aihub-muted mb-2 font-medium">URL *</label>
                <input
                  ref={urlRef}
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="w-full bg-aihub-surface border border-aihub-border rounded-xl px-4 py-3 text-sm text-aihub-text placeholder:text-aihub-muted/50 focus:outline-none focus:border-aihub-accent transition-colors no-drag"
                  disabled={status === 'loading'}
                  style={{ userSelect: 'text' }}
                />
              </div>

              <div>
                <label className="block text-xs text-aihub-muted mb-2 font-medium">
                  Title <span className="text-aihub-muted/50">(optional)</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="My Bookmark"
                  className="w-full bg-aihub-surface border border-aihub-border rounded-xl px-4 py-3 text-sm text-aihub-text placeholder:text-aihub-muted/50 focus:outline-none focus:border-aihub-accent transition-colors no-drag"
                  disabled={status === 'loading'}
                  style={{ userSelect: 'text' }}
                />
              </div>

              {/* Status */}
              <AnimatePresence mode="wait">
                {message && (
                  <motion.div
                    key={status}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className={`flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm ${
                      status === 'error' ? 'bg-red-500/10 border border-red-500/30 text-red-400' :
                      status === 'success' ? 'bg-green-500/10 border border-green-500/30 text-green-400' :
                      'bg-aihub-accent/10 border border-aihub-accent/30 text-aihub-accent'
                    }`}
                  >
                    {status === 'loading' && <Loader2 size={15} className="animate-spin shrink-0 mt-0.5" />}
                    {status === 'error' && <AlertCircle size={15} className="shrink-0 mt-0.5" />}
                    {status === 'success' && <CheckCircle2 size={15} className="shrink-0 mt-0.5" />}
                    <span>{message}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              {warning && (
                <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm bg-yellow-500/10 border border-yellow-500/30 text-yellow-400">
                  <Info size={15} className="shrink-0 mt-0.5" />
                  <span>{warning}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={status === 'loading' || status === 'success' || !url.trim()}
                className="w-full py-3 rounded-xl font-medium text-sm transition-all no-drag
                  bg-aihub-accent hover:bg-aihub-accent-glow text-white
                  disabled:opacity-50 disabled:cursor-not-allowed
                  glow-accent"
              >
                {status === 'loading' ? 'Processing…' : status === 'success' ? 'Added!' : 'Add to Sphere'}
              </button>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
