import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  CornerUpLeft, MessageSquareText, Pencil, Trash2, Copy, Flag, SmilePlus, Check, X,
} from 'lucide-react'
import type { Attachment, Message, Role } from '../../../../shared/community'
import { Avatar, EmptyRoom, timeOf, dayOf } from './bits'
import type { CommunityMember } from './useCommunity'

/**
 * The conversation.
 *
 * Two things here are load-bearing and easy to get wrong.
 *
 * Scroll anchoring: a chat sticks to the bottom, except when you have
 * deliberately scrolled up to read — at which point new arrivals must not yank
 * you back. And when older messages are prepended, the content you were looking
 * at has to stay under your eyes rather than jumping down the page.
 *
 * Mounting: only a window of rows is in the DOM. Scrolling up widens the window
 * before it asks the main process for another page, so the common case of
 * re-reading the last hundred messages costs nothing.
 */

const GROUP_WINDOW_MS = 5 * 60_000
const MOUNT_STEP = 60
const INITIAL_MOUNT = 80

interface Props {
  messages: Message[]
  memberId: string
  memberById: Map<string, CommunityMember>
  roleFor: (memberId: string) => Role | undefined
  channelName: string
  channelDescription: string
  lastReadAt: number
  exhausted: boolean
  canModerate: boolean
  onLoadOlder: () => Promise<number>
  onReply: (message: Message) => void
  onOpenThread: (message: Message) => void
  onEdit: (id: string, body: string) => Promise<{ ok: boolean } | undefined>
  onDelete: (id: string) => void
  onReact: (id: string, reaction: string) => void
  onReport: (id: string) => void
  attachmentUrl: (attachment: Attachment) => string
}

const QUICK_REACTIONS = ['👍', '🎉', '🙏', '👀', '🔥']

