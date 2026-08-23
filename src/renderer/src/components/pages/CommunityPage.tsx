import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  BookMarked, Code2, Shield, CandlestickChart, Trophy, Clapperboard, Briefcase,
  Send, Users, Flag, EyeOff, HandHeart, AlertTriangle, KeyRound, Loader2,
} from 'lucide-react'
import { CHANNELS, type ChannelDef, type Message, type MessageKind } from '../../../../shared/community'
import { validateHandle, joinBlocker } from '../../../../shared/communityHandle'
import { avatarDataUri } from '../../../../shared/communityAvatar'

/**
 * The Community room.
 *
 * Three panes: channels on the left, the conversation in the middle, the
 * composer underneath. Everything that decides whether a post is allowed lives
 * in the main process — this file renders the answer and never second-guesses
 * it, which is why a rejected post shows the server's sentence rather than one
 * invented here.
 */

const ICONS: Record<string, React.ElementType> = {
  BookMarked, Code2, Shield, CandlestickChart, Trophy, Clapperboard, Briefcase,
}

type Status = any   // shaped by main; narrowed at the use sites below

export default function CommunityPage() {
  const [status, setStatus] = useState<Status | null>(null)
  const [channel, setChannel] = useState<ChannelDef>(CHANNELS[0])
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [kind, setKind] = useState<MessageKind>('text')
  const [anonymous, setAnonymous] = useState(false)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const api = (window as any).electronAPI?.community

  const loadMessages = useCallback(async (slug: string) => {
    if (!api) return
    try { setMessages(await api.messages(slug)) } catch { /* room stays as-is */ }
  }, [api])

  useEffect(() => {
    if (!api) return
    api.status().then(setStatus).catch(() => setStatus(null))
    const offStatus = api.onStatus(setStatus)
    return () => offStatus?.()
  }, [api])

  useEffect(() => { void loadMessages(channel.slug) }, [channel.slug, loadMessages])

  useEffect(() => {
    if (!api) return
    // Reload rather than splicing the pushed message in: the pushed copy is
    // the anonymized one, and only main knows whether this viewer is the
    // author who should still see their own name on it.
    const offMessage = api.onMessage((p: any) => {
      if (p?.channel === channel.slug) void loadMessages(channel.slug)
    })
    const offRefresh = api.onRefresh(() => void loadMessages(channel.slug))
    return () => { offMessage?.(); offRefresh?.() }
  }, [api, channel.slug, loadMessages])

  // Pin to the newest message, the way every chat room behaves.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const send = useCallback(async () => {
    if (!api || !draft.trim() || sending) return
    setSending(true); setError('')
    try {
      const out = await api.post({ channel: channel.slug, kind, body: draft, anonymous })
      if (out?.ok) { setDraft(''); setKind('text'); setAnonymous(false); void loadMessages(channel.slug) }
      else setError(out?.error || 'That did not send.')
    } catch (e: any) {
      setError(e?.message || 'That did not send.')
    } finally { setSending(false) }
  }, [api, draft, kind, anonymous, channel.slug, sending, loadMessages])

  if (!api) return <Centered>Community is unavailable in this build.</Centered>
  if (!status) return <Centered><Loader2 size={18} className="animate-spin" /> Loading…</Centered>
  if (status.state === 'unregistered') {
    return <Onboarding onJoined={setStatus} />
  }

  const me = status.member

  return (
    <div className="h-full flex" style={{ background: 'rgb(var(--ds-bg))', color: 'rgb(var(--ds-text))' }}>
      <ChannelRail active={channel} onPick={setChannel} me={me} status={status} />

      <div className="flex-1 flex flex-col min-w-0">
        <ChannelHeader channel={channel} status={status} />

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4" style={{ scrollBehavior: 'smooth' }}>
          {messages.length === 0
            ? <EmptyRoom channel={channel} />
            : messages.map(m => (
                <MessageRow key={m.id} message={m} me={me} api={api}
                  onChanged={() => void loadMessages(channel.slug)} />
              ))}
        </div>

        {status.state === 'banned'
          ? <BannedNotice reason={me.banReason} />
          : <Composer
              channel={channel} draft={draft} setDraft={setDraft}
              kind={kind} setKind={setKind}
              anonymous={anonymous} setAnonymous={setAnonymous}
              error={error} sending={sending} onSend={send}
            />}
      </div>
    </div>
  )
}

