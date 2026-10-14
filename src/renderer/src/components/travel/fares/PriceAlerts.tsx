import React, { useEffect, useState } from 'react'
import { Bell, BellRing, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import type { FareQuery } from '../../../../../shared/fares/types'

/**
 * Fare alerts: the main process re-prices a watched route every 6 hours
 * through the live-fares engine and sends a desktop notification once, when
 * the lowest round-trip price falls to the target (shared/fares/watch.ts).
 * This file is the part people see: setting an alert and following it.
 */

export interface FareAlert {
  id: string; title: string; target: number; lastPrice?: number
  lastChecked?: number; triggered: boolean; active: boolean; query: FareQuery
}

/** The watches main keeps, narrowed to valid fare alerts. */
export function fareAlertsFrom(watches: unknown): FareAlert[] {
  if (!Array.isArray(watches)) return []
  return watches.filter((w: any) => w?.mode === 'fare' && w.fare?.query && Number.isFinite(w.fare.target)).map((w: any) => ({
    id: String(w.id), title: String(w.title || `${w.fare.query.from} → ${w.fare.query.to}`), target: w.fare.target,
    lastPrice: Number.isFinite(w.fare.lastPrice) ? w.fare.lastPrice : undefined,
    lastChecked: Number.isFinite(w.lastChecked) ? w.lastChecked : undefined,
    triggered: Boolean(w.triggered), active: w.active !== false, query: w.fare.query,
  }))
}

/** A target worth waiting for: about 10% under today's lowest fare, else the trip budget. */
export function suggestTarget(lowest: number | null, budget: string): number | null {
  if (lowest !== null && lowest > 30) return Math.floor((lowest * 0.9) / 5) * 5
  const b = Number(budget)
  return Number.isFinite(b) && b > 20 ? Math.round(b) : null
}

/** Why a target cannot be used, or null when it can. */
export function targetProblem(target: number, lowest: number | null): string | null {
  if (!Number.isFinite(target) || target <= 20) return 'Enter a price above $20.'
  if (lowest !== null && target >= lowest) return `Fares are already $${lowest} — that is at or under your target, so book now or choose a lower price.`
  return null
}

const api = () => (window as any).electronAPI

function ago(ts?: number): string {
  if (!ts) return 'first check in a minute'
  const min = Math.round((Date.now() - ts) / 60000)
  return min < 1 ? 'checked just now' : min < 60 ? `checked ${min} min ago` : `checked ${Math.round(min / 60)} h ago`
}

/** "Alert me when it drops to $N" for one route. */
export function AlertForm({ query, title, lowest, budget, onDone }: {
  query: FareQuery; title: string; lowest: number | null; budget: string; onDone: (message: string) => void
}) {
  const [value, setValue] = useState(() => String(suggestTarget(lowest, budget) ?? ''))
  const [busy, setBusy] = useState(false)
  const target = Number(value)
  const problem = value === '' ? null : targetProblem(target, lowest)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || value === '' || problem) return
    setBusy(true)
    try {
      const r = await api()?.fares?.watch(query, target, title, lowest ?? undefined)
      onDone(r?.ok
        ? `${r.updated ? 'Alert updated' : 'Alert on'}: we check ${title} every 6 hours and notify you once it is $${Math.round(target)} or less.`
        : 'Price alerts are not available in this window (Incognito keeps nothing).')
    } catch { onDone('Could not set the alert. Please try again.') } finally { setBusy(false) }
  }
  return <form className="fare-alert-form" onSubmit={submit} aria-label="Set a price alert">
    <BellRing size={17} />
    <label>Alert me when this round trip drops to
      <span className="fare-alert-price">$<input type="number" min="21" step="1" inputMode="numeric" value={value} aria-label="Target price in US dollars" onChange={e => setValue(e.target.value)} /></span>
    </label>
    <button type="submit" disabled={busy || value === '' || Boolean(problem)}>{busy ? <Loader2 size={15} className="fare-spin" /> : <Bell size={15} />} Alert me</button>
    {problem && <small role="alert">{problem}</small>}
    {!problem && lowest !== null && <small>Lowest fare right now: ${lowest}. Checked every 6 hours; you get one notification.</small>}
  </form>
}

/** Every fare alert on this device, live-updated as the checks run. */
export function AlertList({ onOpen }: { onOpen: (q: FareQuery) => void }) {
  const [alerts, setAlerts] = useState<FareAlert[] | null>(null)
  const [checking, setChecking] = useState<string | null>(null)
  useEffect(() => {
    const w = api()?.watch
    if (!w?.list) { setAlerts([]); return }
    let alive = true
    const load = () => { void w.list().then((l: unknown) => { if (alive) setAlerts(fareAlertsFrom(l)) }).catch(() => { if (alive) setAlerts([]) }) }
    load()
    const off = w.onChanged?.(load)
    return () => { alive = false; off?.() }
  }, [])
  if (alerts === null) return null
  const w = api()?.watch
  return <section className="fare-alerts" aria-label="Your price alerts">
    <h2>Price alerts <span>{alerts.length}</span></h2>
    {!alerts.length && <p>Search a flight, then use “Alert me” — you get a notification when the fare drops.</p>}
    {alerts.map(a => <div key={a.id} className={`fare-alert${a.triggered ? ' dropped' : ''}${a.active ? '' : ' ended'}`}>
      <button className="fare-alert-main" onClick={() => onOpen(a.query)} title="Show this trip">
        <strong>{a.title}</strong>
        <span>{a.triggered ? '✓ Price dropped! ' : ''}Target ${a.target}{a.lastPrice !== undefined ? ` · now $${a.lastPrice}` : ''}</span>
        <small>{a.active ? ago(a.lastChecked) : 'Ended — departure date passed'}</small>
      </button>
      {a.active && <button aria-label={`Check ${a.title} now`} title="Check now" disabled={checking === a.id}
        onClick={async () => { setChecking(a.id); try { await w?.checkNow(a.id) } finally { setChecking(null) } }}>
        {checking === a.id ? <Loader2 size={15} className="fare-spin" /> : <RefreshCw size={15} />}
      </button>}
      <button aria-label={`Remove alert ${a.title}`} title="Remove alert" onClick={() => void w?.remove(a.id)}><Trash2 size={15} /></button>
    </div>)}
  </section>
}
