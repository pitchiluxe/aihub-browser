import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Hash, Menu, Search, Users, Bell, BellOff, BellRing, ShieldAlert, AlertCircle,
  UserCog, ScrollText, Megaphone, Loader2,
} from 'lucide-react'
import type { Attachment, Channel, Message, NotifLevel } from '../../../../shared/community'
import { extensionFor } from '../../../../shared/fileTypes'
import { useCommunity } from './useCommunity'
import { useVoiceSession } from './useVoiceSession'
import ChannelSidebar from './ChannelSidebar'
import MessageList from './MessageList'
import Composer from './Composer'
import MemberList from './MemberList'
import VoiceDock from './VoiceDock'
import OwnerTools from './OwnerTools'
import { ChannelEditor, ScreenPicker, TimeoutDialog } from './dialogs'
import { SearchPanel, ThreadPanel } from './panels'
import { ChannelIcon } from './bits'
import '../../styles/community.css'

/**
 * The community workspace.
 *
 * Four columns and a dock, and one idea holding the visual design together:
 * the channel you are standing in tints the whole frame. Every channel already
 * carried an accent colour and nothing used it for more than a dot; here it
 * becomes `--cm-accent` and drives the header rule, the active spine, focus
 * rings, the unread divider and the speaking ring.
 *
 * This component holds layout and intent. It decides what to draw from `can()`,
 * and the main process decides what may actually happen — when they disagree,
 * the sentence on screen is the one the main process returned.
 */

interface Props {
  onOpenModeration: () => void
  onOpenAccount: () => void
  onOpenGuidelines: () => void
  isModerator: boolean
}

function attachmentUrl(attachment: Attachment): string {
  return `aihub-community-file://${attachment.sha256}.${extensionFor(attachment.mime)}`
}

