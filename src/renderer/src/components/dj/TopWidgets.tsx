/**
 * Top-bar widgets: CPU meter, Sandbox (rehearse through the headphones with the
 * speakers silent), the sampler bank (level and pitch knobs around eight pads)
 * and the master spectrum scope.
 */
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AudioLines, Box } from 'lucide-react'
import type { DjEngine } from './engine/DjEngine'
import { HITS } from './engine/sampler'
import { Knob } from './controls'

const SEGMENTS = 8

/**
 * Audio render load (the browser's own AudioRenderCapacity when it has one),
 * otherwise how late a 100 ms timer fires — both read as a 0..1 load.
 */
export function CpuMeter({ engine }: { engine: DjEngine }) {
  const [load, setLoad] = useState(0)
  useEffect(() => {
    let alive = true
    let audioLoad: number | null = null
    const cap = (engine.ctx as AudioContext & { renderCapacity?: { start(o: { updateInterval: number }): void; stop(): void; addEventListener(t: 'update', f: (e: { averageLoad: number }) => void): void } }).renderCapacity
    if (cap) {
      try {
        cap.addEventListener('update', e => { audioLoad = e.averageLoad })
        cap.start({ updateInterval: 0.5 })
      } catch { /* not supported — fall back to timer lag */ }
    }
    let last = performance.now()
    let lag = 0
    const t = window.setInterval(() => {
      const now = performance.now()
      lag = lag * 0.7 + Math.min(1, Math.max(0, (now - last - 100) / 100)) * 0.3
      last = now
      if (alive) setLoad(Math.min(1, Math.max(audioLoad ?? 0, lag)))
    }, 100)
    return () => { alive = false; window.clearInterval(t); try { cap?.stop() } catch { /* already stopped */ } }
  }, [engine])
  const lit = Math.round(load * SEGMENTS)
  return (
    <div className="dj-cpu" title={`Load ${Math.round(load * 100)}%`}>
      <span>CPU</span>
      <div className="dj-cpu-bar">
        {Array.from({ length: SEGMENTS }, (_, i) => <i key={i} className={i < lit ? (i >= 6 ? 'hot' : i >= 4 ? 'warm' : 'on') : ''} />)}
      </div>
    </div>
  )
}

/** Sandbox: the speakers go quiet, so a mix can be rehearsed in the headphones before the crowd hears it. */
export function SandboxBar({ engine, say }: { engine: DjEngine; say: (m: string) => void }) {
  useSyncExternalStore(engine.subscribe, engine.getVersion)
  const on = engine.sandbox
  const toggle = () => {
    engine.setSandbox(!on)
    if (!on && !engine.phonesDevice) say('Sandbox on — speakers are silent. Pick a headphone output to hear your rehearsal.')
  }
  return (
    <div className="dj-sandbox">
      <button type="button" className={`dj-top-btn dj-icon-btn ${on ? 'dj-on dj-on-orange' : ''}`} onClick={toggle}
        title="Sandbox — rehearse a mix in the headphones while the speakers stay silent">
        <Box size={14} />
      </button>
      <div className={`dj-lcd dj-sandbox-bar ${on ? 'dj-sandbox-on' : ''}`}>{on ? (engine.phonesDevice ? 'SANDBOX · headphones only' : 'SANDBOX · speakers muted') : 'SANDBOX'}</div>
    </div>
  )
}

/** Level and pitch knobs either side of eight pads: top row blue, bottom row red. */
export function SamplerBank({ engine }: { engine: DjEngine }) {
  const [level, setLevel] = useState(engine.sampler.level)
  const [pitch, setPitch] = useState(0.5 + engine.sampler.cents / 2400)
  const [lit, setLit] = useState<string | null>(null)
  const litTimer = useRef(0)
  const fire = (id: (typeof HITS)[number]['id']) => {
    void engine.resume()
    engine.sampler.hit(id)
    setLit(id)
    window.clearTimeout(litTimer.current)
    litTimer.current = window.setTimeout(() => setLit(null), 160)
  }
  useEffect(() => () => window.clearTimeout(litTimer.current), [])
  return (
    <div className="dj-bank" role="group" aria-label="Sampler">
      <Knob value={level} onChange={v => { setLevel(v); engine.sampler.setLevel(v) }} size={22} center={0} defaultValue={0.8} color="#22c55e" title="Sampler volume" />
      <div className="dj-bank-pads">
        {HITS.map((h, i) => (
          <button type="button" key={h.id} className={`dj-hit ${i < 4 ? 'dj-hit-a' : 'dj-hit-b'} ${lit === h.id ? 'dj-hit-lit' : ''}`} title={h.title}
            onPointerDown={() => fire(h.id)}>{h.label}</button>
        ))}
      </div>
      <Knob value={pitch} onChange={v => { setPitch(v); engine.sampler.setCents((v - 0.5) * 2400) }} size={22} center={0.5} defaultValue={0.5} color="#38bdf8" title="Sampler pitch (±1 octave, double-click to reset)" />
    </div>
  )
}

/** Live spectrum of everything going to the speakers, in a small pop-over. */
export function ScopeButton({ engine, open, toggle }: { engine: DjEngine; open: boolean; toggle: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!open) return
    const bins = new Uint8Array(new ArrayBuffer(engine.spectrumBins))
    const t = window.setInterval(() => {
      const c = cv.current
      const g = c?.getContext('2d')
      if (!c || !g) return
      engine.masterSpectrum(bins)
      const w = c.width, h = c.height
      g.fillStyle = '#07090b'
      g.fillRect(0, 0, w, h)
      // Log-spaced bars from ~40 Hz to 16 kHz.
      const n = 48
      const nyq = engine.ctx.sampleRate / 2
      for (let i = 0; i < n; i++) {
        const f0 = 40 * Math.pow(400, i / n), f1 = 40 * Math.pow(400, (i + 1) / n)
        const b0 = Math.floor((f0 / nyq) * bins.length), b1 = Math.max(b0 + 1, Math.floor((f1 / nyq) * bins.length))
        let m = 0
        for (let b = b0; b < b1 && b < bins.length; b++) m = Math.max(m, bins[b])
        const bh = (m / 255) * (h - 4)
        const gr = g.createLinearGradient(0, h, 0, 0)
        gr.addColorStop(0, '#22c55e'); gr.addColorStop(0.65, '#facc15'); gr.addColorStop(1, '#ef4444')
        g.fillStyle = gr
        g.fillRect(i * (w / n) + 1, h - bh, w / n - 2, bh)
      }
    }, 50)
    return () => window.clearInterval(t)
  }, [open, engine])
  return (
    <div className="dj-out">
      <button type="button" className={`dj-top-btn dj-icon-btn ${open ? 'dj-on dj-on-blue' : ''}`} onClick={toggle} title="Master spectrum">
        <AudioLines size={14} />
      </button>
      {open && (
        <div className="dj-out-menu dj-scope-menu">
          <div className="dj-out-title">Master spectrum</div>
          <canvas ref={cv} width={300} height={110} />
        </div>
      )}
    </div>
  )
}
