import { useCallback, useState } from 'react'
import { useVoiceSession, type VoicePeer, type VoiceError } from './useVoiceSession'
import { useLiveKitVoice } from './useLiveKitVoice'

/**
 * One voice API, two transports underneath.
 *
 * LiveKit when a project is configured; the direct peer mesh when it is not, so
 * a community with no backend at all still has working voice between windows of
 * this app. Which one is in use is decided once, at join time, by asking the
 * main process for a token — if it hands one back there is an SFU to talk to.
 *
 * ── Why both hooks are always called ──────────────────────────────────────
 *
 * Hooks cannot be called conditionally: React identifies them by call order, so
 * a `mode === 'livekit' ? useA() : useB()` would corrupt every hook after it the
 * first time the mode changed. Both run on every render and the idle one holds
 * no connection, costs nothing, and is simply not returned.
 *
 * Both expose the identical shape, so VoiceStage and VoiceDock never learn which
 * is behind them. That is the whole point — the transport swap does not fork
 * the UI.
 */

export type { VoicePeer, VoiceError }

export type VoiceTransport = 'none' | 'livekit' | 'mesh'

export function useVoice() {
  const api = (window as any).electronAPI?.community

  const mesh = useVoiceSession()
  const livekit = useLiveKitVoice()
  const [transport, setTransport] = useState<VoiceTransport>('none')

  const active = transport === 'livekit' ? livekit : mesh

  const join = useCallback(async (channelSlug: string) => {
    // Never in two rooms at once, and never in the same room over two
    // transports — leaving both is cheap and an already-idle one is a no-op.
    await livekit.leave()
    await mesh.leave()

    const grant = await api?.voiceToken?.(channelSlug)

    if (grant?.ok === false) {
      setTransport('none')
      mesh.setError({ kind: 'connect', message: grant.error })
      return { ok: false, error: grant.error }
    }

    if (grant?.livekit) {
      setTransport('livekit')
      const result = await livekit.join(channelSlug, grant.livekit)
      // A LiveKit room that refuses the connection is a real failure and says
      // so, rather than silently dropping to a mesh that cannot reach the
      // people the user is trying to talk to.
      return result
    }

    // No LiveKit project configured. The mesh reaches the windows of this app,
    // which is honest and is what the dock's status line reports.
    setTransport('mesh')
    return mesh.join(channelSlug)
  }, [api, livekit, mesh])

  const leave = useCallback(async () => {
    await active.leave()
    setTransport('none')
  }, [active])

  return { ...active, transport, join, leave }
}
