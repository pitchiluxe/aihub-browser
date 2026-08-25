import React, { useEffect, useRef, useState } from 'react'
import {
  Mic, MicOff, Headphones, VolumeX, Video, VideoOff,
  MonitorUp, MonitorX, PhoneOff, Loader2, AlertCircle, Grid2x2, Maximize2,
} from 'lucide-react'
import { Avatar } from './bits'
import type { CommunityMember } from './useCommunity'
import type { VoicePeer, VoiceError } from './useVoiceSession'

/**
 * The voice dock, and the stage above it.
 *
 * The dock is always visible while connected, because the two questions people
 * ask constantly in a call — am I muted, how do I leave — must never be more
 * than one glance and one click away.
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
  remoteStreams: Record<string, MediaStream>
  localVideoStream: MediaStream | null
  screenShareStream: MediaStream | null
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
    channelName, peers, selfPeerId, memberById, remoteStreams, localVideoStream,
    screenShareStream, speaking, connection, error, muted, deafened, camera, sharing,
    canVideo, canShare, onToggleMute, onToggleDeafen, onToggleCamera,
    onStartShare, onStopShare, onLeave, onDismissError,
  } = props

  const [focused, setFocused] = useState<string | null>(null)

  const anyVideo = camera || sharing
    || peers.some(p => p.peerId !== selfPeerId && (p.camera || p.sharing))

  const statusText = {
    idle: 'Not connected',
    connecting: 'Connecting…',
    live: peers.length > 1 ? `Connected · ${peers.length} in the room` : 'Connected · waiting for others',
    failed: 'Connection failed',
  }[connection]

  return (
    <>
      {anyVideo && (
        <VoiceStage
          peers={peers}
          selfPeerId={selfPeerId}
          memberById={memberById}
          remoteStreams={remoteStreams}
          localVideoStream={localVideoStream}
          screenShareStream={screenShareStream}
          speaking={speaking}
          focused={focused}
          onFocus={setFocused}
        />
      )}

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

// ── The stage ──────────────────────────────────────────────────────────────

function VoiceStage({
  peers, selfPeerId, memberById, remoteStreams, localVideoStream, screenShareStream,
  speaking, focused, onFocus,
}: {
  peers: VoicePeer[]
  selfPeerId: string
  memberById: Map<string, CommunityMember>
  remoteStreams: Record<string, MediaStream>
  localVideoStream: MediaStream | null
  screenShareStream: MediaStream | null
  speaking: Record<string, boolean>
  focused: string | null
  onFocus: (peerId: string | null) => void
}) {
  // Someone sharing a screen is almost always the thing everyone came to look
  // at, so it takes the stage unless a person has chosen otherwise.
  const sharer = peers.find(p => p.sharing)
  const active = focused ?? sharer?.peerId ?? null

  const tiles = peers.map(peer => ({
    peer,
    stream: peer.peerId === selfPeerId
      ? (peer.sharing ? screenShareStream : localVideoStream)
      : remoteStreams[peer.peerId] ?? null,
    isSelf: peer.peerId === selfPeerId,
  }))

  const focusTile = active ? tiles.find(t => t.peer.peerId === active) : null

  return (
    <div className="px-4 pb-3" style={{ borderTop: '1px solid var(--cm-line)' }}>
      <div className="flex items-center justify-between py-2">
        <p className="text-xs font-medium" style={{ color: 'var(--cm-dim)' }}>
          {sharer
            ? `${memberById.get(sharer.memberId)?.handle ?? 'Someone'} is sharing a screen`
            : 'Video'}
        </p>
        <button
          onClick={() => onFocus(active ? null : tiles[0]?.peer.peerId ?? null)}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-[var(--cm-hover)]"
          style={{ color: 'var(--cm-dim)' }}
        >
          {active ? <><Grid2x2 className="h-3.5 w-3.5" /> Grid</> : <><Maximize2 className="h-3.5 w-3.5" /> Focus</>}
        </button>
      </div>

      {focusTile ? (
        <div className="flex flex-col gap-2">
          <Tile {...focusTile} speaking={speaking} memberById={memberById} large />
          <div className="flex gap-2 overflow-x-auto">
            {tiles.filter(t => t.peer.peerId !== active).map(tile => (
              <button key={tile.peer.peerId} onClick={() => onFocus(tile.peer.peerId)} className="shrink-0">
                <Tile {...tile} speaking={speaking} memberById={memberById} small />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          {tiles.map(tile => (
            <button key={tile.peer.peerId} onClick={() => onFocus(tile.peer.peerId)}>
              <Tile {...tile} speaking={speaking} memberById={memberById} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Tile({
  peer, stream, isSelf, speaking, memberById, large, small,
}: {
  peer: VoicePeer
  stream: MediaStream | null
  isSelf: boolean
  speaking: Record<string, boolean>
  memberById: Map<string, CommunityMember>
  large?: boolean
  small?: boolean
}) {
  const video = useRef<HTMLVideoElement>(null)
  const member = memberById.get(peer.memberId)
  const isSpeaking = speaking[isSelf ? 'self' : peer.peerId]

  useEffect(() => {
    if (video.current && stream) video.current.srcObject = stream
  }, [stream])

  const height = large ? 340 : small ? 72 : 150

  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl ${isSpeaking ? 'cm-speaking' : ''}`}
      style={{
        height,
        background: 'var(--cm-void)',
        border: `1px solid ${isSpeaking ? 'var(--cm-accent)' : 'var(--cm-line)'}`,
      }}
    >
      {stream && (peer.camera || peer.sharing) ? (
        <video
          ref={video}
          autoPlay
          playsInline
          // Never play your own audio back: that is feedback, and it is loud.
          muted={isSelf}
          className="h-full w-full"
          style={{ objectFit: peer.sharing ? 'contain' : 'cover' }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Avatar seed={member?.avatarSeed ?? peer.memberId} size={small ? 28 : 56} />
        </div>
      )}

      {!small && (
        <p className="absolute bottom-1.5 left-2 flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]"
           style={{ background: 'rgb(0 0 0 / .55)', color: '#fff' }}>
          {peer.muted && <MicOff className="h-3 w-3" />}
          {member?.handle ?? 'Member'}{isSelf ? ' (you)' : ''}
        </p>
      )}
    </div>
  )
}
