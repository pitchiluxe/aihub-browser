import React, { useEffect, useRef, useState } from 'react'
import { MicOff, MonitorUp, Grid2x2, Maximize2 } from 'lucide-react'
import { Avatar } from './bits'
import type { CommunityMember } from './useCommunity'
import type { VoicePeer } from './useVoiceSession'

/**
 * The stage: whatever everyone came to look at.
 *
 * This used to live inside VoiceDock, rendered into the bottom dock at a fixed
 * 340px. That meant a shared screen arrived *smaller than the chat it was
 * interrupting* — a desktop letterboxed into a strip under the composer, which
 * is the one shape a screen share must never take.
 *
 * Discord's arrangement is the right one and this copies its logic rather than
 * its pixels: the thing being watched takes every pixel of height going, and
 * the rest of the room runs along the bottom in a filmstrip that never competes
 * with it. Nothing here is sized in pixels except the filmstrip's own band. The
 * focus tile is `flex-1 min-h-0` inside a column, so it grows to the window and
 * shrinks rather than shoving the filmstrip off the bottom edge.
 */

export interface VoiceStageProps {
  peers: VoicePeer[]
  selfPeerId: string
  memberById: Map<string, CommunityMember>
  remoteStreams: Record<string, MediaStream>
  localVideoStream: MediaStream | null
  screenShareStream: MediaStream | null
  speaking: Record<string, boolean>
}

/**
 * Is there anything worth showing?
 *
 * No camera and no share means no stage. A grid of five motionless avatars is
 * exactly the member list one column over, and putting it where the
 * conversation was costs the user the conversation for nothing.
 */
export function stageIsLive(peers: VoicePeer[]): boolean {
  return peers.some(p => p.camera || p.sharing)
}

/**
 * Which tile belongs in the big slot.
 *
 * An explicit click wins, but only while that peer is still in the room —
 * otherwise someone leaving strands the stage on a tile that no longer exists.
 * After that a screen share beats a camera, because a share is a deliberate
 * "look at this" and a camera is just a face. Ties go to roster order, which is
 * join order, so the stage does not flip between two sharers every time the
 * room re-announces itself.
 */
export function pickFocus(peers: VoicePeer[], chosen: string | null): string | null {
  if (chosen && peers.some(p => p.peerId === chosen)) return chosen
  return peers.find(p => p.sharing)?.peerId
    ?? peers.find(p => p.camera)?.peerId
    ?? peers[0]?.peerId
    ?? null
}

