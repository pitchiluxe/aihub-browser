import { useEffect, useState } from 'react'
import { Square } from 'lucide-react'
import { penSession } from '../../../services/screenPen/penSession'
import { usePenSession } from './usePenSession'

const formatElapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/**
 * The screen recording's clock and stop control, in the nav bar.
 *
 * A screen recording is not tied to the pen: it keeps rolling with the pen
 * closed, on any tab or app page, or with the browser in the background. So its
 * stop control cannot live only on the pen's toolbar — a recorder with no
 * visible way to stop it is one people leave running. The nav bar is host
 * HTML above every BrowserView, so this is reachable from everywhere.
 */
export default function PenRecordingBadge() {
  const { recordingStartedAt, busy } = usePenSession()
  const [, tick] = useState(0)

  useEffect(() => {
    if (recordingStartedAt === null) return
    const id = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [recordingStartedAt])

  if (recordingStartedAt === null) return null
  const seconds = Math.max(0, Math.floor((Date.now() - recordingStartedAt) / 1000))

  return (
    <button
      onClick={() => penSession.toggleRecording()}
      disabled={busy}
      title="Stop the screen recording and save it"
      className="no-drag flex items-center gap-1.5 rounded-xl"
      style={{
        height: 32, padding: '0 10px', cursor: busy ? 'default' : 'pointer',
        background: 'rgba(239,68,68,0.16)', border: '1px solid rgba(239,68,68,0.4)',
        color: '#f87171',
      }}
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
      </span>
      <Square size={11} fill="currentColor" />
      <span style={{ fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatElapsed(seconds)}</span>
    </button>
  )
}
