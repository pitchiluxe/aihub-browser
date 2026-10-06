/**
 * AIHub DJ — a two-deck DJ console inside the browser.
 *
 * The page owns the audio engine for as long as its tab is open, so music
 * keeps playing while the user browses in other tabs.
 */
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Circle, Headphones, Minus, Palette, Plus, Settings2, Square } from 'lucide-react'
import { DjEngine, type DeckId, type DjTrack } from './engine/DjEngine'
import { DeckClock, DeckInfo, DeckPads, Turntable } from './DeckUI'
import { ZoomWave } from './Waveforms'
import Mixer from './Mixer'
import Library from './Library'
import { djApi, trackByToken, toTrack, loadMeta } from './libraryData'
import { useRaf, VuMeter } from './controls'
import './dj.css'

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

function savedTheme(): string {
  try {
    const t = localStorage.getItem(THEME_KEY)
    return DJ_THEMES.some(x => x.id === t) ? (t as string) : 'silver'
  } catch { return 'silver' }
}

/** Automix: start the next song this many seconds before the end, fade over this long. */
const AUTOMIX_LEAD = 12
const AUTOMIX_FADE = 10

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
  const [automix, setAutomix] = useState(false)
  const [theme, setThemeState] = useState(savedTheme)
  const [uiZoom, setUiZoomState] = useState(savedZoom)
  const setUiZoom = (z: number) => {
    const v = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 100) / 100
    setUiZoomState(v)
    try { localStorage.setItem(ZOOM_KEY, String(v)) } catch { /* optional */ }
  }
  const fit = useFitToTab(uiZoom)
  const setTheme = (t: string) => {
    setThemeState(t)
    try { localStorage.setItem(THEME_KEY, t) } catch { /* optional */ }
  }

  const say = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(t => (t === msg ? null : t)), 2600)
  }, [])

  const load = useCallback((track: DjTrack, id?: DeckId) => {
    const deck = id ? engine.decks[id] : !A.playing ? A : !B.playing ? B : null
    if (!deck) { say('Both decks are playing — stop one first'); return }
    if (deck.playing) { say(`Deck ${deck.id} is playing — stop it before loading`); return }
    void deck.load(track)
  }, [engine, A, B, say])

  const dropOn = (id: DeckId) => async (src: string | File) => {
    if (typeof src === 'string') {
      const t = trackByToken(src)
      if (t) load(t, id)
      return
    }
    // A file dragged in from the desktop / Explorer.
    const path = djApi().pathForFile(src)
    const raw = path ? await djApi().registerFile(path).catch(() => null) : null
    if (!raw) { say('Only audio files can be dropped on a deck (mp3, wav, flac, m4a, ogg…)'); return }
    load(toTrack(raw, await loadMeta(raw)), id)
  }

  // ── Automix: beat-matched crossfades through the sidelist ──
  const mixing = useRef<{ from: DeckId; start: number } | null>(null)
  useEffect(() => {
    if (!automix) { mixing.current = null; return }
    const next = (): DjTrack | undefined => {
      const [t, ...rest] = sideRef.current
      if (t) setSidelist(() => rest)
      return t
    }
    const timer = window.setInterval(() => {
      const m = mixing.current
      if (m) {
        const p = Math.min(1, (performance.now() - m.start) / (AUTOMIX_FADE * 1000))
        engine.setCrossfader(m.from === 'A' ? p : 1 - p)
        if (p >= 1) {
          engine.decks[m.from].pause()
          mixing.current = null
        }
        return
      }
      const playing = A.playing ? A : B.playing ? B : null
      if (!playing) {
        if (A.track && !A.playing && A.time < 1) { engine.setCrossfader(0); void A.play(); return }
        const t = next()
        if (t) { void A.load(t).then(() => { engine.setCrossfader(0); void A.play() }) }
        else { setAutomix(false); say('Automix finished — the sidelist is empty') }
        return
      }
      const other = playing === A ? B : A
      const left = playing.duration - playing.time
      if (!playing.duration) return
      // Cue the next song well ahead so it is analysed by the time we need it.
      if (left < AUTOMIX_LEAD + 25 && !other.playing && (!other.track || other.time > 1)) {
        const t = next()
        if (t) void other.load(t)
        else if (!other.track) return
      }
      if (left < AUTOMIX_LEAD && other.track && !other.playing && other.duration) {
        other.sync(playing)
        other.seek(Math.max(0, other.firstBeat))
        void other.play()
        mixing.current = { from: playing.id, start: performance.now() }
      }
    }, 150)
    return () => window.clearInterval(timer)
  }, [automix, engine, A, B, setSidelist, say])

  return (
    <div className="aihub-dj" data-dj-theme={theme} ref={fit.ref} style={fit.style}>
      <TopBar engine={engine} say={say} theme={theme} setTheme={setTheme} uiZoom={uiZoom} setUiZoom={setUiZoom} />

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
        <Mixer engine={engine} />
        <Turntable deck={B} other={A} onDropTrack={dropOn('B')} />
        <DeckPads deck={B} onDropTrack={dropOn('B')} />
      </div>

      <Library onLoad={load} sidelist={sidelist} setSidelist={setSidelist} automix={automix} setAutomix={setAutomix} />

      {toast && <div className="dj-toast">{toast}</div>}
    </div>
  )
}

