import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, Loader2, SpellCheck, X } from 'lucide-react'
import type { GrammarRequest } from '../../../../shared/grammarEditing'
import { useBrowserStore } from '../../store/browserStore'

export default function GrammarModal({ request, onClose }: { request: GrammarRequest; onClose: () => void }) {
  const [corrected, setCorrected] = useState('')
  const [busy, setBusy] = useState(true)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const dialog = useRef<HTMLDivElement>(null)
  const generation = useRef(0)
  const close = () => { void window.electronAPI.grammar.close(request.id).catch(() => {}); onClose() }
  const correct = async () => {
    const current = ++generation.current
    setBusy(true); setError('')
    try {
      const result = await window.electronAPI.grammar.correct(request.id)
      if (current !== generation.current) return
      if (!result.ok) throw Error(result.error)
      setCorrected(result.value)
    } catch (error) { if (current === generation.current) setError(error instanceof Error ? error.message : 'Correction failed. Try again.') }
    finally { if (current === generation.current) setBusy(false) }
  }
  useEffect(() => {
    useBrowserStore.getState().pushHostOverlay()
    void correct()
    dialog.current?.focus()
    return () => { generation.current++; useBrowserStore.getState().popHostOverlay() }
  }, [request.id])
  const action = async (kind: 'apply' | 'copy') => {
    setApplying(true); setError('')
    try {
      const result = await window.electronAPI.grammar[kind](request.id, corrected)
      if (!result.ok) throw Error(result.error)
      if (kind === 'apply') close()
      else setCopied(true)
    } catch (error) { setError(error instanceof Error ? error.message : 'Correction could not be applied.') }
    finally { setApplying(false) }
  }
  return createPortal(<div className="fixed inset-0 flex items-center justify-center bg-black/55 p-5" style={{ zIndex: 2147483300 }}>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="grammar-title" className="w-full max-w-2xl max-h-[90vh] overflow-auto bg-aihub-bg text-aihub-text rounded-2xl border border-aihub-border shadow-2xl outline-none" onKeyDown={event => {
      if (event.key === 'Escape' && !applying) { event.stopPropagation(); close() }
      if (event.key === 'Tab') {
        const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),[tabindex="0"]')
        const first = controls?.[0], last = controls?.[controls.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}>
      <header className="flex justify-between items-center px-6 py-5 border-b border-aihub-border"><h2 id="grammar-title" className="flex gap-2 items-center text-lg font-semibold"><SpellCheck size={20} className="text-aihub-accent" />Correct grammar</h2><button aria-label="Close grammar correction" disabled={applying} className="p-1.5 rounded-lg hover:bg-aihub-card" onClick={close}><X size={18} /></button></header>
      <div className="px-6 py-5 space-y-4">
        <div><h3 className="text-xs text-aihub-muted mb-2">Original</h3><p className="max-h-36 overflow-auto whitespace-pre-wrap break-words text-sm p-3 rounded-lg bg-aihub-card">{request.original}</p></div>
        <label className="block"><span className="text-xs text-aihub-muted">Correction</span>{busy ? <div role="status" className="flex items-center gap-2 py-8 text-sm text-aihub-muted"><Loader2 size={16} className="animate-spin" />Checking grammar with your configured AI provider…</div> : <textarea aria-label="Corrected text" value={corrected} onChange={event => { setCorrected(event.target.value); setCopied(false) }} maxLength={16000} rows={6} className="w-full mt-2 p-3 rounded-lg bg-aihub-card border border-aihub-border text-sm outline-none focus:border-aihub-accent resize-y" />}</label>
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <p className="text-xs text-aihub-muted">Review and edit the correction before using it. Replacement is available only while the original field is unchanged.</p>
      </div>
      <footer className="flex justify-end gap-2 px-6 pb-5 flex-wrap">
        {error && <button className="px-3 py-2 text-sm text-aihub-muted" disabled={busy || applying} onClick={() => void correct()}>Try again</button>}
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-aihub-border text-sm hover:bg-aihub-card disabled:opacity-40" disabled={busy || applying || !corrected.trim()} onClick={() => void action('copy')}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy correction'}</button>
        {request.canReplace && <button className="px-4 py-2 rounded-lg bg-aihub-accent text-white text-sm disabled:opacity-40" disabled={busy || applying || !corrected.trim()} onClick={() => void action('apply')}>{applying ? 'Replacing…' : 'Replace selection'}</button>}
      </footer>
    </div>
  </div>, document.body)
}
