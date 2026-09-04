import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Room, RoomEvent, Track, ConnectionState,
  type Participant, type RemoteTrack, type TrackPublication,
} from 'livekit-client'
import type { VoicePeer, VoiceError } from './useVoiceSession'

/**
 * Voice, video and screen share over a LiveKit SFU.
 *
 * ── Why this exists next to the mesh ──────────────────────────────────────
 *
 * The peer mesh in useVoiceSession is real WebRTC and works, between windows of
 * one process and across a LAN. It does not survive a NAT without a TURN server
 * and it does not scale: five people is twenty peer connections and five
 * separate uploads of your own camera. An SFU takes one uplink and fans it out,
 * and terminates the media itself, so traversal stops being this app's problem.
 *
 * This hook deliberately returns the **same shape** as the mesh hook. VoiceStage
 * and VoiceDock cannot tell which one is behind them, so switching transports is
 * a decision made once at join time rather than a fork through the UI.
 *
 * ── One stream per participant, screen wins ───────────────────────────────
 *
 * LiveKit publishes camera and screen share as separate tracks, so a
 * participant can have both. The stage shows one tile per person, and the rule
 * that matters is the same one the stage already applies: a screen share is a
 * deliberate "look at this" and beats a camera. `activeVideoTrack` encodes it
 * once, here, so the tile and the focus logic cannot disagree.
 */

export interface LiveKitGrant {
  token: string
  url: string
  room: string
  identity: string
}

/** Screen share if there is one, otherwise the camera. */
function activeVideoPublication(participant: Participant): TrackPublication | undefined {
  const publications = [...participant.videoTrackPublications.values()]
  return publications.find(p => p.source === Track.Source.ScreenShare && p.track)
    ?? publications.find(p => p.source === Track.Source.Camera && p.track)
}

function hasSource(participant: Participant, source: Track.Source): boolean {
  return [...participant.videoTrackPublications.values()]
    .some(p => p.source === source && p.track && !p.isMuted)
}

