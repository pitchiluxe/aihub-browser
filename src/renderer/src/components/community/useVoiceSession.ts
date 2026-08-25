import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Voice, video and screen share — a real peer connection mesh.
 *
 * There is no media server and no fake. Each participant holds one
 * RTCPeerConnection per other participant, with genuine audio and video tracks
 * flowing over it. The only thing the main process does is carry offers,
 * answers and ICE candidates between windows, which is all WebRTC ever asked of
 * a signaling channel.
 *
 * Two limits, both stated in the UI rather than hidden:
 *
 *  - No STUN or TURN server is configured, so this reaches loopback and usually
 *    a LAN, and not across NATs. `iceServers` below is where that changes.
 *  - The relay only knows about windows of this process, so the people it can
 *    connect are the people at this machine.
 *
 * A mesh is right at this size and wrong past about six participants, where the
 * upload cost of sending your own video to everyone separately starts to hurt.
 * That is the point at which an SFU becomes the answer, not before.
 */

export interface VoicePeer {
  peerId: string
  memberId: string
  channel: string
  muted: boolean
  deafened: boolean
  camera: boolean
  sharing: boolean
}

export type VoiceError =
  | { kind: 'mic'; message: string }
  | { kind: 'camera'; message: string }
  | { kind: 'screen'; message: string }
  | { kind: 'connect'; message: string }

/** Empty by design. Host candidates only: loopback and, usually, the LAN. */
const ICE_SERVERS: RTCIceServer[] = []

