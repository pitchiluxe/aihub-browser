import React, { useEffect, useRef, useState } from 'react'
import { Search, X, Loader2, Send } from 'lucide-react'
import type { Message } from '../../../../shared/community'
import { Avatar, timeOf, dayOf } from './bits'
import type { CommunityMember } from './useCommunity'

/**
 * The two side panels: search, and one thread.
 *
 * They share the right-hand slot because they answer the same kind of question
 * — "show me that specific thing" — and having both open at once would leave
 * the conversation itself as the narrowest column on screen.
 */

// ── Search ─────────────────────────────────────────────────────────────────

interface SearchResults {
  messages: Array<{ message: Message; channelName: string; authorHandle: string }>
  members: CommunityMember[]
  channels: Array<{ slug: string; name: string; description: string }>
}

export function SearchPanel({
  onClose, onJump, search,
}: {
  onClose: () => void
  onJump: (channelSlug: string, messageId: string) => void
  search: (query: string) => Promise<SearchResults>
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!query.trim()) { setResults(null); return }
    setBusy(true)
    // Debounced: a search-as-you-type that fires per keystroke re-scans the
    // whole history for prefixes nobody meant to search for.
    const timer = window.setTimeout(async () => {
      setResults(await search(query))
      setBusy(false)
    }, 220)
    return () => { window.clearTimeout(timer); setBusy(false) }
  }, [query, search])

  const total = results
    ? results.messages.length + results.members.length + results.channels.length
    : 0

  return (
    <section className="flex h-full flex-col" aria-label="Search">
      <header className="flex items-center gap-2 px-3 py-3" style={{ borderBottom: '1px solid var(--cm-line)' }}>
        <Search className="h-4 w-4 shrink-0" style={{ color: 'var(--cm-dim)' }} />
        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search messages, people, channels"
          aria-label="Search the community"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          style={{ color: 'var(--cm-ink)' }}
        />
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: 'var(--cm-dim)' }} />}
        <button onClick={onClose} aria-label="Close search" className="rounded p-1 hover:bg-[var(--cm-hover)]"
                style={{ color: 'var(--cm-dim)' }}>
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="cm-scroll flex-1 overflow-y-auto px-2 py-2">
        {!query.trim() && (
          <p className="px-2 py-6 text-xs" style={{ color: 'var(--cm-faint)' }}>
            Every word has to match. Searching <span className="cm-slug">vlan cisco</span> finds
            messages containing both.
          </p>
        )}

        {results && total === 0 && !busy && (
          <p className="px-2 py-6 text-sm" style={{ color: 'var(--cm-dim)' }}>
            Nothing matched “{query}”.
          </p>
        )}

        {!!results?.channels.length && (
          <Group label="Channels">
            {results.channels.map(channel => (
              <button key={channel.slug} onClick={() => onJump(channel.slug, '')}
                      className="w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--cm-hover)]">
                <span className="cm-slug text-sm" style={{ color: 'var(--cm-ink)' }}>#{channel.slug}</span>
                <span className="block truncate text-[11px]" style={{ color: 'var(--cm-faint)' }}>
                  {channel.description}
                </span>
              </button>
            ))}
          </Group>
        )}

        {!!results?.members.length && (
          <Group label="People">
            {results.members.map(member => (
              <div key={member.id} className="flex items-center gap-2 px-2 py-1.5">
                <Avatar seed={member.avatarSeed} size={24} />
                <span className="text-sm" style={{ color: 'var(--cm-ink)' }}>{member.handle}</span>
              </div>
            ))}
          </Group>
        )}

        {!!results?.messages.length && (
          <Group label="Messages">
            {results.messages.map(hit => (
              <button
                key={hit.message.id}
                onClick={() => onJump(hit.message.channel, hit.message.id)}
                className="w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--cm-hover)]"
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-xs font-medium" style={{ color: 'var(--cm-ink)' }}>{hit.authorHandle}</span>
                  <span className="cm-slug text-[10px]" style={{ color: 'var(--cm-faint)' }}>
                    #{hit.message.channel} · {dayOf(hit.message.createdAt)} {timeOf(hit.message.createdAt)}
                  </span>
                </span>
                <span className="mt-0.5 block line-clamp-3 text-xs leading-relaxed" style={{ color: 'var(--cm-dim)' }}>
                  {hit.message.body}
                </span>
              </button>
            ))}
          </Group>
        )}
      </div>
    </section>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mb-3">
      <h3 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--cm-faint)' }}>
        {label}
      </h3>
      {children}
    </section>
  )
}

// ── Thread ─────────────────────────────────────────────────────────────────

export function ThreadPanel({
  root, replies, memberById, onClose, onSend, busy,
}: {
  root: Message
  replies: Message[]
  memberById: Map<string, CommunityMember>
  onClose: () => void
  onSend: (body: string) => Promise<{ ok: boolean } | undefined>
  busy: boolean
}) {
  const [draft, setDraft] = useState('')
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [replies.length])

  const send = async () => {
    const body = draft.trim()
    if (!body) return
    const result = await onSend(body)
    if (result?.ok) setDraft('')
  }

  return (
    <section className="flex h-full flex-col" aria-label="Thread">
      <header className="flex items-center justify-between px-3 py-3" style={{ borderBottom: '1px solid var(--cm-line)' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--cm-ink)' }}>Thread</h2>
        <button onClick={onClose} aria-label="Close thread" className="rounded p-1 hover:bg-[var(--cm-hover)]"
                style={{ color: 'var(--cm-dim)' }}>
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="cm-scroll flex-1 overflow-y-auto px-3 py-3">
        <ThreadMessage message={root} memberById={memberById} root />
        <div className="my-3 flex items-center gap-2 text-[11px]" style={{ color: 'var(--cm-faint)' }}>
          <span className="h-px flex-1" style={{ background: 'var(--cm-line)' }} />
          {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
          <span className="h-px flex-1" style={{ background: 'var(--cm-line)' }} />
        </div>
        {replies.map(reply => (
          <ThreadMessage key={reply.id} message={reply} memberById={memberById} />
        ))}
        <div ref={bottom} />
      </div>

      <div className="px-3 pb-3">
        <div className="cm-composer flex items-end gap-1 px-2 py-1.5">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
            rows={1}
            placeholder="Reply in thread"
            aria-label="Reply in thread"
            className="max-h-32 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none"
            style={{ color: 'var(--cm-ink)' }}
          />
          <button onClick={() => void send()} disabled={busy || !draft.trim()} aria-label="Send reply"
                  className="rounded-lg p-1.5 disabled:opacity-40" style={{ color: 'var(--cm-accent)' }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </section>
  )
}

function ThreadMessage({
  message, memberById, root,
}: { message: Message; memberById: Map<string, CommunityMember>; root?: boolean }) {
  void memberById
  return (
    <article className="mb-3 flex gap-2">
      <Avatar seed={message.authorSeed} size={root ? 30 : 24} />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <span className="text-xs font-semibold" style={{ color: 'var(--cm-ink)' }}>
            {message.authorHandle}
          </span>
          <time className="cm-slug text-[10px]" style={{ color: 'var(--cm-faint)' }}>
            {timeOf(message.createdAt)}
          </time>
        </p>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed" style={{ color: 'var(--cm-ink)' }}>
          {message.body}
        </p>
      </div>
    </article>
  )
}
