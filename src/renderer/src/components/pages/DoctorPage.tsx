import React, { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, Cpu, Eye, HeartPulse, MemoryStick, Moon, RotateCcw, Stethoscope } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useBrowserStore } from '../../store/browserStore'
import type { DoctorSnapshot, Finding, ProcessSample } from '../../../../shared/doctor'

// The snapshot only changes when main takes a sample (every 10 s) or a tab
// hangs/recovers; 3 s keeps hang reports prompt without busy polling.
const POLL_MS = 3000
const STALL_MS = 250

const STATUS = {
  ok:       { label: 'All good',        color: '#34d399', bg: 'rgba(52,211,153,.14)' },
  warn:     { label: 'Needs a look',    color: '#fbbf24', bg: 'rgba(251,191,36,.14)' },
  critical: { label: 'Something is wrong', color: '#fb7185', bg: 'rgba(251,113,133,.14)' },
} as const

const muted = { color: 'rgb(var(--ds-text-4))' }
const card = { background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)' }

function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

const mb = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${Math.round(n)} MB`)

function processName(p: ProcessSample): string {
  if (p.tab) return p.tab.title
  switch (p.type) {
    case 'Browser': return 'Browser core (main process)'
    case 'GPU': return 'Graphics'
    case 'Utility': return 'Utility service'
    // A renderer that hosts no browser tab: the app's own interface, or one of
    // its background windows (music decks, fare search, Bible voice).
    case 'Tab': return 'Browser interface or background page'
    default: return p.type
  }
}

/** Main-thread delay over the last ~10 minutes, with the lag threshold marked. */
function LagChart({ snapshot }: { snapshot: DoctorSnapshot }) {
  const w = 600, h = 90
  const values = snapshot.samples.map(s => s.loopP99Ms)
  const top = Math.max(STALL_MS * 1.4, ...values)
  const x = (i: number) => (values.length < 2 ? w : (i / (values.length - 1)) * w)
  const y = (v: number) => h - (Math.min(v, top) / top) * h
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-24" role="img"
      aria-label={`Main-process delay, latest ${Math.round(values[values.length - 1] ?? 0)} milliseconds`}>
      <line x1="0" x2={w} y1={y(STALL_MS)} y2={y(STALL_MS)} stroke="#fb7185" strokeOpacity=".5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      {values.length > 1 && <polyline points={points} fill="none" stroke="#67e8f9" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
    </svg>
  )
}

function Tile({ icon: Icon, label, value, hint }: { icon: typeof Cpu; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl p-4" style={card}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide" style={muted}><Icon size={13} />{label}</div>
      <div className="text-xl font-semibold mt-1" style={{ color: 'rgb(var(--ds-text-1))' }}>{value}</div>
      {hint && <div className="text-[11px] mt-0.5" style={muted}>{hint}</div>}
    </div>
  )
}

function FindingCard({ finding, now, onRefresh }: { finding: Finding; now: number; onRefresh: () => void }) {
  const { tabs, activeTabId, setActiveTab, sleepTab } = useBrowserStore(useShallow(s => ({
    tabs: s.tabs, activeTabId: s.activeTabId, setActiveTab: s.setActiveTab, sleepTab: s.sleepTab,
  })))
  const [note, setNote] = useState('')
  // Actions only for tabs in this window; findings cover every window.
  const tab = finding.tab && tabs.find(t => t.id === finding.tab!.id)
  const critical = finding.severity === 'critical'
  const tone = critical ? STATUS.critical : STATUS.warn

  const sleep = async () => {
    if (!tab) return
    const ok = await window.electronAPI.tabView.canSleep(tab.id).catch(() => false)
    if (!ok) { setNote('This tab is busy (playing media, unsaved form, or devtools open), so it was left awake.'); return }
    sleepTab(tab.id)
    setNote('Tab is asleep. Click it in the tab bar to wake it.')
    onRefresh()
  }
  const restart = async () => {
    if (!finding.tab) return
    const ok = await window.electronAPI.doctor.restartTab(finding.tab.windowId, finding.tab.id).catch(() => false)
    setNote(ok ? 'Page restarted.' : 'Could not restart this page; it may already be closed.')
    onRefresh()
  }

  return (
    <article className="rounded-xl p-4 flex gap-3" style={{ ...card, borderColor: critical ? 'rgba(251,113,133,.35)' : 'var(--ds-border-sm)' }}>
      <AlertTriangle size={16} className="shrink-0 mt-0.5" style={{ color: tone.color }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold truncate" style={{ color: 'rgb(var(--ds-text-1))' }}>{finding.title}</h3>
          <span className="text-[11px] shrink-0" style={muted}>{ago(finding.since, now)}</span>
        </div>
        <p className="text-xs mt-1">{finding.detail}</p>
        {tab && (
          <div className="flex flex-wrap gap-2 mt-3">
            {tab.id !== activeTabId && (
              <button type="button" onClick={() => setActiveTab(tab.id)} className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5" style={card}><Eye size={13} /> Show tab</button>
            )}
            {(finding.kind === 'tab-cpu' || finding.kind === 'tab-memory') && tab.id !== activeTabId && !tab.asleep && (
              <button type="button" onClick={sleep} className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5" style={card}><Moon size={13} /> Sleep tab</button>
            )}
            {finding.kind === 'tab-hung' && (
              <button type="button" onClick={restart} className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5" style={{ background: tone.bg, color: tone.color, border: `1px solid ${tone.color}55` }}><RotateCcw size={13} /> Restart page</button>
            )}
          </div>
        )}
        {note && <p role="status" className="text-[11px] mt-2" style={{ color: '#67e8f9' }}>{note}</p>}
      </div>
    </article>
  )
}

export default function DoctorPage() {
  const [snapshot, setSnapshot] = useState<DoctorSnapshot | null>(null)
  const [now, setNow] = useState(Date.now())

  const refresh = () => {
    window.electronAPI.doctor.snapshot()
      .then((s: DoctorSnapshot | null) => { if (s) setSnapshot(s); setNow(Date.now()) })
      .catch(() => {})
  }
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    return () => clearInterval(timer)
  }, [])

  const latest = snapshot?.samples[snapshot.samples.length - 1]
  const totals = useMemo(() => {
    const procs = latest?.processes ?? []
    return {
      memMb: procs.reduce((n, p) => n + p.memMb, 0),
      cpu: procs.reduce((n, p) => n + p.cpu, 0),
      tabs: procs.filter(p => p.tab).length,
      top: [...procs].sort((a, b) => b.memMb - a.memMb).slice(0, 12),
    }
  }, [latest])
  const status = STATUS[snapshot?.status ?? 'ok']

  return (
    <div className="h-full overflow-y-auto px-6 py-7" style={{ color: 'rgb(var(--ds-text-2))' }}>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(103,232,249,.14)', color: '#67e8f9' }}><Stethoscope size={20} /></div>
          <div className="flex-1">
            <h1 className="text-xl font-semibold">Agent Doctor</h1>
            <p className="text-xs" style={muted}>Watches the browser's health: lag, stuck pages, and tabs using too much. Everything stays on this device.</p>
          </div>
          <span className="px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5" style={{ background: status.bg, color: status.color }}>
            <HeartPulse size={13} /> {snapshot ? status.label : 'Starting…'}
          </span>
        </div>

        {!latest ? (
          <p className="text-xs" style={muted}>The first health check runs within 10 seconds of the browser starting.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Tile icon={Activity} label="Main thread" value={`${Math.round(latest.loopP99Ms)} ms`} hint={latest.loopP99Ms < STALL_MS ? 'responsive' : 'lagging'} />
              <Tile icon={MemoryStick} label="Memory" value={mb(totals.memMb)} hint="all browser processes" />
              <Tile icon={Cpu} label="CPU" value={`${Math.round(totals.cpu)}%`} hint="of one core, summed" />
              <Tile icon={Eye} label="Tab processes" value={String(totals.tabs)} hint="awake pages" />
            </div>

            <section className="rounded-2xl p-4 mt-4" style={card}>
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-semibold">Main-thread delay, last {Math.round((snapshot!.samples.length * 10) / 60) || 1} min</span>
                <span style={muted}>dashed line = noticeable lag ({STALL_MS} ms)</span>
              </div>
              <LagChart snapshot={snapshot!} />
            </section>
          </>
        )}

        <section className="mt-7">
          <h2 className="text-sm font-semibold mb-3">Findings</h2>
          {!snapshot?.findings.length
            ? <p className="text-xs" style={muted}>Nothing needs attention.</p>
            : <div className="grid gap-2">{snapshot.findings.map(f => <FindingCard key={f.key} finding={f} now={now} onRefresh={refresh} />)}</div>}
        </section>

        {latest && (
          <section className="mt-7">
            <h2 className="text-sm font-semibold mb-3">Heaviest processes</h2>
            <div className="rounded-2xl overflow-hidden" style={card}>
              <table className="w-full text-xs">
                <thead><tr style={muted}><th className="text-left font-medium px-4 py-2">Process</th><th className="text-right font-medium px-4 py-2 w-24">CPU</th><th className="text-right font-medium px-4 py-2 w-28">Memory</th></tr></thead>
                <tbody>
                  {totals.top.map(p => (
                    <tr key={p.pid} style={{ borderTop: '1px solid var(--ds-border-sm)' }}>
                      <td className="px-4 py-2 truncate max-w-0 w-full" title={processName(p)}>{processName(p)}{p.tab?.active && <span className="ml-2 text-[10px]" style={{ color: '#67e8f9' }}>visible</span>}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{Math.round(p.cpu)}%</td>
                      <td className="px-4 py-2 text-right tabular-nums">{mb(p.memMb)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {!!snapshot?.journal.length && (
          <section className="mt-7">
            <h2 className="text-sm font-semibold mb-3">This session</h2>
            <ul className="grid gap-1 text-xs">
              {snapshot.journal.slice(0, 25).map((e, i) => (
                <li key={`${e.at}-${i}`} className="flex gap-3">
                  <span className="w-20 shrink-0 tabular-nums" style={muted}>{ago(e.at, now)}</span>
                  <span style={{ color: e.event === 'resolved' ? '#34d399' : e.severity === 'critical' ? '#fb7185' : '#fbbf24' }}>{e.event === 'resolved' ? 'Resolved' : 'Started'}</span>
                  <span className="truncate">{e.title}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-6 text-[11px]" style={muted}>The Doctor only observes and suggests. It never closes, sleeps or restarts anything on its own; findings are kept in memory and cleared when the browser closes.</p>
      </div>
    </div>
  )
}