export function useVoiceSession() {
  const api = (window as any).electronAPI?.community

  const [channel, setChannel] = useState<string | null>(null)
  const [peerId, setPeerId] = useState<string>('')
  const [peers, setPeers] = useState<VoicePeer[]>([])
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({})
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({})
  const [muted, setMuted] = useState(false)
  const [deafened, setDeafened] = useState(false)
  const [camera, setCamera] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [connection, setConnection] = useState<'idle' | 'connecting' | 'live' | 'failed'>('idle')
  const [error, setError] = useState<VoiceError | null>(null)

  const connections = useRef(new Map<string, RTCPeerConnection>())
  /** Perfect-negotiation bookkeeping, one entry per peer. */
  const negotiation = useRef(new Map<string, { polite: boolean; makingOffer: boolean; ignoreOffer: boolean }>())
  const localAudio = useRef<MediaStream | null>(null)
  const localVideo = useRef<MediaStream | null>(null)
  const screenStream = useRef<MediaStream | null>(null)
  const audioContext = useRef<AudioContext | null>(null)
  const analysers = useRef(new Map<string, AnalyserNode>())
  const channelRef = useRef<string | null>(null)
  channelRef.current = channel

  // ── Microphone ───────────────────────────────────────────────────────────

  const ensureMicrophone = useCallback(async (): Promise<MediaStream | null> => {
    if (localAudio.current) return localAudio.current
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Left on: these are the difference between a call and a room full of
        // laptop fans, and nothing here is doing audio production.
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      localAudio.current = stream
      return stream
    } catch (err: any) {
      setError({
        kind: 'mic',
        message: err?.name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow it in your system settings, then rejoin.'
          : 'No microphone was found.',
      })
      return null
    }
  }, [])

  // ── Speaking detection ───────────────────────────────────────────────────

  const watchLevels = useCallback((key: string, stream: MediaStream) => {
    if (!stream.getAudioTracks().length) return
    audioContext.current ??= new AudioContext()
    const context = audioContext.current
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    // Smoothing so the ring tracks speech rather than flickering on plosives.
    analyser.smoothingTimeConstant = 0.75
    context.createMediaStreamSource(stream).connect(analyser)
    analysers.current.set(key, analyser)
  }, [])

  useEffect(() => {
    if (!channel) return
    let frame = 0
    const buffer = new Uint8Array(256)

    const tick = () => {
      const next: Record<string, boolean> = {}
      for (const [key, analyser] of analysers.current) {
        analyser.getByteTimeDomainData(buffer)
        let sum = 0
        for (const sample of buffer) {
          const centred = (sample - 128) / 128
          sum += centred * centred
        }
        next[key] = Math.sqrt(sum / buffer.length) > 0.045
      }
      setSpeaking(prev => {
        // Only re-render when the answer actually changed; this runs 60 times
        // a second and a chat window has better things to do.
        const changed = Object.keys(next).some(k => next[k] !== prev[k])
          || Object.keys(prev).length !== Object.keys(next).length
        return changed ? next : prev
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [channel])

  // ── Peer connections ─────────────────────────────────────────────────────

  const peerConnection = useCallback((otherId: string, polite: boolean): RTCPeerConnection => {
    const existing = connections.current.get(otherId)
    if (existing) return existing

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    connections.current.set(otherId, pc)
    negotiation.current.set(otherId, { polite, makingOffer: false, ignoreOffer: false })

    for (const track of localAudio.current?.getTracks() ?? []) {
      pc.addTrack(track, localAudio.current!)
    }

    pc.onicecandidate = event => {
      if (event.candidate) void api?.voiceSignal(otherId, { type: 'ice', candidate: event.candidate })
    }

    pc.ontrack = event => {
      const [stream] = event.streams
      if (!stream) return
      setRemoteStreams(prev => ({ ...prev, [otherId]: stream }))
      watchLevels(otherId, stream)
    }

    pc.onnegotiationneeded = async () => {
      const state = negotiation.current.get(otherId)!
      try {
        state.makingOffer = true
        await pc.setLocalDescription()
        void api?.voiceSignal(otherId, { type: 'description', description: pc.localDescription })
      } catch {
        // A failed renegotiation leaves the existing tracks running; the call
        // does not need to end because a camera could not be added.
      } finally {
        state.makingOffer = false
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        setConnection('failed')
        setError({
          kind: 'connect',
          message: 'The connection failed. Without a STUN or TURN server this only reaches your own network.',
        })
      } else if (pc.connectionState === 'connected') {
        setConnection('live')
      }
    }

    return pc
  }, [api, watchLevels])

  const closePeer = useCallback((otherId: string) => {
    connections.current.get(otherId)?.close()
    connections.current.delete(otherId)
    negotiation.current.delete(otherId)
    analysers.current.delete(otherId)
    setRemoteStreams(prev => {
      const next = { ...prev }
      delete next[otherId]
      return next
    })
  }, [])

  // ── Signaling ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!api?.onVoiceSignal) return
    return api.onVoiceSignal(async ({ from, payload }: { from: string; payload: any }) => {
      if (!channelRef.current) return

      if (payload?.type === 'bye') { closePeer(from); return }

      // Anyone already here when a signal arrives is polite: the peer that
      // arrived is the one that offers, so we are the one that yields.
      const pc = peerConnection(from, true)
      const state = negotiation.current.get(from)!

      try {
        if (payload?.type === 'description') {
          const description = payload.description
          const offerCollision = description.type === 'offer'
            && (state.makingOffer || pc.signalingState !== 'stable')

          // Perfect negotiation: exactly one side backs down, so two peers
          // that offer at the same moment recover instead of deadlocking.
          state.ignoreOffer = !state.polite && offerCollision
          if (state.ignoreOffer) return

          await pc.setRemoteDescription(description)
          if (description.type === 'offer') {
            await pc.setLocalDescription()
            void api.voiceSignal(from, { type: 'description', description: pc.localDescription })
          }
        } else if (payload?.type === 'ice') {
          try { await pc.addIceCandidate(payload.candidate) }
          catch { if (!state.ignoreOffer) throw new Error('ice') }
        }
      } catch {
        setError({ kind: 'connect', message: 'A connection could not be negotiated.' })
      }
    })
  }, [api, peerConnection, closePeer])

  useEffect(() => {
    if (!api?.onVoicePeers) return
    return api.onVoicePeers(({ channel: room, peers: roster }: { channel: string; peers: VoicePeer[] }) => {
      if (room !== channelRef.current) return
      setPeers(roster)

      // Somebody left without a goodbye: their peer connection is dead weight
      // holding a frozen last frame.
      const present = new Set(roster.map(p => p.peerId))
      for (const id of [...connections.current.keys()]) {
        if (!present.has(id)) closePeer(id)
      }
    })
  }, [api, closePeer])

  // ── Join and leave ───────────────────────────────────────────────────────

  const join = useCallback(async (slug: string) => {
    setError(null)
    setConnection('connecting')

    const microphone = await ensureMicrophone()
    if (!microphone) { setConnection('idle'); return false }

    const result = await api?.voiceJoin(slug)
    if (!result?.ok) {
      setError({ kind: 'connect', message: result?.error ?? 'Could not join that channel.' })
      setConnection('idle')
      return false
    }

    setChannel(slug)
    channelRef.current = slug
    setPeerId(result.peerId)
    watchLevels('self', microphone)

    // The arriving peer offers to everyone already here. If both sides offered
    // on sight, every pair would negotiate twice and glare.
    for (const other of result.peers as VoicePeer[]) {
      const pc = peerConnection(other.peerId, false)
      try {
        await pc.setLocalDescription()
        void api.voiceSignal(other.peerId, { type: 'description', description: pc.localDescription })
      } catch {
        setError({ kind: 'connect', message: 'Could not reach one of the participants.' })
      }
    }
    if (!result.peers.length) setConnection('live')
    return true
  }, [api, ensureMicrophone, peerConnection, watchLevels])

  const leave = useCallback(async () => {
    for (const id of [...connections.current.keys()]) closePeer(id)
    for (const stream of [localAudio.current, localVideo.current, screenStream.current]) {
      stream?.getTracks().forEach(track => track.stop())
    }
    localAudio.current = null
    localVideo.current = null
    screenStream.current = null
    analysers.current.clear()
    try { await audioContext.current?.close() } catch { /* already closed */ }
    audioContext.current = null

    await api?.voiceLeave()
    setChannel(null)
    channelRef.current = null
    setPeers([])
    setRemoteStreams({})
    setSpeaking({})
    setCamera(false)
    setSharing(false)
    setConnection('idle')
  }, [api, closePeer])

  // Leaving the app is leaving the call. Without this the room keeps a seat
  // for a window that no longer exists.
  useEffect(() => () => { void leave() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Controls ─────────────────────────────────────────────────────────────

  const toggleMute = useCallback(() => {
    const next = !muted
    for (const track of localAudio.current?.getAudioTracks() ?? []) track.enabled = !next
    setMuted(next)
    void api?.voiceState({ muted: next })
  }, [api, muted])

  const toggleDeafen = useCallback(() => {
    const next = !deafened
    setDeafened(next)
    // Deafening also mutes: it means "I have stepped away", and a live mic
    // pointed at a room you are not listening to is how people get overheard.
    if (next && !muted) {
      for (const track of localAudio.current?.getAudioTracks() ?? []) track.enabled = false
      setMuted(true)
    }
    void api?.voiceState({ deafened: next, muted: next ? true : muted })
  }, [api, deafened, muted])

  const toggleCamera = useCallback(async () => {
    if (camera) {
      for (const track of localVideo.current?.getTracks() ?? []) {
        track.stop()
        for (const pc of connections.current.values()) {
          const sender = pc.getSenders().find(s => s.track === track)
          if (sender) pc.removeTrack(sender)
        }
      }
      localVideo.current = null
      setCamera(false)
      void api?.voiceState({ camera: false })
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      localVideo.current = stream
      for (const pc of connections.current.values()) {
        for (const track of stream.getVideoTracks()) pc.addTrack(track, stream)
      }
      setCamera(true)
      void api?.voiceState({ camera: true })
    } catch (err: any) {
      setError({
        kind: 'camera',
        message: err?.name === 'NotAllowedError'
          ? 'Camera access was denied. Allow it in your system settings, then try again.'
          : 'No camera was found.',
      })
    }
  }, [api, camera])

  /**
   * Share a screen or window.
   *
   * `sourceId` comes from the app's own picker, because Electron has no native
   * one — Chrome's picker belongs to Chrome. The main process holds the choice
   * for exactly this request and denies anything it did not see chosen, so this
   * cannot start sharing a desktop nobody selected.
   */
  const startScreenShare = useCallback(async (sourceId: string) => {
    setError(null)
    try {
      await api?.screenShareChoice(sourceId)
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      screenStream.current = stream

      for (const pc of connections.current.values()) {
        for (const track of stream.getVideoTracks()) pc.addTrack(track, stream)
      }
      // Stopping from the OS bar is the normal way people end a share.
      stream.getVideoTracks()[0]?.addEventListener('ended', () => void stopScreenShare())
      setSharing(true)
      void api?.voiceState({ sharing: true })
    } catch (err: any) {
      setError({
        kind: 'screen',
        message: err?.name === 'NotAllowedError'
          ? 'Screen sharing was denied.'
          : 'That screen could not be shared.',
      })
    }
  }, [api])

  const stopScreenShare = useCallback(async () => {
    for (const track of screenStream.current?.getTracks() ?? []) {
      track.stop()
      for (const pc of connections.current.values()) {
        const sender = pc.getSenders().find(s => s.track === track)
        if (sender) pc.removeTrack(sender)
      }
    }
    screenStream.current = null
    setSharing(false)
    void api?.voiceState({ sharing: false })
  }, [api])

  return {
    channel, peerId, peers, remoteStreams, speaking, connection, error, setError,
    muted, deafened, camera, sharing,
    localVideoStream: localVideo.current,
    screenShareStream: screenStream.current,
    join, leave, toggleMute, toggleDeafen, toggleCamera, startScreenShare, stopScreenShare,
  }
}
