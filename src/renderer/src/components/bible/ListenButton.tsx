import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Volume2, VolumeX } from 'lucide-react'
import { speak, speechSupported, type SpeechHandle } from '../../services/verseSpeech'
import { getTranslationMeta } from '../../services/bibleService'

interface Props {
  /** The scripture to read. Empty disables the button. */
  text: string
  /** Spoken first — "John 3:16" becomes "John 3 verse 16". */
  reference?: string
  /** `chip` matches the study cards, `icon` the reader's toolbar. */
  variant?: 'chip' | 'icon'
  label?: string
  accent?: string
}

/**
 * One button, everywhere scripture is on screen: press to hear it, press again
 * to stop.
 *
 * The reading is stopped on unmount as well as on a second press. A popup
 * closed mid-verse that keeps narrating from nowhere is the single most
 * annoying thing a feature like this can do.
 */
export default function ListenButton({
  text, reference, variant = 'chip', label = 'Listen', accent = '#e6c86e',
}: Props) {
  const [state, setState] = useState<'idle' | 'starting' | 'playing'>('idle')
  const handle = useRef<SpeechHandle | null>(null)
  const supported = speechSupported()

  const stop = useCallback(() => {
    handle.current?.stop()
    handle.current = null
    setState('idle')
  }, [])

  useEffect(() => stop, [stop])
  // A new verse means the old reading is no longer what is on screen.
  useEffect(() => { stop() }, [text, stop])

  const toggle = useCallback(async () => {
    if (state !== 'idle') { stop(); return }
    if (!text.trim()) return
    // Voices load asynchronously, so there is a real gap before the first
    // word on a cold start — the button says so rather than looking dead.
    setState('starting')
    const h = await speak(text, {
      intro: reference,
      // Read in the language of the open version: a French psalm handed to an
      // English voice is unintelligible, however good that voice is.
      lang: getTranslationMeta().locale,
      onChunk: () => setState('playing'),
      onDone: () => { handle.current = null; setState('idle') },
    })
    handle.current = h
  }, [state, stop, text, reference])

  if (!supported) return null

  const active = state !== 'idle'
  const icon = state === 'starting'
    ? <Loader2 size={variant === 'icon' ? 14 : 13} className="animate-spin" />
    : active ? <VolumeX size={variant === 'icon' ? 14 : 13} /> : <Volume2 size={variant === 'icon' ? 14 : 13} />

  if (variant === 'icon') {
    return (
      <button onClick={toggle} disabled={!text.trim()}
        title={active ? 'Stop reading' : 'Read this aloud'}
        className="flex items-center gap-1.5 rounded-lg border border-aihub-border/40 bg-aihub-surface px-3 py-1.5 text-sm disabled:opacity-40">
        {icon} {active ? 'Stop' : label}
      </button>
    )
  }

  return (
    <button onClick={toggle} disabled={!text.trim()}
      title={active ? 'Stop reading' : 'Read this aloud'}
      className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all disabled:opacity-40"
      style={active
        ? { background: `${accent}28`, border: `1px solid ${accent}55`, color: accent }
        : { background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-3))' }}>
      {icon} {active ? 'Stop' : label}
    </button>
  )
}
