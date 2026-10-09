/**
 * AI DJ panel. Three ways to use it:
 *  - Talk to it: "skip", "more energy", "play Essence by Wizkid", "hit the horn".
 *    Plain rules answer instantly (so it works with no AI model at all); the
 *    model handles anything looser.
 *  - Describe a vibe and the local model plans a set for it.
 *  - "Take over": the AI becomes the DJ, building the set from what it has
 *    learnt the listener plays, finishes, skips and likes — following the
 *    energy asked for, what is playing now and the time of day — and keeps it going.
 * Either way YouTube supplies the songs and Automix mixes them. If no model
 * answers, the AI DJ keeps the set going from the listener's taste directly.
 */
import React, { useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Sparkles, Loader2, Play, Square, Bot, Brain, Trash2, Check, SkipForward, Heart, Send, Mic } from 'lucide-react'
import type { DjTrack } from './engine/DjEngine'
import { planSet, resolvePicks, type SongPick } from './aiDj'
import {
  clearTaste, currentProfile, describeTaste, learningEnabled, setLearning, subscribeTaste, tasteEvents, tasteVersion,
} from './taste'
import {
  buildCommandPrompt, fallbackQueries, getEnergy, parseCommand, parseModelIntents, setEnergy, subscribeEnergy,
  type DjIntent, type Energy, type SetContext,
} from './djBrain'
import { DjEnvContext, describeDeck, onAir, runIntent, type PanelControls } from './djActions'
import { setVoiceEnabled, subscribeVoice, voiceEnabled } from './djVoice'
import { IS_INCOGNITO } from '../../services/incognitoMode'

const VIBES = ['Afrobeats party', 'Chill R&B evening', 'Deep house sunset', '90s hip-hop classics', 'Gospel praise', 'Amapiano groove']
const BATCH = 8
const ENERGIES: { id: Energy; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'Read the room' },
  { id: 'build', label: 'Build', hint: 'Each song a little more intense' },
  { id: 'peak', label: 'Peak', hint: 'Biggest, most danceable songs' },
  { id: 'chill', label: 'Chill', hint: 'Bring the energy down' },
]
const ASK_EXAMPLES = ['skip', 'more energy', 'chill it down', 'play Essence by Wizkid', 'hit the horn', "what's playing?"]

type LogKind = 'info' | 'pick' | 'err' | 'you' | 'dj'
interface LogLine { text: string; kind: LogKind; sub?: string }

interface Props {
  sidelistCount: number
  addTracks: (t: DjTrack[]) => void
  automix: boolean
  setAutomix: (on: boolean) => void
  visible: boolean
}

