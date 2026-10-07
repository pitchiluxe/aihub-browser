/**
 * AIHub DJ — a two-deck DJ console inside the browser.
 *
 * The page owns the audio engine for as long as its tab is open, so music
 * keeps playing while the user browses in other tabs.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Circle, Headphones, Minus, Palette, Plus, Settings2, Square } from 'lucide-react'
import { DjEngine, type DeckId, type DjTrack } from './engine/DjEngine'
import { AutoMixer } from './engine/autoMixer'
import { DeckClock, DeckInfo, DeckPads, Turntable } from './DeckUI'
import { ZoomWave } from './Waveforms'
import Mixer from './Mixer'
import Library from './Library'
import VideoMonitor from './VideoMonitor'
import { ListeningTracker } from './listeningTracker'
import { takeNext } from './ytQueue'
import { learningEnabled, setLearning, subscribeTaste, tasteVersion } from './taste'
import { IS_INCOGNITO } from '../../services/incognitoMode'
import { djApi, trackByToken, toTrack, loadMeta } from './libraryData'
import { HFader, useRafThrottled, VuMeter } from './controls'
import './dj.css'
import './dj-pro.css'

export const DJ_THEMES: { id: string; name: string; swatch: string }[] = [
  { id: 'silver', name: 'Silver', swatch: 'linear-gradient(#eceef0, #c2c6cb)' },
  { id: 'midnight', name: 'Midnight', swatch: 'linear-gradient(#3a3d44, #202227)' },
  { id: 'neon', name: 'Neon Club', swatch: 'linear-gradient(135deg, #c026d3, #22d3ee)' },
  { id: 'gold', name: 'Gold', swatch: 'linear-gradient(#f7e7b4, #b8964a)' },
  { id: 'ocean', name: 'Ocean', swatch: 'linear-gradient(#cfe3f5, #7aa3c9)' },
  { id: 'ruby', name: 'Ruby', swatch: 'linear-gradient(#8f1d2c, #4f0c17)' },
  { id: 'forest', name: 'Forest', swatch: 'linear-gradient(#4b5d48, #2b382a)' },
  { id: 'arctic', name: 'Arctic', swatch: 'linear-gradient(#ffffff, #e3e8ef)' },
]
const THEME_KEY = 'aihub-dj-theme'
const VIEW_KEY = 'aihub-dj-mixer-view'
const FADE_KEY = 'aihub-dj-fade-seconds'
const AUTOGAIN_KEY = 'aihub-dj-autogain'
const FADE_CHOICES = [4, 6, 8, 10, 16]

function readPref(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function writePref(key: string, v: string): void {
  try { localStorage.setItem(key, v) } catch { /* optional */ }
}

function savedTheme(): string {
  const t = readPref(THEME_KEY)
  return DJ_THEMES.some(x => x.id === t) ? (t as string) : 'silver'
}

export default function DjPage() {
  const [engine, setEngine] = useState<DjEngine | null>(null)
  useEffect(() => {
    const e = new DjEngine()
    setEngine(e)
    return () => e.dispose()
  }, [])
  if (!engine) return <div className="aihub-dj" />
  return <Console engine={engine} />
}

