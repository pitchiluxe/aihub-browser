import React from 'react'
import {
  Mic, MicOff, Headphones, VolumeX, Video, VideoOff,
  MonitorUp, MonitorX, PhoneOff, Loader2, AlertCircle,
} from 'lucide-react'
import { Avatar } from './bits'
import type { CommunityMember } from './useCommunity'
import type { VoicePeer, VoiceError } from './useVoiceSession'

/**
 * The voice control dock.
 *
 * The dock is always visible while connected, because the two questions people
 * ask constantly in a call — am I muted, how do I leave — must never be more
 * than one glance and one click away.
 *
 * The stage this file used to own now lives in VoiceStage.tsx, mounted in the
 * main column. Rendering video here meant a shared screen got a 340px strip
 * beneath the chat; it needs the window. The dock keeps the controls and the
 * roster of faces, which is all it should ever have had.
 *
 * Connection state is reported honestly. "Connecting" is a real state here, not
 * a spinner that resolves optimistically, and a failure says what would fix it
 * rather than asking the user to try again at nothing.
 */

interface Props {
  channelName: string
  peers: VoicePeer[]
  selfPeerId: string
  memberById: Map<string, CommunityMember>
  speaking: Record<string, boolean>
  connection: 'idle' | 'connecting' | 'live' | 'failed'
  error: VoiceError | null
  muted: boolean
  deafened: boolean
  camera: boolean
  sharing: boolean
  canVideo: boolean
  canShare: boolean
  onToggleMute: () => void
  onToggleDeafen: () => void
  onToggleCamera: () => void
  onStartShare: () => void
  onStopShare: () => void
  onLeave: () => void
  onDismissError: () => void
}

export default function VoiceDock(props: Props) {
  const {
    channelName, peers, selfPeerId, memberById,
    speaking, connection, error, muted, deafened, camera, sharing,
    canVideo, canShare, onToggleMute, onToggleDeafen, onToggleCamera,
    onStartShare, onStopShare, onLeave, onDismissError,
  } = props

  const statusText = {
    idle: 'Not connected',
    connecting: 'Connecting…',
    live: peers.length > 1 ? `Connected · ${peers.length} in the room` : 'Connected · waiting for others',
    failed: 'Connection failed',
  }[connection]

  return (
    <>
      <div
        className="flex flex-wrap items-center gap-3 px-4 py-2.5"
        style={{ borderTop: '1px solid var(--cm-line)' }}
        role="region"
        aria-label="Voice controls"
      >
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--cm-ink)' }}>
            {connection === 'connecting' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                background: connection === 'live' ? 'var(--cm-accent)'
                  : connection === 'failed' ? 'var(--cm-danger)' : 'var(--cm-warn)',
              }}
              aria-hidden="true"
            />
            <span className="truncate">{channelName}</span>
          </p>
          <p className="cm-slug truncate text-[11px]" style={{ color: 'var(--cm-faint)' }}>
            {statusText}
          </p>
        </div>

        <ul className="flex items-center -space-x-1.5">
          {peers.map(peer => {
            const member = memberById.get(peer.memberId)
            const key = peer.peerId === selfPeerId ? 'self' : peer.peerId
            return (
              <li key={peer.peerId} title={member?.handle ?? 'Member'}>
                <span className={speaking[key] ? 'cm-speaking inline-block rounded-full' : 'inline-block rounded-full'}>
                  <Avatar seed={member?.avatarSeed ?? peer.memberId} size={26} />
                </span>
              </li>
            )
          })}
        </ul>

        <div className="flex items-center gap-1">
          <DockButton label={muted ? 'Unmute' : 'Mute'} active={muted} danger={muted} onClick={onToggleMute}>
            {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </DockButton>

          <DockButton label={deafened ? 'Undeafen' : 'Deafen'} active={deafened} danger={deafened} onClick={onToggleDeafen}>
            {deafened ? <VolumeX className="h-4 w-4" /> : <Headphones className="h-4 w-4" />}
          </DockButton>

          {canVideo && (
            <DockButton label={camera ? 'Turn camera off' : 'Turn camera on'} active={camera} onClick={onToggleCamera}>
              {camera ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
            </DockButton>
          )}

          {canShare && (
            <DockButton
              label={sharing ? 'Stop sharing' : 'Share your screen'}
              active={sharing}
              onClick={sharing ? onStopShare : onStartShare}
            >
              {sharing ? <MonitorX className="h-4 w-4" /> : <MonitorUp className="h-4 w-4" />}
            </DockButton>
          )}

          <button
            onClick={onLeave}
            title="Disconnect"
            aria-label="Disconnect from voice"
            className="ml-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
            style={{ background: 'color-mix(in srgb, var(--cm-danger) 16%, transparent)', color: 'var(--cm-danger)' }}
          >
            <PhoneOff className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && (
        <p
          className="flex items-start gap-2 px-4 pb-2.5 text-xs"
          style={{ color: 'var(--cm-danger)' }}
          role="alert"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{error.message}</span>
          <button onClick={onDismissError} className="underline">Dismiss</button>
        </p>
      )}
    </>
  )
}

function DockButton({
  label, active, danger, onClick, children,
}: {
  label: string; active?: boolean; danger?: boolean
  onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className="rounded-lg p-2 transition-colors hover:bg-[var(--cm-hover)]"
      style={{
        color: danger ? 'var(--cm-danger)' : active ? 'var(--cm-accent)' : 'var(--cm-dim)',
        background: active && !danger ? 'color-mix(in srgb, var(--cm-accent) 14%, transparent)' : undefined,
      }}
    >
      {children}
    </button>
  )
}
