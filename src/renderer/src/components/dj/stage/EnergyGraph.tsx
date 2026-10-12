import React from 'react'
import { curveAt, type SetBrief } from '../ai/setBrief'

// Click or drag on the graph to move the peak there: the set re-plans.
export default function EnergyGraph({ brief, startedAt, onPeak }: { brief: SetBrief; startedAt: number; played: number; onPeak?: (atMin: number) => void }) {
  const W = 1000, H = 90, steps = 60
  const nowMin = startedAt ? (Date.now() - startedAt) / 60_000 : 0
  const pts = Array.from({ length: steps + 1 }, (_, i) => { const m = (i / steps) * brief.durationMin; return `${(i / steps) * W},${H - curveAt(brief.curve, m) * (H - 10) - 5}` })
  const x = Math.min(W, (nowMin / brief.durationMin) * W)
  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onPeak || (e.type === 'pointermove' && e.buttons !== 1)) return
    const r = e.currentTarget.getBoundingClientRect()
    onPeak(Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))) * brief.durationMin)
  }
  return <svg className="dj-energy" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="slider" aria-label="Energy plan — click to move the peak" aria-valuemin={0} aria-valuemax={brief.durationMin} aria-valuenow={Math.round(nowMin)} onPointerDown={pick} onPointerMove={pick}>
    <polyline className="planned" points={pts.join(' ')} />
    <polyline className="played" points={pts.filter((_, i) => (i / steps) * W <= x).join(' ')} />
    <circle className="here" cx={x} cy={H - curveAt(brief.curve, nowMin) * (H - 10) - 5} r="5" />
  </svg>
}
