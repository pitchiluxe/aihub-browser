import React, { useState, useEffect, useRef } from 'react'
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react'

// Chrome-style find-in-page bar. Renders inside the 44px strip App reserves
// above the native tab view (the view always paints over host HTML, so the
// bar cannot overlay it — the page shifts down instead).
export default function FindBar({ tabId, onClose }: { tabId: string; onClose: () => void }) {
  const [text, setText] = useState('')
  const [matches, setMatches] = useState<{ active: number; total: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const textRef = useRef('')

  useEffect(() => { inputRef.current?.focus() }, [])

  // Live match counts come back asynchronously via tab events.
  useEffect(() => {
    const off = window.electronAPI.tabView.onEvent((tid: string, type: string, payload: any) => {
      if (tid !== tabId || type !== 'found-in-page') return
      setMatches({ active: payload?.activeMatchOrdinal || 0, total: payload?.matches || 0 })
    })
    return () => {
      try { off?.() } catch {}
      window.electronAPI.tabView.stopFind(tabId, 'clearSelection').catch?.(() => {})
    }
  }, [tabId])

  const search = (value: string) => {
    setText(value)
    textRef.current = value
    const q = value.trim()
    if (q) window.electronAPI.tabView.find(tabId, q, true, false)
    else { window.electronAPI.tabView.stopFind(tabId, 'clearSelection'); setMatches(null) }
  }

  const step = (forward: boolean) => {
    const q = textRef.current.trim()
    if (q) window.electronAPI.tabView.find(tabId, q, forward, true)
  }

  return (
    <div
      className="absolute top-0 left-0 right-0 flex items-center justify-end"
      style={{ height: 44, padding: '0 16px', zIndex: 30 }}
    >
      <div
        className="flex items-center gap-2 rounded-xl px-3"
        style={{
          height: 34, background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)', backdropFilter: 'blur(12px)',
        }}
      >
        <Search size={13} style={{ color: 'rgb(var(--ds-text-4))' }} />
        <input
          ref={inputRef}
          value={text}
          onChange={e => search(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') step(!e.shiftKey)
            if (e.key === 'Escape') onClose()
          }}
          placeholder="Find in page…"
          className="bg-transparent outline-none text-sm"
          style={{ width: 200, color: 'rgb(var(--ds-text-2))', userSelect: 'text' }}
        />
        <span className="text-xs tabular-nums" style={{ color: 'rgb(var(--ds-text-4))', minWidth: 44, textAlign: 'right' }}>
          {matches && text.trim() ? `${matches.active}/${matches.total}` : ''}
        </span>
        <div className="flex items-center gap-0.5" style={{ borderLeft: '1px solid var(--ds-border-sm)', paddingLeft: 6 }}>
          <FindBtn title="Previous match (Shift+Enter)" onClick={() => step(false)}><ChevronUp size={13} /></FindBtn>
          <FindBtn title="Next match (Enter)" onClick={() => step(true)}><ChevronDown size={13} /></FindBtn>
          <FindBtn title="Close (Esc)" onClick={onClose}><X size={13} /></FindBtn>
        </div>
      </div>
    </div>
  )
}

function FindBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex items-center justify-center rounded-md transition-all"
      style={{ width: 24, height: 24, border: 'none', background: 'transparent', cursor: 'pointer', color: 'rgb(var(--ds-text-3))' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--ds-glass-md)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
    >
      {children}
    </button>
  )
}
