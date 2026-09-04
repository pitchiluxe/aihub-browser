import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { GitCompare, X, Globe, Loader2, Check } from 'lucide-react'
import { useBrowserStore } from '../../store/browserStore'
import { buildPageExtractionScript } from '../../services/pageExtractor'

// Compare Mode — F8: Cross-Tab AI Comparison
// Pick 2+ open pages and let the AI build a side-by-side comparison table.
// We extract each page's text ourselves and hand the AI one well-formed prompt,
// so it doesn't depend on the model driving tools.
const MAX_TABS = 6

export default function CompareModal() {
  const { isCompareOpen, setCompareOpen, tabs, tabWcIds } = useBrowserStore()
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Only real web pages with a live view can be read.
  const candidates = tabs.filter(t => !t.isHome && t.pageType === 'browser' && !t.asleep && tabWcIds[t.id])

  const toggle = (id: string) => {
    setError('')
    setPicked(p => {
      if (p.includes(id)) return p.filter(x => x !== id)
      if (p.length >= MAX_TABS) return p  // hard cap
      return [...p, id]
    })
  }

  const close = () => { setCompareOpen(false); setPicked([]); setError('') }

  const run = async () => {
    if (picked.length < 2 || busy) return
    setBusy(true); setError('')
    try {
      const pages = await Promise.all(picked.map(async id => {
        const t = tabs.find(x => x.id === id)!
        const wcId = tabWcIds[id]
        let text = ''
        try {
          const res = await window.electronAPI.webview.execScript(wcId, buildPageExtractionScript())
          text = res?.ok ? String(res.result || '').trim() : ''
        } catch {}
        return { title: t.title || t.url, url: t.url, text: text.slice(0, 6000) }
      }))
      if (pages.some(p => !p.text)) { setError("Couldn't read one of the pages. Make sure all tabs are fully loaded."); setBusy(false); return }

      const colLabels = pages.map((_, i) => String.fromCharCode(65 + i)) // A, B, C, D, E, F
      const prompt =
        `Compare these ${pages.length} web pages for me. They may be competing products, alternative sources, or related items.\n\n` +
        `Produce a single clear **markdown comparison table** with one row per meaningful attribute (price, features, specs, pros/cons, ratings, etc. — whatever fits the content) and one column per page labeled ${colLabels.map(c => `**${c}**`).join(', ')}. Keep cells short (under 12 words). After the table, give a one-paragraph "Bottom line" noting the best pick per attribute and overall. Be objective and only use what's actually on the pages — don't invent specs.\n\n` +
        `Column key:\n` +
        pages.map((p, i) => `- **${colLabels[i]}** = ${p.title} (${p.url})`).join('\n') + '\n\n' +
        pages.map((p, i) => `## ${colLabels[i]} — ${p.title}\n${p.text}`).join('\n\n')

      const display = pages.length === 2
        ? `⚖️ Compare: **${pages[0].title}** vs **${pages[1].title}**`
        : `⚖️ Compare ${pages.length} pages: ${pages.map(p => p.title).join(', ')}`
      document.dispatchEvent(new CustomEvent('aihub-ai-send', { detail: { text: prompt, display } }))
      close()
    } catch (e: any) {
      setError(e?.message || String(e))
    }
    setBusy(false)
  }

  if (!isCompareOpen) return null

  return createPortal(
    <div
      onClick={close}
      style={{ position: 'fixed', inset: 0, zIndex: 2147483200, background: 'rgba(4,7,15,0.5)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '12vh' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="no-drag"
        style={{
          width: 'min(600px, 92vw)', maxHeight: '72vh', display: 'flex', flexDirection: 'column',
          borderRadius: 18, overflow: 'hidden', background: 'var(--ds-panel-bg, rgba(16,20,34,0.98))',
          backdropFilter: 'blur(34px)', border: '1px solid rgb(var(--ds-accent) / 0.26)',
          boxShadow: '0 30px 90px rgba(0,0,0,0.65)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 18px', borderBottom: '1px solid var(--ds-border-sm)' }}>
          <GitCompare size={17} style={{ color: 'rgb(var(--ds-accent-soft))' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'rgb(var(--ds-text-1, var(--ds-text-2)))' }}>Compare pages</div>
            <div style={{ fontSize: 11.5, color: 'rgb(var(--ds-text-4))' }}>Pick 2-{MAX_TABS} open tabs — the AI builds a side-by-side comparison table</div>
          </div>
          <button onClick={close} style={{ width: 28, height: 28, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--ds-glass-sm)', color: 'rgb(var(--ds-text-4))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={14} /></button>
        </div>

        {/* Tab list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {candidates.length < 2 && (
            <div style={{ padding: '28px 12px', textAlign: 'center', fontSize: 13, color: 'rgb(var(--ds-text-4))', lineHeight: 1.6 }}>
              Open at least two web pages in tabs, then compare them here.
            </div>
          )}
          {candidates.map(t => {
            const idx = picked.indexOf(t.id)
            const sel = idx !== -1
            const disabled = !sel && picked.length >= MAX_TABS
            return (
              <button
                key={t.id}
                onClick={() => !disabled && toggle(t.id)}
                disabled={disabled}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '10px 11px',
                  borderRadius: 11, border: `1px solid ${sel ? 'rgb(var(--ds-accent) / 0.5)' : 'transparent'}`,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.4 : 1,
                  background: sel ? 'rgb(var(--ds-accent) / 0.14)' : 'transparent', textAlign: 'left', marginBottom: 2,
                }}
              >
                <span style={{
                  width: 22, height: 22, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: `1.5px solid ${sel ? 'rgb(var(--ds-accent-soft))' : 'var(--ds-border-sm)'}`,
                  background: sel ? 'rgb(var(--ds-accent) / 0.25)' : 'transparent',
                  fontSize: 11, fontWeight: 800, color: 'rgb(var(--ds-accent-soft))',
                }}>
                  {sel ? (idx < 26 ? String.fromCharCode(65 + idx) : '+') : ''}
                </span>
                {t.favicon ? <img src={t.favicon} style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0 }} /> : <Globe size={16} style={{ flexShrink: 0, color: 'rgb(var(--ds-text-4))' }} />}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'rgb(var(--ds-text-2))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title || t.url}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'rgb(var(--ds-text-4))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.url}</span>
                </span>
                {sel && <Check size={14} style={{ flexShrink: 0, color: 'rgb(var(--ds-accent-soft))' }} />}
              </button>
            )
          })}
        </div>

        {error && <div style={{ padding: '8px 16px', fontSize: 11.5, color: '#f87171', borderTop: '1px solid var(--ds-border-sm)' }}>{error}</div>}

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderTop: '1px solid var(--ds-border-sm)' }}>
          <span style={{ fontSize: 11.5, color: 'rgb(var(--ds-text-4))' }}>{picked.length}/{MAX_TABS} selected (min 2)</span>
          <button
            onClick={run}
            disabled={picked.length < 2 || busy}
            style={{
              marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 11,
              border: 'none', cursor: picked.length >= 2 && !busy ? 'pointer' : 'not-allowed',
              background: picked.length >= 2 && !busy ? 'linear-gradient(135deg, rgb(var(--ds-accent)), rgb(var(--ds-accent-2)))' : 'var(--ds-glass-sm)',
              color: picked.length >= 2 && !busy ? '#fff' : 'rgb(var(--ds-text-4))', fontSize: 13, fontWeight: 800,
              boxShadow: picked.length >= 2 && !busy ? '0 4px 18px rgb(var(--ds-accent) / 0.4)' : 'none',
            }}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <GitCompare size={14} />}
            {busy ? 'Reading pages…' : 'Compare'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

