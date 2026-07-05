import React, { useState, useRef, useEffect } from 'react'
import { X, Plus, Home, Minus, Square } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useBrowserStore, Tab } from '../../store/browserStore'

export default function TabBar() {
  const { tabs, activeTabId, addTab, closeTab, closeOtherTabs, closeTabsToRight, setActiveTab, reorderTabs } = useBrowserStore()

  // Native context menu — an HTML dropdown would be clipped by the 40px bar
  // and painted over by the active tab's BrowserView.
  const handleContextMenu = async (e: React.MouseEvent, tab: Tab) => {
    e.preventDefault()
    const idx = tabs.findIndex(t => t.id === tab.id)
    const action = await window.electronAPI.tabs.showContextMenu({
      isBrowser: !tab.isHome && tab.pageType === 'browser',
      hasRight: idx !== -1 && idx < tabs.length - 1,
      count: tabs.length,
    })
    switch (action) {
      case 'new-tab':      addTab(); break
      case 'duplicate':    addTab(tab.isHome ? 'home' : tab.url, tab.pageType); break
      case 'reload':       window.electronAPI.tabView.reload(tab.id); break
      case 'close':        closeTab(tab.id); break
      case 'close-others': closeOtherTabs(tab.id); break
      case 'close-right':  closeTabsToRight(tab.id); break
    }
  }

  const dragTabId  = useRef<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)

  // Keep the active tab visible — with many tabs open the strip scrolls, and
  // without this a newly opened or switched-to tab could sit off-screen.
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-tab-id="${activeTabId}"]`)
    el?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
  }, [activeTabId, tabs.length])

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
      className="flex items-stretch px-2 drag-region ds-tabbar relative"
      style={{ minHeight: 40, height: 40 }}
    >
      {/* Purple ambient glow strip along top */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 1, pointerEvents: 'none',
        background: 'linear-gradient(90deg, transparent 0%, rgb(var(--ds-accent) / 0.4) 50%, transparent 100%)',
        zIndex: 1,
      }} />

      {/* Scrollable tab strip — tabs shrink to fit and only scroll once they
          hit their minimum width, so none get pushed off behind the window
          controls (which now live outside this container and stay pinned). */}
      <div
        ref={stripRef}
        className="flex items-end gap-1 overflow-x-auto no-scrollbar min-w-0 flex-1"
        onWheel={e => {
          // Vertical wheel scrolls the strip horizontally (scrollbar is hidden)
          if (e.deltaY !== 0 && stripRef.current) stripRef.current.scrollLeft += e.deltaY
        }}
      >
        <AnimatePresence initial={false}>
          {tabs.map(tab => (
            <TabItem
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              isDropTarget={dropTarget === tab.id && dragTabId.current !== tab.id}
              onActivate={() => setActiveTab(tab.id)}
              onClose={() => closeTab(tab.id)}
              onContextMenu={e => handleContextMenu(e, tab)}
              onDragStart={e => handleDragStart(e, tab.id)}
              onDragOver={e => handleDragOver(e, tab.id)}
              onDrop={e => handleDrop(e, tab.id)}
              onDragEnd={handleDragEnd}
            />
          ))}
        </AnimatePresence>

        {/* New tab button */}
        <NewTabBtn onClick={() => addTab()} />

        {/* Draggable filler — collapses to 0 once tabs fill the strip */}
        <div style={{ flex: '1 0 12px', minWidth: 12, alignSelf: 'stretch' }} className="drag-region" />
      </div>

      {/* Window controls — pinned right, always visible regardless of tab count */}
      <div className="flex items-center self-center gap-1.5 pl-2 pr-1 no-drag shrink-0">
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

function TabItem({ tab, isActive, isDropTarget, onActivate, onClose, onContextMenu, onDragStart, onDragOver, onDrop, onDragEnd }: {
  tab: Tab
  isActive: boolean
  isDropTarget: boolean
  onActivate: () => void
  onClose: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <motion.div
      data-tab-id={tab.id}
      initial={{ maxWidth: 0, minWidth: 0, opacity: 0, y: 4 }}
      animate={{ maxWidth: 176, minWidth: 46, opacity: 1, y: 0 }}
      exit={{ maxWidth: 0, minWidth: 0, opacity: 0, y: 4 }}
      transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onActivate}
      onContextMenu={onContextMenu}
      className={`ds-tab no-drag select-none ${isActive ? 'ds-tab-active' : isDropTarget ? 'ds-tab-inactive' : 'ds-tab-inactive'}`}
      style={{
        // Flexible width: grow toward 176px, shrink to the 46px minimum
        // (favicon + close still visible) as more tabs open; the strip
        // scrolls only once every tab is at its minimum.
        flex: '1 1 176px',
        overflow: 'hidden',
        marginBottom: 2,
        ...(isDropTarget && !isActive ? {
          background: 'rgb(var(--ds-accent) / 0.10)',
          borderColor: 'rgb(var(--ds-accent) / 0.28)',
          color: 'rgb(var(--ds-accent-soft))',
        } : {}),
        ...(isActive ? { animation: 'tabGlow 3s ease-in-out infinite' } : {}),
      }}
    >
      {/* Favicon */}
      <span className="shrink-0 flex items-center">
        {tab.isHome ? (
          <Home size={11} style={{ color: isActive ? 'rgb(var(--ds-accent-soft))' : 'inherit' }} />
        ) : tab.favicon ? (
          <img src={tab.favicon} style={{ width: 13, height: 13, borderRadius: 3, objectFit: 'contain' }} />
        ) : (
          <span style={{
            width: 13, height: 13, borderRadius: 3, display: 'inline-block',
            background: isActive ? 'rgb(var(--ds-accent) / 0.3)' : 'var(--ds-glass-md)',
          }} />
        )}
      </span>

      {/* Title */}
      <span style={{
        flex: 1, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap', userSelect: 'none',
        color: isActive ? 'rgb(var(--ds-text-2))' : undefined,
      }}>
        {tab.title || 'Loading…'}
      </span>

      {/* Loading spinner */}
      {tab.isLoading && (
        <span className="shrink-0" style={{
          width: 11, height: 11, borderRadius: '50%',
          border: '1.5px solid rgb(var(--ds-accent) / 0.3)',
          borderTopColor: 'rgb(var(--ds-accent-soft))',
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
          color: 'rgb(var(--ds-text-3) / 0.6)',
        }}
        onMouseEnter={e => {
          const el = e.currentTarget as HTMLElement
          el.style.background = 'rgba(239,68,68,0.18)'
          el.style.color = '#f87171'
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLElement
          el.style.background = 'transparent'
          el.style.color = 'rgb(var(--ds-text-3) / 0.6)'
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
        borderRadius: 9, border: `1px solid ${hovered ? 'rgb(var(--ds-accent) / 0.28)' : 'transparent'}`,
        cursor: 'pointer',
        color: hovered ? 'rgb(var(--ds-accent-soft))' : 'rgb(var(--ds-text-4))',
        background: hovered ? 'rgb(var(--ds-accent) / 0.10)' : 'transparent',
        boxShadow: hovered ? '0 0 12px rgb(var(--ds-accent) / 0.18)' : 'none',
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
