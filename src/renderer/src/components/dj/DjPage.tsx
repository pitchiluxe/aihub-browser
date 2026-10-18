/**
 * AIHub DJ — a two-deck DJ console inside the browser.
 *
 * The page owns the audio engine for as long as its tab is open, so music
 * keeps playing while the user browses in other tabs.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Circle, Clipboard, Headphones, Minus, Palette, Plus, Settings2, Square } from 'lucide-react'
import { DjEngine, type DeckId, type DjTrack } from './engine/DjEngine'
import { AutoMixer } from './engine/autoMixer'
import { DeckClock, DeckInfo, DeckPads, Turntable } from './DeckUI'
import { ZoomWave } from './Waveforms'
import Mixer from './Mixer'
import Library from './Library'
import VideoMonitor from './VideoMonitor'
import { ListeningTracker } from './listeningTracker'
import PartyView from './PartyView'
import { takeNext } from './ytQueue'
import { learningEnabled, setLearning, subscribeTaste, tasteVersion } from './taste'
import { DjEnvContext, type DjEnv } from './djActions'
import { announce, setVoiceEnabled, subscribeVoice, voiceEnabled } from './djVoice'
import { getEnergy, introLine } from './djBrain'
import { SetLog } from './setLog'
import { CpuMeter, NowPlaying, SamplerBank, SandboxBar, ScopeButton } from './TopWidgets'
import { IS_INCOGNITO } from '../../services/incognitoMode'
import { djApi, trackByToken, toTrack, loadMeta } from './libraryData'
import { HFader, useRafThrottled, VuMeter } from './controls'
import StagePage from './stage/StagePage'
import { askDj } from './stage/askPipeline'
import { SetConductor } from './ai/setConductor'
import { parseBrief } from './ai/setBrief'
import { AnalysisQueue } from './engine/analysisQueue'
import { liveSide, loadTarget } from './ai/deckChoice'
import { searchQueryFor } from './ai/instructions'
import { aiFinds } from './aiFinds'
import type { PickHow, StageResults } from './stage/SearchResults'
import { createFactSource } from './engine/factScan'
import { factsCache } from './ai/trackFacts'
import { buildProfile, tasteEvents } from './taste'
import { queueStore, FAVORITES_ID, trackFrom } from './ytQueue'
import { searchYouTube } from './libraryData'
import { isSong } from './ai/candidatePool'
import { runIntent, type PanelControls } from './djActions'
import { setEnergy } from './djBrain'
import './dj.css'
import './dj-pro.css'
import './dj-themes.css'
import './dj-layouts.css'
import './dj-real.css'
import './dj-skins.css'
import './dj-skins-pro.css'
import './dj-skins-real.css'
import './dj-designs.css'
import './dj-reference-skins.css'
import './dj-rigs.css'
import './dj-palettes.css'
import { DesignContext, partsFor } from './designs'
import { RIGS, RigContext, rigFor } from './rigs'
import { withDeckCover } from './coverLookup'

export interface DjTheme { id: string; name: string; swatch: string; dark?: boolean; lightBg?: boolean }
export const DJ_THEMES: DjTheme[] = [
  { id: 'original', name: 'Skin original', swatch: 'linear-gradient(90deg, #cfd2d6 0 50%, #25272b 50%)' },
  { id: 'silver', name: 'Silver', swatch: 'linear-gradient(#eceef0, #c2c6cb)' },
  { id: 'midnight', name: 'Midnight', swatch: 'linear-gradient(#3a3d44, #202227)', dark: true },
  { id: 'neon', name: 'Neon Club', swatch: 'linear-gradient(135deg, #c026d3, #22d3ee)', dark: true },
  { id: 'gold', name: 'Gold', swatch: 'linear-gradient(#f7e7b4, #b8964a)' },
  { id: 'ocean', name: 'Ocean', swatch: 'linear-gradient(#cfe3f5, #7aa3c9)' },
  { id: 'ruby', name: 'Ruby', swatch: 'linear-gradient(#8f1d2c, #4f0c17)', dark: true },
  { id: 'forest', name: 'Forest', swatch: 'linear-gradient(#4b5d48, #2b382a)', dark: true },
  { id: 'arctic', name: 'Arctic', swatch: 'linear-gradient(#ffffff, #e3e8ef)', lightBg: true },
  { id: 'carbon', name: 'Carbon', swatch: 'repeating-linear-gradient(45deg, #1b1c1f 0 3px, #2c2e33 3px 6px)', dark: true },
  { id: 'sunset', name: 'Sunset', swatch: 'linear-gradient(135deg, #f97316, #7e22ce)', dark: true },
  { id: 'rosegold', name: 'Rose Gold', swatch: 'linear-gradient(#f8e4db, #d4a18c)' },
  { id: 'matrix', name: 'Matrix', swatch: 'linear-gradient(#052e16, #000)', dark: true },
  { id: 'vapor', name: 'Vaporwave', swatch: 'linear-gradient(135deg, #ffd6f2, #c7f0ff)' },
  { id: 'walnut', name: 'Walnut', swatch: 'repeating-linear-gradient(92deg, #6e4428 0 5px, #5c381f 5px 8px)', dark: true },
  { id: 'pearl', name: 'Pearl', swatch: 'linear-gradient(135deg, #ffffff, #e8e3f0)', lightBg: true },
  { id: 'royal', name: 'Royal', swatch: 'linear-gradient(#23306a, #c9a227)', dark: true },
  { id: 'lava', name: 'Lava', swatch: 'linear-gradient(#2a110a, #ea580c)', dark: true },
  { id: 'mint', name: 'Mint', swatch: 'linear-gradient(#ecfcf5, #a6dfc9)' },
  { id: 'clubblack', name: 'Club Black', swatch: 'linear-gradient(#34363b, #121315)', dark: true },
  { id: 'graphite', name: 'Graphite', swatch: 'linear-gradient(#8a8f97, #565b63)', dark: true },
  { id: 'champagne', name: 'Champagne', swatch: 'linear-gradient(#efe3c8, #bfa774)' },
  { id: 'bakelite', name: 'Bakelite', swatch: 'linear-gradient(#e8dcc2, #bba97f)' },
  { id: 'chrome', name: 'Chrome', swatch: 'linear-gradient(#ffffff, #a9afb8 55%, #eef0f3)' },
  { id: 'gunmetal', name: 'Gunmetal', swatch: 'linear-gradient(#5b6572, #303741)', dark: true },
  { id: 'redline', name: 'Redline', swatch: 'linear-gradient(#5a1a1f, #1a0507)', dark: true },
  { id: 'pianowhite', name: 'Piano White', swatch: 'linear-gradient(#ffffff, #dfe3e8)', lightBg: true },
  { id: 'rosewood', name: 'Rosewood', swatch: 'repeating-linear-gradient(92deg, #5a2a1c 0 3px, #6a3322 3px 7px)', dark: true },
  { id: 'titanium', name: 'Titanium', swatch: 'linear-gradient(#c4c7cc, #868a92)' },
  { id: 'midnightblue', name: 'Navy', swatch: 'linear-gradient(#1f3a63, #0f1f38)', dark: true },
  { id: 'emeraldglass', name: 'Emerald', swatch: 'linear-gradient(#14543f, #082a20)', dark: true },
  { id: 'copper', name: 'Copper', swatch: 'linear-gradient(#e8b090, #8f4e30)' },
  { id: 'stealth', name: 'Stealth', swatch: 'linear-gradient(#17181b, #000)', dark: true },
  { id: 'sand', name: 'Sand', swatch: 'linear-gradient(#e9dfcf, #bfae90)' },
  { id: 'violetnight', name: 'Violet Night', swatch: 'linear-gradient(#3b2a5e, #1b122f)', dark: true },
]

/** Looks restyle the hardware itself; any look goes with any colour theme. */
export const DJ_LOOKS: { id: string; name: string; preview: string }[] = [
  { id: 'studio', name: 'Studio', preview: 'linear-gradient(90deg, #6e4428 0 14%, #cfd2d6 14% 86%, #6e4428 86%)' },
  { id: 'classic', name: 'Classic', preview: 'linear-gradient(180deg, #f3f4f6, #b9bec5)' },
  { id: 'flat', name: 'Flat', preview: 'linear-gradient(#d1d5db, #d1d5db)' },
  { id: 'club', name: 'Club', preview: 'linear-gradient(#111, #111) padding-box, linear-gradient(90deg, #22d3ee, #c026d3) border-box' },
  { id: 'retro', name: 'Retro', preview: 'linear-gradient(90deg, #6e4428 0 18%, #e7d6b7 18% 82%, #6e4428 82%)' },
  { id: 'glass', name: 'Glass', preview: 'linear-gradient(135deg, rgba(255,255,255,0.75), rgba(148,163,184,0.35))' },
  // DJ-software and hardware skins (dj-skins.css).
  { id: 'pro-dark', name: 'Pro Dark', preview: 'linear-gradient(90deg, #2f9bff 0 10%, #16181b 10% 90%, #ff7a1a 90%)' },
  { id: 'carbon', name: 'Carbon', preview: 'repeating-linear-gradient(45deg, #1b1c1f 0 4px, #26272b 4px 8px)' },
  { id: 'cdj', name: 'CDJ', preview: 'radial-gradient(circle, #2b2d30 40%, #3ea6ff 42% 50%, #26282b 52%)' },
  { id: 'neon-night', name: 'Neon Night', preview: 'linear-gradient(#07070d, #07070d) padding-box, linear-gradient(90deg, #22d3ee, #e879f9) border-box' },
  { id: 'gold-elite', name: 'Gold Elite', preview: 'linear-gradient(#0f0e0c, #0f0e0c) padding-box, linear-gradient(135deg, #8a6a2b, #e6c66e, #b8913f) border-box' },
  { id: 'daylight', name: 'Daylight Pro', preview: 'linear-gradient(90deg, #2563eb 0 10%, #f1f2f4 10% 90%, #ea580c 90%)' },
  // More professional looks (dj-skins-pro.css).
  { id: 'midnight-blue', name: 'Midnight Blue', preview: 'linear-gradient(90deg, #22d3ee 0 10%, #0d1427 10% 90%, #a78bfa 90%)' },
  { id: 'studio-black', name: 'Studio Black', preview: 'linear-gradient(90deg, #f43f5e 0 8%, #000 8% 92%, #fbbf24 92%)' },
  { id: 'graphite', name: 'Graphite', preview: 'repeating-linear-gradient(90deg, #3b3f45 0 2px, #2d3136 2px 4px)' },
  { id: 'crimson-rack', name: 'Crimson Rack', preview: 'linear-gradient(#110809, #110809) padding-box, linear-gradient(90deg, #ef4444, #fb923c) border-box' },
  { id: 'emerald', name: 'Emerald', preview: 'linear-gradient(#0a1d15, #0a1d15) padding-box, linear-gradient(135deg, #34d399, #e6c66e) border-box' },
  { id: 'arctic', name: 'Arctic', preview: 'linear-gradient(90deg, #0ea5e9 0 10%, #f7fbff 10% 90%, #6366f1 90%)' },
  // Hardware replicas: each rebuilds the deck, record and mixer of one rig (rigs.ts, dj-rigs.css).
  { id: 'silver-wave', name: 'Technics Silver', preview: 'radial-gradient(circle at 26% 50%, #1b3a66 0 7%, #c9cfd7 8% 22%, transparent 23%), radial-gradient(circle at 74% 50%, #1b3a66 0 7%, #c9cfd7 8% 22%, transparent 23%), linear-gradient(90deg, #e8ebef 0 42%, #9ca3ad 42% 58%, #e8ebef 58%)' },
  { id: 'silver-classic', name: 'Technics Silver 4', preview: 'radial-gradient(circle at 26% 50%, #1b3a66 0 7%, #bfc5cd 8% 22%, transparent 23%), radial-gradient(circle at 74% 50%, #1b3a66 0 7%, #bfc5cd 8% 22%, transparent 23%), repeating-linear-gradient(90deg, #d4d8de 0 6px, #8c939e 6px 8px)' },
  { id: 'classic-1200', name: 'Classic 1200', preview: 'radial-gradient(circle at 26% 50%, #2ea44f 0 7%, #111 8% 22%, transparent 23%), radial-gradient(circle at 74% 50%, #d61f26 0 7%, #111 8% 22%, transparent 23%), linear-gradient(90deg, #a7abb1 0 42%, #1c1d20 42% 58%, #a7abb1 58%)' },
  { id: 'battle-art', name: 'Battle Artwork', preview: 'radial-gradient(circle at 26% 50%, #e51b23 0 6%, #7a5b8c 7% 22%, transparent 23%), radial-gradient(circle at 74% 50%, #e51b23 0 6%, #8c6b5b 7% 22%, transparent 23%), linear-gradient(90deg, #383a3b 0 42%, #1a1b1d 42% 58%, #383a3b 58%)' },
  { id: 'battle-black', name: 'Battle Black', preview: 'radial-gradient(circle at 26% 50%, #e51b23 0 8%, #0b0b0c 9% 22%, transparent 23%), radial-gradient(circle at 74% 50%, #e51b23 0 8%, #0b0b0c 9% 22%, transparent 23%), linear-gradient(90deg, #2a2b2d 0 42%, #111214 42% 58%, #2a2b2d 58%)' },
  { id: 'ember-vinyl', name: 'Ember Vinyl', preview: 'radial-gradient(circle at 26% 50%, #15171b 0 6%, #e94208 7% 22%, transparent 23%), radial-gradient(circle at 74% 50%, #15171b 0 6%, #e94208 7% 22%, transparent 23%), linear-gradient(90deg, #26272a 0 42%, #090a0c 42% 58%, #26272a 58%)' },
  // Material skins — real finishes (dj-skins-real.css).
  { id: 'walnut-hifi', name: 'Walnut Hi-Fi', preview: 'linear-gradient(90deg, #5a3218 0 16%, #d9d5cc 16% 84%, #5a3218 84%)' },
  { id: 'rose-gold', name: 'Rose Gold', preview: 'linear-gradient(135deg, #f6d6c8, #c98e7a)' },
  { id: 'porcelain', name: 'Porcelain', preview: 'linear-gradient(180deg, #ffffff 0 45%, #e6e8ec)' },
  { id: 'field-olive', name: 'Field Olive', preview: 'linear-gradient(90deg, #f97316 0 8%, #55603a 8%)' },
  { id: 'tube-amp', name: 'Tube Amp', preview: 'radial-gradient(circle at 50% 120%, #fb923c, #1d1c1a 60%)' },
  { id: 'concrete', name: 'Concrete Loft', preview: 'linear-gradient(90deg, #facc15 0 8%, #9a9a95 8%)' },
  { id: 'titanium', name: 'Titanium', preview: 'linear-gradient(90deg, #22d3ee 0 8%, #80858c 8% 92%, #a3e635 92%)' },
  { id: 'mahogany', name: 'Mahogany Console', preview: 'repeating-linear-gradient(91deg, #4a1b12 0 3px, #5a2219 3px 7px)' },
  { id: 'ocean', name: 'Ocean Anodized', preview: 'linear-gradient(90deg, #2dd4bf 0 8%, #0e4c55 8% 92%, #fb7185 92%)' },
  { id: 'obsidian', name: 'Obsidian Glass', preview: 'linear-gradient(115deg, #0a0b0d 0 40%, #2a2b30 44%, #0a0b0d 48%)' },
]
const REFERENCE_LOOKS = new Set(Object.keys(RIGS))
const LOOK_KEY = 'aihub-dj-look'

