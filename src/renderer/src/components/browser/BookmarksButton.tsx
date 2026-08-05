import React, { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Library, Search, Globe, X, ExternalLink } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useBrowserStore } from '../../store/browserStore'
import { rankBookmarks, groupByCategory, flattenGroups } from '../../services/bookmarkSearch'

/**
 * Toolbar bookmarks menu — every saved page, one click away.
 *
 * The sphere is the beautiful way to browse bookmarks and a poor way to open a
 * specific one you already have in mind. This is the plain list: search,
 * grouped by category, keyboard-navigable, open in this tab or a new one.
 *
 * Like the VPN picker, the panel is host HTML, so while it is open the store
 * flag makes App detach the active tab's BrowserView — otherwise the page
 * paints straight over it.
 */
export default function BookmarksButton({ onNavigate }: { onNavigate: (url: string) => void }) {
  const { bookmarks, addTab, setBookmarksMenuOpen } = useBrowserStore(useShallow(s => ({
    bookmarks: s.bookmarks,
    addTab: s.addTab,
    setBookmarksMenuOpen: s.setBookmarksMenuOpen,
  })))

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const btnRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<{ top: number; right: number }>({ top: 52, right: 14 })

  useEffect(() => { setBookmarksMenuOpen(open); return () => setBookmarksMenuOpen(false) }, [open, setBookmarksMenuOpen])

  useEffect(() => {
    if (!open) return
    setSel(0)
    const t = setTimeout(() => inputRef.current?.focus(), 20)
    return () => clearTimeout(t)
  }, [open])

  // Ranking and grouping live in services/bookmarkSearch, where they are unit
  // tested — the keyboard order and the drawn order have to agree exactly, and
  // that is easy to get subtly wrong inline.
  const groups = useMemo(() => groupByCategory(rankBookmarks(bookmarks, query)), [bookmarks, query])
  // The flat list the arrow keys walk, in the same order the panel draws.
  const filtered = useMemo(() => flattenGroups(groups), [groups])

  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel, open])

  const openBookmark = (url: string, newTab: boolean) => {
    setOpen(false)
    if (newTab) addTab(url, 'browser')
    else onNavigate(url)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter' && filtered[sel]) {
      e.preventDefault()
      openBookmark(filtered[sel].url, e.ctrlKey || e.metaKey || e.shiftKey)
    }
  }

  const togglePanel = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setAnchor({ top: Math.round(r.bottom + 8), right: Math.round(window.innerWidth - r.right) })
    setQuery('')
    setOpen(o => !o)
  }

  // Running index across groups, so keyboard selection matches what is drawn.
  let renderIndex = -1

  return (
    <>
      <button
        ref={btnRef}
        onClick={togglePanel}
        title={`All bookmarks (${bookmarks.length})`}
        className="no-drag flex items-center justify-center rounded-xl transition-colors"
        style={{
          width: 32, height: 32, cursor: 'pointer',
          background: open ? 'rgb(var(--ds-accent) / 0.16)' : 'transparent',
          border: `1px solid ${open ? 'rgb(var(--ds-accent) / 0.4)' : 'var(--ds-border-sm)'}`,
          color: open ? 'rgb(var(--ds-accent-soft))' : 'rgb(var(--ds-text-3))',
        }}
      >
        <Library size={13} />
      </button>

      {open && createPortal(
        <>
          {/* Click-away catcher, below the panel and above everything else. */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
          />
          <div
            onKeyDown={onKey}
            style={{
              position: 'fixed', top: anchor.top, right: anchor.right, zIndex: 9999,
              width: 340, maxHeight: 'min(60vh, 520px)', display: 'flex', flexDirection: 'column',
              borderRadius: 16, overflow: 'hidden',
              background: 'var(--ds-glass-lg, rgb(var(--ds-bg-2)))',
              border: '1px solid var(--ds-border-sm)',
              boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
              backdropFilter: 'blur(18px)',
            }}
          >
            <div style={{ padding: 10, borderBottom: '1px solid var(--ds-border-sm)' }}>
              <div style={{ position: 'relative' }}>
                <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'rgb(var(--ds-text-4))' }} />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => { setQuery(e.target.value); setSel(0) }}
                  placeholder={`Search ${bookmarks.length} bookmarks…`}
                  style={{
                    width: '100%', padding: '7px 28px 7px 30px', borderRadius: 10, fontSize: 12.5,
                    background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)',
                    color: 'rgb(var(--ds-text-2))', outline: 'none',
                  }}
                />
                {!!query && (
                  <button
                    onClick={() => { setQuery(''); inputRef.current?.focus() }}
                    style={{
                      position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', color: 'rgb(var(--ds-text-4))',
                    }}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            <div ref={listRef} style={{ overflowY: 'auto', padding: '6px 0' }}>
              {groups.map(([category, items]) => (
                <div key={category}>
                  <div style={{
                    padding: '6px 12px 3px', fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
                    textTransform: 'uppercase', color: 'rgb(var(--ds-text-4))',
                  }}>
                    {category}
                  </div>
                  {items.map(b => {
                    renderIndex++
                    const idx = renderIndex
                    return (
                      <div
                        key={b.id}
                        data-idx={idx}
                        onMouseEnter={() => setSel(idx)}
                        onClick={e => openBookmark(b.url, e.ctrlKey || e.metaKey || e.shiftKey)}
                        onAuxClick={e => { if (e.button === 1) { e.preventDefault(); openBookmark(b.url, true) } }}
                        title={`${b.url}\n\nClick to open here · Ctrl/⌘ or middle-click for a new tab`}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', cursor: 'pointer',
                          background: sel === idx ? 'rgb(var(--ds-accent) / 0.14)' : 'transparent',
                        }}
                      >
                        {b.favicon
                          ? <img src={b.favicon} alt="" style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0 }} />
                          : <Globe size={13} style={{ flexShrink: 0, color: 'rgb(var(--ds-text-4))' }} />}
                        <span style={{
                          flex: 1, minWidth: 0, fontSize: 12.5, color: 'rgb(var(--ds-text-2))',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {b.title || b.url}
                        </span>
                        <button
                          onClick={e => { e.stopPropagation(); openBookmark(b.url, true) }}
                          title="Open in a new tab"
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                            color: 'rgb(var(--ds-text-4))', opacity: sel === idx ? 1 : 0,
                          }}
                        >
                          <ExternalLink size={11} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              ))}

              {!filtered.length && (
                <div style={{ padding: '22px 12px', textAlign: 'center', fontSize: 12, color: 'rgb(var(--ds-text-4))' }}>
                  {bookmarks.length ? 'No bookmarks match that' : 'No bookmarks saved yet'}
                </div>
              )}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}