/** The size the console is designed for; smaller tabs scale it down to fit. */
const DESIGN_W = 1300
const DESIGN_H = 880
const ZOOM_KEY = 'aihub-dj-zoom'
const ZOOM_MIN = 0.55
const ZOOM_MAX = 1
const ZOOM_DEFAULT = 1

function savedZoom(): number {
  try {
    const v = parseFloat(localStorage.getItem(ZOOM_KEY) || '')
    return v >= ZOOM_MIN && v <= ZOOM_MAX ? v : ZOOM_DEFAULT
  } catch { return ZOOM_DEFAULT }
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

function TopBar({ engine, say, theme, setTheme, uiZoom, setUiZoom }: {
  engine: DjEngine; say: (m: string) => void; theme: string; setTheme: (t: string) => void; uiZoom: number; setUiZoom: (z: number) => void
}) {
  useSyncExternalStore(engine.subscribe, engine.getVersion)
  const clockRef = useRef<HTMLSpanElement>(null)
  const recRef = useRef<HTMLSpanElement>(null)
  const [recording, setRecording] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showOut, setShowOut] = useState(false)
  const [showThemes, setShowThemes] = useState(false)
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([])

  useRaf(() => {
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
  })

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
    setShowOut(s => !s)
    setShowThemes(false)
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      setOutputs(all.filter(d => d.kind === 'audiooutput'))
    } catch { setOutputs([]) }
  }

  const pickPhones = async (id: string | null) => {
    setShowOut(false)
    try {
      await engine.setPhonesDevice(id)
      say(id ? 'Headphones cue output on' : 'Headphones cue output off')
    } catch {
      say('That output device could not be opened')
    }
  }

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
        {showOut && (
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
        <button type="button" className="dj-icon-btn dj-top-btn" onClick={() => { setShowThemes(s => !s); setShowOut(false) }} title="Console theme">
          <Palette size={14} />
        </button>
        {showThemes && (
          <div className="dj-out-menu dj-theme-menu">
            <div className="dj-out-title">Console theme</div>
            {DJ_THEMES.map(t => (
              <button type="button" key={t.id} className={theme === t.id ? 'on' : ''} onClick={() => { setTheme(t.id); setShowThemes(false) }}>
                <span className="dj-swatch" style={{ background: t.swatch }} />{t.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="dj-help" title={HELP}><Settings2 size={14} /></div>
    </div>
  )
}

const HELP = [
  'Load: drag a song onto a deck, double-click it, or use the A / B buttons.',
  'YouTube: pick YouTube under Online in the browser and search; drag a result onto a deck.',
  'AI DJ: open the AI DJ tab, describe a vibe, and press AI DJ — your local model picks the set and Automix mixes it.',
  'Platter: hold the record to stop and scrub; drag the rim while playing to nudge tempo.',
  'CUE: set a cue while stopped, jump back to it while playing.',
  'Hot cues: click an empty pad to set, click to jump, right-click to clear.',
  'Faders and knobs: drag, scroll or Shift-drag for fine control; double-click to reset.',
].join('\n')
