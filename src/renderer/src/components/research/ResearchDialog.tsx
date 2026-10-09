import React, { useEffect, useRef } from 'react'
export default function ResearchDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { const old = document.activeElement as HTMLElement; ref.current?.focus(); return () => old?.focus() }, [])
  return <div className="research-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><div className="research-dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onKeyDown={e => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    if (e.key === 'Tab') { const nodes = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,select,a[href]') ?? [])]; const first = nodes[0], last = nodes.at(-1); if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last?.focus() } else if (!e.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { e.preventDefault(); first?.focus() } }
  }}><h2>{title}</h2>{children}</div></div>
}
