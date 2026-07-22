import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Star, StarOff, MailOpen, Mail, Archive, Trash2, ExternalLink } from 'lucide-react'
import type { ThreadRow } from '../../../services/mailService'

interface Props {
  x: number
  y: number
  thread: ThreadRow
  onClose: () => void
  onOpen: (t: ThreadRow) => void
  onToggleStar: (t: ThreadRow) => void
  onMarkRead: (t: ThreadRow) => void
  onMarkUnread: (t: ThreadRow) => void
  onArchive: (t: ThreadRow) => void
  onTrash: (t: ThreadRow) => void
}

interface Item {
  label: string
  icon: React.ReactNode
  run: () => void
  danger?: boolean
}

// Gmail-style right-click menu for a conversation. Every item mirrors an action
// Gmail itself exposes on a thread, so the menu feels native to anyone who
// knows Gmail: open, star/unstar, toggle read state, archive, delete.
export default function MailContextMenu({
  x, y, thread, onClose,
  onOpen, onToggleStar, onMarkRead, onMarkUnread, onArchive, onTrash,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  // Keep the menu on screen — flip it back from the right/bottom edges once we
  // know its real size, so a row clicked near the window edge isn't clipped.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const nx = Math.min(x, window.innerWidth - width - 8)
    const ny = Math.min(y, window.innerHeight - height - 8)
    setPos({ x: Math.max(8, nx), y: Math.max(8, ny) })
  }, [x, y])

  // Dismiss on any outside click, right-click, scroll or Escape.
  useEffect(() => {
    const close = () => onClose()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const act = (fn: (t: ThreadRow) => void) => () => { fn(thread); onClose() }

  const items: (Item | 'divider')[] = [
    { label: 'Open', icon: <ExternalLink size={14} />, run: act(onOpen) },
    { label: thread.starred ? 'Remove star' : 'Add to favorites',
      icon: thread.starred ? <StarOff size={14} /> : <Star size={14} />, run: act(onToggleStar) },
    thread.unread
      ? { label: 'Mark as read', icon: <MailOpen size={14} />, run: act(onMarkRead) }
      : { label: 'Mark as unread', icon: <Mail size={14} />, run: act(onMarkUnread) },
    'divider',
    { label: 'Archive', icon: <Archive size={14} />, run: act(onArchive) },
    { label: 'Delete', icon: <Trash2 size={14} />, run: act(onTrash), danger: true },
  ]

  return (
    <div
      ref={ref}
      // Stop the mousedown from bubbling to the window listener that closes us.
      onMouseDown={e => e.stopPropagation()}
      onContextMenu={e => e.preventDefault()}
      style={{
        position: 'fixed', left: pos.x, top: pos.y, zIndex: 1000, minWidth: 210,
        padding: 6, borderRadius: 12,
        background: 'var(--ds-panel-bg, rgba(20,24,38,0.98))',
        border: '1px solid var(--ds-border-sm)',
        boxShadow: '0 18px 48px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      {items.map((it, i) =>
        it === 'divider' ? (
          <div key={`d${i}`} style={{ height: 1, margin: '5px 6px', background: 'var(--ds-border-sm)' }} />
        ) : (
          <button
            key={it.label}
            onClick={it.run}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: 'transparent', textAlign: 'left', fontSize: 13,
              color: it.danger ? '#f87171' : 'rgb(var(--ds-text-2))',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = it.danger ? 'rgba(248,113,113,0.12)' : 'var(--ds-glass-sm)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            <span style={{ display: 'flex', color: it.danger ? '#f87171' : 'rgb(var(--ds-text-4))' }}>{it.icon}</span>
            {it.label}
          </button>
        ),
      )}
    </div>
  )
}
