import React, { useState, useRef, useEffect } from 'react'
import {
  ChevronLeft, ChevronRight, RotateCw, Home, Bookmark, Bot,
  Lock, AlertTriangle, PanelLeft, Pencil, Search, Globe,
} from 'lucide-react'
import { useBrowserStore } from '../../store/browserStore'
import { addBookmarkWithAI } from '../../services/bookmarkService'

interface Props {
  onNavigate: (url: string) => void
  onHome:     () => void
  onBack:     () => void
  onForward:  () => void
  onReload:   () => void
  canGoBack:    boolean
  canGoForward: boolean
}

function isUrl(s: string): boolean {
  if (s.startsWith('http://') || s.startsWith('https://')) return true
  if (/^[\w-]+\.[\w.-]+/.test(s)) return true
  return false
}

export default function NavigationBar({
  onNavigate, onHome, onBack, onForward, onReload,
  canGoBack, canGoForward,
}: Props) {
  const {
    tabs, activeTabId, toggleAIPanel, isAIPanelOpen,
    bookmarks, addBookmark, removeBookmark, toggleSidebar, isSidebarOpen,
    isAnnotationMode, toggleAnnotationMode,
  } = useBrowserStore()

  const activeTab = tabs.find(t => t.id === activeTabId)

  const [urlInput,  setUrlInput]  = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [bmToast,   setBmToast]   = useState('')
  const [bmBusy,    setBmBusy]    = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showBmToast = (msg: string) => {
    setBmToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setBmToast(''), 2200)
  }

  const displayUrl    = activeTab?.url === 'home' || !activeTab?.url ? '' : activeTab.url
  const isSecure      = activeTab?.url?.startsWith('https://')
  const normUrl = (u?: string) => (u || '').replace(/\/+$/, '').toLowerCase()
  const curBookmark   = activeTab?.url ? bookmarks.find(b => normUrl(b.url) === normUrl(activeTab.url)) : undefined
  const isBookmarked  = !!curBookmark
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

  // One-click add the current page to the sphere (or remove it if already in).
  const handleToggleBookmark = async () => {
    if (bmBusy) return
    const url = activeTab?.url
    if (!url || isSpecialPage) return

    if (curBookmark) {
      removeBookmark(curBookmark.id)
      showBmToast('Removed from sphere')
      return
    }

    setBmBusy(true)
    showBmToast('Adding to sphere…')
    try {
      const result = await addBookmarkWithAI(url, activeTab?.title || '', bookmarks)
      if (result.success && result.bookmark) {
        addBookmark(result.bookmark)
        showBmToast(result.warning ? 'Already in sphere — updated' : 'Added to sphere')
      } else {
        showBmToast(result.error || "Couldn't add page")
      }
    } catch (e: any) {
      showBmToast(`Couldn't add: ${e?.message || e}`)
    } finally {
      setBmBusy(false)
    }
  }

  // Ctrl+L now arrives via the main process (works even when a page inside
  // the BrowserView has focus) as this custom event — see App.tsx.
  useEffect(() => {
    const h = () => {
      inputRef.current?.focus()
      setTimeout(() => inputRef.current?.select(), 10)
    }
    document.addEventListener('aihub-focus-url', h)
    return () => document.removeEventListener('aihub-focus-url', h)
  }, [])

  return (
    <div
      className="drag-region flex items-center ds-navbar"
      style={{ height: 52, padding: '0 10px', gap: 8, position: 'relative' }}
    >
      {/* Add-to-sphere toast — rendered inside the nav-bar chrome (above the
          BrowserView, which always paints over host HTML placed in the page
          region), vertically centered and anchored left of the action group. */}
      {bmToast && (
        <div
          className="no-drag"
          style={{
            position: 'absolute', top: '50%', right: 130, transform: 'translateY(-50%)',
            zIndex: 60, pointerEvents: 'none',
            background: 'rgba(139,92,246,0.95)', color: '#fff',
            borderRadius: 8, padding: '5px 12px', fontSize: 11.5, fontWeight: 700,
            boxShadow: '0 6px 22px rgba(139,92,246,0.4)', whiteSpace: 'nowrap',
          }}
        >
          {bmToast}
        </div>
      )}

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
            if (canGoBack) onBack()
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
                fontSize: 9, color: 'rgb(var(--ds-accent-soft))',
                textShadow: '0 0 8px rgb(var(--ds-accent) / 0.6)',
              }}>◆</span>
            ) : activeTab?.url && activeTab.url !== 'home' ? (
              isSecure
                ? <Lock size={10} style={{ color: 'rgba(52,211,153,0.80)' }} />
                : <AlertTriangle size={10} style={{ color: 'rgba(251,191,36,0.80)' }} />
            ) : (
              <Globe size={11} style={{ color: 'rgb(var(--ds-text-4) / 0.7)' }} />
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
                ? 'rgb(var(--ds-text-1))'
                : displayUrl
                  ? 'rgb(var(--ds-text-3))'
                  : 'rgb(var(--ds-text-4))',
              letterSpacing: isEditing ? '0' : '0.01em',
              userSelect: 'text',
            }}
          />

          {/* Search icon visible when editing */}
          {isEditing && (
            <span style={{ flexShrink: 0 }}>
              <Search size={10} style={{ color: 'rgb(var(--ds-accent) / 0.6)' }} />
            </span>
          )}
        </div>
      </form>

      {/* Right-side action buttons */}
      <div className="flex items-center gap-1 no-drag">
        <NavBtn
          onClick={handleToggleBookmark}
          title={isSpecialPage ? 'Open a page to add it' : isBookmarked ? 'Remove from sphere' : 'Add this page to the sphere'}
          active={isBookmarked}
          disabled={isSpecialPage || bmBusy}
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

        {/* AI assistant button — purple accent — opens the full docked panel */}
        <AIButton onClick={toggleAIPanel} active={isAIPanelOpen} />
      </div>
    </div>
  )
}