export default function VoiceStage(props: VoiceStageProps) {
  const {
    peers, selfPeerId, memberById, remoteStreams,
    localVideoStream, screenShareStream, speaking,
  } = props

  const [chosen, setChosen] = useState<string | null>(null)
  const [grid, setGrid] = useState(false)

  const focusId = pickFocus(peers, chosen)

  const streamFor = (peer: VoicePeer): MediaStream | null => {
    if (peer.peerId !== selfPeerId) return remoteStreams[peer.peerId] ?? null
    // Your own camera and your own screen are two separate MediaStreams. When
    // both are running the share is the one that matters — it is what the room
    // is looking at, and your face is already in the filmstrip.
    return peer.sharing ? screenShareStream : localVideoStream
  }

  const tiles = peers.map(peer => ({
    peer,
    stream: streamFor(peer),
    isSelf: peer.peerId === selfPeerId,
    isSpeaking: !!speaking[peer.peerId === selfPeerId ? 'self' : peer.peerId],
  }))

  const focus = tiles.find(t => t.peer.peerId === focusId) ?? null
  const strip = tiles.filter(t => t.peer.peerId !== focusId)
  const sharer = peers.find(p => p.sharing)

  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-2 p-3"
      style={{ background: 'var(--cm-void)' }}
      aria-label="Video stage"
    >
      <header className="flex shrink-0 items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--cm-dim)' }}>
          {sharer && <MonitorUp className="h-3.5 w-3.5" style={{ color: 'var(--cm-accent)' }} />}
          {sharer
            ? `${memberById.get(sharer.memberId)?.handle ?? 'Someone'} is sharing a screen`
            : 'Video'}
        </p>
        <button
          onClick={() => setGrid(g => !g)}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-[var(--cm-hover)]"
          style={{ color: 'var(--cm-dim)' }}
          aria-pressed={grid}
          title={grid ? 'Focus one person' : 'Show everyone at the same size'}
        >
          {grid
            ? <><Maximize2 className="h-3.5 w-3.5" /> Focus</>
            : <><Grid2x2 className="h-3.5 w-3.5" /> Grid</>}
        </button>
      </header>

      {grid ? (
        <div
          className="grid min-h-0 flex-1 auto-rows-fr gap-2 overflow-y-auto"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
        >
          {tiles.map(tile => (
            <Tile
              key={tile.peer.peerId}
              {...tile}
              memberById={memberById}
              onClick={() => { setChosen(tile.peer.peerId); setGrid(false) }}
            />
          ))}
        </div>
      ) : (
        <>
          {/* The whole point of this file: min-h-0 + flex-1 means the shared
              screen takes every pixel the window can spare. */}
          <div className="min-h-0 flex-1">
            {focus && <Tile {...focus} memberById={memberById} focus />}
          </div>

          {strip.length > 0 && (
            <ul
              className="flex shrink-0 gap-2 overflow-x-auto pb-0.5"
              style={{ height: 108 }}
              aria-label="Everyone else in the room"
            >
              {strip.map(tile => (
                <li key={tile.peer.peerId} className="h-full shrink-0" style={{ width: 176 }}>
                  <Tile {...tile} memberById={memberById} onClick={() => setChosen(tile.peer.peerId)} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

function Tile({
  peer, stream, isSelf, isSpeaking, memberById, focus, onClick,
}: {
  peer: VoicePeer
  stream: MediaStream | null
  isSelf: boolean
  isSpeaking: boolean
  memberById: Map<string, CommunityMember>
  focus?: boolean
  onClick?: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const member = memberById.get(peer.memberId)
  const live = !!stream && (peer.camera || peer.sharing)

  useEffect(() => {
    if (video.current && stream) video.current.srcObject = stream
  }, [stream])

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? e => { if (e.key === 'Enter' || e.key === ' ') onClick() } : undefined}
      title={onClick ? `Focus ${member?.handle ?? 'this person'}` : undefined}
      className={`relative h-full w-full overflow-hidden rounded-xl ${isSpeaking ? 'cm-speaking' : ''} ${onClick ? 'cursor-pointer' : ''}`}
      style={{
        // Black rather than --cm-void: letterbox bars around a shared screen
        // should read as the edge of the screen, not as a panel behind it.
        background: '#000',
        border: `1px solid ${isSpeaking ? 'var(--cm-accent)' : 'var(--cm-line)'}`,
      }}
    >
      {live ? (
        <video
          ref={video}
          autoPlay
          playsInline
          // Never play your own audio back: that is feedback, and it is loud.
          muted={isSelf}
          className="h-full w-full"
          // A shared screen must never be cropped — `contain` keeps the whole
          // desktop visible, letterboxed. A face may be cropped, so `cover`
          // fills the tile and a row of cameras reads as one clean strip.
          style={{ objectFit: peer.sharing ? 'contain' : 'cover' }}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center"
          style={{ background: 'var(--cm-void)' }}
        >
          <Avatar seed={member?.avatarSeed ?? peer.memberId} size={focus ? 96 : 40} />
        </div>
      )}

      <p
        className="absolute bottom-1.5 left-2 flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]"
        style={{ background: 'rgb(0 0 0 / .55)', color: '#fff' }}
      >
        {peer.muted && <MicOff className="h-3 w-3" />}
        {member?.handle ?? 'Member'}{isSelf ? ' (you)' : ''}
      </p>
    </div>
  )
}