function Console({ engine }: { engine: DjEngine }) {
  const { A, B } = engine.decks
  const [toast, setToast] = useState<string | null>(null)
  const [sidelist, setSidelistState] = useState<DjTrack[]>([])
  const sideRef = useRef<DjTrack[]>([])
  const setSidelist = useCallback((fn: (s: DjTrack[]) => DjTrack[]) => {
    setSidelistState(s => { const n = fn(s); sideRef.current = n; return n })
  }, [])
  const [theme, setThemeState] = useState(savedTheme)
  const [uiZoom, setUiZoomState] = useState(savedZoom)
  const [mixerView, setMixerViewState] = useState<'mixer' | 'video'>(() => (readPref(VIEW_KEY) === 'video' ? 'video' : 'mixer'))
  const [bigVideo, setBigVideo] = useState(false)
  const setMixerView = (v: 'mixer' | 'video') => { setMixerViewState(v); writePref(VIEW_KEY, v) }
  const setUiZoom = (z: number) => {
    const v = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 100) / 100
    setUiZoomState(v)
    writePref(ZOOM_KEY, String(v))
  }
  const fit = useFitToTab(uiZoom)
  const setTheme = (t: string) => {
    setThemeState(t)
    writePref(THEME_KEY, t)
  }

  const say = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(t => (t === msg ? null : t)), 2600)
  }, [])

  // ── Listening history (what the AI DJ learns from) and Automix ──
  const tracker = useMemo(() => new ListeningTracker(engine), [engine])
  useEffect(() => () => tracker.dispose(), [tracker])
  const mixer = useMemo(() => {
    const m = new AutoMixer(engine, {
      // The set list first, then the YouTube queue when a list is playing.
      next: () => {
        const [t, ...rest] = sideRef.current
        if (t) { setSidelist(() => rest); return t }
        return takeNext()
      },
      loaded: (deck, auto) => tracker.noteLoad(deck, auto),
      say,
    })
    const saved = parseFloat(readPref(FADE_KEY) || '')
    if (saved >= 2 && saved <= 30) m.setFadeSeconds(saved)
    return m
  }, [engine, tracker, setSidelist, say])
  useEffect(() => () => mixer.dispose(), [mixer])
  useSyncExternalStore(mixer.subscribe, mixer.getVersion)
  const automix = mixer.on
  const setAutomix = useCallback((on: boolean) => mixer.setOn(on), [mixer])
  useEffect(() => {
    if (readPref(AUTOGAIN_KEY) === 'off') engine.setAutoGain(false)
  }, [engine])

  const load = useCallback((track: DjTrack, id?: DeckId) => {
    const deck = id ? engine.decks[id] : !A.active ? A : !B.active ? B : null
    if (!deck) { say('Both decks are playing — stop one first'); return }
    if (deck.active || deck.held) { say(`Deck ${deck.id} is playing — stop it before loading`); return }
    tracker.noteLoad(deck.id, false)
    void deck.load(track)
  }, [engine, A, B, say, tracker])

  const mixNow = useCallback((track: DjTrack) => { void mixer.mixNow(track) }, [mixer])

  const dropOn = (id: DeckId) => async (src: string | File) => {
    if (typeof src === 'string') {
      const t = trackByToken(src)
      if (t) load(t, id)
      return
    }
    // A file dragged in from the desktop / Explorer.
    const path = djApi().pathForFile(src)
    const raw = path ? await djApi().registerFile(path).catch(() => null) : null
    if (!raw) { say('Only audio and music-video files can be dropped on a deck (mp3, wav, flac, m4a, mp4…)'); return }
    load(toTrack(raw, await loadMeta(raw)), id)
  }

  useDjShortcuts(engine, mixer, fit.ref)

  return (
    <div className="aihub-dj" data-dj-theme={theme} ref={fit.ref} style={fit.style}>
      <TopBar engine={engine} mixer={mixer} say={say} theme={theme} setTheme={setTheme} uiZoom={uiZoom} setUiZoom={setUiZoom} />

      <div className="dj-row-clocks">
        <DeckClock deck={A} onDropTrack={dropOn('A')} />
        <div className="dj-panel dj-zoom"><ZoomWave decks={[A, B]} /></div>
        <DeckClock deck={B} onDropTrack={dropOn('B')} />
      </div>

      <div className="dj-row-info">
        <DeckInfo deck={A} onDropTrack={dropOn('A')} />
        <div className="dj-info-gap" />
        <DeckInfo deck={B} onDropTrack={dropOn('B')} />
      </div>

      <div className="dj-row-decks">
        <DeckPads deck={A} onDropTrack={dropOn('A')} />
        <Turntable deck={A} other={B} onDropTrack={dropOn('A')} />
        <Mixer engine={engine} view={mixerView} setView={setMixerView} onBigVideo={() => setBigVideo(true)} fadeSeconds={mixer.fadeSeconds} />
        <Turntable deck={B} other={A} onDropTrack={dropOn('B')} />
        <DeckPads deck={B} onDropTrack={dropOn('B')} />
        {bigVideo && (
          <div className="dj-bigscreen">
            <VideoMonitor engine={engine} big onToggleBig={() => setBigVideo(false)} />
            <BigScreenFader engine={engine} />
          </div>
        )}
      </div>

      <Library onLoad={load} sidelist={sidelist} setSidelist={setSidelist} automix={automix} setAutomix={setAutomix} mixNow={mixNow} say={say} />

      {toast && <div className="dj-toast">{toast}</div>}
    </div>
  )
}

