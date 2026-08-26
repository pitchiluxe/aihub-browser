import React, { useCallback, useEffect, useState } from 'react'
import { Users, AlertTriangle, Loader2, ArrowLeft } from 'lucide-react'
import { validateHandle, joinBlocker } from '../../../../shared/communityHandle'
import { avatarDataUri } from '../../../../shared/communityAvatar'
import '../../styles/community-welcome.css'
import ModerationPanel from '../community/ModerationPanel'
import AccountPanel from '../community/AccountPanel'
import CommunityShell from '../community/CommunityShell'

/**
 * The Community page.
 *
 * This file owns the two things that sit outside the workspace: joining, and
 * the panels that are destinations rather than rooms (moderation queue,
 * guidelines, your own account). Everything else — channels, messages, members,
 * voice — lives in CommunityShell.
 */

type Status = any   // shaped by main; narrowed at the use sites below
type View = 'workspace' | 'moderation' | 'guidelines' | 'account'

export default function CommunityPage() {
  const [status, setStatus] = useState<Status | null>(null)
  const [view, setView] = useState<View>('workspace')
  const [isModerator, setIsModerator] = useState(false)

  const api = (window as any).electronAPI?.community

  useEffect(() => {
    if (!api) return
    api.status().then(setStatus).catch(() => setStatus(null))
    const offStatus = api.onStatus(setStatus)
    return () => offStatus?.()
  }, [api])

  // Whether to offer the queue at all. Advisory only: main authorises every
  // moderation call again regardless of what this says.
  useEffect(() => {
    if (!api) return
    api.moderatorStatus()
      .then((r: any) => setIsModerator(!!r?.isModerator))
      .catch(() => setIsModerator(false))
  }, [api, status])

  const backToWorkspace = useCallback(() => setView('workspace'), [])

  if (!api) return <Centered>Community is unavailable in this build.</Centered>
  if (!status) return <Centered><Loader2 size={18} className="animate-spin" /> Loading…</Centered>
  if (status.state === 'unregistered') return <Onboarding onJoined={setStatus} />

  if (view !== 'workspace') {
    return (
      <div className="flex h-full flex-col"
           style={{ background: 'rgb(var(--ds-bg))', color: 'rgb(var(--ds-text))' }}>
        <button
          onClick={backToWorkspace}
          className="flex items-center gap-2 px-5 py-3 text-sm"
          style={{ color: 'rgb(var(--ds-muted))', borderBottom: '1px solid rgb(var(--ds-border))' }}
        >
          <ArrowLeft size={15} /> Back to the community
        </button>
        {view === 'moderation' && <ModerationPanel />}
        {view === 'guidelines' && <GuidelinesPanel />}
        {view === 'account' && (
          <AccountPanel
            me={status.member}
            onGone={() => { backToWorkspace(); api.status().then(setStatus).catch(() => {}) }}
          />
        )}
      </div>
    )
  }

  return (
    <div className="h-full">
      {status.state === 'banned' && <BannedNotice reason={status.member?.banReason} />}
      <CommunityShell
        isModerator={isModerator}
        onOpenModeration={() => setView('moderation')}
        onOpenAccount={() => setView('account')}
        onOpenGuidelines={() => setView('guidelines')}
      />
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

  // What the well is doing, which is real state rather than decoration: it
  // ripples only while a name is genuinely in flight to the main process.
  const wellState = !check.ok ? 'idle'
    : taken === null ? 'checking'
    : taken ? 'taken' : 'ok'

  return (
    <div className="cw h-full overflow-y-auto flex justify-center px-8">
      <div className="cw-center" style={{ maxWidth: 540, width: '100%' }}>
        <div className="cw-pane">
          <div className="flex items-center gap-2.5">
            <Users size={15} style={{ color: 'var(--cw-aqua)' }} />
            <span className="cw-eyebrow">AIHub Community</span>
          </div>
          <h1 className="cw-title">Find your <strong>room</strong>.</h1>

          <p className="cw-lede">
            Rooms for AI, technology, cloud, networking, Bible study, trading and
            the rest. Text channels, voice channels, screen sharing. You post under
            a name you choose — no email, no password, no account anywhere else.
          </p>

          <div style={{ marginTop: 18 }}><LocalPreviewBanner /></div>

          <div style={{ marginTop: 18 }}>
            <Rule>
              <strong>Posts are public and lasting.</strong> Anyone in the room can
              read what you write. Prayer requests can be posted anonymously, but
              they are still public.
            </Rule>
            <Rule>
              <strong>Files stay on this computer.</strong> Images, video and PDFs
              can be attached. They are checked by their actual contents rather than
              their name, and stored in your own profile folder — nothing is uploaded
              anywhere.
            </Rule>
            <Rule>
              <strong>Be decent.</strong> Harassment, spam and impersonation get you
              removed. Every message has a report button.
            </Rule>
          </div>

          <label className="cw-label">Your name in the community</label>
          <div className="flex items-center gap-3">
            {/* The signature. The avatar sits in a lit basin and the surface
                ripples while the name is being checked — motion tied to state,
                so it reports rather than decorates. */}
            <div className="cw-well" data-state={wellState}>
              <img src={avatarDataUri(previewSeed, 40)} width={40} height={40} alt="" />
            </div>
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
              className="cw-field"
              data-invalid={!!handle && !check.ok}
            />
          </div>

          <div style={{ minHeight: 18, marginTop: 8 }}>
            {handle && !check.ok && <span className="cw-note cw-bad">{check.error}</span>}
            {check.ok && taken === false && (
              <span className="cw-note cw-ok"><strong>{check.value}</strong> is available.</span>
            )}
            {check.ok && taken === true && (
              <span className="cw-note cw-bad">
                <strong>{check.value}</strong> is taken.
                {suggestions.length > 0 && (
                  <>
                    {' '}Try{' '}
                    {suggestions.map((s, i) => (
                      <React.Fragment key={s}>
                        {i > 0 && ', '}
                        <button className="cw-link" onClick={() => setHandle(s)}>{s}</button>
                      </React.Fragment>
                    ))}
                    .
                  </>
                )}
              </span>
            )}
          </div>

          <label className="cw-agree">
            <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />
            <span>I have read the three rules above and agree to them.</span>
          </label>

          {error && <div className="cw-note cw-bad" style={{ marginTop: 12 }}>{error}</div>}

          <button onClick={join} disabled={!canJoin} className="cw-join">
            {busy ? 'Joining…' : 'Join the community'}
          </button>

          {/* Never leave a disabled control unexplained: say which step is
              outstanding, in the order the user would fix them. */}
          {!canJoin && !busy && (
            <div className="cw-note" style={{ marginTop: 10, textAlign: 'center' }}>
              {blocker || (taken === true ? 'That name is taken — pick another.' : 'Checking that name…')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Rule({ children }: { children: React.ReactNode }) {
  // A facet of crystal: light sweeps across it as the pointer passes. The
  // sweep is a one-shot on hover rather than a loop — three cards pulsing
  // away on their own would pull attention off the well, which is the one
  // thing on this screen that is meant to hold it.
  return <div className="cw-rule">{children}</div>
}

/**
 * Whether there is a server is now a question, not a given.
 *
 * Saying which is not optional: someone who believes they are talking to a room
 * full of people, and is not, has been lied to by the product — and that was
 * exactly the complaint. The reverse is just as bad, so once a backend is
 * connected this says nothing rather than warning about a limitation that has
 * been lifted.
 *
 * Reads the backend directly rather than taking a prop, because it renders on
 * the onboarding screen, before there is a member or a status object to hang it
 * off.
 */
function LocalPreviewBanner() {
  const [network, setNetwork] = useState<'local' | 'connecting' | 'remote' | 'error'>('local')

  useEffect(() => {
    const api = (window as any).electronAPI?.community
    let alive = true
    api?.backend?.get?.()
      .then((b: any) => { if (alive && b) setNetwork(b.network) })
      .catch(() => {})
    const off = api?.onBackendStatus?.((b: any) => setNetwork(b.network))
    return () => { alive = false; off?.() }
  }, [])

  if (network === 'remote') return null

  return (
    <div className="flex gap-2 items-start" style={{
      fontSize: 12.5, lineHeight: 1.5, padding: '10px 12px', marginBottom: 14,
      borderRadius: 8, color: '#fcd34d',
      background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.30)',
    }}>
      <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>
        <strong>This computer only.</strong> No community backend is connected, so
        messages you post stay on this computer and nobody else can see them — not
        even someone running AIHub beside you. Voice, video and screen sharing
        work between windows here. Join anyway: your name and identity key carry
        over, and connecting a backend later brings this history with it.
      </span>
    </div>
  )
}

// ── Guidelines ─────────────────────────────────────────────────────────────

function GuidelinesPanel() {
  return (
    <div className="flex-1 overflow-y-auto" style={{ padding: '18px 22px', maxWidth: 620 }}>
      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Community guidelines</h2>
      <p style={{ color: 'rgb(var(--ds-muted))', fontSize: 12.5, marginBottom: 16 }}>
        These are the rules you agreed to when you joined.
      </p>

      <Rule>
        <strong>Posts are public and lasting.</strong> Anyone in the room can read what you
        write. Prayer requests can be posted anonymously, but they are still public.
      </Rule>
      <Rule>
        <strong>Files stay on this computer.</strong> Images, video and PDFs can be attached.
        Every file is identified by its actual contents rather than its name, images are
        re-encoded so location data is stripped, and nothing is uploaded anywhere.
      </Rule>
      <Rule>
        <strong>Be decent.</strong> Harassment, spam and impersonation get you removed.
        Every message has a report button.
      </Rule>

      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '22px 0 8px' }}>What happens when
        something is reported</h3>
      <p style={{ color: 'rgb(var(--ds-muted))', fontSize: 12.5, lineHeight: 1.65 }}>
        One report puts a message in front of a moderator. Three from different people hide
        it from the room straight away, before anyone has looked at it — hidden, not deleted,
        so a pile-on cannot destroy anything on its own. A moderator then keeps it, removes
        it, or removes it and bans whoever posted it. A banned member can still read the
        rooms; they cannot post.
      </p>

      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '22px 0 8px' }}>Timeouts and bans</h3>
      <p style={{ color: 'rgb(var(--ds-muted))', fontSize: 12.5, lineHeight: 1.65 }}>
        A timeout is the proportionate answer to a bad afternoon: you keep reading, you stop
        posting, and it lifts by itself. A ban is the answer to something worse. Both are
        recorded in the audit log with who did it and when.
      </p>

      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '22px 0 8px' }}>Who runs the community</h3>
      <p style={{ color: 'rgb(var(--ds-muted))', fontSize: 12.5, lineHeight: 1.65 }}>
        Channels, categories and roles are managed by the community owner, and by nobody
        else. Ownership is not a setting that can be switched on — it is bound to a verified
        Google account, checked by the main process on every request. Moderators can remove
        messages and sanction members; they cannot reshape the community.
      </p>

      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '22px 0 8px' }}>New accounts</h3>
      <p style={{ color: 'rgb(var(--ds-muted))', fontSize: 12.5, lineHeight: 1.65 }}>
        For the first day a new name posts once every thirty seconds and cannot post links.
        Both limits lift once the account has some history. This is not about you — it is
        what makes a ban cost something.
      </p>
    </div>
  )
}

function BannedNotice({ reason }: { reason?: string }) {
  return (
    <div style={{
      borderBottom: '1px solid rgb(var(--ds-border))', padding: '10px 18px',
      color: '#fca5a5', fontSize: 13, lineHeight: 1.55,
      background: 'rgba(248,113,113,0.08)',
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
