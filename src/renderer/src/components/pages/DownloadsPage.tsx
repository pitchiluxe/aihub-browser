import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Download, FolderOpen, FileText, Trash2, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { DownloadItem, useBrowserStore } from '../../store/browserStore'

export default function DownloadsPage() {
  const { downloads, setDownloads, upsertDownload } = useBrowserStore()

  useEffect(() => {
    window.electronAPI.downloads.getAll().then(setDownloads)
    const unsub = window.electronAPI.downloads.onUpdate(upsertDownload)
    return () => { if (typeof unsub === 'function') unsub() }
  }, [])

  const clearAll = async () => {
    await window.electronAPI.downloads.clear()
    setDownloads([])
  }

  const formatSize = (bytes: number) => {
    if (!bytes) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatProgress = (dl: DownloadItem) => {
    if (dl.totalBytes > 0) return `${formatSize(dl.receivedBytes)} / ${formatSize(dl.totalBytes)}`
    return formatSize(dl.receivedBytes)
  }

  return (
    <div className="flex flex-col h-full bg-aihub-bg text-aihub-text overflow-hidden">
      <div className="px-8 pt-8 pb-4 border-b border-aihub-border/30 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-aihub-text">Downloads</h1>
          <p className="text-sm text-aihub-muted mt-0.5">{downloads.length} files</p>
        </div>
        {downloads.length > 0 && (
          <button onClick={clearAll} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium transition-all">
            <Trash2 size={14} /> Clear list
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-4">
        {downloads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-aihub-muted">
            <Download size={40} className="opacity-20" />
            <p className="text-sm">No downloads yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {downloads.map((dl, i) => (
              <motion.div
                key={dl.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="flex items-center gap-4 p-4 rounded-2xl bg-aihub-card/60 border border-aihub-border/30 group"
              >
                {/* Icon */}
                <div className="w-10 h-10 rounded-xl bg-aihub-accent/10 flex items-center justify-center shrink-0">
                  <FileText size={18} className="text-aihub-accent" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-aihub-text truncate">{dl.filename}</span>
                    {dl.state === 'completed' && <CheckCircle2 size={13} className="text-green-400 shrink-0" />}
                    {dl.state === 'cancelled' && <XCircle size={13} className="text-red-400 shrink-0" />}
                    {dl.state === 'progressing' && <Loader2 size={13} className="text-aihub-accent animate-spin shrink-0" />}
                  </div>

                  {dl.state === 'progressing' && dl.totalBytes > 0 && (
                    <div className="w-full bg-aihub-border/40 rounded-full h-1 mb-1">
                      <div className="bg-aihub-accent h-1 rounded-full transition-all" style={{ width: `${Math.min(100, (dl.receivedBytes / dl.totalBytes) * 100)}%` }} />
                    </div>
                  )}

                  <div className="flex items-center gap-3 text-xs text-aihub-muted">
                    <span>{formatProgress(dl)}</span>
                    <span>·</span>
                    <span>{dl.state === 'completed' ? 'Complete' : dl.state === 'cancelled' ? 'Cancelled' : 'Downloading…'}</span>
                    {dl.completedAt && <><span>·</span><span>{new Date(dl.completedAt).toLocaleDateString()}</span></>}
                  </div>
                </div>

                {/* Actions */}
                {dl.state === 'completed' && dl.savePath && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => window.electronAPI.downloads.openFile(dl.savePath)}
                      className="px-3 py-1.5 rounded-lg text-xs bg-aihub-accent/20 hover:bg-aihub-accent/30 text-aihub-accent transition-all">
                      Open
                    </button>
                    <button onClick={() => window.electronAPI.downloads.showInFolder(dl.savePath)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-aihub-muted hover:text-aihub-text hover:bg-aihub-card transition-all">
                      <FolderOpen size={13} />
                    </button>
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
