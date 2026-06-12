import React, { useState } from 'react'
import { X, Plus, Home, Minus, Square } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useBrowserStore, Tab } from '../../store/browserStore'

export default function TabBar() {
  const { tabs, activeTabId, addTab, closeTab, setActiveTab } = useBrowserStore()

  return (
    <div
      className="flex items-end px-2 gap-1 overflow-x-auto no-scrollbar drag-region"
      style={{
        minHeight: 36, height: 36,
        background: 'linear-gradient(180deg, rgba(8,13,28,0.99) 0%, rgba(11,18,36,0.99) 100%)',
      }}
    >
      <AnimatePresence initial={false}>
        {tabs.map(tab => (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onActivate={() => setActiveTab(tab.id)}
            onClose={() => closeTab(tab.id)}
          />
        ))}
      </AnimatePresence>

      {/* New tab */}
      <NewTabBtn onClick={() => addTab()} />

      {/* Drag spacer — fills remaining width */}
      <div style={{ flex: 1, minWidth: 12 }} className="drag-region" />

      {/* Window controls — right-aligned in tab row, Chrome-style */}
      <div className="flex items-center gap-1.5 pb-0.5 no-drag shrink-0">
        <WinBtn onClick={() => window.electronAPI.window.minimize()} bg="#f59e0b" title="Minimize"><Minus size={8} /></WinBtn>
        <WinBtn onClick={() => window.electronAPI.window.maximize()} bg="#10b981" title="Maximize"><Square size={7} /></WinBtn>
        <WinBtn onClick={() => window.electronAPI.window.close()}    bg="#ef4444" title="Close"><X size={8} /></WinBtn>
      </div>
    </div>
  )
}

function TabItem({ tab, isActive, onActivate, onClose }: {
  tab: Tab; isActive: boolean; onActivate: () => void; onClose: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 178, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onActivate}
      className="shrink-0 group flex items-center gap-1.5 h-7 mb-0.5 px-3 cursor-pointer no-drag overflow-hidden rounded-t-lg"
      style={isActive ? {
        background: 'linear-gradient(180deg, rgba(59,130,246,0.16) 0%, rgba(11,18,40,0.97) 55%)',
        borderTop: '1px solid rgba(96,165,250,0.38)',
        borderLeft: '1px solid rgba(96,165,250,0.13)',
        borderRight: '1px solid rgba(96,165,250,0.13)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.09)',
        color: '#e2e8f0',
        transition: 'none',
      } : {
        color: hovered ? '#cbd5e1' : '#8b9ab5',
        background: hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
        transition: 'background 0.12s, color 0.12s',
        borderTop: '1px solid transparent',
        borderLeft: '1px solid transparent',
        borderRight: '1px solid transparent',
      }}
    >
      {/* Icon */}
      <span className="shrink-0" style={{ display: 'flex', alignItems: 'center' }}>
        {tab.isHome ? (
          <Home size={12} />
        ) : tab.favicon ? (
          <img src={tab.favicon} style={{ width: 14, height: 14, borderRadius: 3, objectFit: 'contain' }} />
        ) : (
          <span style={{ width: 14, height: 14, borderRadius: 3, background: 'rgba(255,255,255,0.1)', display: 'inline-block' }} />
        )}
      </span>

      {/* Title */}
      <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'none' }}>
        {tab.title || 'Loading…'}
      </span>

      {/* Loading spinner */}
      {tab.isLoading && (
        <span className="shrink-0" style={{
          width: 12, height: 12, borderRadius: '50%', display: 'inline-block',
          border: '1.5px solid rgba(96,165,250,0.35)',
          borderTopColor: '#60a5fa',
          animation: 'spin 0.65s linear infinite',
        }} />
      )}

      {/* Close */}
      <button
        onClick={e => { e.stopPropagation(); onClose() }}
        className="shrink-0 flex items-center justify-center"
        style={{
          width: 16, height: 16, borderRadius: 4, border: 'none', cursor: 'pointer',
          background: 'transparent', opacity: hovered || isActive ? 1 : 0, transition: 'all 0.1s',
          color: '#64748b',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.18)'; (e.currentTarget as HTMLElement).style.color = '#f87171' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#64748b' }}
      >
        <X size={9} />
      </button>
    </motion.div>
  )
}

function NewTabBtn({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="shrink-0 no-drag flex items-center justify-center"
      style={{
        width: 28, height: 26, marginBottom: 2, borderRadius: 6, border: 'none', cursor: 'pointer',
        color: hovered ? '#94a3b8' : '#3d4f6b',
        background: hovered ? 'rgba(255,255,255,0.06)' : 'transparent',
        transition: 'all 0.12s',
      }}
    >
      <Plus size={13} />
    </button>
  )
}

function WinBtn({ onClick, bg, title, children }: { onClick: () => void; bg: string; title: string; children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 14, height: 14, borderRadius: '50%', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: bg, opacity: hovered ? 1 : 0.72,
        boxShadow: hovered ? `0 0 10px ${bg}90` : `0 0 5px ${bg}50`,
        transition: 'all 0.12s',
        color: 'rgba(0,0,0,0.65)',
      }}
    >
      <span style={{ opacity: hovered ? 1 : 0, transition: 'opacity 0.1s', fontSize: 8 }}>{children}</span>
    </button>
  )
}
