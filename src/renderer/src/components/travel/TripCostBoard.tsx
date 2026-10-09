import React, { useEffect, useState } from 'react'
import { CalendarDays, CircleHelp, Wallet } from 'lucide-react'
import type { Trip } from './flightsRentals'
import { COST_CATEGORIES, formatCostCents, parseCostCents, summarizeTripEstimate, type TripEstimate } from './tripCosts'

export default function TripCostBoard({ trip, estimate, onChange }: { trip: Trip; estimate: TripEstimate; onChange(estimate: TripEstimate): void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(estimate.lines.map(line => [line.id, line.amount])))
  useEffect(() => { setDrafts(Object.fromEntries(estimate.lines.map(line => [line.id, line.amount]))) }, [estimate])
  const summary = summarizeTripEstimate({ ...estimate, lines: estimate.lines.map(line => ({ ...line, amount: drafts[line.id] ?? line.amount })) })
  const updateAmount = (id: string, amount: string) => {
    setDrafts(current => ({ ...current, [id]: amount }))
    if (amount.trim() && parseCostCents(amount) === null) return
    onChange({ ...estimate, updatedAt: new Date().toISOString(), lines: estimate.lines.map(line => line.id === id ? { ...line, amount } : line) })
  }
  const dateRange = `${new Date(`${trip.start}T12:00:00`).toLocaleDateString()} – ${new Date(`${trip.end}T12:00:00`).toLocaleDateString()}`
  return <section className="fare-cost-board" aria-label="Trip cost estimate">
    <div className="fare-cost-heading"><div><h2><Wallet size={18} /> Trip total-cost board</h2><p><CalendarDays size={13} />{dateRange} · edited {new Date(estimate.updatedAt).toLocaleString()}</p></div><div className="fare-cost-total"><small>Known subtotal</small><strong>{formatCostCents(summary.knownTotalCents, estimate.currency)}</strong></div></div>
    <p className="fare-cost-disclosure">Estimate in {estimate.currency}. Only amounts you enter are included; provider prices and availability must still be confirmed.</p>
    <div className="fare-cost-lines">{COST_CATEGORIES.map(category => {
      const amount = drafts[category.id] ?? ''
      const invalid = !!amount.trim() && parseCostCents(amount) === null
      return <label className="fare-cost-line" key={category.id}><span><strong>{category.label}</strong><small>{category.detail}</small></span><span className="fare-cost-input"><span>{estimate.currency}</span><input aria-label={`${category.label} amount`} aria-invalid={invalid} type="text" inputMode="decimal" placeholder="Unknown" value={amount} onChange={e => updateAmount(category.id, e.target.value)} /><small aria-live="polite">{invalid ? 'Enter a non-negative amount with up to two decimals.' : amount ? 'Included in subtotal' : 'Unknown · excluded'}</small></span></label>
    })}</div>
    <div className="fare-cost-footer"><span><CircleHelp size={14} />{summary.unknownCount} unknown · {summary.invalidCount} invalid, excluded</span><strong>{summary.unknownCount || summary.invalidCount ? 'Partial estimate' : 'All categories entered'}</strong></div>
  </section>
}