/** Layouts arrange the console for a way of working; any layout goes with any look and colour. */
export const DJ_LAYOUTS: { id: string; name: string; hint: string }[] = [
  { id: 'classic', name: 'Classic', hint: 'Everything on screen: decks, pads, mixer and library' },
  { id: 'pro', name: 'Pro', hint: 'Tall scrolling waveforms for beat-matching by eye, compact decks' },
  { id: 'essentials', name: 'Essentials', hint: 'Just the decks, mixer and library — big platters, nothing in the way' },
  { id: 'controller', name: 'Controller', hint: 'Performance pads under each platter, like a hardware controller' },
  { id: 'video', name: 'Video DJ', hint: 'The video monitor in the middle, large' },
  { id: 'party', name: 'Party', hint: 'A big now-playing screen with one-tap mixing — made for Automix and the AI DJ' },
  { id: '4deck', name: '4-Deck', hint: 'Four decks around a four-channel mixer — C plays with A on the left, D with B on the right' },
]
const LAYOUT_KEY = 'aihub-dj-layout'
const THEME_KEY = 'aihub-dj-theme'
const VIEW_KEY = 'aihub-dj-mixer-view'
/** Console (default) or the AI DJ stage, opened from the console. */
const STAGE_VIEW_KEY = 'aihub-dj-view'
const FADE_KEY = 'aihub-dj-fade-seconds'
const AUTOGAIN_KEY = 'aihub-dj-autogain'
const PROFX_KEY = 'aihub-dj-pro-transitions'
const FADE_CHOICES = [4, 6, 8, 10, 16]

