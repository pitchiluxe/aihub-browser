import React, { useState, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight, RotateCw, Home, Bookmark, Bot, Lock, AlertTriangle, PanelLeft, Pencil } from 'lucide-react'
import { useBrowserStore } from '../../store/browserStore'

interface Props {
  onNavigate: (url: string) => void
  onHome: () => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  canGoBack: boolean
  canGoForward: boolean
  liveCanGoBack?: () => boolean
}

function isUrl(s: string): boolean {
  if (s.startsWith('http://') || s.startsWith('https://')) return true
  if (/^[\w-]+\.[\w.-]+/.test(s)) return true
  return false
}

export default function NavigationBar({
  onNavigate, onHome, onBack, onForward, onReload,
  canGoBack, canGoForward, liveCanGoBack,
}: Props) {
  const { tabs, activeTabId, toggleAIPanel, setAddBookmarkOpen, bookmarks, toggleSidebar, isSidebarOpen, isAnnotationMode, toggleAnnotationMode } = useBrowserStore()
  const activeTab = tabs.find(t => t.id === activeTabId)

  const [urlInput, setUrlInput]   = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const displayUrl    = activeTab?.url === 'home' || !activeTab?.url ? '' : activeTab.url
  const isSecure      = activeTab?.url?.startsWith('https://')
  const isBookmarked  = bookmarks.some(b => b.url === activeTab?.url)
  const isSpecialPage = !!(activeTab?.pageType && activeTab.pageType !== 'browser')

  useEffect(() => { if (!isEditing) setUrlInput(displayUrl) }, [activeTab?.url, isEditing])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const q = urlInput.trim()
    if (!q) return
    const url = isUrl(q) ? (q.startsWith('http') ? q : `https://${q}`) : `https://www.google.com/search?q=${encodeURIComponent(q)}`
    onNavigate(url)
    setIsEditing(false)
    inputRef.current?.blur()
  }

  // Ctrl+L → focus URL bar
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') { e.preventDefault(); inputRef.current?.focus(); inputRef.current?.select() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  return (
    <div className="aero-bar drag-region flex items-center h-11 px-2 gap-1.5">

      {/* Sidebar toggle */}
      <div className="no-drag">
        <NavBtn onClick={toggleSidebar} title="Toggle sidebar" active={isSidebarOpen}>
          <PanelLeft size={13} />
        </NavBtn>
      </div>

      <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />

      {/* Back / Forward / Reload / Home */}
      <div className="flex items-center gap-0.5 no-drag">
        <NavBtn
          onClick={() => {
            const realBack = liveCanGoBack?.() ?? canGoBack
            if (realBack) onBack()
            else if (activeTab?.fromHome) onHome()
          }}
          disabled={(!canGoBack && !activeTab?.fromHome) || isSpecialPage}
          title="Back (Alt+Left)"
        >
          <ChevronLeft size={15} />
        </NavBtn>
        <NavBtn onClick={onForward} disabled={!canGoForward || isSpecialPage} title="Forward (Alt+Right)">
          <ChevronRight size={15} />
        </NavBtn>
        <NavBtn onClick={onReload} disabled={isSpecialPage} title="Reload (Ctrl+R)">
          <RotateCw size={13} />
        </NavBtn>
        <NavBtn onClick={onHome} title="Home">
          <Home size={13} />
        </NavBtn>
      </div>

      {/* Aero URL bar */}
      <form onSubmit={handleSubmit} className="flex-1 no-drag" style={{ padding: '0 6px' }}>
        <div
          className={isEditing ? '' : 'aero-urlbar'}
          style={isEditing ? {
            display: 'flex', alignItems: 'center', gap: 8,
            height: 28, borderRadius: 9999, padding: '0 12px',
            background: 'rgba(59,130,246,0.13)',
            border: '1px solid rgba(59,130,246,0.48)',
            boxShadow: '0 0 0 3px rgba(59,130,246,0.1)',
          } : {
            display: 'flex', alignItems: 'center', gap: 8,
            height: 28, borderRadius: 9999, padding: '0 12px',
          }}
        >
          {/* Security indicator */}
          {!isSpecialPage && activeTab?.url && activeTab.url !== 'home' && (
            <span style={{ flexShrink: 0 }}>
              {isSecure
                ? <Lock size={10} style={{ color: 'rgba(52,211,153,0.85)' }} />
                : <AlertTriangle size={10} style={{ color: 'rgba(251,191,36,0.85)' }} />}
            </span>
          )}
          {isSpecialPage && <span style={{ flexShrink: 0, color: '#60a5fa', fontSize: 10 }}>◆</span>}

          <input
            ref={inputRef}
            value={isEditing ? urlInput : (isSpecialPage ? `aihub://${activeTab?.pageType}` : displayUrl)}
            onChange={e => setUrlInput(e.target.value)}
            onFocus={() => { setIsEditing(true); setUrlInput(displayUrl); setTimeout(() => inputRef.current?.select(), 10) }}
            onBlur={() => setIsEditing(false)}
            placeholder="Search or enter URL…"
            style={{
              flex: 1, background: 'transparent', outline: 'none',
              fontSize: 12, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              color: isEditing ? '#e2e8f0' : '#94a3b8', userSelect: 'text',
            }}
          />
        </div>
      </form>

      {/* Bookmark + Annotate + AI Assistant */}
      <div className="flex items-center gap-0.5 no-drag">
        <NavBtn onClick={() => setAddBookmarkOpen(true)} title={isBookmarked ? 'Bookmarked' : 'Bookmark page'} active={isBookmarked}>
          <Bookmark size={13} fill={isBookmarked ? 'currentColor' : 'none'} />
        </NavBtn>
        <NavBtn onClick={toggleAnnotationMode} title="Annotation tools — draw, highlight, annotate (Ctrl+Shift+A)" active={isAnnotationMode}>
          <Pencil size={13} />
        </NavBtn>
        <NavBtn onClick={toggleAIPanel} title="AI Assistant (toggle)">
          <Bot size={14} />
        </NavBtn>
      </div>
    </div>
  )
}

function NavBtn({ onClick, disabled, title, children, active = false }: {
  onClick: () => void; disabled?: boolean; title?: string; children: React.ReactNode; active?: boolean
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 28, height: 28, borderRadius: 8, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: disabled ? 0.25 : 1,
        color: active ? '#60a5fa' : hovered ? '#e2e8f0' : '#94a3b8',
        background: active ? 'rgba(59,130,246,0.16)' : hovered && !disabled ? 'rgba(255,255,255,0.07)' : 'transparent',
        transition: 'all 0.12s ease',
      }}
    >
      {children}
    </button>
  )
}

