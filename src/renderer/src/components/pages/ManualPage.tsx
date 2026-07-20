import React, { useState } from 'react'
import { BookOpen, Download, Printer, Check, Loader2, ExternalLink } from 'lucide-react'
// The manual ships inside the bundle as a standalone HTML document, so it
// works offline and can be handed to the user as a single self-contained file.
import manualHtml from '../../assets/manual.html?raw'

const MANUAL_FILENAME = 'AIHub-Browser-Manual.html'

export default function ManualPage() {
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState('')

  const download = async () => {
    if (saving) return
    setSaving(true); setError('')
    try {
      const res = await window.electronAPI.file.saveText({
        filename: MANUAL_FILENAME,
        content:  manualHtml,
      })
      if (res?.success) {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      } else if (res?.error) {
        setError(res.error)
      }
      // A cancelled save dialog reports neither — stay silent, same as
      // the other file:save* callers in the app.
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  // Printing has to target the iframe's own document — printing the host
  // window would print the app chrome instead of the manual.
  const print = () => {
    const frame = document.getElementById('manual-frame') as HTMLIFrameElement | null
    try { frame?.contentWindow?.focus(); frame?.contentWindow?.print() } catch {}
  }

  const openInTab = () => {
    const blob = new Blob([manualHtml], { type: 'text/html' })
    window.open(URL.createObjectURL(blob), '_blank')
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--ds-page-bg)' }}>

      {/* ── Header ── */}
      <div
        className="flex items-center gap-4 px-8 py-5 shrink-0"
        style={{ borderBottom: '1px solid var(--ds-border-sm)' }}
      >
        <div
          style={{
            width: 46, height: 46, borderRadius: 15, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg, rgb(var(--ds-accent) / 0.28), rgb(var(--ds-accent-2) / 0.16))',
            border: '1px solid rgb(var(--ds-accent) / 0.3)',
            boxShadow: '0 0 22px rgb(var(--ds-accent) / 0.18)',
          }}
        >
          <BookOpen size={21} style={{ color: 'rgb(var(--ds-accent-soft))' }} />
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold tracking-tight" style={{ color: 'rgb(var(--ds-text-1, var(--ds-text-2)))' }}>
            User Manual
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'rgb(var(--ds-text-4))' }}>
            Every feature, all shortcuts, and how to command the AI · Created by <strong style={{ color: 'rgb(var(--ds-accent-soft))' }}>Erick Omari</strong>
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={openInTab}
            title="Open the manual in its own tab"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
            style={{
              background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)',
              color: 'rgb(var(--ds-text-3))', cursor: 'pointer',
            }}
          >
            <ExternalLink size={13} /> Open in Tab
          </button>

          <button
            onClick={print}
            title="Print, or save as PDF"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
            style={{
              background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)',
              color: 'rgb(var(--ds-text-3))', cursor: 'pointer',
            }}
          >
            <Printer size={13} /> Print / PDF
          </button>

          <button
            onClick={download}
            disabled={saving}
            title={`Save ${MANUAL_FILENAME} to your computer`}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all"
            style={{
              background: saved
                ? 'rgba(52,211,153,0.18)'
                : 'linear-gradient(135deg, rgb(var(--ds-accent)), rgb(var(--ds-accent-2)))',
              border: `1px solid ${saved ? 'rgba(52,211,153,0.45)' : 'rgb(var(--ds-accent-soft) / 0.5)'}`,
              color: saved ? '#34d399' : '#fff',
              boxShadow: saved ? 'none' : '0 3px 18px rgb(var(--ds-accent) / 0.4)',
              cursor: saving ? 'wait' : 'pointer',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? <Loader2 size={13} className="animate-spin" />
              : saved ? <Check size={13} />
              : <Download size={13} />}
            {saving ? 'Saving…' : saved ? 'Saved' : 'Download Manual'}
          </button>
        </div>
      </div>

      {error && (
        <div
          className="mx-8 mt-4 px-4 py-2.5 rounded-xl text-xs shrink-0"
          style={{ background: 'rgba(239,68,68,0.09)', border: '1px solid rgba(239,68,68,0.22)', color: '#f87171' }}
        >
          Couldn't save the manual: {error}
        </div>
      )}

      {/* ── The manual itself ── */}
      {/* Rendered in an iframe so the manual's own stylesheet and theme tokens
          stay fully isolated from the app's UI. */}
      <iframe
        id="manual-frame"
        title="AIHub Browser User Manual"
        srcDoc={manualHtml}
        className="flex-1 w-full border-0 min-h-0"
        style={{ background: 'transparent' }}
      />
    </div>
  )
}
