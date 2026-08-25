import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Paperclip, Send, Smile, X, CornerUpLeft, Loader2, AlertCircle } from 'lucide-react'
import type { Attachment, Message } from '../../../../shared/community'
import { MAX_ATTACHMENTS_PER_MESSAGE } from '../../../../shared/community'
import { Avatar } from './bits'
import type { CommunityMember } from './useCommunity'

/**
 * Writing a message.
 *
 * The composer is where a chat is judged, so the small things matter: Enter
 * sends and Shift+Enter does not, a reply shows what it is replying to and can
 * be cancelled, an upload reports its own failure next to itself rather than in
 * a toast that has already gone, and typing notifies once rather than on every
 * keystroke.
 */

const EMOJI = [
  '👍', '🙏', '🎉', '🔥', '👀', '😀', '😂', '😍', '🤔', '😅',
  '🙌', '💡', '✅', '❌', '⚡', '🚀', '💻', '📈', '🐛', '☕',
]

interface Pending {
  key: string
  name: string
  state: 'uploading' | 'done' | 'failed'
  error?: string
  attachment?: Attachment
}

interface Props {
  channelName: string
  disabled: boolean
  disabledReason: string
  canAttach: boolean
  members: CommunityMember[]
  replyTo: Message | null
  onCancelReply: () => void
  onSend: (body: string, attachments: Attachment[]) => Promise<{ ok: boolean } | undefined>
  onTyping: (on: boolean) => void
  upload: (name: string, bytes: Uint8Array) => Promise<{ ok: boolean; attachment?: Attachment; error?: string }>
  error: string
}