function BigScreenFader({ engine }: { engine: DjEngine }) {
  useSyncExternalStore(engine.subscribe, engine.getVersion)
  return (
    <div className="dj-bigscreen-xf">
      <span>◂ A</span>
      <HFader value={engine.crossfader} onChange={v => engine.setCrossfader(v)} width={260} title="Crossfader (double-click to centre)" />
      <span>B ▸</span>
    </div>
  )
}

/**
 * Keyboard control, while the console is the page on screen and no text box
 * has focus. Keys mirror the left / right layout of the decks.
 */
function useDjShortcuts(engine: DjEngine, mixer: AutoMixer, root: React.RefObject<HTMLDivElement>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = root.current
      if (!el || !el.offsetParent || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      const tgt = e.target as HTMLElement | null
      if (tgt && (tgt.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName))) return
      const { A, B } = engine.decks
      const hot = (d: typeof A, i: number) => (e.shiftKey ? d.clearHotCue(i) : d.hotCue(i))
      const k = e.key.toLowerCase()
      let used = true
      switch (k) {
        case 'q': A.toggle(); break
        case 'w': A.cue(); break
        case 'p': B.toggle(); break
        case 'o': B.cue(); break
        case 's': if (!B.sync(A)) A.sync(B); break
        case '1': case '2': case '3': hot(A, Number(k) - 1); break
        case '8': case '9': hot(B, Number(k) - 8); break
        case '0': hot(B, 2); break
        case 'arrowleft': if (e.shiftKey) engine.fadeTo(0, mixer.fadeSeconds); else engine.setCrossfader(engine.crossfader - 0.05); break
        case 'arrowright': if (e.shiftKey) engine.fadeTo(1, mixer.fadeSeconds); else engine.setCrossfader(engine.crossfader + 0.05); break
        case 'arrowdown': engine.setCrossfader(0.5); break
        case 'm': engine.fadeTo(engine.crossfader < 0.5 ? 1 : 0, mixer.fadeSeconds); break
        case 'a': mixer.setOn(!mixer.on); break
        default: used = false
      }
      if (used) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [engine, mixer, root])
}

/** The size the console is designed for; smaller tabs scale it down to fit. */
const DESIGN_W = 1300
const DESIGN_H = 880
const ZOOM_KEY = 'aihub-dj-zoom'
const ZOOM_MIN = 0.55
const ZOOM_MAX = 1
const ZOOM_DEFAULT = 1

function savedZoom(): number {
  const v = parseFloat(readPref(ZOOM_KEY) || '')
  return v >= ZOOM_MIN && v <= ZOOM_MAX ? v : ZOOM_DEFAULT
}

/**
 * Fit the whole console into the tab instead of scrolling: lay it out at
 * (tab size ÷ scale) and zoom by `scale`, so it always fills the tab exactly.
 */
