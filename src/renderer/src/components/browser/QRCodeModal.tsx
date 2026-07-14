import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, QrCode, Download, Copy, Check } from 'lucide-react'
import qrcode from 'qrcode-generator'

interface Props {
  url: string | null
  onClose: () => void
}

// A QR code for the current page URL. Rendered fully offline via the
// zero-dependency qrcode-generator (byte mode, error-correction level M) and
// painted onto a canvas so we can export a crisp PNG.
export default function QRCodeModal({ url, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!url) return
    setCopied(false)
    setError('')
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      const qr = qrcode(0, 'M')
      qr.addData(url)
      qr.make()
      const count = qr.getModuleCount()
      const quiet = 4                 // standard 4-module quiet zone
      const size = 264                // rendered px (square)
      const total = count + quiet * 2
      const cell = size / total
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      canvas.width = size
      canvas.height = size
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = '#0b0b12'
      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (qr.isDark(r, c)) {
            ctx.fillRect(
              Math.round((c + quiet) * cell),
              Math.round((r + quiet) * cell),
              Math.ceil(cell),
              Math.ceil(cell),
            )
          }
        }
      }
    } catch {
      setError('Could not generate a QR code for this page.')
    }
  }, [url])

  const download = async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      const dataUrl = canvas.toDataURL('image/png')
      let base = 'qr-code'
      try { base = `qr-${new URL(url || '').hostname.replace(/^www\./, '')}` } catch {}
      await window.electronAPI.file.saveImage({ dataUrl, baseName: base })
    } catch {}
  }

  const copyUrl = async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  let host = url || ''
  try { host = new URL(url || '').hostname.replace(/^www\./, '') } catch {}

  return (
    <AnimatePresence>
      {url && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            className="relative w-full max-w-sm mx-4 glass rounded-2xl shadow-2xl border border-aihub-accent/30"
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
          >
            <div className="flex items-center justify-between p-6 pb-4 border-b border-aihub-border/40">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-aihub-accent/20 flex items-center justify-center">
                  <QrCode size={18} className="text-aihub-accent" />
                </div>
                <div>
                  <h2 className="font-semibold text-aihub-text">Page QR Code</h2>
                  <p className="text-xs text-aihub-muted truncate max-w-[200px]">{host}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg hover:bg-aihub-surface flex items-center justify-center transition-colors no-drag"
              >
                <X size={16} className="text-aihub-muted" />
              </button>
            </div>

            <div className="p-6 flex flex-col items-center gap-4">
              {error ? (
                <p className="text-sm text-aihub-muted py-8 text-center">{error}</p>
              ) : (
                <div className="p-3 bg-white rounded-xl">
                  <canvas ref={canvasRef} className="block w-[220px] h-[220px]" />
                </div>
              )}
              <p className="text-xs text-aihub-muted text-center break-all max-w-full">{url}</p>

              <div className="flex items-center gap-2 w-full">
                <button
                  onClick={download}
                  disabled={!!error}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-aihub-accent/20 hover:bg-aihub-accent/30 text-aihub-text text-sm font-medium transition-colors disabled:opacity-40 no-drag"
                >
                  <Download size={15} /> Save PNG
                </button>
                <button
                  onClick={copyUrl}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-aihub-surface hover:bg-aihub-card text-aihub-text text-sm font-medium transition-colors no-drag"
                >
                  {copied ? <Check size={15} className="text-aihub-green" /> : <Copy size={15} />}
                  {copied ? 'Copied' : 'Copy URL'}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
