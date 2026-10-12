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
import './stage.css'

export default function StagePage({ engine, conductor, onTakeDecks, onAsk }: { engine: DjEngine; conductor: SetConductor; onTakeDecks: () => void; onAsk: (text: string) => void }) {
  useSyncExternalStore(conductor.subscribe, conductor.getVersion)
  const s = conductor.state
  const [discovery, setDiscovery] = useState(s.brief?.discoveryShare ?? 0.25)
  if (!s.active || !s.brief) return <div className="dj-stage theme-cinema"><Backdrop engine={engine} /><StartScreen onStart={b => { void conductor.start(b) }} /></div>
  return <div className="dj-stage theme-cinema">
    <Backdrop engine={engine} />
    <div className="dj-stage-top">
      <NowCard engine={engine} conductor={conductor} />
      <NextStrip upNext={s.upNext} />
    </div>
    {s.message && <div className="dj-stage-message" role="status">{s.message}</div>}
    <RulesChips rules={s.rules} onRemove={i => conductor.removeRule(i)} />
    <EnergyGraph brief={s.brief} startedAt={s.startedAt} played={s.played.length} onPeak={m => conductor.setPeak(m)} />
    {(engine as any).fading && s.handoff && <div className="dj-caption" role="status">{handoffCaption(s.handoff)}</div>}
    <SteerBar
      discovery={discovery}
      onDiscovery={v => { setDiscovery(v); conductor.setDiscovery(v) }}
      onSkip={() => conductor.skip()}
      onSteer={k => conductor.steer(k)}
      onAsk={onAsk}
      onTakeDecks={onTakeDecks}
    />
  </div>
}