export default function Composer(props: Props) {
  const {
    channelName, disabled, disabledReason, canAttach, members, replyTo,
    onCancelReply, onSend, onTyping, upload, error,
  } = props

  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<Pending[]>([])
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [mention, setMention] = useState<{ query: string; at: number } | null>(null)
  const [highlight, setHighlight] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [sending, setSending] = useState(false)

  const input = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const typingUntil = useRef(0)

  useEffect(() => { if (replyTo) input.current?.focus() }, [replyTo])

  const grow = useCallback(() => {
    const node = input.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, 180)}px`
  }, [])

  useEffect(grow, [draft, grow])

  // ── Typing ───────────────────────────────────────────────────────────────

  const noteTyping = useCallback(() => {
    // Once every few seconds, not once per keystroke: the indicator has its own
    // expiry, so re-announcing constantly is pure traffic.
    const now = Date.now()
    if (now < typingUntil.current) return
    typingUntil.current = now + 3_000
    onTyping(true)
  }, [onTyping])

  // ── Mentions ─────────────────────────────────────────────────────────────

  const candidates = mention
    ? members
      .filter(m => m.handle.toLowerCase().startsWith(mention.query.toLowerCase()))
      .slice(0, 6)
    : []

  const detectMention = useCallback((value: string, caret: number) => {
    const before = value.slice(0, caret)
    const match = /(?:^|\s)@([\p{L}\p{N}_-]{0,32})$/u.exec(before)
    setMention(match ? { query: match[1], at: caret - match[1].length - 1 } : null)
    setHighlight(0)
  }, [])

  const applyMention = useCallback((handle: string) => {
    if (!mention) return
    const node = input.current
    if (!node) return
    const caret = node.selectionStart ?? draft.length
    const next = `${draft.slice(0, mention.at)}@${handle} ${draft.slice(caret)}`
    setDraft(next)
    setMention(null)
    requestAnimationFrame(() => {
      const position = mention.at + handle.length + 2
      node.focus()
      node.setSelectionRange(position, position)
    })
  }, [draft, mention])

  // ── Attachments ──────────────────────────────────────────────────────────

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = [...files]
    const room = MAX_ATTACHMENTS_PER_MESSAGE - pending.length
    if (room <= 0) return

    for (const file of list.slice(0, room)) {
      const key = `${file.name}:${file.size}:${Math.random().toString(36).slice(2, 8)}`
      setPending(prev => [...prev, { key, name: file.name, state: 'uploading' }])
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const result = await upload(file.name, bytes)
        setPending(prev => prev.map(item => item.key === key
          ? result.ok
            ? { ...item, state: 'done', attachment: result.attachment }
            // The failure sits on the file it belongs to. A toast would be gone
            // before the reader worked out which of five files it meant.
            : { ...item, state: 'failed', error: result.error ?? 'Upload failed.' }
          : item))
      } catch {
        setPending(prev => prev.map(item => item.key === key
          ? { ...item, state: 'failed', error: 'That file could not be read.' }
          : item))
      }
    }
  }, [pending.length, upload])

  // ── Sending ──────────────────────────────────────────────────────────────

  const send = useCallback(async () => {
    const body = draft.trim()
    const ready = pending.filter(p => p.state === 'done' && p.attachment).map(p => p.attachment!)
    if (!body && !ready.length) return
    if (pending.some(p => p.state === 'uploading')) return

    setSending(true)
    const result = await onSend(body, ready)
    setSending(false)
    if (result?.ok) {
      setDraft('')
      setPending([])
      onTyping(false)
      typingUntil.current = 0
      onCancelReply()
    }
  }, [draft, pending, onSend, onTyping, onCancelReply])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && candidates.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => (h + 1) % candidates.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => (h - 1 + candidates.length) % candidates.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyMention(candidates[highlight].handle); return }
      if (e.key === 'Escape') { setMention(null); return }
    }
    if (e.key === 'Escape' && replyTo) { onCancelReply(); return }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
  }

  if (disabled) {
    return (
      <div
        className="mx-4 mb-4 rounded-xl px-4 py-3 text-sm"
        style={{ background: 'var(--cm-raise)', border: '1px solid var(--cm-line)', color: 'var(--cm-dim)' }}
      >
        {disabledReason}
      </div>
    )
  }

  return (
    <div className="px-4 pb-4">
      {replyTo && (
        <div
          className="flex items-center gap-2 rounded-t-xl px-3 py-1.5 text-xs"
          style={{ background: 'var(--cm-raise)', borderBottom: '1px solid var(--cm-line)', color: 'var(--cm-dim)' }}
        >
          <CornerUpLeft className="h-3.5 w-3.5" />
          <span className="truncate">
            Replying to <span style={{ color: 'var(--cm-ink)' }}>{replyTo.authorHandle}</span>
          </span>
          <button onClick={onCancelReply} className="ml-auto rounded p-0.5 hover:bg-[var(--cm-hover)]" aria-label="Cancel reply">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {!!error && (
        <p
          className="mb-1.5 flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
          style={{ background: 'color-mix(in srgb, var(--cm-danger) 12%, transparent)', color: 'var(--cm-danger)' }}
          role="alert"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      <div
        className="cm-composer relative"
        onDragOver={e => { if (canAttach) { e.preventDefault(); setDragging(true) } }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          if (!canAttach) return
          e.preventDefault()
          setDragging(false)
          void addFiles(e.dataTransfer.files)
        }}
        style={dragging ? { borderColor: 'var(--cm-accent)', borderStyle: 'dashed' } : undefined}
      >
        {mention && candidates.length > 0 && (
          <ul
            className="absolute bottom-full left-0 z-20 mb-2 w-64 overflow-hidden rounded-lg py-1"
            style={{ background: 'var(--cm-raise)', border: '1px solid var(--cm-line)', boxShadow: '0 8px 32px rgb(0 0 0 / .45)' }}
            role="listbox"
            aria-label="Mention a member"
          >
            {candidates.map((member, index) => (
              <li key={member.id}>
                <button
                  onMouseDown={e => { e.preventDefault(); applyMention(member.handle) }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm"
                  style={{
                    background: index === highlight ? 'var(--cm-hover)' : 'transparent',
                    color: 'var(--cm-ink)',
                  }}
                  role="option"
                  aria-selected={index === highlight}
                >
                  <Avatar seed={member.avatarSeed} size={20} />
                  {member.handle}
                </button>
              </li>
            ))}
          </ul>
        )}

        {!!pending.length && (
          <ul className="flex flex-wrap gap-2 px-3 pt-3">
            {pending.map(item => (
              <li
                key={item.key}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs"
                style={{
                  background: 'var(--cm-hover)',
                  border: `1px solid ${item.state === 'failed' ? 'var(--cm-danger)' : 'var(--cm-line)'}`,
                  color: item.state === 'failed' ? 'var(--cm-danger)' : 'var(--cm-dim)',
                }}
              >
                {item.state === 'uploading' && <Loader2 className="h-3 w-3 animate-spin" />}
                <span className="max-w-[160px] truncate">{item.name}</span>
                {item.state === 'failed' && <span>— {item.error}</span>}
                <button
                  onClick={() => setPending(prev => prev.filter(p => p.key !== item.key))}
                  aria-label={`Remove ${item.name}`}
                  className="rounded p-0.5 hover:bg-[var(--cm-raise)]"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-end gap-1 px-2 py-2">
          {canAttach && (
            <>
              <button
                onClick={() => fileInput.current?.click()}
                title="Attach a file"
                aria-label="Attach a file"
                className="rounded-lg p-2 transition-colors hover:bg-[var(--cm-hover)]"
                style={{ color: 'var(--cm-dim)' }}
              >
                <Paperclip className="h-4.5 w-4.5" />
              </button>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={e => { void addFiles(e.target.files ?? []); e.target.value = '' }}
              />
            </>
          )}

          <textarea
            ref={input}
            value={draft}
            rows={1}
            placeholder={`Message #${channelName}`}
            aria-label={`Message ${channelName}`}
            onChange={e => {
              setDraft(e.target.value)
              detectMention(e.target.value, e.target.selectionStart ?? 0)
              noteTyping()
            }}
            onKeyDown={onKeyDown}
            onBlur={() => { onTyping(false); typingUntil.current = 0 }}
            className="max-h-44 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none"
            style={{ color: 'var(--cm-ink)' }}
          />

          <div className="relative">
            <button
              onClick={() => setEmojiOpen(o => !o)}
              title="Emoji"
              aria-label="Insert emoji"
              aria-expanded={emojiOpen}
              className="rounded-lg p-2 transition-colors hover:bg-[var(--cm-hover)]"
              style={{ color: 'var(--cm-dim)' }}
            >
              <Smile className="h-4.5 w-4.5" />
            </button>
            {emojiOpen && (
              <div
                className="absolute bottom-full right-0 z-20 mb-2 grid w-56 grid-cols-5 gap-1 rounded-lg p-2"
                style={{ background: 'var(--cm-raise)', border: '1px solid var(--cm-line)', boxShadow: '0 8px 32px rgb(0 0 0 / .45)' }}
              >
                {EMOJI.map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => { setDraft(d => d + emoji); setEmojiOpen(false); input.current?.focus() }}
                    className="rounded p-1 text-lg hover:bg-[var(--cm-hover)]"
                    aria-label={`Insert ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => void send()}
            disabled={sending || (!draft.trim() && !pending.some(p => p.state === 'done'))}
            title="Send"
            aria-label="Send message"
            className="rounded-lg p-2 transition-colors disabled:opacity-40"
            style={{ color: 'var(--cm-accent)' }}
          >
            {sending ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Send className="h-4.5 w-4.5" />}
          </button>
        </div>
      </div>

      <p className="mt-1 px-1 text-[11px]" style={{ color: 'var(--cm-faint)' }}>
        Enter sends · Shift+Enter adds a line
      </p>
    </div>
  )
}
