import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Search, Plus, RotateCcw, Bot, PanelLeft, Pencil, BookmarkPlus, Volume2,
  Home, FlaskConical, Sparkles, StickyNote, History, Download, Puzzle, Wifi,
  Shield, Mail, BookOpen, Settings, Globe, ArrowRight, CornerDownLeft, GitCompare, BellRing,
  Smartphone, Laptop, BookMarked, Layers, Columns2, PictureInPicture2, Camera, CopyMinus,
  GraduationCap, Archive, Brain, Table,
} from 'lucide-react'
import { useBrowserStore } from '../../store/browserStore'

import type { PageType } from '../../../../shared/pageTypes'
export type { PageType }

interface Cmd {
  id: string
  label: string
  hint?: string
  group: 'Actions' | 'Go to' | 'Tabs' | 'Workspaces' | 'Bookmarks' | 'Search'
  icon: React.ReactNode
  keywords?: string
  run: () => void
}

interface Props {
  onNavigate: (url: string) => void
  onOpenPage: (p: PageType) => void
  onReadAloud: () => void
  onFind: () => void
  onAddBookmark: () => void
  onCompare: () => void
  onSendTabs: () => void
  onReceiveTabs: () => void
}

// A single fuzzy launcher (Ctrl+K) for everything: jump to any open tab or
// bookmark, open any app page, or fire a common action — all from the keyboard.
export default function CommandPalette({ onNavigate, onOpenPage, onReadAloud, onFind, onAddBookmark, onCompare, onSendTabs, onReceiveTabs }: Props) {
  const {
    isCmdPaletteOpen, setCmdPaletteOpen,
    tabs, bookmarks, setActiveTab, addTab, reopenClosedTab,
    toggleAIPanel, toggleSidebar, toggleAnnotationMode,
  } = useBrowserStore()

  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const close = () => setCmdPaletteOpen(false)

  useEffect(() => {
    if (isCmdPaletteOpen) {
      setQuery(''); setSel(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [isCmdPaletteOpen])

  // Saved workspaces, loaded when the palette opens so the list is always the
  // one on disk (another window may have saved one since this render).
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string; tabs: any[] }[]>([])
  const [containers, setContainers] = useState<{ id: string; name: string; color: string }[]>([])
  useEffect(() => {
    if (!isCmdPaletteOpen) return
    window.electronAPI.workspaces.list().then((ws: any[]) => setWorkspaces(ws || [])).catch(() => {})
    window.electronAPI.containers.list().then((cs: any[]) => setContainers(cs || [])).catch(() => {})
  }, [isCmdPaletteOpen])

  const tabSnapshot = () => {
    const state = useBrowserStore.getState()
    return {
      tabs: state.tabs.map(t => ({ url: t.url, title: t.title, pageType: t.pageType })),
      activeIndex: Math.max(0, state.tabs.findIndex(t => t.id === state.activeTabId)),
    }
  }

  // Name a workspace after what is actually in it — "tradingview + 3 more" —
  // so saving never needs a modal or a second keystroke.
  const suggestWorkspaceName = () => {
    const real = useBrowserStore.getState().tabs.filter(t => !t.isHome && /^https?:/i.test(t.url))
    if (!real.length) return 'Workspace'
    let host = real[0].url
    try { host = new URL(real[0].url).hostname.replace(/^www\./, '') } catch {}
    return real.length > 1 ? `${host} + ${real.length - 1} more` : host
  }

  const restoreSaved = (saved: { tabs: any[]; activeIndex?: number } | null) => {
    if (!saved?.tabs?.length) return
    useBrowserStore.getState().restoreTabs(saved.tabs, saved.activeIndex ?? 0)
  }

  const pageIcon: Record<string, React.ReactNode> = {
    research: <FlaskConical size={15} />, agents: <Bot size={15} />, notes: <StickyNote size={15} />,
    rewind: <History size={15} />, watch: <BellRing size={15} />, history: <History size={15} />, downloads: <Download size={15} />, extensions: <Puzzle size={15} />,
    wifi: <Wifi size={15} />, vpn: <Shield size={15} />, mail: <Mail size={15} />,
    manual: <BookOpen size={15} />, settings: <Settings size={15} />,
    bible: <BookMarked size={15} />, study: <GraduationCap size={15} />,
    vault: <Archive size={15} />, recall: <Brain size={15} />,
  }

  const commands: Cmd[] = useMemo(() => {
    const out: Cmd[] = []
    const act = (id: string, label: string, icon: React.ReactNode, run: () => void, keywords?: string, hint?: string) =>
      out.push({ id, label, group: 'Actions', icon, run: () => { run(); close() }, keywords, hint })

    act('new-tab', 'New Tab', <Plus size={15} />, () => addTab(), 'open create', 'Ctrl+T')
    act('export-tables', 'Export a table from this page to CSV', <Table size={15} />,
      () => useBrowserStore.getState().setTableExportOpen(true),
      'csv spreadsheet excel sheets table data extract')
    act('reopen', 'Reopen Closed Tab', <RotateCcw size={15} />, () => reopenClosedTab(), 'restore undo', 'Ctrl+Shift+T')
    act('ai', 'Toggle AI Assistant', <Bot size={15} />, () => toggleAIPanel(), 'chat agent', 'Ctrl+Shift+A')
    act('sidebar', 'Toggle Sidebar', <PanelLeft size={15} />, () => toggleSidebar())
    act('annotate', 'Annotate this Page', <Pencil size={15} />, () => toggleAnnotationMode(), 'draw markup')
    act('read', 'Read this Page Aloud', <Volume2 size={15} />, () => onReadAloud(), 'tts speak listen voice audio')
    act('find', 'Find in Page', <Search size={15} />, () => onFind(), 'search text', 'Ctrl+F')
    act('bookmark', 'Add this Page to Sphere', <BookmarkPlus size={15} />, () => onAddBookmark(), 'save', 'Ctrl+D')
    act('compare', 'Compare two pages', <GitCompare size={15} />, () => onCompare(), 'versus vs comparison table diff')
    act('handoff-send', 'Send my tabs to another device', <Smartphone size={15} />, () => onSendTabs(), 'handoff continue phone laptop sync move transfer')
    act('handoff-recv', 'Open tabs from another device', <Laptop size={15} />, () => onReceiveTabs(), 'handoff continue receive pull phone laptop sync')
    act('pip', 'Pop the video out (picture-in-picture)', <PictureInPicture2 size={15} />, async () => {
      const state = useBrowserStore.getState()
      if (state.activeTabId) await window.electronAPI.tabView.pictureInPicture(state.activeTabId)
    }, 'pip float video mini player overlay watch while working')

    act('fullshot', 'Screenshot the whole page', <Camera size={15} />, async () => {
      const state = useBrowserStore.getState()
      if (state.activeTabId) await window.electronAPI.tabView.captureFullPage(state.activeTabId)
    }, 'capture scrolling screenshot save image long page')

    act('merge-dupes', 'Merge duplicate tabs', <CopyMinus size={15} />, () => {
      useBrowserStore.getState().mergeDuplicateTabs()
    }, 'close duplicates tidy clean up same page twice')

    act('split', 'Split view — show two tabs side by side', <Columns2 size={15} />, () => {
      const state = useBrowserStore.getState()
      if (state.splitTabId) { state.setSplitTab(null); return }
      // Pair with the next real browsing tab after the active one; wrapping
      // round means a split still works from the last tab in the strip.
      const order = state.tabs
      const at = order.findIndex(t => t.id === state.activeTabId)
      const partner = [...order.slice(at + 1), ...order.slice(0, Math.max(at, 0))]
        .find(t => t.id !== state.activeTabId)
      if (partner) state.setSplitTab(partner.id)
    }, 'split screen side by side two panes compare dual')

    act('session-previous', 'Reopen my previous session', <RotateCcw size={15} />,
      async () => restoreSaved(await window.electronAPI.session.getPrevious()),
      'restore tabs last time yesterday reopen session')
    act('workspace-save', `Save these tabs as a workspace`, <Layers size={15} />,
      async () => {
        const { tabs: snap, activeIndex } = tabSnapshot()
        await window.electronAPI.workspaces.save(suggestWorkspaceName(), snap, activeIndex)
      }, 'workspace save group set of tabs project')

    const pages: [PageType, string][] = [
      ['research', 'Research Mode'], ['agents', 'Agent Mode'], ['notes', 'Sticky Notes'],
      ['rewind', 'Rewind — search what you\'ve read'], ['watch', 'Watch & Ping — track a page for changes'],
      ['bible', 'Bible — read, highlight and study'], ['study', 'Bible Study — daily verse, courses and memorisation'], ['history', 'History'], ['downloads', 'Downloads'],
      ['vault', 'Page Vault — copies of the pages you bookmarked'],
      ['recall', 'Recall — review what you highlighted'],
      ['extensions', 'Extensions'], ['wifi', 'Free WiFi'], ['vpn', 'VPN / Proxy'], ['mail', 'Mail'],
      ['manual', 'User Manual'], ['settings', 'Settings'],
    ]
    out.push({ id: 'go-home', label: 'Home', group: 'Go to', icon: <Home size={15} />, run: () => { addTab('home', 'browser'); close() }, keywords: 'start new tab' })
    for (const [p, label] of pages) {
      out.push({ id: `go-${p}`, label, group: 'Go to', icon: pageIcon[p] ?? <Sparkles size={15} />, run: () => { onOpenPage(p); close() } })
    }

    for (const t of tabs) {
      out.push({
        id: `tab-${t.id}`, label: t.title || (t.isHome ? 'New Tab' : t.url), group: 'Tabs',
        icon: t.favicon ? <img src={t.favicon} style={{ width: 15, height: 15, borderRadius: 3 }} /> : <Globe size={15} />,
        hint: t.isHome ? 'Home' : t.url, keywords: t.url,
        run: () => { setActiveTab(t.id); close() },
      })
    }

    for (const c of containers) {
      out.push({
        id: `container-${c.id}`,
        label: `New tab in ${c.name}`,
        group: 'Actions',
        icon: <span style={{ width: 10, height: 10, borderRadius: 999, background: c.color, display: 'inline-block' }} />,
        hint: 'Separate cookies and logins',
        keywords: `container profile isolate ${c.name} account separate session`,
        run: () => { addTab('home', 'browser', c.id); close() },
      })
    }

    for (const w of workspaces) {
      out.push({
        id: `ws-${w.id}`, label: w.name, group: 'Workspaces', icon: <Layers size={15} />,
        hint: `${w.tabs.length} tab${w.tabs.length === 1 ? '' : 's'}`,
        keywords: 'workspace open restore set of tabs',
        run: () => { restoreSaved(w as any); close() },
      })
    }

    for (const b of bookmarks) {
      out.push({
        id: `bm-${b.id}`, label: b.title, group: 'Bookmarks',
        icon: b.favicon ? <img src={b.favicon} style={{ width: 15, height: 15, borderRadius: 3 }} /> : <Globe size={15} />,
        hint: b.url, keywords: `${b.url} ${b.category || ''}`,
        run: () => { addTab(b.url, 'browser'); close() },
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, bookmarks, workspaces, containers])

  const filtered = useMemo(() => {
    const raw = query.trim()
    if (!raw) return commands
    const q = raw.toLowerCase()
    const matches = commands.filter(c => (c.label + ' ' + (c.hint || '') + ' ' + (c.keywords || '')).toLowerCase().includes(q))
    // Always offer to open what was typed — as a URL if it looks like one,
    // otherwise as a web search in a new tab.
    const looksUrl = /^https?:\/\//i.test(raw) || /^[\w-]+\.[\w.-]{2,}(\/|$)/.test(raw)
    const go: Cmd = looksUrl
      ? { id: 'go-url', label: `Go to ${raw}`, group: 'Search', icon: <Globe size={15} />, run: () => { onNavigate(raw.startsWith('http') ? raw : `https://${raw}`); close() } }
      : { id: 'go-search', label: `Search the web for “${raw}”`, group: 'Search', icon: <Search size={15} />, run: () => { addTab(`https://www.google.com/search?q=${encodeURIComponent(raw)}`, 'browser'); close() } }
    // A URL with no command match goes first (that's clearly the intent);
    // otherwise real command matches win the default Enter and the web-search
    // fallback sits at the end.
    return (looksUrl && matches.length === 0) ? [go, ...matches] : [...matches, go]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commands, query])

  useEffect(() => { setSel(0) }, [query])

  // Keep the highlighted row in view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  if (!isCmdPaletteOpen) return null

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); filtered[sel]?.run() }
    else if (e.key === 'Escape') { e.preventDefault(); close() }
  }

  return createPortal(
    <div
      onClick={close}
      style={{ position: 'fixed', inset: 0, zIndex: 2147483200, background: 'rgba(4,7,15,0.5)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '11vh' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="no-drag"
        style={{
          width: 'min(620px, 92vw)', maxHeight: '70vh', display: 'flex', flexDirection: 'column',
          borderRadius: 18, overflow: 'hidden',
          background: 'var(--ds-panel-bg, rgba(16,20,34,0.98))',
          backdropFilter: 'blur(34px)', WebkitBackdropFilter: 'blur(34px)',
          border: '1px solid rgb(var(--ds-accent) / 0.26)',
          boxShadow: '0 30px 90px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.06)',
          animation: 'cmdPop .16s cubic-bezier(0.34,1.2,0.64,1)',
        }}
      >
        <style>{`@keyframes cmdPop{from{opacity:0;transform:translateY(-10px) scale(.98)}to{opacity:1;transform:none}}`}</style>

        {/* Search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '15px 18px', borderBottom: '1px solid var(--ds-border-sm)' }}>
          <Search size={17} style={{ color: 'rgb(var(--ds-accent-soft))', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search tabs, bookmarks, pages, actions…"
            style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', fontSize: 15, color: 'rgb(var(--ds-text-1, var(--ds-text-2)))', userSelect: 'text' }}
          />
          <kbd style={{ fontSize: 10, fontWeight: 700, color: 'rgb(var(--ds-text-4))', border: '1px solid var(--ds-border-sm)', borderRadius: 6, padding: '2px 6px' }}>ESC</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {filtered.length === 0 && (
            <div style={{ padding: '28px 10px', textAlign: 'center', fontSize: 13, color: 'rgb(var(--ds-text-4))' }}>No matches for “{query}”</div>
          )}
          {/* Iterate in filtered order so the keyboard index (filtered[sel])
              always matches the rendered row; emit a header when the group
              changes. */}
          {filtered.map((c, idx) => {
            const active = idx === sel
            const showHeader = idx === 0 || filtered[idx - 1].group !== c.group
            return (
              <React.Fragment key={c.id}>
                {showHeader && (
                  <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgb(var(--ds-text-4) / 0.8)', padding: '8px 10px 4px' }}>{c.group}</div>
                )}
                <button
                  data-idx={idx}
                  onMouseEnter={() => setSel(idx)}
                  onClick={() => c.run()}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '9px 11px',
                    borderRadius: 11, border: 'none', cursor: 'pointer', textAlign: 'left', marginBottom: 1,
                    background: active ? 'rgb(var(--ds-accent) / 0.16)' : 'transparent',
                  }}
                >
                  <span style={{ flexShrink: 0, width: 20, display: 'flex', justifyContent: 'center', color: active ? 'rgb(var(--ds-accent-soft))' : 'rgb(var(--ds-text-3))' }}>{c.icon}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 500, color: 'rgb(var(--ds-text-2))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
                  {c.hint && <span style={{ flexShrink: 0, maxWidth: 220, fontSize: 11, color: 'rgb(var(--ds-text-4))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.hint}</span>}
                  {active && <CornerDownLeft size={13} style={{ flexShrink: 0, color: 'rgb(var(--ds-accent-soft))' }} />}
                </button>
              </React.Fragment>
            )
          })}
        </div>

        {/* Footer hint */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 16px', borderTop: '1px solid var(--ds-border-sm)', fontSize: 10.5, color: 'rgb(var(--ds-text-4))' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><ArrowRight size={11} style={{ transform: 'rotate(90deg)' }} /> navigate</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><CornerDownLeft size={11} /> open</span>
          <span style={{ marginLeft: 'auto' }}>Ctrl+K anytime</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