function useFitToTab(userZoom: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<React.CSSProperties>({})
  useEffect(() => {
    const host = ref.current?.parentElement
    if (!host) return
    const apply = () => {
      const w = host.clientWidth
      const h = host.clientHeight
      if (!w || !h) return
      // Fit first, then the user's own size preference on top. Below 1 the
      // console simply gets more room, so it never overflows the tab.
      const scale = Math.max(0.4, Math.min(1, w / DESIGN_W, h / DESIGN_H) * userZoom)
      setStyle({ zoom: scale, width: w / scale, height: h / scale })
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(host)
    return () => ro.disconnect()
  }, [userZoom])
  return { ref, style }
}

function TopBar({ engine, mixer, say, theme, setTheme, uiZoom, setUiZoom }: {
  engine: DjEngine; mixer: AutoMixer; say: (m: string) => void; theme: string; setTheme: (t: string) => void; uiZoom: number; setUiZoom: (z: number) => void
}) {
  useSyncExternalStore(engine.subscribe, engine.getVersion)
  useSyncExternalStore(mixer.subscribe, mixer.getVersion)
  useSyncExternalStore(subscribeTaste, tasteVersion)
  const clockRef = useRef<HTMLSpanElement>(null)
  const recRef = useRef<HTMLSpanElement>(null)
  const [recording, setRecording] = useState(false)
  const [saving, setSaving] = useState(false)
  const [menu, setMenu] = useState<'out' | 'theme' | 'settings' | null>(null)
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([])
  const toggleMenu = (m: 'out' | 'theme' | 'settings') => setMenu(cur => (cur === m ? null : m))

  useRafThrottled(() => {
    const now = new Date()
    const c = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    if (clockRef.current && clockRef.current.textContent !== c) clockRef.current.textContent = c
    if (recRef.current) {
      const secs = recording ? (performance.now() - engine.recStartedAt) / 1000 : 0
      const mm = String(Math.floor(secs / 60)).padStart(2, '0')
      const ss = String(Math.floor(secs % 60)).padStart(2, '0')
      const kb = engine.recBytes / 1024
      const s = `${mm}:${ss} / ${kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`}`
      if (recRef.current.textContent !== s) recRef.current.textContent = s
    }
  }, 200)

  const toggleRec = async () => {
    if (!recording) {
      engine.startRecording()
      setRecording(true)
      return
    }
    setRecording(false)
    setSaving(true)
    try {
      const blob = await engine.stopRecording()
      if (!blob) { say('Nothing was recorded'); return }
      const r = await djApi().saveRecording(await blob.arrayBuffer(), 'webm')
      if (r.success) say(`Mix saved to ${r.path}`)
      else if (r.error) say(r.error)
    } finally {
      setSaving(false)
    }
  }

  const openOutputs = async () => {
    toggleMenu('out')
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      setOutputs(all.filter(d => d.kind === 'audiooutput'))
    } catch { setOutputs([]) }
  }

  const pickPhones = async (id: string | null) => {
    setMenu(null)
    try {
      await engine.setPhonesDevice(id)
      say(id ? 'Headphones cue output on' : 'Headphones cue output off')
    } catch {
      say('That output device could not be opened')
    }
  }

  const setFade = (s: number) => { mixer.setFadeSeconds(s); writePref(FADE_KEY, String(s)) }
  const setAutoGain = (on: boolean) => { engine.setAutoGain(on); writePref(AUTOGAIN_KEY, on ? 'on' : 'off') }

  return (
    <div className="dj-top">
      <div className="dj-brand"><span>AIHub</span><b>DJ</b></div>
      <div className="dj-lcd dj-top-clock"><span ref={clockRef} /></div>
      <div className="dj-top-meter" title="Master level">
        <span>MASTER</span>
        <div className="dj-hmeter">
          <VuMeter read={() => engine.masterDb()[0]} segments={24} horizontal />
          <VuMeter read={() => engine.masterDb()[1]} segments={24} horizontal />
        </div>
      </div>
      <button type="button" className={`dj-top-automix ${mixer.on ? 'dj-on dj-on-green' : ''}`} onClick={() => mixer.setOn(!mixer.on)}
        title="Automix — mix through the set list and the playing YouTube queue (A)">
        AUTOMIX {mixer.on ? 'ON' : 'OFF'}
      </button>
      <div className="dj-top-spacer" />
      <div className="dj-zoomctl" title="Console size">
        <button type="button" onClick={() => setUiZoom(uiZoom - 0.05)} disabled={uiZoom <= ZOOM_MIN} aria-label="Smaller"><Minus size={11} /></button>
        <span>{Math.round(uiZoom * 100)}%</span>
        <button type="button" onClick={() => setUiZoom(uiZoom + 0.05)} disabled={uiZoom >= ZOOM_MAX} aria-label="Bigger"><Plus size={11} /></button>
      </div>
      <div className="dj-rec">
        <button type="button" className={`dj-rec-btn ${recording ? 'dj-recording' : ''}`} onClick={toggleRec} disabled={saving}
          title={recording ? 'Stop and save the recording' : 'Record your mix'}>
          {recording ? <Square size={9} fill="currentColor" /> : <Circle size={9} fill="currentColor" />} REC
        </button>
        <span className="dj-lcd dj-rec-info" ref={recRef}>00:00 / 0 KB</span>
      </div>
      <div className="dj-out">
        <button type="button" className={`dj-icon-btn dj-top-btn ${engine.phonesDevice ? 'dj-on dj-on-orange' : ''}`} onClick={openOutputs}
          title="Headphones (cue) output">
          <Headphones size={14} />
        </button>
        {menu === 'out' && (
          <div className="dj-out-menu">
            <div className="dj-out-title">Headphones cue output</div>
            <button type="button" className={!engine.phonesDevice ? 'on' : ''} onClick={() => pickPhones(null)}>Off</button>
            {outputs.filter(o => o.deviceId !== 'default' && o.deviceId !== 'communications').map((o, i) => (
              <button type="button" key={o.deviceId} className={engine.phonesDevice === o.deviceId ? 'on' : ''} onClick={() => pickPhones(o.deviceId)}>
                {o.label || `Output ${i + 1}`}
              </button>
            ))}
            <p>Pick a second sound card or headset to pre-listen with the 🎧 buttons while the crowd hears the master.</p>
          </div>
        )}
      </div>
      <div className="dj-out">
        <button type="button" className="dj-icon-btn dj-top-btn" onClick={() => toggleMenu('theme')} title="Console theme">
          <Palette size={14} />
        </button>
        {menu === 'theme' && (
          <div className="dj-out-menu dj-theme-menu">
            <div className="dj-out-title">Console theme</div>
            {DJ_THEMES.map(t => (
              <button type="button" key={t.id} className={theme === t.id ? 'on' : ''} onClick={() => { setTheme(t.id); setMenu(null) }}>
                <span className="dj-swatch" style={{ background: t.swatch }} />{t.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="dj-out">
        <button type="button" className={`dj-icon-btn dj-top-btn ${menu === 'settings' ? 'dj-on dj-on-blue' : ''}`} onClick={() => toggleMenu('settings')} title="Settings, help and keyboard shortcuts">
          <Settings2 size={14} />
        </button>
        {menu === 'settings' && (
          <div className="dj-out-menu dj-settings-menu">
            <div className="dj-out-title">Mixing</div>
            <label className="dj-set-row">
              <input type="checkbox" checked={engine.autoGain} onChange={e => setAutoGain(e.target.checked)} />
              Auto-gain — level quiet and loud songs to match
            </label>
            <div className="dj-set-row">
              <span>Automix &amp; fade length</span>
              <div className="dj-seg">
                {FADE_CHOICES.map(s => (
                  <button type="button" key={s} className={mixer.fadeSeconds === s ? 'on' : ''} onClick={() => setFade(s)}>{s}s</button>
                ))}
              </div>
            </div>
            <label className="dj-set-row">
              <input type="checkbox" checked={learningEnabled()} disabled={IS_INCOGNITO} onChange={e => setLearning(e.target.checked)} />
              {IS_INCOGNITO ? 'Taste learning is off in private windows' : 'Learn my taste for the AI DJ (stays on this computer)'}
            </label>
            <div className="dj-out-title">Keyboard</div>
            <div className="dj-keys">
              {SHORTCUTS.map(([k, what]) => <React.Fragment key={k}><kbd>{k}</kbd><span>{what}</span></React.Fragment>)}
            </div>
            <div className="dj-out-title">Tips</div>
            <ul className="dj-tips">{HELP.map(h => <li key={h}>{h}</li>)}</ul>
          </div>
        )}
      </div>
    </div>
  )
}

const SHORTCUTS: [string, string][] = [
  ['Q / P', 'Play / pause deck A / B'],
  ['W / O', 'CUE deck A / B'],
  ['1 2 3', 'Hot cues deck A (Shift clears)'],
  ['8 9 0', 'Hot cues deck B (Shift clears)'],
  ['S', 'Sync tempo between the decks'],
  ['← →', 'Nudge the crossfader'],
  ['Shift ← →', 'Fade all the way to A / B'],
  ['↓', 'Centre the crossfader'],
  ['M', 'Fade across to the other deck'],
  ['A', 'Automix on / off'],
]

const HELP = [
  'Load: drag a song onto a deck, double-click it, or use the A / B buttons.',
  'YouTube: pick YouTube under Online and search. Songs get the full mixer — EQ, effects, stems, waveform, scratching.',
  'Queue: press the list button on a YouTube result to queue it, the heart for Favorites, then Play list in the QUEUE tab.',
  'Mix now (⇄): blends a song in over the fade length while the other deck keeps playing.',
  'Scratch: hold the record and move it — it plays at the speed and direction of your hand. Let go and it spins back up.',
  'Rim: drag the outer edge while playing to nudge the tempo when beat-matching by ear.',
  'AI DJ: "Let the AI take over" plays a set built from what you play, finish, skip and like (👍 / 👎 on each deck).',
  'Video: switch the mixer to VIDEO to watch YouTube and music videos, blended by the crossfader.',
  'Faders and knobs: drag, scroll or Shift-drag for fine control; double-click to reset.',
]