export default function MessageList(props: Props) {
  const {
    messages, memberId, memberById, roleFor, channelName, channelDescription,
    lastReadAt, exhausted, canModerate, onLoadOlder, onReply, onOpenThread,
    onEdit, onDelete, onReact, onReport, attachmentUrl,
  } = props

  const scroller = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(INITIAL_MOUNT)
  const [editing, setEditing] = useState<string | null>(null)
  const [pinned, setPinned] = useState(true)
  const loading = useRef(false)

  const visible = useMemo(
    () => messages.slice(Math.max(0, messages.length - mounted)),
    [messages, mounted],
  )
  const hidden = messages.length - visible.length

  // Reset the window when the room changes, or switching channels would leave
  // the previous room's scroll depth applied to a different conversation.
  useEffect(() => { setMounted(INITIAL_MOUNT); setPinned(true) }, [channelName])

  /** Bottom-anchored unless the reader has moved away from it. */
  useLayoutEffect(() => {
    const node = scroller.current
    if (!node || !pinned) return
    node.scrollTop = node.scrollHeight
  }, [visible.length, pinned])

  const onScroll = useCallback(async () => {
    const node = scroller.current
    if (!node) return

    const fromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
    setPinned(fromBottom < 120)

    if (node.scrollTop > 200 || loading.current) return

    // Widen the window first — it is free. Only ask for another page when
    // everything already loaded is on screen.
    if (hidden > 0) { setMounted(m => m + MOUNT_STEP); return }
    if (exhausted) return

    loading.current = true
    const before = node.scrollHeight
    const added = await onLoadOlder()
    if (added) {
      setMounted(m => m + added)
      // Hold the reader's place: without this, prepending a page drops the
      // line they were reading to the bottom of the screen.
      requestAnimationFrame(() => {
        if (scroller.current) scroller.current.scrollTop += scroller.current.scrollHeight - before
      })
    }
    loading.current = false
  }, [hidden, exhausted, onLoadOlder])

  if (!messages.length) {
    return (
      <div className="cm-scroll flex-1 overflow-y-auto">
        <EmptyRoom name={channelName} description={channelDescription} />
      </div>
    )
  }

  let dividerDrawn = false

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      className="cm-scroll flex-1 overflow-y-auto py-4"
      role="log"
      aria-live="polite"
      aria-label={`Messages in ${channelName}`}
    >
      {hidden === 0 && exhausted && (
        <EmptyRoom name={channelName} description={channelDescription} />
      )}
      {(hidden > 0 || !exhausted) && (
        <p className="py-2 text-center text-xs" style={{ color: 'var(--cm-faint)' }}>
          Loading earlier messages…
        </p>
      )}

      {visible.map((message, index) => {
        const previous = visible[index - 1]
        const role = roleFor(message.authorId)

        const sameAuthor = previous
          && previous.authorId === message.authorId
          && !previous.anonymous && !message.anonymous
          && message.createdAt - previous.createdAt < GROUP_WINDOW_MS
          && !message.replyToId

        const newDay = !previous || dayOf(previous.createdAt) !== dayOf(message.createdAt)

        // The unread line is drawn once, above the first message the reader has
        // not seen. Drawing it per-message would stripe the whole backlog.
        const firstUnread = !dividerDrawn
          && lastReadAt > 0
          && message.createdAt > lastReadAt
          && message.authorId !== memberId
        if (firstUnread) dividerDrawn = true

        return (
          <React.Fragment key={message.id}>
            {newDay && (
              <div className="cm-divider" style={{ color: 'var(--cm-faint)' }}>
                <span>{dayOf(message.createdAt)}</span>
              </div>
            )}
            {firstUnread && <div className="cm-divider"><span>New</span></div>}

            <MessageRow
              message={message}
              grouped={!!sameAuthor && !newDay && !firstUnread}
              role={role}
              mine={message.authorId === memberId}
              mentioned={!!message.mentions?.includes(memberId) || !!message.mentionsEveryone}
              replyTo={message.replyToId ? messages.find(m => m.id === message.replyToId) : undefined}
              threadCount={messages.filter(m => m.threadRootId === message.id).length}
              editing={editing === message.id}
              canModerate={canModerate}
              memberById={memberById}
              attachmentUrl={attachmentUrl}
              onStartEdit={() => setEditing(message.id)}
              onCancelEdit={() => setEditing(null)}
              onSaveEdit={async body => {
                const result = await onEdit(message.id, body)
                if (result?.ok) setEditing(null)
              }}
              onReply={() => onReply(message)}
              onOpenThread={() => onOpenThread(message)}
              onDelete={() => onDelete(message.id)}
              onReact={reaction => onReact(message.id, reaction)}
              onReport={() => onReport(message.id)}
            />
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ── One message ────────────────────────────────────────────────────────────

interface RowProps {
  message: Message
  grouped: boolean
  role?: Role
  mine: boolean
  mentioned: boolean
  replyTo?: Message
  threadCount: number
  editing: boolean
  canModerate: boolean
  memberById: Map<string, CommunityMember>
  attachmentUrl: (attachment: Attachment) => string
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: (body: string) => void
  onReply: () => void
  onOpenThread: () => void
  onDelete: () => void
  onReact: (reaction: string) => void
  onReport: () => void
}

function MessageRow(props: RowProps) {
  const {
    message, grouped, role, mine, mentioned, replyTo, threadCount,
    editing, canModerate, memberById, attachmentUrl,
    onStartEdit, onCancelEdit, onSaveEdit, onReply, onOpenThread,
    onDelete, onReact, onReport,
  } = props

  const [draft, setDraft] = useState(message.body)
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => { if (editing) setDraft(message.body) }, [editing, message.body])

  const reactions = Object.entries(message.reactions ?? {}).filter(([, ids]) => ids.length)

  return (
    <article
      // The anchor a search result jumps to. Without it, clicking a hit opened
      // the right channel and left the reader at the bottom of it.
      id={`cm-msg-${message.id}`}
      className="cm-msg group py-0.5"
      data-grouped={grouped}
      data-mentioned={mentioned}
      style={role ? ({ ['--cm-role' as string]: role.color }) : undefined}
    >
      {replyTo && (
        <p className="mb-0.5 flex items-center gap-1.5 truncate text-xs" style={{ color: 'var(--cm-dim)' }}>
          <CornerUpLeft className="h-3 w-3 shrink-0" />
          <span style={{ color: role?.color ?? 'var(--cm-dim)' }}>{replyTo.authorHandle}</span>
          <span className="truncate opacity-80">{replyTo.body || 'attachment'}</span>
        </p>
      )}

      {!grouped && (
        <div className="absolute left-4 top-1">
          <Avatar seed={message.authorSeed} size={32} ring={role && role.id !== 'member' ? role.color : undefined} />
        </div>
      )}

      {!grouped && (
        <p className="flex items-baseline gap-2">
          <span className="text-sm font-semibold" style={{ color: role?.color ?? 'var(--cm-ink)' }}>
            {message.authorHandle}
          </span>
          {role && role.id !== 'member' && (
            <span
              className="rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide"
              style={{ background: `${role.color}22`, color: role.color }}
            >
              {role.name}
            </span>
          )}
          <time className="cm-slug text-[11px]" style={{ color: 'var(--cm-faint)' }}>
            {timeOf(message.createdAt)}
          </time>
        </p>
      )}

      {editing ? (
        <div className="my-1">
          <textarea
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') onCancelEdit()
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSaveEdit(draft) }
            }}
            rows={2}
            className="cm-composer w-full resize-none bg-transparent px-3 py-2 text-sm outline-none"
            style={{ color: 'var(--cm-ink)' }}
            aria-label="Edit message"
          />
          <div className="mt-1 flex items-center gap-2 text-xs" style={{ color: 'var(--cm-dim)' }}>
            <button onClick={() => onSaveEdit(draft)} className="inline-flex items-center gap-1 hover:underline">
              <Check className="h-3 w-3" /> Save
            </button>
            <button onClick={onCancelEdit} className="inline-flex items-center gap-1 hover:underline">
              <X className="h-3 w-3" /> Cancel
            </button>
            <span>Enter saves, Shift+Enter adds a line.</span>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed" style={{ color: 'var(--cm-ink)' }}>
          <Body text={message.body} memberById={memberById} />
          {message.editedAt && (
            <span className="ml-1.5 text-[11px]" style={{ color: 'var(--cm-faint)' }}>(edited)</span>
          )}
        </p>
      )}

      {!!message.attachments?.length && (
        <div className="mt-1.5 flex flex-wrap gap-2">
          {message.attachments.map(attachment => (
            <AttachmentView key={attachment.id} attachment={attachment} url={attachmentUrl(attachment)} />
          ))}
        </div>
      )}

      {!!reactions.length && (
        <div className="mt-1 flex flex-wrap gap-1">
          {reactions.map(([reaction, ids]) => (
            <button
              key={reaction}
              onClick={() => onReact(reaction)}
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors"
              style={{ background: 'var(--cm-raise)', border: '1px solid var(--cm-line)', color: 'var(--cm-dim)' }}
              aria-label={`${reaction}, ${ids.length}`}
            >
              <span>{reaction}</span>
              <span className="cm-slug">{ids.length}</span>
            </button>
          ))}
        </div>
      )}

      {threadCount > 0 && (
        <button
          onClick={onOpenThread}
          className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium hover:underline"
          style={{ color: 'var(--cm-accent)' }}
        >
          <MessageSquareText className="h-3.5 w-3.5" />
          {threadCount} {threadCount === 1 ? 'reply' : 'replies'}
        </button>
      )}

      {/* Hover actions. Focusable so the keyboard reaches them too. */}
      <div
        className="absolute right-4 top-0 hidden items-center gap-0.5 rounded-lg px-1 py-0.5 group-hover:flex group-focus-within:flex"
        style={{ background: 'var(--cm-raise)', border: '1px solid var(--cm-line)' }}
      >
        {pickerOpen && (
          <div className="flex items-center gap-0.5 pr-1">
            {QUICK_REACTIONS.map(reaction => (
              <button
                key={reaction}
                onClick={() => { onReact(reaction); setPickerOpen(false) }}
                className="rounded px-1 text-sm hover:bg-[var(--cm-hover)]"
                aria-label={`React ${reaction}`}
              >
                {reaction}
              </button>
            ))}
          </div>
        )}
        <RowAction label="Add reaction" onClick={() => setPickerOpen(o => !o)}><SmilePlus className="h-3.5 w-3.5" /></RowAction>
        <RowAction label="Reply" onClick={onReply}><CornerUpLeft className="h-3.5 w-3.5" /></RowAction>
        <RowAction label="Reply in thread" onClick={onOpenThread}><MessageSquareText className="h-3.5 w-3.5" /></RowAction>
        <RowAction label="Copy text" onClick={() => void navigator.clipboard.writeText(message.body)}>
          <Copy className="h-3.5 w-3.5" />
        </RowAction>
        {mine && <RowAction label="Edit" onClick={onStartEdit}><Pencil className="h-3.5 w-3.5" /></RowAction>}
        {(mine || canModerate) && (
          <RowAction label="Delete" onClick={onDelete} danger><Trash2 className="h-3.5 w-3.5" /></RowAction>
        )}
        {!mine && <RowAction label="Report" onClick={onReport}><Flag className="h-3.5 w-3.5" /></RowAction>}
      </div>
    </article>
  )
}

function RowAction({
  label, onClick, danger, children,
}: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded p-1 transition-colors hover:bg-[var(--cm-hover)]"
      style={{ color: danger ? 'var(--cm-danger)' : 'var(--cm-dim)' }}
    >
      {children}
    </button>
  )
}

