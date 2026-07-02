import React, { useState, useRef } from 'react'
import { X, Plus, Home, Minus, Square } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useBrowserStore, Tab } from '../../store/browserStore'

export default function TabBar() {
  const { tabs, activeTabId, addTab, closeTab, setActiveTab, reorderTabs } = useBrowserStore()

  const dragTabId  = useRef<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const handleDragStart = (e: React.DragEvent, tabId: string) => {
    dragTabId.current = tabId
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', tabId)
  }
  const handleDragOver = (e: React.DragEvent, tabId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (tabId !== dragTabId.current) setDropTarget(tabId)
  }
  const handleDrop = (e: React.DragEvent, tabId: string) => {
    e.preventDefault()
    if (dragTabId.current && dragTabId.current !== tabId) reorderTabs(dragTabId.current, tabId)
    dragTabId.current = null; setDropTarget(null)
  }
  const handleDragEnd = () => { dragTabId.current = null; setDropTarget(null) }

  return (
    <div
      className="flex items-end px-2 gap-1 overflow-x-auto no-scrollbar drag-region ds-tabbar"
      style={{ minHeight: 40, height: 40 }}
    >
      {/* Purple ambient glow strip along top */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 1, pointerEvents: 'none',
        background: 'linear-gradient(90deg, transparent 0%, rgba(107,78,255,0.4) 50%, transparent 100%)',
        zIndex: 1,
      }} />

      <AnimatePresence initial={false}>
        {tabs.map(tab => (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            isDropTarget={dropTarget === tab.id && dragTabId.current !== tab.id}
            onActivate={() => setActiveTab(tab.id)}
            onClose={() => closeTab(tab.id)}
            onDragStart={e => handleDragStart(e, tab.id)}
            onDragOver={e => handleDragOver(e, tab.id)}
            onDrop={e => handleDrop(e, tab.id)}
            onDragEnd={handleDragEnd}
          />
        ))}
      </AnimatePresence>

      {/* New tab button */}
      <NewTabBtn onClick={() => addTab()} />

      {/* Spacer */}
      <div style={{ flex: 1, minWidth: 12 }} className="drag-region" />

      {/* Window controls — self-center so they don't inherit the bar's items-end and sink to the tab line */}
      <div className="flex items-center self-center gap-1.5 pr-1 no-drag shrink-0">
        <WinBtn onClick={() => window.electronAPI.window.minimize()} bg="#f59e0b" title="Minimize">
          <Minus size={7} />
        </WinBtn>
        <WinBtn onClick={() => window.electronAPI.window.maximize()} bg="#10b981" title="Maximize">
          <Square size={6} />
        </WinBtn>
        <WinBtn onClick={() => window.electronAPI.window.close()} bg="#ef4444" title="Close">
          <X size={7} />
        </WinBtn>
      </div>
    </div>
  )
}

function TabItem({ tab, isActive, isDropTarget, onActivate, onClose, onDragStart, onDragOver, onDrop, onDragEnd }: {
  tab: Tab
  isActive: boolean
  isDropTarget: boolean
  onActivate: () => void
  onClose: () => void
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <motion.div
      initial={{ width: 0, opacity: 0, y: 4 }}
      animate={{ width: 176, opacity: 1, y: 0 }}
      exit={{ width: 0, opacity: 0, y: 4 }}
      transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onActivate}
      className={`shrink-0 ds-tab no-drag select-none ${isActive ? 'ds-tab-active' : isDropTarget ? 'ds-tab-inactive' : 'ds-tab-inactive'}`}
      style={{
        marginBottom: 2,
        ...(isDropTarget && !isActive ? {
          background: 'rgba(107,78,255,0.10)',
          borderColor: 'rgba(107,78,255,0.28)',
          color: 'rgb(159,132,255)',
        } : {}),
        ...(isActive ? { animation: 'tabGlow 3s ease-in-out infinite' } : {}),
      }}
    >
      {/* Favicon */}
      <span className="shrink-0 flex items-center">
        {tab.isHome ? (
          <Home size={11} style={{ color: isActive ? 'rgb(159,132,255)' : 'inherit' }} />
        ) : tab.favicon ? (
          <img src={tab.favicon} style={{ width: 13, height: 13, borderRadius: 3, objectFit: 'contain' }} />
        ) : (
          <span style={{
            width: 13, height: 13, borderRadius: 3, display: 'inline-block',
            background: isActive ? 'rgba(107,78,255,0.3)' : 'rgba(255,255,255,0.08)',
          }} />
        )}
      </span>

      {/* Title */}
      <span style={{
        flex: 1, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap', userSelect: 'none',
        color: isActive ? 'rgb(215,215,228)' : undefined,
      }}>
        {tab.title || 'Loading…'}
      </span>

      {/* Loading spinner */}
      {tab.isLoading && (
        <span className="shrink-0" style={{
          width: 11, height: 11, borderRadius: '50%',
          border: '1.5px solid rgba(107,78,255,0.3)',
          borderTopColor: 'rgb(159,132,255)',
          animation: 'spin 0.65s linear infinite',
          display: 'inline-block', flexShrink: 0,
        }} />
      )}

      {/* Close */}
      <button
        onClick={e => { e.stopPropagation(); onClose() }}
        className="shrink-0 flex items-center justify-center rounded-md no-drag"
        style={{
          width: 16, height: 16, border: 'none', cursor: 'pointer',
          background: 'transparent',
          opacity: hovered || isActive ? 1 : 0,
          transition: 'all 0.12s',
          color: 'rgba(184,184,199,0.6)',
        }}
        onMouseEnter={e => {
          const el = e.currentTarget as HTMLElement
          el.style.background = 'rgba(239,68,68,0.18)'
          el.style.color = '#f87171'
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLElement
          el.style.background = 'transparent'
          el.style.color = 'rgba(184,184,199,0.6)'
        }}
      >
        <X size={8} />
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
        width: 28, height: 26, marginBottom: 2,
        borderRadius: 9, border: `1px solid ${hovered ? 'rgba(107,78,255,0.28)' : 'transparent'}`,
        cursor: 'pointer',
        color: hovered ? 'rgb(159,132,255)' : 'rgb(96,102,130)',
        background: hovered ? 'rgba(107,78,255,0.10)' : 'transparent',
        boxShadow: hovered ? '0 0 12px rgba(107,78,255,0.18)' : 'none',
        transition: 'all 0.15s',
      }}
    >
      <Plus size={12} />
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
        width: 13, height: 13, borderRadius: '50%', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: bg, opacity: hovered ? 1 : 0.65,
        boxShadow: hovered ? `0 0 10px ${bg}90` : `0 0 4px ${bg}40`,
        transition: 'all 0.15s',
        color: 'rgba(0,0,0,0.65)',
      }}
    >
      <span style={{ opacity: hovered ? 1 : 0, transition: 'opacity 0.1s' }}>{children}</span>
    </button>
  )
}