function readPref(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function writePref(key: string, v: string): void {
  try { localStorage.setItem(key, v) } catch { /* optional */ }
}

function savedTheme(): string {
  const t = readPref(THEME_KEY)
  return DJ_THEMES.some(x => x.id === t) ? (t as string) : 'original'
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
  const { A, B, C, D } = engine.decks
  const [toast, setToast] = useState<string | null>(null)
  const [sidelist, setSidelistState] = useState<DjTrack[]>([])
  const sideRef = useRef<DjTrack[]>([])
  const setSidelist = useCallback((fn: (s: DjTrack[]) => DjTrack[]) => {
    setSidelistState(s => { const n = fn(s); sideRef.current = n; return n })
  }, [])
  const [theme, setThemeState] = useState(savedTheme)
  const [look, setLookState] = useState(() => { const l = readPref(LOOK_KEY); return DJ_LOOKS.some(x => x.id === l) ? (l as string) : 'studio' })
  const [layout, setLayoutState] = useState(() => { const l = readPref(LAYOUT_KEY); return DJ_LAYOUTS.some(x => x.id === l) ? (l as string) : 'classic' })
  const setLayout = (l: string) => { setLayoutState(l); writePref(LAYOUT_KEY, l) }
  // Essentials and Video DJ leave out the stems / effects / loop panels.
  const showPads = layout !== 'essentials' && layout !== 'video'
  const setLook = (l: string) => {
    setLookState(l); writePref(LOOK_KEY, l)
    if (REFERENCE_LOOKS.has(l)) setMixerView('mixer')
  }
  const themeInfo = DJ_THEMES.find(t => t.id === theme)
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
  const conductorRef = useRef<SetConductor | null>(null)
  const mixer = useMemo(() => {
    const m = new AutoMixer(engine, {
      // The AI set owns the queue while it runs; otherwise the set list
      // first, then the YouTube queue when a list is playing.
      next: () => {
        const c = conductorRef.current
        if (c?.state.active && !c.state.paused) {
          const t = c.next()
          // Songs the AI set plays are in the library too (Online → AI DJ finds).
          if (t?.youtubeId) aiFinds.add([t], c.state.brief?.vibe || 'AI DJ set')
          return t
        }
        const [t, ...rest] = sideRef.current
        if (t) { setSidelist(() => rest); return t }
        const queued = takeNext()
        if (queued) return queued
        // A set paused only because the DJ is looking at the decks keeps the
        // music going when they have not lined anything up themselves.
        if (c?.state.active) {
          const s = c.next()
          if (s?.youtubeId) aiFinds.add([s], c.state.brief?.vibe || 'AI DJ set')
          return s
        }
        return undefined
      },
      loaded: (deck, auto) => tracker.noteLoad(deck, auto),
      say,
      mixing: t => announce(engine, introLine(t.artist, t.title, getEnergy())),
    })
    const saved = parseFloat(readPref(FADE_KEY) || '')
    if (saved >= 2 && saved <= 30) m.setFadeSeconds(saved)
    m.setProTransitions(readPref(PROFX_KEY) !== 'off')
    return m
  }, [engine, tracker, setSidelist, say])
  useEffect(() => () => mixer.dispose(), [mixer])
  const setLog = useMemo(() => new SetLog(engine), [engine])
  useEffect(() => () => setLog.dispose(), [setLog])
  useSyncExternalStore(mixer.subscribe, mixer.getVersion)
  const automix = mixer.on
  const setAutomix = useCallback((on: boolean) => mixer.setOn(on), [mixer])
  useEffect(() => {
    if (readPref(AUTOGAIN_KEY) === 'off') engine.setAutoGain(false)
  }, [engine])

  const load = useCallback((track: DjTrack, id?: DeckId) => {
    // No deck named: the first free one (C and D too in the 4-Deck layout).
    const pool = layout === '4deck' ? [A, B, C, D] : [A, B]
    const deck = id ? engine.decks[id] : pool.find(d => !d.active && !d.held) ?? null
    if (!deck) { say('Both decks are playing — stop one first'); return }
    if (deck.active || deck.held) { say(`Deck ${deck.id} is playing — stop it before loading`); return }
    tracker.noteLoad(deck.id, false)
    // With the cover the library shows for it (looked up or folder art), so
    // what was dragged is what appears on the deck.
    void withDeckCover(track).then(t => deck.load(t))
  }, [engine, A, B, C, D, say, tracker, layout])

  const mixNow = useCallback((track: DjTrack) => { void mixer.mixNow(track) }, [mixer])

  // A specific track on a named deck (a picked search result, or loadDeck above).
  const loadTrackOnDeck = useCallback(async (t: DjTrack, deckId: 'A' | 'B', play: boolean) => {
    const isBusy = (id: 'A' | 'B') => engine.decks[id].active || engine.decks[id].held
    // A busy deck is never cut off mid-song (see loadTarget).
    const target = loadTarget(deckId, play, { A: isBusy('A'), B: isBusy('B') })
    if ('busy' in target) { say(`Both decks are playing — say "play ${t.title} next" to queue it`); return }
    if ('mixin' in target) { say(`Deck ${deckId} is playing — mixing ${t.title} in instead`); void mixer.mixNow(t); return }
    if (target.moved) say(`Deck ${deckId} is playing — loading ${t.title} on deck ${target.deck}`)
    deckId = target.deck
    const deck = engine.decks[deckId]
    tracker.noteLoad(deckId, false)
    await deck.load(t)
    if (deck.error) { say(`Couldn't load ${t.title}: ${deck.error}`); return }
    if (play) {
      const other = engine.decks[deckId === 'A' ? 'B' : 'A']
      if (!other.playing) engine.setCrossfader(deckId === 'A' ? 0 : 1)
      await deck.play()
    }
  }, [engine, mixer, say, tracker])

  // "load X on deck A" / "play X on deck B": a real song on the named deck.
  const loadDeck = useCallback(async (query: string, deckId: 'A' | 'B', play: boolean) => {
    const t = (await searchYouTube(query, 8).catch(() => [] as DjTrack[])).find(isSong)
    if (!t) { say(`Could not find "${query}" on YouTube`); return }
    await loadTrackOnDeck(t, deckId, play)
  }, [say, loadTrackOnDeck])

  // What the AI DJ assistant may reach — the same calls the buttons make.
  const env = useMemo<DjEnv>(() => ({
    engine, mixer, mixNow, say,
    loadDeck: (q, d, p) => { void loadDeck(q, d, p) },
    conductor: () => conductorRef.current,
    playNext: ts => setSidelist(s => [...ts, ...s]),
    pullNext: () => {
      const [t, ...rest] = sideRef.current
      if (t) { setSidelist(() => rest); return t }
      return takeNext()
    },
  }), [engine, mixer, mixNow, say, setSidelist, loadDeck])

  // ── AI DJ: conductor + stage (the default view) ──
  const [stageView, setStageView] = useState<'stage' | 'console'>(() => readPref(STAGE_VIEW_KEY) === 'stage' ? 'stage' : 'console')
  const showView = useCallback((v: 'stage' | 'console') => {
    setStageView(v); writePref(STAGE_VIEW_KEY, v)
  }, [])
  const analysis = useMemo(() => new AnalysisQueue(createFactSource(engine.ctx), factsCache, { isBusy: () => mixer.busy }), [engine, mixer])
  useEffect(() => () => analysis.dispose(), [analysis])
  const conductor = useMemo(() => new SetConductor({
    pool: {
      profile: () => buildProfile([...tasteEvents()]),
      favorites: () => (queueStore.get().lists.find(l => l.id === FAVORITES_ID)?.items ?? []).map(trackFrom),
      search: (q, n) => searchYouTube(q, n).catch(() => []),
    },
    analysis: { ensure: t => analysis.ensure(t), known: t => analysis.known(t) },
    nowPlaying: () => {
      const side = liveSide({ A: A.playing, B: B.playing }, engine.crossfader)
      const live = side === 'A' ? A : side === 'B' ? B : null
      return live?.track ? { track: live.track, facts: analysis.known(live.track) } : null
    },
    startMixer: () => mixer.setOn(true),
    mixNow: t => { void mixer.mixNow(t) },
  }), [analysis, mixer, engine, A, B])
  conductorRef.current = conductor
  // The console is the DJ's: planning waits while it is on screen.
  useEffect(() => { conductor.setPaused(stageView === 'console') }, [conductor, stageView])
  // Automix switches itself off when `next()` is empty; a running set re-arms it.
  useEffect(() => mixer.subscribe(() => {
    if (!mixer.on && conductor.state.active && !conductor.state.paused) mixer.setOn(true)
  }), [mixer, conductor])
  // Opt-in handle for the end-to-end script (scripts/test-ai-dj-e2e.cjs); off for everyone else.
  useEffect(() => {
    try { if (localStorage.getItem('aihub-dj-debug') === '1') (window as any).__aihubDj = { conductor, mixer, engine } } catch { /* storage blocked */ }
  }, [conductor, mixer, engine])
  // Stop from the stage: end the set FIRST (so the re-arm above cannot restart
  // Automix), then switch Automix off and pause every deck.
  const stopMusic = useCallback(() => {
    conductor.stop()
    mixer.setOn(false)
    for (const d of Object.values(engine.decks)) d.pause()
  }, [conductor, mixer, engine])
  const stageControls = useMemo<PanelControls>(() => ({
    setEnergy: e => { setEnergy(e); conductor.steer(e === 'chill' ? 'calmer' : 'more-energy') },
    setTakeover: on => { if (!on) conductor.stop() },
    planVibe: text => { void conductor.start(parseBrief(text)) },
  }), [conductor])
  // "Wizkid" typed on the stage: their songs, to play now, next or on a deck.
  const [stageResults, setStageResults] = useState<StageResults | null>(null)
  // The last list stays available: "🎵 Songs" pulls it back up to switch songs.
  const lastResults = useRef<StageResults | null>(null)
  useEffect(() => { if (stageResults && !stageResults.loading) lastResults.current = stageResults }, [stageResults])
  const toggleSongs = useCallback(() => {
    setStageResults(open => open ? null : (lastResults.current ?? { query: '', tracks: [], loading: false }))
  }, [])
  const searchSeq = useRef(0)
  const searchSongs = useCallback(async (query: string) => {
    const seq = ++searchSeq.current
    setStageResults({ query, tracks: [], loading: true })
    const found = await searchYouTube(searchQueryFor(query), 24).catch(() => [] as DjTrack[])
    if (seq !== searchSeq.current) return   // a newer search won
    const songs = found.filter(isSong).slice(0, 15)
    aiFinds.add(songs, query)   // also in the library: Online → AI DJ finds
    setStageResults({ query, tracks: songs, loading: false })
  }, [])
  const pickResult = useCallback((t: DjTrack, how: PickHow) => {
    if (how === 'now') {
      say(`Mixing in ${t.title}`); void mixer.mixNow(t)
      // Played from the start screen: the song opens a set in its vein. Without
      // one the stage stayed on "What's the vibe?" with music playing and no
      // controls, and the music stopped when the song ended.
      if (!conductor.state.active && t.artist) {
        void conductor.start(parseBrief(t.artist))
        conductor.noteStarted(t)
        setStageResults(null)
      }
      return
    }
    if (how === 'next') {
      if (conductor.state.active && !conductor.state.paused) conductor.queueTrack(t)
      else { setSidelist(s => [t, ...s]); say(`${t.title} plays next`) }
      return
    }
    void loadTrackOnDeck(t, how, false)
  }, [conductor, mixer, say, setSidelist, loadTrackOnDeck])
  const ask = useCallback((text: string) => {
    void askDj(text, {
      conductor: conductor.state.active ? conductor : null,
      startSet: brief => conductor.start(parseBrief(brief)),
      activeConductor: () => conductor.state.active ? conductor : null,
      runAction: a => { void runIntent(a, env, stageControls).then(r => { if (r) say(r) }) },
      loadDeck: (q, d, p) => { void loadDeck(q, d, p) },
      chat: (m: any[]) => (window as any).electronAPI?.ai?.chat(m),
      say,
      search: q => { void searchSongs(q) },
    })
  }, [conductor, env, stageControls, say, loadDeck, searchSongs])

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
    <DjEnvContext.Provider value={env}>
    <DesignContext.Provider value={partsFor(look)}>
    <RigContext.Provider value={rigFor(look)}>
    {/* The stage sits beside the console, not inside it: the console is
        CSS-zoomed to fit the tab and the stage must not be scaled with it. */}
    <div className="dj-host">
    {stageView === 'stage' && <StagePage engine={engine} conductor={conductor} onTakeDecks={() => showView('console')} onStop={stopMusic} onAsk={ask}
      results={stageResults} onPick={pickResult} onCloseResults={() => setStageResults(null)} onToggleSongs={toggleSongs}
      onSearch={q => { void searchSongs(q) }} />}
    {stageView === 'console' && <button className="dj-back-to-stage" onClick={() => showView('stage')}>{conductor.state.active ? 'Back to stage' : '✨ AI DJ stage'}</button>}
    {/* Not rendered while the stage covers it: its turntables, waveforms and meters
        redrew 30x a second out of sight and held YouTube video to <10 fps (23 fps
        without them, measured 2026-10-13). The music plays on — audio is not drawn. */}
    <div className="aihub-dj" data-dj-reference={REFERENCE_LOOKS.has(look) ? '1' : undefined} data-dj-theme={theme} data-dj-look={look} data-dj-layout={layout} data-dj-dark={themeInfo?.dark ? '1' : '0'}
      data-dj-covered={stageView === 'stage' ? '1' : undefined}
      data-dj-light-bg={themeInfo?.lightBg ? '1' : '0'} ref={fit.ref} style={fit.style}>
      <TopBar engine={engine} mixer={mixer} setLog={setLog} say={say} theme={theme} setTheme={setTheme} look={look} setLook={setLook}
        layout={layout} setLayout={setLayout} uiZoom={uiZoom} setUiZoom={setUiZoom} />

      {layout === 'party' ? (
        <PartyView engine={engine} mixer={mixer} sidelist={sidelist} say={say} />
      ) : layout === '4deck' ? (
      <>
      <div className="dj-row-clocks dj-4-waves">
        <div className="dj-panel dj-zoom"><ZoomWave decks={[A, B, C, D]} /></div>
      </div>
      <div className="dj-4deck">
        {([[A, B], [B, A], [C, A], [D, B]] as const).map(([d, other]) => (
          <div key={d.id} className={`dj-4-cell dj-4-${d.id.toLowerCase()}`}>
            <DeckInfo deck={d} onDropTrack={dropOn(d.id)} clock />
            <Turntable deck={d} other={other} onDropTrack={dropOn(d.id)} />
          </div>
        ))}
        <Mixer engine={engine} four view={mixerView} setView={setMixerView} onBigVideo={() => setBigVideo(true)} fadeSeconds={mixer.fadeSeconds} />
        {bigVideo && (
          <div className="dj-bigscreen">
            <VideoMonitor engine={engine} big onToggleBig={() => setBigVideo(false)} />
            <BigScreenFader engine={engine} />
          </div>
        )}
      </div>
      </>
      ) : (
      <>
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
        {showPads && <DeckPads deck={A} onDropTrack={dropOn('A')} />}
        <Turntable deck={A} other={B} onDropTrack={dropOn('A')} />
        <Mixer engine={engine} view={layout === 'video' ? 'video' : mixerView} setView={setMixerView} onBigVideo={() => setBigVideo(true)} fadeSeconds={mixer.fadeSeconds} />
        <Turntable deck={B} other={A} onDropTrack={dropOn('B')} />
        {showPads && <DeckPads deck={B} onDropTrack={dropOn('B')} />}
        {bigVideo && (
          <div className="dj-bigscreen">
            <VideoMonitor engine={engine} big onToggleBig={() => setBigVideo(false)} />
            <BigScreenFader engine={engine} />
          </div>
        )}
      </div>
      </>
      )}

      <Library onLoad={load} sidelist={sidelist} setSidelist={setSidelist} automix={automix} setAutomix={setAutomix} mixNow={mixNow} say={say}
        deckIds={layout === '4deck' ? ['A', 'B', 'C', 'D'] : ['A', 'B']} />

    </div>
    {/* Beside the console, not inside it: the console is display:none under the
        stage, which hid every answer ("what's playing?") while the stage was up. */}
    {toast && <div className={`dj-toast${stageView === 'stage' ? ' on-stage' : ''}`} role="status">{toast}</div>}
    </div>
    </RigContext.Provider>
    </DesignContext.Provider>
    </DjEnvContext.Provider>
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
        case 'z': engine.sampler.hit('horn'); break
        case 'x': engine.sampler.hit('siren'); break
        case 'c': engine.sampler.hit('laser'); break
        case 'v': engine.sampler.hit('riser'); break
        case 'b': engine.sampler.hit('impact'); break
        case 'n': engine.sampler.hit('clap'); break
        case 'g': engine.sampler.hit('rewind'); break
        case 'h': engine.sampler.hit('tom'); break
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
const DESIGN_H = 892
const ZOOM_KEY = 'aihub-dj-zoom'
const ZOOM_MIN = 0.55
const ZOOM_MAX = 1
const ZOOM_DEFAULT = 1

function savedZoom(): number {
  const v = parseFloat(readPref(ZOOM_KEY) || '')
  return v >= ZOOM_MIN && v <= ZOOM_MAX ? v : ZOOM_DEFAULT
}

/**
 * Fit the whole console into the tab instead of scrolling: zoom by `scale`
 * and pin the console to all four edges of the tab, so it lays out at
 * (tab size ÷ scale) and always fills the tab exactly.
 *
 * Pinned, not sized: a computed width / height was rounded at 125 % and
 * 150 % display scaling and the console stopped a fraction of a pixel —
 * up to ~5 px after a resize — short of the right and bottom edges, where
 * the see-through window background showed as a thin border.
 */
function useFitToTab(userZoom: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<React.CSSProperties>({ position: 'absolute', inset: 0 })
  useEffect(() => {
    const host = ref.current?.parentElement
    if (!host) return
    const apply = () => {
      const r = host.getBoundingClientRect()
      const w = r.width
      const h = r.height
      if (!w || !h) return
      // Fit first, then the user's own size preference on top. Below 1 the
      // console simply gets more room, so it never overflows the tab.
      const scale = Math.max(0.4, Math.min(1, w / DESIGN_W, h / DESIGN_H) * userZoom)
      setStyle({ zoom: scale, position: 'absolute', inset: 0 })
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(host)
    return () => ro.disconnect()
  }, [userZoom])
  return { ref, style }
}

function TopBar({ engine, mixer, setLog, say, theme, setTheme, look, setLook, layout, setLayout, uiZoom, setUiZoom }: {
  engine: DjEngine; mixer: AutoMixer; setLog: SetLog; say: (m: string) => void; theme: string; setTheme: (t: string) => void
  look: string; setLook: (l: string) => void; layout: string; setLayout: (l: string) => void; uiZoom: number; setUiZoom: (z: number) => void
}) {
  useSyncExternalStore(engine.subscribe, engine.getVersion)
  useSyncExternalStore(mixer.subscribe, mixer.getVersion)
  useSyncExternalStore(subscribeTaste, tasteVersion)
  useSyncExternalStore(setLog.subscribe, setLog.getVersion)
  useSyncExternalStore(subscribeVoice, voiceEnabled)
  const clockRef = useRef<HTMLSpanElement>(null)
  const recRef = useRef<HTMLSpanElement>(null)
  const [recording, setRecording] = useState(false)
  const [saving, setSaving] = useState(false)
  const [menu, setMenu] = useState<'out' | 'theme' | 'settings' | 'scope' | null>(null)
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([])
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const checkUpdates = async () => {
    const api = (window as any).electronAPI?.updater
    if (!api) return say('Update checks are available in the installed desktop app.')
    setCheckingUpdate(true)
    try {
      const result = await api.check()
      say(result.disabled ? 'Update checks are enabled in the installed app.'
        : !result.ok ? result.error || 'The update check failed. Please try again.'
        : result.updateAvailable ? `Version ${result.latest} is available — use the update notification to download it.`
        : `AIHub DJ ${result.current} is up to date.`)
    } catch { say('Could not check for updates. Please try again.') }
    finally { setCheckingUpdate(false) }
  }
  const toggleMenu = (m: 'out' | 'theme' | 'settings' | 'scope') => setMenu(cur => (cur === m ? null : m))
  // A click anywhere outside the open menu closes it.
  useEffect(() => {
    if (!menu) return
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.('.dj-out')) setMenu(null)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [menu])

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
    } catch {
      say('The recording could not be saved')
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
      <CpuMeter engine={engine} />
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
      <SandboxBar engine={engine} say={say} />
      <SamplerBank engine={engine} />
      <NowPlaying engine={engine} />
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
      <ScopeButton engine={engine} open={menu === 'scope'} toggle={() => toggleMenu('scope')} />
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
            <div className="dj-out-title">Layout</div>
            <div className="dj-layout-row">
              {DJ_LAYOUTS.map(l => (
                <button type="button" key={l.id} className={layout === l.id ? 'on' : ''} onClick={() => setLayout(l.id)} title={l.hint}>
                  <span className={`dj-layout-ico dj-layout-ico-${l.id}`}><i /><i /><i /></span>{l.name}
                </button>
              ))}
            </div>
            <div className="dj-out-title">Look</div>
            <div className="dj-look-row">
              {DJ_LOOKS.map(l => (
                <button type="button" key={l.id} className={look === l.id ? 'on' : ''} onClick={() => setLook(l.id)} title={`${l.name} look`}>
                  <span className="dj-look-ico" style={{ background: l.preview, border: l.id === 'club' ? '2px solid transparent' : '1px solid rgba(255,255,255,0.2)' }} />{l.name}
                </button>
              ))}
            </div>
            <div className="dj-out-title">Colour</div>
            <div className="dj-swatch-grid">
              {DJ_THEMES.map(t => (
                <button type="button" key={t.id} className={theme === t.id ? 'on' : ''} onClick={() => setTheme(t.id)}>
                  <span className="dj-swatch" style={{ background: t.swatch }} />{t.name}
                </button>
              ))}
            </div>
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
            <label className="dj-set-row" title="When both songs have a tempo: swap the basslines mid-blend. Otherwise: sweep a filter out and in.">
              <input type="checkbox" checked={mixer.proTransitions} onChange={e => { mixer.setProTransitions(e.target.checked); writePref(PROFX_KEY, e.target.checked ? 'on' : 'off') }} />
              Pro transitions — bass swap and filter sweeps
            </label>
            <label className="dj-set-row" title="The AI DJ announces the next song over the mix, dipping the music">
              <input type="checkbox" checked={voiceEnabled()} onChange={e => setVoiceEnabled(e.target.checked)} />
              DJ voice — announce the next song
            </label>
            <label className="dj-set-row">
              <input type="checkbox" checked={learningEnabled()} disabled={IS_INCOGNITO} onChange={e => setLearning(e.target.checked)} />
              {IS_INCOGNITO ? 'Taste learning is off in private windows' : 'Learn my taste for the AI DJ (stays on this computer)'}
            </label>
            <div className="dj-out-title">Tracklist <span className="dj-dim">({setLog.entries.length})</span></div>
            <div className="dj-tracklist">
              {setLog.entries.length === 0
                ? <span className="dj-dim">Songs are listed here once they have been on air for a few seconds.</span>
                : setLog.text(true).split('\n').map((l, i) => <div key={i}>{l}</div>)}
            </div>
            <div className="dj-set-row">
              <button type="button" className="dj-seg-btn" disabled={!setLog.entries.length}
                onClick={() => { void navigator.clipboard.writeText(setLog.text()).then(() => say('Tracklist copied — paste it under your mix')) }}>
                <Clipboard size={11} /> Copy tracklist
              </button>
              <button type="button" className="dj-seg-btn" disabled={!setLog.entries.length} onClick={() => setLog.clear()}>Clear</button>
            </div>
            {(window as any).electronAPI?.updater && <>
              <div className="dj-out-title">App updates</div>
              <button type="button" className="dj-seg-btn" disabled={checkingUpdate} onClick={() => void checkUpdates()}>
                {checkingUpdate ? 'Checking for updates…' : 'Check for updates'}
              </button>
              <p className="dj-dim">Updates are checked automatically while the app is open. Download first, then restart when you are ready.</p>
            </>}
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
  ['Z X C V B N G H', 'Sampler pads, left to right'],
]

const HELP = [
  'Load: drag a song onto a deck, double-click it, or use the A / B buttons.',
  'YouTube: pick YouTube under Online and search. Songs get the full mixer — EQ, effects, stems, waveform, scratching.',
  'Queue: press the list button on a YouTube result to queue it, the heart for Favorites, then Play list in the QUEUE tab.',
  'Mix now (⇄): blends a song in over the fade length while the other deck keeps playing.',
  'Scratch: hold the record and move it — it plays at the speed and direction of your hand. Let go and it spins back up.',
  'Rim: drag the outer edge while playing to nudge the tempo when beat-matching by ear.',
  'Ask the DJ: type "skip", "more energy", "play Essence by Wizkid" or "hit the horn" in the AI tab — it understands plain speech.',
  "Key: the colour of a deck's KEY box shows how it mixes with the other deck — green is in key, red clashes.",
  'AI DJ: "Let the AI take over" plays a set built from what you play, finish, skip and like (👍 / 👎 on each deck).',
  'Video: switch the mixer to VIDEO to watch YouTube and music videos, blended by the crossfader.',
  'Faders and knobs: drag, scroll or Shift-drag for fine control; double-click to reset.',
]
