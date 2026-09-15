import React, { useState } from 'react'
import { X, ChevronUp, ChevronDown } from 'lucide-react'
import { useBrowserStore } from '../../store/browserStore'

interface Props {
  tabId: string
  onClose: () => void
}

export default function BottomSummaryCard({ tabId, onClose }: Props) {
  const insight = useBrowserStore(s => s.currentPageInsight)
  const [expanded, setExpanded] = useState(false)

  if (!insight || insight.tabId !== tabId) return null
  const { bullets, pageType } = insight

  return (
    <div style={{
      position: 'fixed',
      bottom: 14,
      left: 232,   // right of the collapsed/expanded sidebar
      right: 380,  // left of the AIAssistant panel
      zIndex: 90,
      maxHeight: expanded ? 200 : 56,
      overflow: 'hidden',
      transition: 'max-height 0.25s ease',
      background: 'var(--bg-primary)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 10px',
        borderBottom: expanded ? '1px solid var(--border)' : 'none',
        flexShrink: 0,
        cursor: 'pointer',
      }}
        onClick={() => setExpanded(e => !e)}
      >
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: 'var(--accent)',
          flexShrink: 0,
        }} />
        <span style={{
          fontSize: 10, fontWeight: 600, color: 'var(--accent)',
          background: 'rgba(var(--ds-accent) / 0.15)',
          padding: '1px 6px', borderRadius: 99,
          flexShrink: 0, textTransform: 'capitalize',
        }}>
          {pageType}
        </span>
        <span style={{
          flex: 1, fontSize: 11, fontWeight: 600,
          color: 'var(--text-secondary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          AI Summary
        </span>
        <button
          onClick={e => { e.stopPropagation(); setExpanded(e => !e) }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-muted)', display: 'flex' }}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </button>
        <button
          onClick={e => { e.stopPropagation(); onClose() }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-muted)', display: 'flex' }}
        >
          <X size={12} />
        </button>
      </div>

      {/* Bullets */}
      <div style={{ padding: '6px 10px', overflow: 'hidden' }}>
        {bullets.slice(0, expanded ? 3 : 1).map((bullet, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'flex-start', gap: 6,
            fontSize: 11, lineHeight: 1.5,
            color: i === 0 ? 'var(--text)' : 'var(--text-secondary)',
            marginBottom: i < (expanded ? bullets.length - 1 : 0) ? 4 : 0,
          }}>
            <span style={{ color: 'var(--accent)', flexShrink: 0, fontWeight: 700 }}>•</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: i === 0 && !expanded ? 'nowrap' : 'normal' }}>
              {bullet}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