/**
 * Message text with mentions picked out.
 *
 * Split rather than replaced into HTML: this text came from another member, and
 * the one thing it must never do is become markup.
 */
function Body({ text, memberById }: { text: string; memberById: Map<string, CommunityMember> }) {
  const handles = useMemo(() => {
    const set = new Set<string>()
    for (const member of memberById.values()) set.add(member.handle.toLowerCase())
    return set
  }, [memberById])

  const parts = text.split(/(@[\p{L}\p{N}_-]{2,32})/gu)

  return (
    <>
      {parts.map((part, index) => {
        if (!part.startsWith('@')) return <React.Fragment key={index}>{part}</React.Fragment>
        const name = part.slice(1).toLowerCase()
        if (name !== 'everyone' && !handles.has(name)) {
          return <React.Fragment key={index}>{part}</React.Fragment>
        }
        return <span key={index} className="cm-chip">{part}</span>
      })}
    </>
  )
}

function AttachmentView({ attachment, url }: { attachment: Attachment; url: string }) {
  if (attachment.mime.startsWith('image/')) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img
          src={url}
          alt={attachment.name}
          loading="lazy"
          className="max-h-80 rounded-lg"
          style={{ border: '1px solid var(--cm-line)', maxWidth: 'min(100%, 420px)' }}
        />
      </a>
    )
  }
  if (attachment.mime.startsWith('video/')) {
    return (
      <video
        src={url}
        controls
        preload="metadata"
        className="max-h-80 rounded-lg"
        style={{ border: '1px solid var(--cm-line)', maxWidth: 'min(100%, 420px)' }}
      />
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-[var(--cm-hover)]"
      style={{ background: 'var(--cm-raise)', border: '1px solid var(--cm-line)', color: 'var(--cm-ink)' }}
    >
      <span className="truncate">{attachment.name}</span>
      <span className="cm-slug text-[11px]" style={{ color: 'var(--cm-faint)' }}>
        {Math.max(1, Math.round(attachment.bytes / 1024))} KB
      </span>
    </a>
  )
}