// ── Onboarding ─────────────────────────────────────────────────────────────

function Onboarding({ onJoined }: { onJoined: (s: any) => void }) {
  const [handle, setHandle] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const api = (window as any).electronAPI?.community

  const check = validateHandle(handle)
  const blocker = joinBlocker(handle, accepted)
  // null = not asked yet. Names are unique, so the answer has to come from the
  // main process; asking on every keystroke would be one IPC round trip per
  // character, so it waits for a pause in typing.
  const [taken, setTaken] = useState<boolean | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const canJoin = !blocker && taken === false && !busy

  useEffect(() => {
    if (!api || !check.ok) { setTaken(null); setSuggestions([]); return }
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const out = await api.handleAvailable(handle)
        if (cancelled) return
        setTaken(out?.ok ? !out.available : null)
        setSuggestions(out?.suggestions || [])
      } catch { if (!cancelled) setTaken(null) }
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [api, handle, check.ok])

  const join = async () => {
    setBusy(true); setError('')
    try {
      const out = await api.join(handle)
      if (out?.ok) onJoined(out.status)
      else setError(out?.error || 'Could not join.')
    } catch (e: any) { setError(e?.message || 'Could not join.') }
    finally { setBusy(false) }
  }

  // Preview the avatar from the typed name, so the choice feels like a choice.
  const previewSeed = check.ok ? check.value : 'preview'

  return (
    <div className="h-full overflow-y-auto flex items-center justify-center p-8"
         style={{ background: 'rgb(var(--ds-bg))', color: 'rgb(var(--ds-text))' }}>
      <div style={{ maxWidth: 520, width: '100%' }}>
        <div className="flex items-center gap-3 mb-4">
          <Users size={26} style={{ color: '#34d399' }} />
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>Community</h1>
        </div>

        <p style={{ color: 'rgb(var(--ds-muted))', lineHeight: 1.6, marginBottom: 18 }}>
          Rooms for Bible study, developers, cybersecurity, traders, sport,
          entertainment and jobs. You post under a name you choose — no email,
          no password, no account anywhere else.
        </p>

        <LocalPreviewBanner />

        <Rule>
          <strong>Text only.</strong> Nothing can be uploaded into the community —
          no files, no images, no attachments, ever. Anything you share is typed
          here, inside the browser.
        </Rule>
        <Rule>
          <strong>Posts are public and lasting.</strong> Anyone in the room can
          read what you write. Prayer requests can be posted anonymously, but
          they are still public.
        </Rule>
        <Rule>
          <strong>Be decent.</strong> Harassment, spam and impersonation get you
          removed. Every message has a report button.
        </Rule>

        <label style={{ display: 'block', fontSize: 12, color: 'rgb(var(--ds-muted))', margin: '18px 0 6px' }}>
          Your name in the community
        </label>
        <div className="flex items-center gap-3">
          <img src={avatarDataUri(previewSeed, 44)} width={44} height={44}
               alt="" style={{ borderRadius: 12, flexShrink: 0 }} />
          <input
            value={handle}
            onChange={e => setHandle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && canJoin) void join() }}
            // The placeholder used to read "Grace", which looks exactly like a
            // filled-in field. People saw a name, a ticked box and a dead
            // button, and had no way to tell the field was empty.
            placeholder="Type a name…"
            autoFocus
            maxLength={40}
            className="flex-1 px-3 py-2 rounded-lg outline-none"
            style={{
              background: 'rgb(var(--ds-surface))', color: 'rgb(var(--ds-text))',
              border: `1px solid ${handle && !check.ok ? '#f8717188' : 'rgb(var(--ds-border))'}`,
            }}
          />
        </div>
        {handle && !check.ok && (
          <div style={{ color: '#f87171', fontSize: 12, marginTop: 6 }}>{check.error}</div>
        )}
        {check.ok && taken === false && (
          <div style={{ color: '#34d399', fontSize: 12, marginTop: 6 }}>
            <strong>{check.value}</strong> is available.
          </div>
        )}
        {check.ok && taken === true && (
          <div style={{ color: '#f87171', fontSize: 12, marginTop: 6 }}>
            <strong>{check.value}</strong> is taken.
            {suggestions.length > 0 && (
              <>
                {' '}Try{' '}
                {suggestions.map((s, i) => (
                  <React.Fragment key={s}>
                    {i > 0 && ', '}
                    <button
                      onClick={() => setHandle(s)}
                      style={{
                        color: '#34d399', textDecoration: 'underline',
                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        font: 'inherit',
                      }}>{s}</button>
                  </React.Fragment>
                ))}
                .
              </>
            )}
          </div>
        )}

        <label className="flex items-start gap-2 mt-4" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)}
                 style={{ marginTop: 3 }} />
          <span style={{ fontSize: 13, color: 'rgb(var(--ds-muted))' }}>
            I have read the three rules above and agree to them.
          </span>
        </label>

        {error && <div style={{ color: '#f87171', fontSize: 13, marginTop: 12 }}>{error}</div>}

        <button
          onClick={join}
          disabled={!canJoin}
          className="mt-5 w-full py-2.5 rounded-lg font-medium"
          style={{
            background: canJoin ? '#34d399' : 'rgb(var(--ds-surface))',
            color: canJoin ? '#04231a' : 'rgb(var(--ds-muted))',
            cursor: canJoin ? 'pointer' : 'not-allowed',
            // A disabled button needs to still look like a button. Flat text on
            // the page background reads as broken rather than as "not yet".
            border: `1px solid ${canJoin ? '#34d399' : 'rgb(var(--ds-border))'}`,
            opacity: canJoin ? 1 : 0.75,
          }}
        >
          {busy ? 'Joining…' : 'Join the community'}
        </button>

        {/* Never leave a disabled control unexplained: say which step is
            outstanding, in the order the user would fix them. */}
        {!canJoin && !busy && (
          <div style={{ fontSize: 12, color: 'rgb(var(--ds-muted))', marginTop: 8, textAlign: 'center' }}>
            {blocker || (taken === true ? 'That name is taken — pick another.' : 'Checking that name…')}
          </div>
        )}
      </div>
    </div>
  )
}

