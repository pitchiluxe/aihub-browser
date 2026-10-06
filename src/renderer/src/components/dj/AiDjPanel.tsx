/**
 * AI DJ panel. Two ways to use it:
 *  - Describe a vibe and the local model plans a set for it.
 *  - "Take over": the AI becomes the DJ, building the set from what it has
 *    learnt the listener plays, finishes, skips and likes, and keeps it going.
 * Either way YouTube supplies the songs and Automix mixes them.
 */
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Sparkles, Loader2, Play, Square, Bot, Brain, Trash2, Check, SkipForward, Heart } from 'lucide-react'
import type { DjTrack } from './engine/DjEngine'
import { planSet, resolvePicks, type SongPick } from './aiDj'
import {
  clearTaste, currentProfile, describeTaste, learningEnabled, setLearning, subscribeTaste, tasteEvents, tasteVersion,
} from './taste'
import { IS_INCOGNITO } from '../../services/incognitoMode'

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
  const [takeover, setTakeover] = useState(false)
  const [view, setView] = useState<'dj' | 'taste'>('dj')
  const played = useRef<string[]>([])
  const last = useRef<SongPick | undefined>()
  const vibeRef = useRef('')
  const takeoverRef = useRef(false)
  useSyncExternalStore(subscribeTaste, tasteVersion)
  const profile = currentProfile()
  const learning = learningEnabled()

  const note = (text: string, kind: 'info' | 'pick' | 'err' = 'info') =>
    setLog(l => [...l.slice(-40), { text, kind }])

  const generate = async (v: string, continuing: boolean) => {
    const own = takeoverRef.current
    if (busy || (!v.trim() && !own)) return
    setBusy(true)
    vibeRef.current = v.trim()
    const taste = describeTaste(currentProfile())
    if (!continuing) {
      note(own
        ? taste ? `Taking over — planning a set from your taste${v.trim() ? ` with a "${v.trim()}" feel` : ''}…` : 'Taking over — no listening history yet, so starting from popular picks. I will learn as you play.'
        : `Planning a "${v.trim()}" set…`)
    } else note('Picking what comes next…')
    try {
      // Songs the AI already chose plus what has just played, so it never repeats itself.
      const recent = tasteEvents().filter(e => e.kind === 'play').slice(-30).map(e => `${e.artist} - ${e.title}`)
      // A described vibe still leans on what the listener likes, when that is known.
      const plan = await planSet(v.trim(), BATCH, [...played.current, ...recent], continuing ? last.current : undefined, taste || undefined)
      note(`${plan.provider ? `${plan.provider} ` : ''}picked ${plan.picks.length} songs — finding them on YouTube…`)
      const found = await resolvePicks(plan.picks, t => {
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

  const start = async (own: boolean) => {
    takeoverRef.current = own
    setTakeover(own)
    setActive(true)
    if (sidelistCount === 0 || own) await generate(vibe, false)
    setAutomix(true)
  }
  const stop = () => { setActive(false); setTakeover(false); takeoverRef.current = false; setAutomix(false) }

  // Top the set up while the AI DJ is running.
  useEffect(() => {
    if (!active || !automix || !keepGoing || busy || sidelistCount > 1) return
    if (!vibeRef.current && !takeoverRef.current) return
    void generate(vibeRef.current, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, automix, keepGoing, busy, sidelistCount])

  useEffect(() => { if (!automix) { setActive(false); setTakeover(false); takeoverRef.current = false } }, [automix])

  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => { logRef.current?.scrollTo({ top: 1e9 }) }, [log])

  const recentPlays = tasteEvents().filter(e => e.kind === 'play').slice(-12).reverse()

  return (
    <div className="dj-ai" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="dj-ai-views">
        <button type="button" className={view === 'dj' ? 'on' : ''} onClick={() => setView('dj')}><Bot size={11} /> DJ</button>
        <button type="button" className={view === 'taste' ? 'on' : ''} onClick={() => setView('taste')}><Brain size={11} /> Your taste</button>
      </div>

      {view === 'dj' && (
        <>
          <textarea className="dj-ai-input" value={vibe} onChange={e => setVibe(e.target.value)} rows={2}
            placeholder="Describe a vibe — or leave empty and let the AI play what you love"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void generate(vibe, false) } e.stopPropagation() }} />
          <div className="dj-ai-chips">
            {VIBES.map(v => <button type="button" key={v} onClick={() => setVibe(v)}>{v}</button>)}
          </div>
          {active && automix ? (
            <button type="button" className="dj-ai-takeover dj-on dj-on-orange" onClick={stop}>
              <Square size={10} fill="currentColor" /> {takeover ? 'Take back the decks' : 'Stop the AI DJ'}
            </button>
          ) : (
            <button type="button" className="dj-ai-takeover" disabled={busy} onClick={() => void start(true)}
              title="The AI plays the set, choosing from what it has learnt you like">
              {busy ? <Loader2 size={13} className="dj-spin" /> : <Bot size={13} />} Let the AI take over
            </button>
          )}
          <div className="dj-ai-actions">
            <button type="button" className="dj-ai-gen" disabled={busy || !vibe.trim()} onClick={() => void generate(vibe, false)}>
              {busy ? <Loader2 size={12} className="dj-spin" /> : <Sparkles size={12} />} Build set
            </button>
            {!(active && automix) && (
              <button type="button" className="dj-ai-go" disabled={busy || (!vibe.trim() && sidelistCount === 0)} onClick={() => void start(false)}>
                <Play size={11} fill="currentColor" /> Play vibe
              </button>
            )}
          </div>
          <label className="dj-ai-keep">
            <input type="checkbox" checked={keepGoing} onChange={e => setKeepGoing(e.target.checked)} /> Keep it going — add songs as the set runs low
          </label>
          <div className="dj-ai-log" ref={logRef}>
            {log.length === 0 && (
              <p className="dj-ai-hint">
                Your local AI (Ollama) picks and orders the songs, AIHub DJ finds them on YouTube and mixes them with Automix.
                {learning ? ' It learns your taste from what you play, finish, skip and like.' : ''}
              </p>
            )}
            {log.map((l, i) => <div key={i} className={`dj-ai-line dj-ai-${l.kind}`}>{l.kind === 'pick' ? '♪ ' : ''}{l.text}</div>)}
          </div>
        </>
      )}

      {view === 'taste' && (
        <div className="dj-taste">
          <label className="dj-ai-keep">
            <input type="checkbox" checked={learning} disabled={IS_INCOGNITO} onChange={e => setLearning(e.target.checked)} />
            {IS_INCOGNITO ? 'Not learning in a private window' : 'Learn my taste from what I play'}
          </label>
          <div className="dj-taste-stats">
            <span><b>{profile.stats.plays}</b> songs</span>
            <span><b>{profile.stats.minutes}</b> min</span>
            <span><b>{profile.stats.completes}</b> played out</span>
            <span><b>{profile.stats.skips}</b> skipped</span>
          </div>
          <div className="dj-taste-h">Artists you love</div>
          <div className="dj-taste-chips">
            {profile.topArtists.length === 0 && <span className="dj-dim">Play a few songs and they will show up here.</span>}
            {profile.topArtists.slice(0, 12).map(a => (
              <button type="button" key={a.artist} title={`Score ${a.score} — click to use as the vibe`}
                onClick={() => { setVibe(`${a.artist} and similar`); setView('dj') }}>{a.artist}</button>
            ))}
          </div>
          {profile.avoidArtists.length > 0 && (
            <>
              <div className="dj-taste-h">The AI will avoid</div>
              <div className="dj-taste-chips dj-taste-avoid">{profile.avoidArtists.map(a => <span key={a}>{a}</span>)}</div>
            </>
          )}
          <div className="dj-taste-h">Recently played</div>
          <div className="dj-taste-list">
            {recentPlays.length === 0 && <span className="dj-dim">Nothing yet.</span>}
            {recentPlays.map((e, i) => (
              <div key={i} className="dj-taste-row" title={new Date(e.at).toLocaleString()}>
                {e.outcome === 'complete' ? <Check size={11} className="ok" /> : e.outcome === 'skip' ? <SkipForward size={11} className="skip" /> : <Heart size={11} className="dim" />}
                <span>{e.artist ? `${e.artist} – ` : ''}{e.title}</span>
              </div>
            ))}
          </div>
          <button type="button" className="dj-taste-reset" onClick={() => { if (window.confirm('Forget everything the AI DJ has learnt about your taste?')) clearTaste() }}>
            <Trash2 size={11} /> Forget my taste
          </button>
        </div>
      )}
    </div>
  )
}