export function useLiveKitVoice() {
  const [channel, setChannel] = useState<string | null>(null)
  const [peers, setPeers] = useState<VoicePeer[]>([])
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({})
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({})
  const [connection, setConnection] = useState<'idle' | 'connecting' | 'live' | 'failed'>('idle')
  const [error, setError] = useState<VoiceError | null>(null)
  const [muted, setMuted] = useState(false)
  const [deafened, setDeafened] = useState(false)
  const [camera, setCamera] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [localVideoStream, setLocalVideoStream] = useState<MediaStream | null>(null)
  const [screenShareStream, setScreenShareStream] = useState<MediaStream | null>(null)

  const room = useRef<Room | null>(null)
  const slug = useRef<string>('')
  /** Hidden <audio> elements, one per remote audio track. LiveKit does not
   *  play audio for you; without these the room is silent. */
  const audio = useRef<Map<string, HTMLAudioElement>>(new Map())

  // ── Deriving the roster ──────────────────────────────────────────────────

  const resync = useCallback(() => {
    const current = room.current
    if (!current) return

    const everyone: Participant[] = [current.localParticipant, ...current.remoteParticipants.values()]

    setPeers(everyone.map(p => ({
      // LiveKit's identity IS the community member id — see livekit.ts, which
      // mints the token with it. So peerId and memberId coincide here, where in
      // the mesh a peer is a window and several can share a member.
      peerId: p.identity,
      memberId: p.identity,
      channel: slug.current,
      muted: !p.isMicrophoneEnabled,
      deafened: false,
      camera: hasSource(p, Track.Source.Camera),
      sharing: hasSource(p, Track.Source.ScreenShare),
    })))

    const streams: Record<string, MediaStream> = {}
    for (const participant of everyone) {
      const publication = activeVideoPublication(participant)
      const track = publication?.track?.mediaStreamTrack
      if (track) streams[participant.identity] = new MediaStream([track])
    }
    setRemoteStreams(streams)

    const local = current.localParticipant
    setCamera(hasSource(local, Track.Source.Camera))
    setSharing(hasSource(local, Track.Source.ScreenShare))
    setMuted(!local.isMicrophoneEnabled)
  }, [])

  // ── Joining ──────────────────────────────────────────────────────────────

  const join = useCallback(async (channelSlug: string, grant: LiveKitGrant) => {
    setError(null)
    setConnection('connecting')
    slug.current = channelSlug

    // Encoding settings copied from the working QuickBooks breakroom: simulcast
    // so a small tile does not pull a 1080p stream, and a lower frame rate but
    // much higher bitrate for screen share, because shared screens are mostly
    // still text and text needs bits far more than it needs frames.
    const next = new Room({
      adaptiveStream: true,
      dynacast: true,
      publishDefaults: {
        simulcast: true,
        videoCodec: 'vp9',
        videoEncoding: { maxBitrate: 1_200_000, maxFramerate: 30 },
        screenShareEncoding: { maxBitrate: 3_000_000, maxFramerate: 15 },
      },
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000,
        channelCount: 1,
      },
    })

    next
      .on(RoomEvent.ParticipantConnected, resync)
      .on(RoomEvent.ParticipantDisconnected, resync)
      .on(RoomEvent.TrackPublished, resync)
      .on(RoomEvent.TrackUnpublished, resync)
      .on(RoomEvent.TrackMuted, resync)
      .on(RoomEvent.TrackUnmuted, resync)
      .on(RoomEvent.LocalTrackPublished, resync)
      .on(RoomEvent.LocalTrackUnpublished, resync)
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant) => {
        if (track.kind === Track.Kind.Audio) {
          const element = track.attach() as HTMLAudioElement
          element.style.display = 'none'
          document.body.appendChild(element)
          audio.current.set(participant.identity, element)
        }
        resync()
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, participant) => {
        if (track.kind === Track.Kind.Audio) {
          track.detach().forEach(el => el.remove())
          audio.current.delete(participant.identity)
        }
        resync()
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        const loud = new Set(speakers.map(s => s.identity))
        const local = next.localParticipant.identity
        const map: Record<string, boolean> = {}
        for (const id of loud) map[id === local ? 'self' : id] = true
        setSpeaking(map)
      })
      .on(RoomEvent.Disconnected, () => {
        setConnection('idle')
        setChannel(null)
      })
      .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        if (state === ConnectionState.Connected) setConnection('live')
        else if (state === ConnectionState.Reconnecting) setConnection('connecting')
      })

    try {
      await next.connect(grant.url, grant.token)
      room.current = next
      setChannel(channelSlug)
      setConnection('live')

      // The microphone is the one track always published on join: a voice room
      // you enter silent is a voice room people think is broken.
      try {
        await next.localParticipant.setMicrophoneEnabled(true)
      } catch {
        setError({ kind: 'mic', message: 'Your microphone could not be opened. You are connected, but muted.' })
      }
      resync()
      return { ok: true as const }
    } catch (failure: any) {
      setConnection('failed')
      setChannel(null)
      const message = String(failure?.message ?? failure)
      setError({
        kind: 'connect',
        message: /token|jwt|unauthor/i.test(message)
          ? 'The LiveKit server rejected this token. Check the API key and secret in Community settings.'
          : `Could not reach the voice server: ${message}`,
      })
      try { await next.disconnect() } catch { /* never connected */ }
      return { ok: false as const, error: message }
    }
  }, [resync])

  const leave = useCallback(async () => {
    for (const element of audio.current.values()) element.remove()
    audio.current.clear()
    try { await room.current?.disconnect() } catch { /* already gone */ }
    room.current = null
    slug.current = ''
    setChannel(null)
    setPeers([])
    setRemoteStreams({})
    setSpeaking({})
    setLocalVideoStream(null)
    setScreenShareStream(null)
    setCamera(false)
    setSharing(false)
    setConnection('idle')
  }, [])

  // A window closing mid-call must take its participant with it, or everyone
  // else keeps a tile for someone who is not there.
  useEffect(() => () => { void room.current?.disconnect() }, [])

  // ── Controls ─────────────────────────────────────────────────────────────

  const toggleMute = useCallback(async () => {
    const local = room.current?.localParticipant
    if (!local) return
    const next = !muted
    setMuted(next)
    try { await local.setMicrophoneEnabled(!next) } catch { setMuted(!next) }
  }, [muted])

  /**
   * Deafen: stop hearing the room, and stop it hearing you.
   *
   * Muting only the speakers would let you keep talking into a conversation you
   * cannot hear, which is worse than either half alone.
   */
  const toggleDeafen = useCallback(async () => {
    const next = !deafened
    setDeafened(next)
    for (const element of audio.current.values()) element.muted = next
    const local = room.current?.localParticipant
    if (!local) return
    if (next) { setMuted(true); try { await local.setMicrophoneEnabled(false) } catch { /* ignore */ } }
  }, [deafened])

  const toggleCamera = useCallback(async () => {
    const local = room.current?.localParticipant
    if (!local) return
    const next = !camera
    try {
      await local.setCameraEnabled(next)
      const track = [...local.videoTrackPublications.values()]
        .find(p => p.source === Track.Source.Camera)?.track?.mediaStreamTrack
      setLocalVideoStream(next && track ? new MediaStream([track]) : null)
      setCamera(next)
      resync()
    } catch (failure: any) {
      setError({
        kind: 'camera',
        message: failure?.name === 'NotAllowedError'
          ? 'Camera access was denied. Allow it in your system settings, then try again.'
          : 'No camera was found.',
      })
    }
  }, [camera, resync])

  /**
   * Share a screen.
   *
   * LiveKit calls `getDisplayMedia` itself, and in Electron that is answered by
   * the app's own picker through the display-media handler in the main process —
   * so the source id chosen there still governs what may be captured. Passing
   * `audio: true` matches the QuickBooks breakroom and picks up system audio
   * where the platform allows it.
   */
  const startScreenShare = useCallback(async (sourceId: string) => {
    const local = room.current?.localParticipant
    if (!local) return
    setError(null)
    try {
      await (window as any).electronAPI?.community?.screenShareChoice?.(sourceId)
      await local.setScreenShareEnabled(true, {
        audio: true,
        resolution: { width: 1920, height: 1080, frameRate: 15 },
      })
      const track = [...local.videoTrackPublications.values()]
        .find(p => p.source === Track.Source.ScreenShare)?.track
      const media = track?.mediaStreamTrack
      setScreenShareStream(media ? new MediaStream([media]) : null)
      // Stopping from the operating system's own bar is how most people end a
      // share; without this the app would keep claiming to be sharing.
      media?.addEventListener('ended', () => void stopScreenShare())
      setSharing(true)
      resync()
    } catch (failure: any) {
      setError({
        kind: 'screen',
        message: failure?.name === 'NotAllowedError'
          ? 'Screen sharing was denied.'
          : 'That screen could not be shared.',
      })
    }
    // stopScreenShare is stable; referencing it here would only churn the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resync])

  const stopScreenShare = useCallback(async () => {
    const local = room.current?.localParticipant
    if (!local) return
    try { await local.setScreenShareEnabled(false) } catch { /* already stopped */ }
    setScreenShareStream(null)
    setSharing(false)
    resync()
  }, [resync])

  return {
    channel,
    // The stage keys "is this me" off peerId, and for LiveKit that is identity.
    peerId: room.current?.localParticipant.identity ?? '',
    peers, remoteStreams, speaking, connection, error, setError,
    muted, deafened, camera, sharing,
    localVideoStream, screenShareStream,
    join, leave, toggleMute, toggleDeafen, toggleCamera, startScreenShare, stopScreenShare,
  }
}

export type LiveKitVoice = ReturnType<typeof useLiveKitVoice>
