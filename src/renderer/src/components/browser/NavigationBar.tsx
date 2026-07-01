import React, { useState, useRef, useEffect } from 'react'
import {
  ChevronLeft, ChevronRight, RotateCw, Home, Bookmark, Bot,
  Lock, AlertTriangle, PanelLeft, Pencil, Search, Globe,
} from 'lucide-react'
import { useBrowserStore } from '../../store/browserStore'

interface Props {
  onNavigate: (url: string) => void
  onHome:     () => void
  onBack:     () => void
  onForward:  () => void
  onReload:   () => void
  canGoBack:    boolean
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
  const {
    tabs, activeTabId, toggleAIPanel, setAddBookmarkOpen,
    bookmarks, toggleSidebar, isSidebarOpen,
    isAnnotationMode, toggleAnnotationMode,
  } = useBrowserStore()

  const activeTab = tabs.find(t => t.id === activeTabId)

  const [urlInput,  setUrlInput]  = useState('')
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
    const url = isUrl(q)
      ? (q.startsWith('http') ? q : `https://${q}`)
      : `https://www.google.com/search?q=${encodeURIComponent(q)}`
    onNavigate(url)
    setIsEditing(false)
    inputRef.current?.blur()
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  return (
    <div
      className="drag-region flex items-center ds-navbar"
      style={{ height: 52, padding: '0 10px', gap: 8 }}
    >
      {/* Sidebar toggle */}
      <div className="no-drag">
        <NavBtn onClick={toggleSidebar} title="Toggle sidebar" active={isSidebarOpen}>
          <PanelLeft size={14} />
        </NavBtn>
      </div>

      <Divider />

      {/* Navigation cluster */}
      <div className="flex items-center gap-1 no-drag">
        <NavBtn
          onClick={() => {
            const realBack = liveCanGoBack?.() ?? canGoBack
            if (realBack) onBack()
            else if (activeTab?.fromHome) onHome()
          }}
          disabled={(!canGoBack && !activeTab?.fromHome) || isSpecialPage}
          title="Back (Alt+Left)"
        >
          <ChevronLeft size={16} />
        </NavBtn>

        <NavBtn onClick={onForward} disabled={!canGoForward || isSpecialPage} title="Forward (Alt+Right)">
          <ChevronRight size={16} />
        </NavBtn>

        <NavBtn onClick={onReload} disabled={isSpecialPage} title="Reload (Ctrl+R)">
          <RotateCw size={13} />
        </NavBtn>

        <NavBtn onClick={onHome} title="Home">
          <Home size={13} />
        </NavBtn>
      </div>

      {/* Floating URL bar */}
      <form onSubmit={handleSubmit} className="no-drag" style={{ flex: 1, padding: '0 4px' }}>
        <div
          className="ds-urlbar"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            height: 36, padding: '0 14px',
          }}
        >
          {/* Protocol / status icon */}
          <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            {isSpecialPage ? (
              <span style={{
                fontSize: 9, color: 'rgb(159,132,255)',
                textShadow: '0 0 8px rgba(107,78,255,0.6)',
              }}>◆</span>
            ) : activeTab?.url && activeTab.url !== 'home' ? (
              isSecure
                ? <Lock size={10} style={{ color: 'rgba(52,211,153,0.80)' }} />
                : <AlertTriangle size={10} style={{ color: 'rgba(251,191,36,0.80)' }} />
            ) : (
              <Globe size={11} style={{ color: 'rgba(96,102,130,0.7)' }} />
            )}
          </span>

          <input
            ref={inputRef}
            value={isEditing
              ? urlInput
              : (isSpecialPage ? `aihub://${activeTab?.pageType}` : displayUrl)}
            onChange={e => setUrlInput(e.target.value)}
            onFocus={() => {
              setIsEditing(true)
              setUrlInput(displayUrl)
              setTimeout(() => inputRef.current?.select(), 10)
            }}
            onBlur={() => setIsEditing(false)}
            placeholder="Search or enter URL…"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 12.5, fontWeight: 450,
              textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              color: isEditing
                ? 'rgb(248,248,248)'
                : displayUrl
                  ? 'rgb(184,184,199)'
                  : 'rgb(96,102,130)',
              letterSpacing: isEditing ? '0' : '0.01em',
              userSelect: 'text',
            }}
          />

          {/* Search icon visible when editing */}
          {isEditing && (
            <span style={{ flexShrink: 0 }}>
              <Search size={10} style={{ color: 'rgba(107,78,255,0.6)' }} />
            </span>
          )}
        </div>
      </form>

      {/* Right-side action buttons */}
      <div className="flex items-center gap-1 no-drag">
        <NavBtn
          onClick={() => setAddBookmarkOpen(true)}
          title={isBookmarked ? 'Bookmarked' : 'Bookmark page'}
          active={isBookmarked}
        >
          <Bookmark size={13} fill={isBookmarked ? 'currentColor' : 'none'} />
        </NavBtn>

        <NavBtn
          onClick={toggleAnnotationMode}
          title="Annotate page"
          active={isAnnotationMode}
        >
          <Pencil size={13} />
        </NavBtn>

        {/* AI assistant button — purple accent */}
        <AIButton onClick={toggleAIPanel} />
      </div>
    </div>
  )
}

function AIButton({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      title="AI Assistant (Ctrl+Shift+A)"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="no-drag flex items-center gap-1.5 rounded-xl"
      style={{
        height: 32, padding: '0 12px', cursor: 'pointer',
        background: hovered
          ? 'linear-gradient(135deg, rgb(107,78,255), rgb(126,92,255))'
          : 'linear-gradient(135deg, rgba(107,78,255,0.22), rgba(126,92,255,0.16))',
        border: `1px solid ${hovered ? 'rgba(159,132,255,0.50)' : 'rgba(107,78,255,0.32)'}`,
        color: hovered ? '#fff' : 'rgb(159,132,255)',
        boxShadow: hovered
          ? '0 4px 20px rgba(107,78,255,0.45), 0 0 0 1px rgba(159,132,255,0.2)'
          : '0 2px 10px rgba(107,78,255,0.20)',
        transition: 'all 0.18s cubic-bezier(0.34,1.2,0.64,1)',
        transform: hovered ? 'translateY(-1px) scale(1.02)' : 'translateY(0) scale(1)',
      }}
    >
      <Bot size={13} />
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.02em' }}>AI</span>
    </button>
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
      className="ds-navbtn"
      style={{
        opacity: disabled ? 0.2 : 1,
        color: active
          ? 'rgb(159,132,255)'
          : hovered && !disabled
            ? 'rgb(159,132,255)'
            : 'rgb(96,102,130)',
        background: active
          ? 'rgba(107,78,255,0.16)'
          : hovered && !disabled
            ? 'rgba(107,78,255,0.10)'
            : 'transparent',
        border: `1px solid ${active ? 'rgba(107,78,255,0.28)' : 'transparent'}`,
        boxShadow: active ? '0 0 14px rgba(107,78,255,0.22)' : 'none',
      }}
    >
      {children}
    </button>
  )
}

function Divider() {
  return (
    <div style={{
      width: 1, height: 18, flexShrink: 0, margin: '0 2px',
      background: 'linear-gradient(180deg, transparent, rgba(107,78,255,0.25), transparent)',
    }} />
  )
}
