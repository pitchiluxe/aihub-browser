import React, { useEffect, useRef, useState } from 'react'
import { Plane, Car, House, ArrowRight, BookmarkPlus, Trash2, Sparkles, Loader2, ArrowLeft, ExternalLink, Wallet } from 'lucide-react'
import { bookingSearches, chooseBookingSearch, localDate, readSavedTrips, researchTrip, SAVED_TRIPS_KEY, tripDescription, validateTrip, type Research, type SavedTrip, type Trip, type TripKind } from './flightsRentals'
import { createTripEstimate, validateTripEstimate } from './tripCosts'
import TripCostBoard from './TripCostBoard'
import AirportInput from './AirportInput'
import ResearchBrief from './ResearchBrief'
import DestinationGallery from './DestinationGallery'
import './flightsRentals.css'

const MODES = [{ kind: 'flights', label: 'Flights', Icon: Plane }, { kind: 'cars', label: 'Car rentals', Icon: Car }, { kind: 'stays', label: 'Vacation stays', Icon: House }] as const
function initialTrip(): Trip {
  const start = new Date(); start.setDate(start.getDate() + 14)
  const end = new Date(start); end.setDate(end.getDate() + 7)
  return { kind: 'flights', origin: '', destination: '', start: localDate(start), end: localDate(end), travelers: 1, budget: '', currency: 'USD', flexible: true }
}
function loadSaved(): SavedTrip[] {
  try { return readSavedTrips(localStorage.getItem(SAVED_TRIPS_KEY)) } catch { return [] }
}
export default function FlightsRentalsPage({ onNavigate, onOpenBooking = onNavigate }: { onNavigate: (url: string) => void; onOpenBooking?: (url: string) => void }) {
  const [trip, setTrip] = useState<Trip>(initialTrip)
  const [searched, setSearched] = useState<Trip | null>(null)
  const [saved, setSaved] = useState<SavedTrip[]>(loadSaved)
  const [costTripId, setCostTripId] = useState('')
  const [research, setResearch] = useState<Research | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const generation = useRef(0)
  const previousProvider = useRef<Partial<Record<TripKind, string>>>({})
  useEffect(() => () => { generation.current++ }, [])
  const change = (patch: Partial<Trip>) => {
    generation.current++; setBusy(false); setTrip(t => ({ ...t, ...patch })); setSearched(null); setResearch(null); setError(''); setNotice('')
  }
  const persist = (next: SavedTrip[]) => {
    try { localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify(next)); setSaved(next); return true }
    catch { setError('This browser could not save your trips. Free some local storage and try again.'); return false }
  }
  const search = () => {
    const err = validateTrip(trip); setError(err || '')
    if (err) return
    generation.current++; setBusy(false); setResearch(null); setSearched({ ...trip }); setNotice('')
    const provider = chooseBookingSearch(trip, previousProvider.current[trip.kind])
    previousProvider.current[trip.kind] = provider.name
    setNotice(`Opened ${provider.name} with your trip details. Compare again to try another site.`)
    onOpenBooking(provider.url)
  }
  const runAI = async () => {
    const err = validateTrip(trip); if (err) { setError(err); return }
    const ai = (window as any).electronAPI?.ai
    if (!ai?.webSearch || !ai?.chat) { setError('AI research is unavailable. Open this page in AIHub and configure an AI provider in Settings.'); return }
    const id = ++generation.current
    setBusy(true); setError(''); setResearch(null); setSearched({ ...trip })
    try { const result = await researchTrip(trip, ai); if (generation.current === id) setResearch(result) }
    catch (e) { if (generation.current === id) setError(e instanceof Error ? e.message : 'Research failed. Please retry.') }
    finally { if (generation.current === id) setBusy(false) }
  }
  const save = () => {
    const err = validateTrip(trip); if (err) { setError(err); return }
    if (saved.some(s => JSON.stringify(s.trip) === JSON.stringify(trip))) { setNotice('This trip is already saved.'); return }
    if (saved.length >= 20) { setError('You have 20 saved trips. Remove one before saving another.'); return }
    if (persist([{ id: crypto.randomUUID(), trip: { ...trip }, estimate: createTripEstimate(trip.currency) }, ...saved])) setNotice('Trip saved on this device.')
  }
  const updateEstimate = (id: string, estimate: SavedTrip['estimate']) => {
    const invalid = validateTripEstimate(estimate)
    if (invalid) { setError(invalid); return }
    setError('')
    if (persist(saved.map(item => item.id === id ? { ...item, estimate } : item))) setNotice('Trip estimate saved on this device.')
  }
  const restore = (t: Trip) => {
    generation.current++; setBusy(false); setTrip({ ...t }); setSearched(null); setResearch(null); setError(''); setNotice('Saved trip restored. Check the dates before searching.')
  }
  return <div className="fare-page">
    <div className="fare-shell">
      <header className="fare-header">
        <button className="fare-back" onClick={() => onNavigate('aihub://travel')}><ArrowLeft size={15} /> Travel the World</button>
        <span>Plan here. Book inside AIHub.</span>
      </header>
      <div className="fare-title"><Plane size={30} /><div><h1>Flights &amp; Rentals</h1><p>A better trip starts with a smarter comparison.</p></div></div>
      <div className="fare-layout">
        <main>
          <section className="fare-planner" aria-label="Trip search">
            <div className="fare-modes" role="group" aria-label="Search type">{MODES.map(({ kind, label, Icon }) => <button key={kind} aria-pressed={trip.kind === kind} className={trip.kind === kind ? 'selected' : ''} onClick={() => change({ kind: kind as TripKind })}><Icon size={17} />{label}</button>)}</div>
            <form onSubmit={e => { e.preventDefault(); search() }}>
              <div className="fare-fields">
                {trip.kind === 'flights' && <AirportInput label="From" value={trip.origin} onChange={origin => change({ origin })} />}
                {trip.kind === 'flights' ? <AirportInput label="Destination" value={trip.destination} onChange={destination => change({ destination })} /> : <label>{trip.kind === 'cars' ? 'Pickup city or airport' : 'Destination'}<input required maxLength={150} value={trip.destination} placeholder="Where are you going?" onChange={e => change({ destination: e.target.value })} /></label>}
                <label>{trip.kind === 'stays' ? 'Check in' : trip.kind === 'cars' ? 'Pickup date' : 'Departure'}<input required type="date" min={localDate()} value={trip.start} onChange={e => change({ start: e.target.value })} /></label>
                <label>{trip.kind === 'stays' ? 'Check out' : trip.kind === 'cars' ? 'Drop-off date' : 'Return'}<input required type="date" min={trip.start} value={trip.end} onChange={e => change({ end: e.target.value })} /></label>
                <label>Adults<select aria-label="Adults" value={trip.travelers} onChange={e => change({ travelers: Number(e.target.value) })}>{Array.from({ length: 9 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
                <label>Total trip budget<div className="fare-budget"><input type="number" min="1" step="any" value={trip.budget} placeholder="Optional" onChange={e => change({ budget: e.target.value })} /><select aria-label="Currency" value={trip.currency} onChange={e => change({ currency: e.target.value })}>{['USD', 'EUR', 'GBP', 'CAD', 'AUD'].map(c => <option key={c}>{c}</option>)}</select></div></label>
              </div>
              <label className="fare-flex"><input type="checkbox" checked={trip.flexible} onChange={e => change({ flexible: e.target.checked })} /> I can shift my dates by up to 3 days</label>
              <div className="fare-actions"><button className="fare-primary" type="submit">Compare providers <ArrowRight size={16} /></button><button type="button" disabled={busy} onClick={() => void runAI()}>{busy ? <Loader2 size={16} className="fare-spin" /> : <Sparkles size={16} />}{busy ? 'Researching…' : 'AI deal research'}</button><button type="button" onClick={save}><BookmarkPlus size={16} /> Save trip</button></div>
              <p className="fare-form-note">Compare opens a supported booking site with your trip details. Compare again to try another site. Final prices and availability are confirmed by the provider.</p>
            </form>
            {error && <p className="fare-error" role="alert">{error}</p>}
            {notice && <p className="fare-notice" role="status">{notice}</p>}
          </section>
          {saved.find(item => item.id === costTripId) && (() => { const item = saved.find(savedItem => savedItem.id === costTripId)!; return <TripCostBoard trip={item.trip} estimate={item.estimate} onChange={estimate => updateEstimate(item.id, estimate)} /> })()}
          {searched && <DestinationGallery trip={searched} onNavigate={onOpenBooking} />}
          {searched && <section className="fare-results" aria-label="Provider comparisons"><div className="fare-section-heading"><h2>Compare your options</h2><span>Searches, not live quotes</span></div><p>{tripDescription(searched)}</p><div className="fare-provider-list">{bookingSearches(searched).map(p => <button key={p.name} onClick={() => onOpenBooking(p.url)}><div><strong>{p.name}</strong><span>{p.detail}</span></div><ExternalLink size={17} /></button>)}</div><small>Confirm dates, travelers, currency and the final total on the provider’s page. Availability and prices can change. Car pickup times and driver age are selected with the rental provider.</small></section>}
          {busy && <div className="fare-research" role="status"><Loader2 size={18} className="fare-spin" /> Searching travel sources and preparing your comparison…</div>}
          {research && <section className="fare-research" aria-label="AI travel research"><div className="fare-section-heading"><h2><Sparkles size={18} /> Your comparison brief</h2><span>{new Date(research.at).toLocaleString()}</span></div><ResearchBrief research={research} onNavigate={onNavigate} /><h3>Research sources</h3><div className="fare-sources">{research.sources.map((s, i) => <button key={`${s.url}-${i}`} onClick={() => onNavigate(s.url)}><span>[{i + 1}] {s.title}</span><small>{new URL(s.url).hostname}</small></button>)}</div><small>Prepared with {research.provider}. Search excerpts are research, not confirmed fares. Check the final price before booking.</small></section>}
          {!searched && <section className="fare-empty"><h2>Find the value behind the price.</h2><p>Compare providers for your dates, then ask AI what to check: nearby airports, flexible dates, baggage, insurance and cancellation terms.</p><div><span>01 · Plan the trip</span><span>02 · Compare the full cost</span><span>03 · Book with the provider</span></div></section>}
        </main>
        <aside className="fare-aside">
          <section><h2>Before you book</h2><ul>{(trip.kind === 'flights' ? ['Include checked bags and seat fees.', 'Compare nearby airports and extra transfer costs.', 'Check layover length and separate-ticket connections.', 'Compare the airline’s direct price.'] : trip.kind === 'cars' ? ['Check the deposit and credit-card requirements.', 'Compare full insurance and excess charges.', 'Confirm mileage and fuel policy.', 'Check driver age, pickup hours and cancellation.'] : ['Include cleaning fees, taxes and deposits.', 'Compare cancellation deadlines.', 'Check the location and transport costs.', 'Read recent reviews and confirm check-in rules.']).map(t => <li key={t}>{t}</li>)}</ul></section>
          <section><h2>Saved trips <span>{saved.length}/20</span></h2>{!saved.length && <p>Your saved plans stay on this device.</p>}{saved.map(s => <div className="fare-saved" key={s.id}><button onClick={() => restore(s.trip)}><strong>{s.trip.destination}</strong><span>{s.trip.kind} · {s.trip.start} → {s.trip.end}</span></button><button aria-label={`Open cost board for ${s.trip.destination}`} title="Open trip cost board" onClick={() => setCostTripId(s.id)}><Wallet size={15} /></button><button aria-label={`Remove saved trip to ${s.trip.destination}`} onClick={() => { if (costTripId === s.id) setCostTripId(''); persist(saved.filter(x => x.id !== s.id)) }}><Trash2 size={15} /></button></div>)}</section>
        </aside>
      </div>
    </div>
  </div>
}
