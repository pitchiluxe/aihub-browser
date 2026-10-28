import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Loader2, Mic, Play, Square, Trash2 } from 'lucide-react'
import { useBibleSettings } from '../../services/bibleSettings'
import { speak, type SpeechHandle } from '../../services/verseSpeech'

interface VoiceStatus {
  installed: boolean
  installing: boolean
  progress: number
  sizeMb: number
  voices: { id: string; label: string; description: string }[]
  error?: string
}

const SAMPLE = 'The Lord is my shepherd; I shall lack nothing. He makes me lie down in green pastures. He leads me beside still waters. He restores my soul.'
const SAMPLE_REF = 'Psalm 23:1–3'

const api = () => (window as any).electronAPI?.voice

/**
 * Settings → Bible → Reading voice.
 *
 * The natural voice is an explicit, one-time download: the size is stated
 * before anything is fetched, and it can be removed again from here. Pace
 * applies to whichever voice is reading.
 */
export default function ReadingVoiceSettings({ rowClass, labelClass }: { rowClass: string; labelClass: string }) {
  const [bible, setBible] = useBibleSettings()
  const [status, setStatus] = useState<VoiceStatus | null>(null)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const preview = useRef<SpeechHandle | null>(null)

  useEffect(() => {
    api()?.status().then(setStatus).catch(() => {})
    const off = api()?.onProgress?.((s: VoiceStatus) => setStatus(s))
    return () => { off?.(); preview.current?.stop() }
  }, [])

  const install = useCallback(() => {
    setStatus(s => s && { ...s, installing: true, progress: 0, error: undefined })
    api()?.install().then(setStatus).catch(() => {})
  }, [])

  const remove = useCallback(() => {
    preview.current?.stop()
    api()?.remove().then(setStatus).catch(() => {})
  }, [])

  const play = useCallback(async (voiceId: string | null) => {
    preview.current?.stop()
    if (previewing === (voiceId ?? 'system')) { setPreviewing(null); return }
    if (voiceId) setBible({ readingVoice: voiceId })
    setPreviewing(voiceId ?? 'system')
    preview.current = await speak(SAMPLE, {
      intro: SAMPLE_REF,
      onDone: () => setPreviewing(null),
    })
  }, [previewing, setBible])

  if (!api()) return null
  const pct = Math.round((status?.progress || 0) * 100)

  return (
    <>
      <div className={rowClass} style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 10 }}>
        <div className="flex w-full items-start justify-between gap-4">
          <div>
            <div className={labelClass}>Natural reading voice</div>
            <div className="text-xs text-aihub-muted">
              {status?.installed
                ? 'Installed. Scripture is read by a natural, human-sounding voice — on this device, offline.'
                : `A neural voice that reads like a person instead of a machine. One-time download of about ${status?.sizeMb ?? 165} MB; it then works offline and nothing you read leaves this device. English only — other versions keep the system voice.`}
            </div>
          </div>
          {status && !status.installed && (
            <button onClick={install} disabled={status.installing}
              className="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold disabled:opacity-70"
              style={{ background: 'rgb(var(--ds-accent) / 0.9)', color: '#fff' }}>
              {status.installing
                ? <><Loader2 size={12} className="animate-spin" /> {pct}%</>
                : <><Download size={12} /> Install</>}
            </button>
          )}
          {status?.installed && (
            <button onClick={remove} title="Remove the natural voice and free the space"
              className="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium"
              style={{ background: 'var(--ds-glass-sm)', color: 'rgb(var(--ds-text-4))' }}>
              <Trash2 size={12} /> Remove
            </button>
          )}
        </div>

        {status?.installing && (
          <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: 'var(--ds-glass-md)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: 'rgb(var(--ds-accent))' }} />
          </div>
        )}
        {status?.error && !status.installing && (
          <div className="text-xs" style={{ color: '#f87171' }}>The download did not finish: {status.error}. Try again.</div>
        )}

        {status?.installed ? (
          <div className="flex flex-wrap gap-2">
            {status.voices.map(v => {
              const active = bible.readingVoice === v.id
              return (
                <button key={v.id} onClick={() => play(v.id)} title={`${v.description} — click to hear it`}
                  className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all"
                  style={active
                    ? { background: 'rgb(var(--ds-accent) / 0.9)', color: '#fff' }
                    : { background: 'var(--ds-glass-sm)', color: 'rgb(var(--ds-text-4))' }}>
                  {previewing === v.id ? <Square size={10} /> : <Play size={10} />}
                  {v.label}
                  <span className="opacity-60">· {v.description}</span>
                </button>
              )
            })}
          </div>
        ) : status && (
          <button onClick={() => play(null)}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium"
            style={{ background: 'var(--ds-glass-sm)', color: 'rgb(var(--ds-text-4))' }}>
            {previewing ? <Square size={10} /> : <Mic size={11} />} Hear the current voice
          </button>
        )}
      </div>

      <div className={rowClass}>
        <div>
          <div className={labelClass}>Reading pace</div>
          <div className="text-xs text-aihub-muted">
            {bible.readingPace < 0.95 ? 'Slow and deliberate' : bible.readingPace > 1.05 ? 'A little quicker' : 'Unhurried, like a reader in church'}
          </div>
        </div>
        <input type="range" min={0.8} max={1.15} step={0.05} value={bible.readingPace}
          onChange={e => setBible({ readingPace: Number(e.target.value) })}
          style={{ width: 140, accentColor: 'rgb(var(--ds-accent))' }} />
      </div>
    </>
  )
}