function Rule({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 13, lineHeight: 1.55, color: 'rgb(var(--ds-muted))',
      padding: '8px 12px', marginBottom: 6, borderRadius: 8,
      background: 'rgb(var(--ds-surface))', border: '1px solid rgb(var(--ds-border))',
    }}>{children}</div>
  )
}

/**
 * There is no server yet. Saying so is not optional: someone who believes they
 * are talking to a room full of people, and is not, has been lied to by the
 * product.
 */
function LocalPreviewBanner() {
  return (
    <div className="flex gap-2 items-start" style={{
      fontSize: 12.5, lineHeight: 1.5, padding: '10px 12px', marginBottom: 14,
      borderRadius: 8, color: '#fcd34d',
      background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.30)',
    }}>
      <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>
        <strong>Local preview.</strong> The community server is not connected yet,
        so messages you post stay on this computer and nobody else can see them.
        Your name and identity key carry over when it goes live.
      </span>
    </div>
  )
}

// ── Rail ───────────────────────────────────────────────────────────────────

function ChannelRail({ active, onPick, me, status }: {
  active: ChannelDef; onPick: (c: ChannelDef) => void; me: any; status: any
}) {
  return (
    <div className="h-full flex flex-col shrink-0"
         style={{ width: 236, borderRight: '1px solid rgb(var(--ds-border))', background: 'rgb(var(--ds-surface))' }}>
      <div style={{ padding: '14px 14px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Users size={16} style={{ color: '#34d399' }} />
        <span style={{ fontWeight: 700, fontSize: 14 }}>Community</span>
      </div>

      <div style={{ padding: '0 10px 10px' }}>
        <div style={{
          fontSize: 10.5, lineHeight: 1.45, color: '#fcd34d', padding: '6px 8px',
          borderRadius: 6, background: 'rgba(251,191,36,0.10)',
          border: '1px solid rgba(251,191,36,0.25)',
        }}>
          Local preview — not connected to other people yet.
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ padding: '0 8px' }}>
        {CHANNELS.map(c => {
          const Icon = ICONS[c.icon] || Users
          const on = c.slug === active.slug
          return (
            <button key={c.slug} onClick={() => onPick(c)}
              className="w-full text-left"
              style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
                marginBottom: 2, borderRadius: 8, cursor: 'pointer',
                background: on ? `${c.accent}18` : 'transparent',
                border: `1px solid ${on ? `${c.accent}35` : 'transparent'}`,
                color: on ? c.accent : 'rgb(var(--ds-text))',
              }}>
              <Icon size={15} style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: on ? 600 : 400 }}>{c.name}</span>
            </button>
          )
        })}
      </div>

      <MemberCard me={me} status={status} />
    </div>
  )
}

