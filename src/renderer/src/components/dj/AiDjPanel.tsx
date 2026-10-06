/**
 * AI DJ panel: describe a vibe, the local model plans the set, YouTube
 * supplies the songs, and Automix plays them. With "Keep it going" on, the
 * AI tops the set up whenever it runs low, continuing from the last song.
 */
import React, { useEffect, useRef, useState } from 'react'
import { Sparkles, Loader2, Play, Square } from 'lucide-react'
import type { DjTrack } from './engine/DjEngine'
import { planSet, resolvePicks, type SongPick } from './aiDj'

const VIBES = ['Afrobeats party', 'Chill R&B evening', 'Deep house sunset', '90s hip-hop classics', 'Gospel praise', 'Amapiano groove']
const BATCH = 8

interface Props {
  sidelistCount: number
  addTracks: (t: DjTrack[]) => void
  automix: boolean
  setAutomix: (on: boolean) => void
  visible: boolean
}

export default function AiDjPanel({ sidelistCount, addTracks, automix, setAutomix, visible }: Props) {
  const [vibe, setVibe] = useState('')
  const [busy, setBusy] = useState(false)
  const [keepGoing, setKeepGoing] = useState(true)
  const [log, setLog] = useState<{ text: string; kind: 'info' | 'pick' | 'err' }[]>([])
  const [active, setActive] = useState(false)
  const played = useRef<string[]>([])
  const last = useRef<SongPick | undefined>()
  const vibeRef = useRef('')

  const note = (text: string, kind: 'info' | 'pick' | 'err' = 'info') =>
    setLog(l => [...l.slice(-40), { text, kind }])

  const generate = async (v: string, continuing: boolean) => {
    if (busy || !v.trim()) return
    setBusy(true)
    vibeRef.current = v.trim()
    note(continuing ? 'Picking what comes next…' : `Planning a "${v.trim()}" set…`)
    try {
      const plan = await planSet(v.trim(), BATCH, played.current, continuing ? last.current : undefined)
      note(`${plan.provider ? `${plan.provider} ` : ''}picked ${plan.picks.length} songs — finding them on YouTube…`)
      const got: DjTrack[] = []
      const found = await resolvePicks(plan.picks, t => {
        got.push(t)
        addTracks([t])
        note(`${t.artist ? `${t.artist} – ` : ''}${t.title}`, 'pick')
      })
      for (const p of plan.picks) played.current.push(`${p.artist} - ${p.title}`)
      last.current = plan.picks[plan.picks.length - 1]
      if (!found) note('None of the picks could be found on YouTube.', 'err')
      else if (found < plan.picks.length) note(`${plan.picks.length - found} picks were not on YouTube and were skipped.`)
    } catch (e: any) {
      note(e?.message || 'The AI DJ could not plan a set.', 'err')
    } finally {
      setBusy(false)
    }
  }

  const start = async () => {
    setActive(true)
    if (sidelistCount === 0) await generate(vibe, false)
    setAutomix(true)
  }
  const stop = () => { setActive(false); setAutomix(false) }

  // Top the set up while the AI DJ is running.
  useEffect(() => {
    if (!active || !automix || !keepGoing || busy || sidelistCount > 1 || !vibeRef.current) return
    void generate(vibeRef.current, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, automix, keepGoing, busy, sidelistCount])

  useEffect(() => { if (!automix) setActive(false) }, [automix])

  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => { logRef.current?.scrollTo({ top: 1e9 }) }, [log])

  return (
    <div className="dj-ai" style={{ display: visible ? 'flex' : 'none' }}>
      <textarea className="dj-ai-input" value={vibe} onChange={e => setVibe(e.target.value)} rows={2}
        placeholder="Describe the vibe — e.g. sunset afro-house for a rooftop party"
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void generate(vibe, false) } e.stopPropagation() }} />
      <div className="dj-ai-chips">
        {VIBES.map(v => <button type="button" key={v} onClick={() => setVibe(v)}>{v}</button>)}
      </div>
      <div className="dj-ai-actions">
        <button type="button" className="dj-ai-gen" disabled={busy || !vibe.trim()} onClick={() => void generate(vibe, false)}>
          {busy ? <Loader2 size={12} className="dj-spin" /> : <Sparkles size={12} />} Build set
        </button>
        {active && automix
          ? <button type="button" className="dj-ai-go dj-on dj-on-orange" onClick={stop}><Square size={10} fill="currentColor" /> Stop</button>
          : <button type="button" className="dj-ai-go" disabled={busy || (!vibe.trim() && sidelistCount === 0)} onClick={() => void start()}><Play size={11} fill="currentColor" /> AI DJ</button>}
      </div>
      <label className="dj-ai-keep">
        <input type="checkbox" checked={keepGoing} onChange={e => setKeepGoing(e.target.checked)} /> Keep it going — add songs as the set runs low
      </label>
      <div className="dj-ai-log" ref={logRef}>
        {log.length === 0 && <p className="dj-ai-hint">Your local AI (Ollama) picks and orders the songs, AIHub DJ finds them on YouTube and mixes them with Automix.</p>}
        {log.map((l, i) => <div key={i} className={`dj-ai-line dj-ai-${l.kind}`}>{l.kind === 'pick' ? '♪ ' : ''}{l.text}</div>)}
      </div>
    </div>
  )
}