export default function CommunityShell(props: Props) {
  const { onOpenModeration, onOpenAccount, onOpenGuidelines, isModerator } = props

  const [activeSlug, setActiveSlug] = useState('general')
  const [membersOpen, setMembersOpen] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [rightPanel, setRightPanel] = useState<'none' | 'search' | 'thread'>('none')
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [thread, setThread] = useState<{ root: Message; replies: Message[] } | null>(null)
  const [threadBusy, setThreadBusy] = useState(false)

  const [editorFor, setEditorFor] = useState<{ channel?: Channel; categoryId: string } | null>(null)
  const [editorError, setEditorError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [timeoutFor, setTimeoutFor] = useState<string | null>(null)
  const [ownership, setOwnership] = useState<{ googleConnected: boolean }>({ googleConnected: false })

  const community = useCommunity(activeSlug)
  const voice = useVoiceSession()
  const { api, snapshot, messages, unread, mentions, can, memberById, roleFor } = community

  const channel = useMemo(
    () => snapshot.channels.find(c => c.slug === activeSlug),
    [snapshot.channels, activeSlug],
  )

  // Land somewhere real: 'general' may not exist in an older community, and a
  // shell pointing at nothing shows an empty room with no explanation.
  useEffect(() => {
    if (channel || !snapshot.channels.length) return
    const first = snapshot.channels.find(c => c.type !== 'voice')
    if (first) setActiveSlug(first.slug)
  }, [channel, snapshot.channels])

  useEffect(() => { api?.ownership().then(setOwnership).catch(() => {}) }, [api, settingsOpen])

  const notifLevel: NotifLevel = snapshot.notifPrefs[activeSlug] ?? 'mentions'

  /**
   * Tint the frame. Set as an inline custom property rather than a class,
   * because the value is the channel's own colour and there is no fixed set of
   * them to enumerate in CSS.
   */
  const shellStyle = { ['--cm-accent' as string]: channel?.accent ?? '#34d399' }

  // ── Actions ──────────────────────────────────────────────────────────────

  const openThread = useCallback(async (root: Message) => {
    setRightPanel('thread')
    const result = await api?.thread(root.id)
    if (result?.ok) setThread({ root: result.root, replies: result.replies })
    else setThread({ root, replies: [] })
  }, [api])

  const sendThreadReply = useCallback(async (body: string) => {
    if (!thread) return { ok: false }
    setThreadBusy(true)
    const result = await community.post({ body, replyToId: thread.root.id })
    setThreadBusy(false)
    if (result?.ok) {
      const fresh = await api?.thread(thread.root.id)
      if (fresh?.ok) setThread({ root: fresh.root, replies: fresh.replies })
    }
    return result
  }, [api, community, thread])

  const jumpTo = useCallback((slug: string, messageId: string) => {
    setActiveSlug(slug)
    setRightPanel('none')
    setDrawerOpen(false)
    if (!messageId) return
    // The row may not be mounted yet; one frame is enough for the page to land.
    requestAnimationFrame(() => {
      document.getElementById(`cm-msg-${messageId}`)?.scrollIntoView({ block: 'center' })
    })
  }, [])

  const saveChannel = useCallback(async (input: {
    name: string; description: string; topic: string; categoryId: string; type: any
  }) => {
    setEditorError('')
    const existing = editorFor?.channel
    const result = existing
      ? await api?.updateChannel(existing.slug, input)
      : await api?.createChannel(input)

    if (result?.ok === false) { setEditorError(result.error); return }
    await community.refresh()
    setEditorFor(null)
  }, [api, community, editorFor])

  const joinVoice = useCallback(async (slug: string) => {
    if (voice.channel === slug) { await voice.leave(); return }
    if (voice.channel) await voice.leave()
    await voice.join(slug)
  }, [voice])

  const canPost = channel
    ? channel.type !== 'voice' && can('send_messages')
    : false

  const postDisabledReason = !channel
    ? 'Pick a channel to start.'
    : channel.type === 'announcement'
      ? 'Only the community owner posts announcements.'
      : 'You do not have permission to post here.'

  const typingNames = community.typingHere
    .filter(id => id !== snapshot.memberId)
    .map(id => memberById.get(id)?.handle)
    .filter(Boolean) as string[]

  const voiceChannelName = voice.channel
    ? snapshot.channels.find(c => c.slug === voice.channel)?.name ?? voice.channel
    : ''

  return (
    <div
      className="cm-shell relative"
      style={shellStyle}
      data-members={membersOpen ? 'open' : 'closed'}
      data-drawer={drawerOpen ? 'open' : 'closed'}
    >
      {/* ── Rail ─────────────────────────────────────────────────────────── */}
      <div className="cm-rail flex flex-col items-center gap-2 py-3">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-2xl text-lg font-bold"
          style={{ background: 'color-mix(in srgb, var(--cm-accent) 20%, transparent)', color: 'var(--cm-accent)' }}
          title="AIHub Community"
        >
          A
        </div>
        <span className="my-1 h-px w-7" style={{ background: 'var(--cm-line)' }} />

        <RailButton label="Channels" active={rightPanel === 'none'} onClick={() => setRightPanel('none')}>
          <Hash className="h-5 w-5" />
        </RailButton>
        <RailButton label="Search" active={rightPanel === 'search'} onClick={() => setRightPanel('search')}>
          <Search className="h-5 w-5" />
        </RailButton>
        {isModerator && (
          <RailButton label="Reports" onClick={onOpenModeration}>
            <ShieldAlert className="h-5 w-5" />
          </RailButton>
        )}
        <RailButton label="Guidelines" onClick={onOpenGuidelines}>
          <ScrollText className="h-5 w-5" />
        </RailButton>

        <div className="mt-auto flex flex-col items-center gap-2">
          <RailButton label="Community settings" onClick={() => setSettingsOpen(true)}>
            <UserCog className="h-5 w-5" />
          </RailButton>
          <RailButton label="Your account" onClick={onOpenAccount}>
            <Users className="h-5 w-5" />
          </RailButton>
        </div>
      </div>

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <div className="cm-sidebar">
        <ChannelSidebar
          categories={snapshot.categories}
          channels={snapshot.channels}
          activeSlug={activeSlug}
          unread={unread}
          mentions={mentions}
          voice={snapshot.voice}
          memberById={memberById}
          canManage={can('manage_channels')}
          onSelect={slug => { setActiveSlug(slug); setDrawerOpen(false); setRightPanel('none') }}
          onJoinVoice={joinVoice}
          onCreateChannel={categoryId => { setEditorError(''); setEditorFor({ categoryId }) }}
          onEditChannel={slug => {
            const target = snapshot.channels.find(c => c.slug === slug)
            if (target) { setEditorError(''); setEditorFor({ channel: target, categoryId: target.categoryId }) }
          }}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </div>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <main className="cm-main flex min-w-0 flex-col">
        <header
          className="flex items-center gap-2 px-4 py-3"
          style={{ borderBottom: '1px solid var(--cm-line)' }}
        >
          <button
            onClick={() => setDrawerOpen(o => !o)}
            aria-label="Show channels"
            className="rounded p-1 lg:hidden"
            style={{ color: 'var(--cm-dim)' }}
          >
            <Menu className="h-5 w-5" />
          </button>

          {channel && (
            <ChannelIcon name={channel.icon} className="h-4.5 w-4.5 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="cm-slug truncate text-sm font-semibold" style={{ color: 'var(--cm-ink)' }}>
              {channel?.name ?? 'Community'}
            </h1>
            {(channel?.topic || channel?.description) && (
              <p className="truncate text-[11px]" style={{ color: 'var(--cm-faint)' }}>
                {channel.topic || channel.description}
              </p>
            )}
          </div>

          {channel?.type === 'announcement' && (
            <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{ background: 'color-mix(in srgb, var(--cm-warn) 16%, transparent)', color: 'var(--cm-warn)' }}>
              <Megaphone className="h-3 w-3" /> Announcements
            </span>
          )}

          <NotificationControl
            level={notifLevel}
            onChange={level => { void api?.setNotifPref(activeSlug, level); void community.refresh() }}
          />

          <HeaderButton label="Search" onClick={() => setRightPanel(rightPanel === 'search' ? 'none' : 'search')}>
            <Search className="h-4 w-4" />
          </HeaderButton>
          <HeaderButton label={membersOpen ? 'Hide members' : 'Show members'} onClick={() => setMembersOpen(o => !o)}>
            <Users className="h-4 w-4" />
          </HeaderButton>
        </header>

        {channel?.type === 'voice' ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
            <p className="text-sm" style={{ color: 'var(--cm-dim)' }}>
              {channel.name} is a voice channel.
            </p>
            <button
              onClick={() => joinVoice(channel.slug)}
              className="rounded-lg px-4 py-2 text-sm font-medium"
              style={{ background: 'var(--cm-accent)', color: '#08131a' }}
            >
              {voice.channel === channel.slug ? 'Leave' : 'Join voice'}
            </button>
          </div>
        ) : (
          <>
            <MessageList
              messages={messages}
              memberId={snapshot.memberId}
              memberById={memberById}
              roleFor={roleFor}
              channelName={channel?.name ?? ''}
              channelDescription={channel?.description ?? ''}
              lastReadAt={snapshot.reads[activeSlug] ?? 0}
              exhausted={community.exhausted}
              canModerate={can('manage_messages')}
              onLoadOlder={community.loadOlder}
              onReply={setReplyTo}
              onOpenThread={openThread}
              onEdit={community.edit}
              onDelete={async id => { await api?.deleteMessage(id); await community.loadChannel(activeSlug) }}
              onReact={community.react}
              onReport={async id => {
                const why = window.prompt('What is wrong with this message?')
                if (why) await api?.report(id, why)
              }}
              attachmentUrl={attachmentUrl}
            />

            {typingNames.length > 0 && (
              <p className="px-5 pb-1 text-[11px]" style={{ color: 'var(--cm-dim)' }} aria-live="polite">
                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                {typingNames.length === 1
                  ? `${typingNames[0]} is typing…`
                  : `${typingNames.slice(0, 2).join(' and ')} are typing…`}
              </p>
            )}

            <Composer
              channelName={channel?.name ?? ''}
              disabled={!canPost}
              disabledReason={postDisabledReason}
              canAttach={can('attach_files')}
              members={snapshot.members}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
              onSend={(body, attachments) => community.post({
                body,
                ...(attachments.length ? { attachments } : {}),
                ...(replyTo ? { replyToId: replyTo.id } : {}),
              })}
              onTyping={community.setTyping}
              upload={(name, bytes) => api.uploadAttachment(name, bytes)}
              error={community.error}
            />
          </>
        )}
      </main>

      {/* ── Right column ─────────────────────────────────────────────────── */}
      <div className="cm-aside" style={{ borderLeft: '1px solid var(--cm-line)' }}>
        {rightPanel === 'search' ? (
          <SearchPanel
            onClose={() => setRightPanel('none')}
            onJump={jumpTo}
            search={async query => {
              const result = await api?.search(query)
              return { messages: result?.messages ?? [], members: result?.members ?? [], channels: result?.channels ?? [] }
            }}
          />
        ) : rightPanel === 'thread' && thread ? (
          <ThreadPanel
            root={thread.root}
            replies={thread.replies}
            memberById={memberById}
            onClose={() => { setRightPanel('none'); setThread(null) }}
            onSend={sendThreadReply}
            busy={threadBusy}
          />
        ) : (
          <MemberList
            members={snapshot.members}
            roles={snapshot.roles}
            roleFor={roleFor}
            ownerId={snapshot.ownership?.memberId}
            canModerate={can('manage_members')}
            canManageRoles={can('manage_roles')}
            memberRoles={snapshot.memberRoles}
            onTimeout={setTimeoutFor}
            onBan={async memberId => {
              const member = memberById.get(memberId)
              const banned = !member?.bannedAt
              const reason = banned ? window.prompt(`Why is ${member?.handle} being banned?`) ?? '' : ''
              await api?.setBanned({ memberId, banned, reason })
              await community.refresh()
            }}
            onAssignRole={async (memberId, roleId) => { await api?.assignRole(memberId, roleId); await community.refresh() }}
            onRevokeRole={async (memberId, roleId) => { await api?.revokeRole(memberId, roleId); await community.refresh() }}
          />
        )}
      </div>

      {/* ── Voice dock ───────────────────────────────────────────────────── */}
      {/*
        A join that fails has to say so. Rendering the dock only once connected
        meant that a refused microphone, a channel you may not enter, or a
        connection that never came up all looked identical to clicking nothing
        at all — the user presses Join and the interface does not react.
      */}
      {!voice.channel && (voice.error || voice.connection === 'connecting') && (
        <div className="cm-dock flex items-center gap-3 px-4 py-2.5" role="status"
             style={{ borderTop: '1px solid var(--cm-line)' }}>
          {voice.connection === 'connecting'
            ? <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--cm-dim)' }} />
            : <AlertCircle className="h-4 w-4 shrink-0" style={{ color: 'var(--cm-danger)' }} />}
          <p className="flex-1 text-xs" style={{ color: voice.error ? 'var(--cm-danger)' : 'var(--cm-dim)' }}>
            {voice.error?.message ?? 'Connecting to voice…'}
          </p>
          {voice.error && (
            <button onClick={() => voice.setError(null)} className="text-xs underline"
                    style={{ color: 'var(--cm-dim)' }}>
              Dismiss
            </button>
          )}
        </div>
      )}

      {voice.channel && (
        <div className="cm-dock">
          <VoiceDock
            channelName={voiceChannelName}
            peers={voice.peers}
            selfPeerId={voice.peerId}
            memberById={memberById}
            remoteStreams={voice.remoteStreams}
            localVideoStream={voice.localVideoStream}
            screenShareStream={voice.screenShareStream}
            speaking={voice.speaking}
            connection={voice.connection}
            error={voice.error}
            muted={voice.muted}
            deafened={voice.deafened}
            camera={voice.camera}
            sharing={voice.sharing}
            canVideo={can('use_video')}
            canShare={can('screen_share')}
            onToggleMute={voice.toggleMute}
            onToggleDeafen={voice.toggleDeafen}
            onToggleCamera={voice.toggleCamera}
            onStartShare={() => setPickerOpen(true)}
            onStopShare={voice.stopScreenShare}
            onLeave={voice.leave}
            onDismissError={() => voice.setError(null)}
          />
        </div>
      )}

      {/* ── Dialogs ──────────────────────────────────────────────────────── */}
      {editorFor && (
        <ChannelEditor
          channel={editorFor.channel}
          categoryId={editorFor.categoryId}
          categories={snapshot.categories}
          error={editorError}
          onClose={() => setEditorFor(null)}
          onSave={saveChannel}
          onDelete={editorFor.channel && (async () => {
            const result = await api?.deleteChannel(editorFor.channel!.slug)
            if (result?.ok === false) setEditorError(result.error)
            else { await community.refresh(); setEditorFor(null) }
          })}
          onRestore={editorFor.channel && (async () => {
            await api?.restoreChannel(editorFor.channel!.slug)
            await community.refresh()
            setEditorFor(null)
          })}
          onPurge={editorFor.channel && (async confirmSlug => {
            const result = await api?.purgeChannel(editorFor.channel!.slug, confirmSlug)
            if (result?.ok === false) setEditorError(result.error)
            else { await community.refresh(); setEditorFor(null) }
          })}
        />
      )}

      {settingsOpen && (
        <OwnerTools
          isOwner={snapshot.isOwner}
          ownership={snapshot.ownership}
          googleConnected={ownership.googleConnected}
          categories={snapshot.categories}
          roles={snapshot.roles}
          api={api}
          onChanged={() => void community.refresh()}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {pickerOpen && (
        <ScreenPicker
          load={() => api.screenSources()}
          onClose={() => setPickerOpen(false)}
          onPick={async sourceId => {
            setPickerOpen(false)
            await voice.startScreenShare(sourceId)
          }}
        />
      )}

      {timeoutFor && (
        <TimeoutDialog
          handle={memberById.get(timeoutFor)?.handle ?? 'this member'}
          onClose={() => setTimeoutFor(null)}
          onApply={async (durationMs, reason) => {
            await api?.timeoutMember({ memberId: timeoutFor, durationMs, reason })
            await community.refresh()
            setTimeoutFor(null)
          }}
        />
      )}
    </div>
  )
}

function RailButton({
  label, active, onClick, children,
}: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-10 w-10 items-center justify-center rounded-xl transition-colors hover:bg-[var(--cm-hover)]"
      style={{
        color: active ? 'var(--cm-accent)' : 'var(--cm-dim)',
        background: active ? 'color-mix(in srgb, var(--cm-accent) 14%, transparent)' : undefined,
      }}
    >
      {children}
    </button>
  )
}

function HeaderButton({
  label, onClick, children,
}: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded-lg p-1.5 transition-colors hover:bg-[var(--cm-hover)]"
      style={{ color: 'var(--cm-dim)' }}
    >
      {children}
    </button>
  )
}

