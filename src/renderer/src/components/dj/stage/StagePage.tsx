import React, { useState, useSyncExternalStore } from 'react'
import type { DjEngine } from '../engine/DjEngine'
import { handoffCaption, type SetConductor } from '../ai/setConductor'
import StartScreen from './StartScreen'
import NowCard from './NowCard'
import NextStrip from './NextStrip'
import EnergyGraph from './EnergyGraph'
import SteerBar from './SteerBar'
import RulesChips from './RulesChips'
import Backdrop from './Backdrop'
import SearchResults, { type PickHow, type StageResults } from './SearchResults'
import StageMixer from './StageMixer'
import VideoMonitor from '../VideoMonitor'
import type { DjTrack } from '../engine/DjEngine'
import './stage.css'

export default function StagePage({ engine, conductor, onTakeDecks, onStop, onAsk, results, onPick, onCloseResults, onToggleSongs, onSearch }: {
  engine: DjEngine; conductor: SetConductor; onTakeDecks: () => void; onStop?: () => void; onAsk: (text: string) => void
  results?: StageResults | null; onPick?: (t: DjTrack, how: PickHow) => void; onCloseResults?: () => void
  onToggleSongs?: () => void
  /** Search from the start screen (before any set). */
  onSearch?: (q: string) => void
}) {
  useSyncExternalStore(conductor.subscribe, conductor.getVersion)
  const s = conductor.state
  const [discovery, setDiscovery] = useState(s.brief?.discoveryShare ?? 0.25)
  const [mixerOpen, setMixerOpen] = useState(false)
  if (!s.active || !s.brief) return <div className="dj-stage theme-cinema"><Backdrop engine={engine} />
    <StartScreen onStart={b => { void conductor.start(b) }} onTakeDecks={onTakeDecks} notice={s.message} onSearch={onSearch} />
    {results && onPick && <SearchResults results={results} onPick={onPick} onClose={() => onCloseResults?.()} />}
  </div>
  return <div className="dj-stage theme-cinema">
    {/* While a set runs the picture is the framed screen below (YouTube's own
        player, full frame rate); behind the controls only the glow. */}
    <Backdrop engine={engine} video={false} />
    <div className="dj-stage-top">
      <NowCard engine={engine} conductor={conductor} />
      <NextStrip upNext={s.upNext} tentative={s.tentative} />
    </div>
    <div className="dj-stage-centre with-screen">
      <div className="dj-stage-screen"><VideoMonitor engine={engine} bare /></div>
      {(engine as any).fading && s.handoff && <div className="dj-caption" role="status">{handoffCaption(s.handoff)}</div>}
      {s.message && <div className="dj-stage-message" role="status">{s.message}</div>}
      <RulesChips rules={s.rules} onRemove={i => conductor.removeRule(i)} />
    </div>
    {results && onPick && !mixerOpen && <SearchResults results={results} onPick={onPick} onClose={() => onCloseResults?.()} />}
    {mixerOpen && <StageMixer engine={engine} onClose={() => setMixerOpen(false)} />}
    <EnergyGraph brief={s.brief} startedAt={s.startedAt} played={s.played.length} onPeak={m => conductor.setPeak(m)} />
    <SteerBar
      discovery={discovery}
      onDiscovery={v => { setDiscovery(v); conductor.setDiscovery(v) }}
      onSkip={() => conductor.skip()}
      onStop={onStop}
      onSteer={k => conductor.steer(k)}
      onAsk={onAsk}
      onTakeDecks={onTakeDecks}
      onSongs={onToggleSongs ? () => { setMixerOpen(false); onToggleSongs() } : undefined}
      onMixer={() => setMixerOpen(o => !o)}
    />
  </div>
}