function AIButton({ onClick, active }: { onClick: () => void; active?: boolean }) {
  const [hovered, setHovered] = useState(false)
  const lit = hovered || active
  return (
    <button
      onClick={onClick}
      title="AI Assistant (Ctrl+Shift+A)"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="no-drag flex items-center gap-1.5 rounded-xl"
      style={{
        height: 32, padding: '0 12px', cursor: 'pointer',
        background: lit
          ? 'linear-gradient(135deg, rgb(var(--ds-accent)), rgb(var(--ds-accent-2)))'
          : 'linear-gradient(135deg, rgb(var(--ds-accent) / 0.22), rgba(126,92,255,0.16))',
        border: `1px solid ${lit ? 'rgb(var(--ds-accent-soft) / 0.50)' : 'rgb(var(--ds-accent) / 0.32)'}`,
        color: lit ? '#fff' : 'rgb(var(--ds-accent-soft))',
        boxShadow: lit
          ? '0 4px 20px rgb(var(--ds-accent) / 0.45), 0 0 0 1px rgb(var(--ds-accent-soft) / 0.2)'
          : '0 2px 10px rgb(var(--ds-accent) / 0.20)',
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
      className={`ds-navbtn${active ? ' active' : ''}`}
      style={{
        opacity: disabled ? 0.2 : 1,
        color: active || (hovered && !disabled)
          ? 'rgb(var(--ds-accent-soft))'
          : 'rgb(var(--ds-text-4))',
        background: active
          ? 'rgb(var(--ds-accent) / 0.16)'
          : hovered && !disabled
            ? 'rgb(var(--ds-accent) / 0.10)'
            : 'transparent',
        border: `1px solid ${active ? 'rgb(var(--ds-accent) / 0.28)' : 'transparent'}`,
        boxShadow: active ? '0 0 14px rgb(var(--ds-accent) / 0.22)' : 'none',
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
      background: 'linear-gradient(180deg, transparent, rgb(var(--ds-accent) / 0.25), transparent)',
    }} />
  )
}