function MemberCard({ me, status }: { me: any; status: any }) {
  return (
    <div style={{ borderTop: '1px solid rgb(var(--ds-border))', padding: '10px 12px' }}>
      <div className="flex items-center gap-2">
        <img src={avatarDataUri(me.avatarSeed, 30)} width={30} height={30} alt=""
             style={{ borderRadius: 9, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {me.handle}
          </div>
          <div style={{ fontSize: 10.5, color: 'rgb(var(--ds-muted))' }}>
            {status.established ? 'Established member' : 'New member — slow mode'}
          </div>
        </div>
      </div>
      {status.insecureKeyStorage && (
        <div className="flex gap-1.5 items-start" style={{
          marginTop: 8, fontSize: 10.5, lineHeight: 1.4, color: '#fca5a5',
        }}>
          <KeyRound size={12} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>This system has no keychain, so your identity key is stored unencrypted.</span>
        </div>
      )}
    </div>
  )
}

// ── Conversation ───────────────────────────────────────────────────────────

function ChannelHeader({ channel, status }: { channel: ChannelDef; status: any }) {
  const Icon = ICONS[channel.icon] || Users
  return (
    <div style={{
      padding: '12px 20px', borderBottom: '1px solid rgb(var(--ds-border))',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <Icon size={17} style={{ color: channel.accent }} />
      <div>
        <div style={{ fontWeight: 650, fontSize: 14.5 }}>{channel.name}</div>
        <div style={{ fontSize: 11.5, color: 'rgb(var(--ds-muted))' }}>{channel.description}</div>
      </div>
      {!status.established && (
        <div style={{
          marginLeft: 'auto', fontSize: 11, color: 'rgb(var(--ds-muted))',
          border: '1px solid rgb(var(--ds-border))', borderRadius: 6, padding: '3px 8px',
        }}>
          New member: one post every {Math.round(status.cooldownMs / 1000)}s, no links yet
        </div>
      )}
    </div>
  )
}

function EmptyRoom({ channel }: { channel: ChannelDef }) {
  const Icon = ICONS[channel.icon] || Users
  return (
    <div className="h-full flex flex-col items-center justify-center text-center" style={{ gap: 10 }}>
      <Icon size={34} style={{ color: channel.accent, opacity: 0.55 }} />
      <div style={{ fontWeight: 600 }}>Nothing here yet</div>
      <div style={{ fontSize: 13, color: 'rgb(var(--ds-muted))', maxWidth: 380, lineHeight: 1.55 }}>
        {channel.description} Be the first to say something.
      </div>
    </div>
  )
}

function MessageRow({ message, me, api, onChanged }: {
  message: Message; me: any; api: any; onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const mine = message.authorId === me.id
  const prayers = message.reactions?.pray?.length || 0
  const iPrayed = !!message.reactions?.pray?.includes(me.id)

  const act = async (fn: () => Promise<any>) => {
    setBusy(true)
    try { await fn(); onChanged() } finally { setBusy(false) }
  }

  const report = () => act(async () => {
    const why = window.prompt('Why are you reporting this message?')
    if (why) await api.report(message.id, why)
  })

  return (
    <div className="group flex gap-3" style={{ padding: '7px 0' }}>
      <img src={avatarDataUri(message.authorSeed, 34)} width={34} height={34} alt=""
           style={{ borderRadius: 10, flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="flex items-baseline gap-2">
          <span style={{ fontSize: 13, fontWeight: 650 }}>
            {message.anonymous && !mine ? 'Anonymous' : message.authorHandle}
          </span>
          <span style={{ fontSize: 10.5, color: 'rgb(var(--ds-muted))' }}>
            {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {message.kind !== 'text' && <KindTag kind={message.kind} />}

          <span className="ml-auto opacity-0 group-hover:opacity-100 flex gap-1" style={{ transition: 'opacity .15s' }}>
            {!mine && (
              <>
                <IconBtn title="Report" onClick={report} disabled={busy}><Flag size={12} /></IconBtn>
                <IconBtn title="Block this person" disabled={busy}
                  onClick={() => act(() => api.block(message.authorId, true))}><EyeOff size={12} /></IconBtn>
              </>
            )}
          </span>
        </div>

        <MessageBody message={message} />

        {message.kind === 'prayer' && (
          <button
            onClick={() => act(() => api.react(message.id, 'pray'))}
            disabled={busy}
            style={{
              marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 11.5, padding: '3px 9px', borderRadius: 999, cursor: 'pointer',
              background: iPrayed ? 'rgba(251,191,36,0.16)' : 'rgb(var(--ds-surface))',
              border: `1px solid ${iPrayed ? 'rgba(251,191,36,0.4)' : 'rgb(var(--ds-border))'}`,
              color: iPrayed ? '#fbbf24' : 'rgb(var(--ds-muted))',
            }}>
            <HandHeart size={12} />
            {prayers > 0 ? `${prayers} praying` : 'I am praying'}
          </button>
        )}
      </div>
    </div>
  )
}

function MessageBody({ message }: { message: Message }) {
  if (message.kind === 'verse') {
    return (
      <div style={{
        marginTop: 4, padding: '9px 12px', borderRadius: 9,
        background: 'rgba(251,191,36,0.07)', borderLeft: '3px solid #fbbf24',
      }}>
        <div style={{ fontSize: 13.5, lineHeight: 1.6, fontStyle: 'italic' }}>{message.body}</div>
        {message.verse && (
          <div style={{ fontSize: 11.5, color: '#fbbf24', marginTop: 5 }}>
            {message.verse.book} {message.verse.chapter}:{message.verse.verse}
            {message.verse.endVerse ? `-${message.verse.endVerse}` : ''}
            {' · '}{message.verse.translation.toUpperCase()}
          </div>
        )}
      </div>
    )
  }

  if (message.kind === 'code') {
    // Rendered as text in a <pre>, never evaluated. Nothing in the community
    // executes, and nothing arrives as a file.
    return (
      <pre style={{
        marginTop: 4, padding: '9px 12px', borderRadius: 9, overflowX: 'auto',
        background: 'rgb(var(--ds-bg))', border: '1px solid rgb(var(--ds-border))',
        fontSize: 12.5, lineHeight: 1.5,
      }}><code>{message.body}</code></pre>
    )
  }

  return <div style={{ fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{message.body}</div>
}

function KindTag({ kind }: { kind: MessageKind }) {
  const label = kind === 'prayer' ? 'Prayer request'
    : kind === 'verse' ? 'Verse'
    : kind === 'testimony' ? 'Testimony'
    : 'Code'
  return (
    <span style={{
      fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.05em',
      padding: '1px 6px', borderRadius: 5, color: 'rgb(var(--ds-muted))',
      border: '1px solid rgb(var(--ds-border))',
    }}>{label}</span>
  )
}

function IconBtn({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} style={{
      padding: 4, borderRadius: 6, cursor: 'pointer',
      color: 'rgb(var(--ds-muted))', background: 'transparent', border: 'none',
    }}>{children}</button>
  )
}

// ── Composer ───────────────────────────────────────────────────────────────

function Composer(props: {
  channel: ChannelDef
  draft: string; setDraft: (v: string) => void
  kind: MessageKind; setKind: (k: MessageKind) => void
  anonymous: boolean; setAnonymous: (v: boolean) => void
  error: string; sending: boolean; onSend: () => void
}) {
  const { channel, draft, setDraft, kind, setKind, anonymous, setAnonymous, error, sending, onSend } = props

  return (
    <div style={{ borderTop: '1px solid rgb(var(--ds-border))', padding: '10px 16px 12px' }}>
      {/* Built from the channel's own list, so a room never shows a button for
          something the main process would reject. */}
      {channel.extras.length > 0 && (
        <div className="flex gap-1.5 mb-2">
          <KindChip on={kind === 'text'} onClick={() => setKind('text')} accent={channel.accent}>Message</KindChip>
          {channel.extras.map(k => (
            <KindChip key={k} on={kind === k} onClick={() => setKind(k)} accent={channel.accent}>
              {k === 'verse' ? 'Verse' : k === 'prayer' ? 'Prayer request'
                : k === 'testimony' ? 'Testimony' : 'Code'}
            </KindChip>
          ))}
        </div>
      )}

      {kind === 'prayer' && (
        <label className="flex items-center gap-2 mb-2" style={{ fontSize: 11.5, color: 'rgb(var(--ds-muted))', cursor: 'pointer' }}>
          <input type="checkbox" checked={anonymous} onChange={e => setAnonymous(e.target.checked)} />
          Post without my name (still visible to everyone in the room)
        </label>
      )}

      <div className="flex gap-2 items-end">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            // Enter sends, Shift+Enter breaks the line — the convention every
            // chat app has trained people into.
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() }
          }}
          rows={kind === 'code' || kind === 'testimony' ? 4 : 2}
          maxLength={4000}
          placeholder={
            kind === 'prayer' ? 'What would you like prayer for?'
            : kind === 'verse' ? 'Type the verse, then say what it means to you'
            : kind === 'code' ? 'Paste code here — it is shown as text and never run'
            : `Message ${channel.name}`
          }
          className="flex-1 px-3 py-2 rounded-lg outline-none resize-none"
          style={{
            background: 'rgb(var(--ds-surface))', color: 'rgb(var(--ds-text))',
            border: '1px solid rgb(var(--ds-border))', fontSize: 13.5, lineHeight: 1.5,
          }}
        />
        <button
          onClick={onSend}
          disabled={!draft.trim() || sending}
          style={{
            padding: '9px 12px', borderRadius: 9, cursor: draft.trim() ? 'pointer' : 'not-allowed',
            background: draft.trim() ? channel.accent : 'rgb(var(--ds-surface))',
            color: draft.trim() ? '#08160f' : 'rgb(var(--ds-muted))',
            border: '1px solid rgb(var(--ds-border))',
          }}>
          {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
      </div>

      {error && <div style={{ color: '#f87171', fontSize: 12, marginTop: 6 }}>{error}</div>}
      <div style={{ fontSize: 10.5, color: 'rgb(var(--ds-muted))', marginTop: 6 }}>
        Text only — nothing can be uploaded here. Enter sends, Shift+Enter for a new line.
      </div>
    </div>
  )
}

function KindChip({ on, accent, children, ...rest }: {
  on: boolean; accent: string; children: React.ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} style={{
      fontSize: 11.5, padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
      background: on ? `${accent}1e` : 'transparent',
      border: `1px solid ${on ? `${accent}45` : 'rgb(var(--ds-border))'}`,
      color: on ? accent : 'rgb(var(--ds-muted))',
    }}>{children}</button>
  )
}

function BannedNotice({ reason }: { reason?: string }) {
  return (
    <div style={{
      borderTop: '1px solid rgb(var(--ds-border))', padding: '14px 18px',
      color: '#fca5a5', fontSize: 13, lineHeight: 1.55,
    }}>
      You can read the community but not post{reason ? `: ${reason}` : '.'}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex items-center justify-center gap-2"
         style={{ background: 'rgb(var(--ds-bg))', color: 'rgb(var(--ds-muted))', fontSize: 13 }}>
      {children}
    </div>
  )
}