function NotificationControl({
  level, onChange,
}: { level: NotifLevel; onChange: (level: NotifLevel) => void }) {
  const [open, setOpen] = useState(false)
  const Icon = level === 'all' ? BellRing : level === 'none' ? BellOff : Bell

  const options: Array<{ id: NotifLevel; label: string; hint: string }> = [
    { id: 'all', label: 'All messages', hint: 'Notify me for everything here' },
    { id: 'mentions', label: 'Mentions only', hint: 'Only when someone names me' },
    { id: 'none', label: 'Nothing', hint: 'Never notify me here' },
  ]

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="Notification settings"
        aria-label="Notification settings for this channel"
        aria-expanded={open}
        className="rounded-lg p-1.5 transition-colors hover:bg-[var(--cm-hover)]"
        style={{ color: level === 'none' ? 'var(--cm-faint)' : 'var(--cm-dim)' }}
      >
        <Icon className="h-4 w-4" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-xl py-1"
          style={{ background: 'var(--cm-raise)', border: '1px solid var(--cm-line)', boxShadow: '0 12px 40px rgb(0 0 0 / .5)' }}
        >
          {options.map(option => (
            <button
              key={option.id}
              onClick={() => { onChange(option.id); setOpen(false) }}
              className="block w-full px-3 py-2 text-left transition-colors hover:bg-[var(--cm-hover)]"
              aria-pressed={level === option.id}
            >
              <span className="block text-sm" style={{ color: level === option.id ? 'var(--cm-accent)' : 'var(--cm-ink)' }}>
                {option.label}
              </span>
              <span className="block text-[11px]" style={{ color: 'var(--cm-faint)' }}>{option.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