export default function AiDjPanel({ sidelistCount, addTracks, automix, setAutomix, visible }: Props) {
  const env = useContext(DjEnvContext)
  const [vibe, setVibe] = useState('')
  const [asking, setAsking] = useState(false)
  const [ask, setAsk] = useState('')
  const [busy, setBusy] = useState(false)
  const [keepGoing, setKeepGoing] = useState(true)
  const [log, setLog] = useState<LogLine[]>([])
  const [active, setActive] = useState(false)
  const [takeover, setTakeover] = useState(false)
  const [view, setView] = useState<'dj' | 'taste'>('dj')
  const played = useRef<string[]>([])
  /** YouTube ids already chosen this session, so searches never hand back the same video. */
  const taken = useRef(new Set<string>())
  const last = useRef<SongPick | undefined>()
  const vibeRef = useRef('')
  const takeoverRef = useRef(false)
  const activeRef = useRef(false)
  // Read synchronously: two plans must never run at once (state updates land a render late).
  const busyRef = useRef(false)
  useSyncExternalStore(subscribeTaste, tasteVersion)
  const energy = useSyncExternalStore(subscribeEnergy, getEnergy)
  const voice = useSyncExternalStore(subscribeVoice, voiceEnabled)
  const profile = currentProfile()
  const learning = learningEnabled()

  const note = (text: string, kind: LogKind = 'info', sub?: string) =>
    setLog(l => [...l.slice(-60), { text, kind, sub }])

  /** What the model should know about the room right now. */
  const setContext = (): SetContext => {
    const d = env ? onAir(env.engine) : null
    return {
      now: d?.track ? { artist: d.track.artist, title: d.track.title, bpm: d.effectiveBpm, key: d.musicalKey?.camelot ?? null } : undefined,
      energy: getEnergy(),
      hour: new Date().getHours(),
    }
  }

  /** Plan songs and add them to the set; resolves with how many were found. `front` puts them next in line. */
  const generate = async (v: string, continuing: boolean, front = false): Promise<number> => {
    const own = takeoverRef.current
    if (busyRef.current || (!v.trim() && !own)) return 0
    busyRef.current = true
    setBusy(true)
    let added = 0
    vibeRef.current = v.trim()
    const taste = describeTaste(currentProfile())
    if (!continuing) {
      note(own
        ? taste ? `Taking over — planning a set from your taste${v.trim() ? ` with a "${v.trim()}" feel` : ''}…` : 'Taking over — no listening history yet, so starting from popular picks. I will learn as you play.'
        : `Planning a "${v.trim()}" set…`)
    } else note('Picking what comes next…')
    const add = (t: DjTrack) => {
      if (t.youtubeId) taken.current.add(t.youtubeId)
      if (front && env) env.playNext([t]); else addTracks([t])
    }
    try {
      // Songs the AI already chose plus what has just played, so it never repeats itself.
      const events = tasteEvents()
      const recent = events.filter(e => e.kind === 'play').slice(-30).map(e => `${e.artist} - ${e.title}`)
      for (const e of events.slice(-80)) if (e.youtubeId) taken.current.add(e.youtubeId)
      let picks: SongPick[]
      try {
        // A described vibe still leans on what the listener likes, when that is known.
        const plan = await planSet(v.trim(), BATCH, [...played.current, ...recent], continuing ? last.current : undefined, taste || undefined, setContext())
        note(`${plan.provider ? `${plan.provider} ` : ''}picked ${plan.picks.length} songs — finding them on YouTube…`)
        picks = plan.picks
      } catch (e: any) {
        // No model answered. Don't stop the music: search from the listener's taste directly.
        const queries = fallbackQueries(v.trim(), currentProfile(), getEnergy(), BATCH)
        note(`${e?.message || 'The AI model is not answering.'} Picking from your taste instead…`)
        picks = queries.map(q => ({ artist: '', title: q, query: q }))
      }
      const found = await resolvePicks(picks, (t, i) => {
        add(t)
        note(`${t.artist ? `${t.artist} – ` : ''}${t.title}`, 'pick', picks[i]?.reason)
      }, taken.current)
      for (const p of picks) played.current.push(p.query ? p.query : `${p.artist} - ${p.title}`)
      last.current = picks.filter(p => !p.query).pop() ?? last.current
      added = found
      if (!found) note('None of the picks could be found on YouTube.', 'err')
      else if (found < picks.length) note(`${picks.length - found} picks were not on YouTube and were skipped.`)
      // While the AI is in charge, new songs always get played — even if the set had run dry.
      if (found && activeRef.current) setAutomix(true)
    } catch (e: any) {
      note(e?.message || 'The AI DJ could not plan a set.', 'err')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
    return added
  }

  const start = async (own: boolean, v = vibe, fresh = false) => {
    takeoverRef.current = own
    setTakeover(own)
    setActive(true)
    activeRef.current = true
    let have = own || fresh ? 0 : sidelistCount
    if (have === 0) have = await generate(v, false)
    // A cold local model can miss the first time: try once more before giving up.
    if (have === 0 && activeRef.current) {
      note('No songs yet — asking the AI once more…')
      have = await generate(v, false)
    }
    if (!activeRef.current) return // stopped while the AI was still choosing
    if (have > 0 || sidelistCount > 0) setAutomix(true)
    else {
      note('The AI DJ could not start: no songs were found. Check your connection, then try again.', 'err')
      activeRef.current = false
      setActive(false)
      setTakeover(false)
      takeoverRef.current = false
    }
  }
  const stop = () => { activeRef.current = false; setActive(false); setTakeover(false); takeoverRef.current = false; setAutomix(false) }

  // Top the set up while the AI DJ is running.
  useEffect(() => {
    if (!active || !automix || !keepGoing || busy || sidelistCount > 1) return
    if (!vibeRef.current && !takeoverRef.current) return
    void generate(vibeRef.current, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, automix, keepGoing, busy, sidelistCount])

  // Automix went off. If the set simply ran dry, the AI fetches more and carries
  // on; if the DJ switched it off with songs still waiting, the AI steps back.
  useEffect(() => {
    if (automix || !activeRef.current || busyRef.current) return
    if (sidelistCount === 0 && keepGoing && (vibeRef.current || takeoverRef.current)) {
      void generate(vibeRef.current, true)
      return
    }
    activeRef.current = false
    setActive(false)
    setTakeover(false)
    takeoverRef.current = false
  }, [automix]) // eslint-disable-line react-hooks/exhaustive-deps

  // A new energy while the AI is running: fetch songs for it and play them next.
  const energyRef = useRef(energy)
  useEffect(() => {
    if (energyRef.current === energy) return
    energyRef.current = energy
    if (activeRef.current && !busyRef.current) void generate(vibeRef.current, true, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [energy])

  const controls: PanelControls = {
    setEnergy: e => setEnergy(e),
    setTakeover: on => { if (on) void start(true); else stop() },
    planVibe: text => { setVibe(text); void start(false, text, true) },
  }

  /** The DJ said something: rules first (instant, offline), the model for anything looser. */
  const tell = async (raw: string) => {
    const text = raw.trim()
    if (!text || !env || asking) return
    setAsk('')
    note(text, 'you')
    setAsking(true)
    try {
      let intents: DjIntent[] = []
      const rule = parseCommand(text)
      if (rule) intents = [rule]
      else {
        try {
          const d = onAir(env.engine)
          const r = await (window as any).electronAPI.ai.chat([{ role: 'user', content: buildCommandPrompt(text, d ? describeDeck(d) : undefined) }])
          if (r && r.provider !== 'error' && r.provider !== 'none' && r.content) intents = parseModelIntents(String(r.content))
        } catch { /* fall through to the hint below */ }
      }
      if (!intents.length) {
        note('I did not catch that. Try "skip", "more energy", "chill it down", "play <song>", "queue <song>" or "hit the horn".', 'dj')
        return
      }
      for (const i of intents) {
        const reply = await runIntent(i, env, controls)
        if (reply) note(reply, 'dj')
      }
    } catch (e: any) {
      note(e?.message || 'That did not work.', 'err')
    } finally {
      setAsking(false)
    }
  }

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
          <form className="dj-ai-ask" onSubmit={e => { e.preventDefault(); void tell(ask) }}>
            <input value={ask} onChange={e => setAsk(e.target.value)} disabled={!env} spellCheck={false}
              placeholder="Tell the DJ… skip, more energy, play a song"
              onKeyDown={e => e.stopPropagation()} aria-label="Tell the AI DJ what to do" />
            <button type="submit" disabled={!ask.trim() || asking} title="Send">
              {asking ? <Loader2 size={12} className="dj-spin" /> : <Send size={12} />}
            </button>
          </form>
          <div className="dj-ai-chips">
            {ASK_EXAMPLES.map(x => <button type="button" key={x} onClick={() => void tell(x)} disabled={asking}>{x}</button>)}
          </div>

          <div className="dj-ai-energy" role="group" aria-label="Energy">
            <span>ENERGY</span>
            {ENERGIES.map(e => (
              <button type="button" key={e.id} className={energy === e.id ? 'on' : ''} title={e.hint} onClick={() => setEnergy(e.id)}>{e.label}</button>
            ))}
          </div>

          {active ? (
            <button type="button" className="dj-ai-takeover dj-on dj-on-orange" onClick={stop}>
              <Square size={10} fill="currentColor" /> {takeover ? 'Take back the decks' : 'Stop the AI DJ'}
            </button>
          ) : (
            <button type="button" className="dj-ai-takeover" disabled={busy} onClick={() => void start(true)}
              title="The AI plays the set, choosing from what it has learnt you like">
              <Bot size={13} /> Let the AI take over
            </button>
          )}
          {/* Always in view: what the AI is doing right now (the full log is below). */}
          {(busy || log.length > 0) && (
            <div className={`dj-ai-status ${!busy && log[log.length - 1]?.kind === 'err' ? 'dj-ai-status-err' : ''}`} role="status">
              {busy ? <Loader2 size={11} className="dj-spin" /> : null}
              <span>{busy && !log.length ? 'Asking your AI model…' : log[log.length - 1]?.text}</span>
            </div>
          )}

          <textarea className="dj-ai-input" value={vibe} onChange={e => setVibe(e.target.value)} rows={2}
            placeholder="Describe a vibe — or leave empty and let the AI play what you love"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void generate(vibe, false) } e.stopPropagation() }} />
          <div className="dj-ai-chips">
            {VIBES.map(v => <button type="button" key={v} onClick={() => setVibe(v)}>{v}</button>)}
          </div>
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
          <label className="dj-ai-keep" title="The AI announces each song as it comes in, dipping the music while it speaks">
            <input type="checkbox" checked={voice} onChange={e => setVoiceEnabled(e.target.checked)} />
            <span><Mic size={10} /> DJ voice — announce the next song</span>
          </label>
          <div className="dj-ai-log" ref={logRef}>
            {log.length === 0 && (
              <p className="dj-ai-hint">
                Talk to me above, or let me take over. I pick and order the songs (your local AI if it is running, your own taste if not),
                AIHub DJ finds them on YouTube, and Automix blends them — swapping basslines when the tempos match.
                {learning ? ' I learn your taste from what you play, finish, skip and like.' : ''}
              </p>
            )}
            {log.map((l, i) => (
              <div key={i} className={`dj-ai-line dj-ai-${l.kind}`} title={l.sub ? `${l.text} — ${l.sub}` : l.text}>
                {l.kind === 'pick' ? '♪ ' : l.kind === 'you' ? '› ' : l.kind === 'dj' ? '◆ ' : ''}{l.text}
                {l.sub && <small> — {l.sub}</small>}
              </div>
            ))}
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
