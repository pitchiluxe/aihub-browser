import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Plane, Car, House, ArrowRight, BookmarkPlus, Trash2, Sparkles, Loader2, ArrowLeft, ExternalLink, Wallet, Bell } from 'lucide-react'
import { bookingSearches, chooseBookingSearch, localDate, readSavedTrips, researchTrip, SAVED_TRIPS_KEY, tripDescription, validateTrip, type Research, type SavedTrip, type Trip, type TripKind } from './flightsRentals'
import { createTripEstimate, validateTripEstimate } from './tripCosts'
import TripCostBoard from './TripCostBoard'
import AirportInput from './AirportInput'
import ResearchBrief from './ResearchBrief'
import DestinationGallery from './DestinationGallery'
import { resolveAirport } from './airports'
import { FLIGHTS_PREFILL_KEY } from './flightsRentals'
import { useFareSearch } from './fares/useFareSearch'
import { fetchAiPick } from './fares/aiPick'
import SourceChips from './fares/SourceChips'
import FlexDateStrip from './fares/FlexDateStrip'
import AiPickCard from './fares/AiPickCard'
import FareTable from './fares/FareTable'
import { AlertForm, AlertList } from './fares/PriceAlerts'
import { streamChat } from '../../services/streamingChat'
import type { FareRow } from '../../../../shared/fares/rank'
import type { FareQuery } from '../../../../shared/fares/types'
import './flightsRentals.css'

export function tripToQuery(t: Trip): FareQuery | null {
  if (t.kind !== 'flights') return null
  const from = resolveAirport(t.origin)?.iata, to = resolveAirport(t.destination)?.iata
  if (!from || !to || from === to) return null
  // Live fares are USD-first (spec assumption): the table prints "$" and the
  // bag-fee estimates are USD, so asking sites for euros would mix currencies.
  return { from, to, depart: t.start, ret: t.end, adults: t.travelers, currency: 'USD' }
}

/** "EWR → FIH · Nov 1–15" — how an alert is named in the list and the notification. */
export function alertTitle(q: FareQuery): string {
  const d = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `${q.from} → ${q.to} · ${d(q.depart)}${q.ret ? `–${d(q.ret)}` : ''}`
}

const MODES = [{ kind: 'flights', label: 'Flights', Icon: Plane }, { kind: 'cars', label: 'Car rentals', Icon: Car }, { kind: 'stays', label: 'Vacation stays', Icon: House }] as const
function initialTrip(): Trip {
  const start = new Date(); start.setDate(start.getDate() + 14)
  const end = new Date(start); end.setDate(end.getDate() + 7)
  return { kind: 'flights', origin: '', destination: '', start: localDate(start), end: localDate(end), travelers: 1, budget: '', currency: 'USD', flexible: true }
}
/**
 * Travel the World hands over a destination airport code.
 *
 * Read-only on purpose: React may run this initializer, throw the render away
 * (a lazy chunk suspending) and run it again. Deleting the key here lost the
 * destination on the retry; the key is consumed in an effect once mounted.
 */
function initialTripWithPrefill(): Trip {
  const t = initialTrip()
  try {
    const code = localStorage.getItem(FLIGHTS_PREFILL_KEY)
    if (code) return { ...t, destination: code }
  } catch {}
  return t
}
function loadSaved(): SavedTrip[] {
  try { return readSavedTrips(localStorage.getItem(SAVED_TRIPS_KEY)) } catch { return [] }
}
export default function FlightsRentalsPage({ onNavigate, onOpenBooking = onNavigate }: { onNavigate: (url: string) => void; onOpenBooking?: (url: string) => void }) {
  const [trip, setTrip] = useState<Trip>(initialTripWithPrefill)
  const [searched, setSearched] = useState<Trip | null>(null)
  const [saved, setSaved] = useState<SavedTrip[]>(loadSaved)
  const [costTripId, setCostTripId] = useState('')
  const [research, setResearch] = useState<Research | null>(null)
  const [draft, setDraft] = useState<Research | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const generation = useRef(0)
  const previousProvider = useRef<Partial<Record<TripKind, string>>>({})
  useEffect(() => () => { generation.current++ }, [])
  // Committed mount: now the hand-over can be consumed safely.
  useEffect(() => { try { localStorage.removeItem(FLIGHTS_PREFILL_KEY) } catch {} }, [])
  const fares = useFareSearch()
  const [handoff, setHandoff] = useState<{ name: string; url: string }[]>([])
  const [rows, setRows] = useState<FareRow[]>([])
  const [pick, setPick] = useState<{ key: string; reason: string } | null>(null)
  const [picking, setPicking] = useState(false)
  const query = tripToQuery(trip)

  const runLive = () => {
    const err = validateTrip(trip); setError(err || '')
    if (err || !query) return
    setPick(null); setPicking(false); setRows([]); setSearched({ ...trip }); setNotice('')
    void fares.start(query)
    void (window as any).electronAPI?.fares?.handoff(query).then((l: any) => setHandoff(Array.isArray(l) ? l : [])).catch(() => setHandoff([]))
  }

  // One AI pick per finished search, from the ranked rows only. Keyed to the
  // search id: a slow local model can answer after the user has searched
  // again, and that late answer must neither show nor block the new pick.
  const pickFor = useRef<string | null>(null)
  const currentSearch = useRef<string | null>(null)
  currentSearch.current = fares.state.searchId
  useEffect(() => {
    const id = fares.state.searchId
    if (fares.state.phase !== 'done' || !id || rows.length < 2 || pickFor.current === id) return
    const chat = (window as any).electronAPI?.ai?.chat
    if (!chat) return
    pickFor.current = id
    setPicking(true)
    void fetchAiPick(rows, { adults: trip.travelers, needs: { carry: true, checked: false } }, m => chat(m))
      .then(p => { if (currentSearch.current === id) { setPick(p); setPicking(false) } })
  }, [fares.state.phase, fares.state.searchId, rows, trip.travelers])

  const onRowsRanked = useCallback((r: FareRow[]) => setRows(r), [])
  const openVisible = (url: string) => { void (window as any).electronAPI?.fares?.openSite(url) }
  const allFailed = fares.state.phase === 'done' && fares.state.offers.length === 0
  // The same number the alert checks compare against: the lowest round-trip offer.
  const lowestFare = fares.state.offers.length ? Math.round(Math.min(...fares.state.offers.map(o => o.price))) : null
  const [alertFor, setAlertFor] = useState('')
  const openAlert = (q: FareQuery) => change({ kind: 'flights', origin: q.from, destination: q.to, start: q.depart, end: q.ret ?? q.depart, travelers: q.adults })

  const change = (patch: Partial<Trip>) => {
    fares.cancel(); setPick(null); setPicking(false); setRows([]); setHandoff([])
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
    setBusy(true); setError(''); setResearch(null); setDraft(null); setSearched({ ...trip })
    // Streamed: the brief fills in as the model writes it, instead of a minute of spinner.
    const streaming = { ...ai, stream: (m: any[], onPartial: (text: string) => void) => streamChat(m, undefined, onPartial) }
    try { const result = await researchTrip(trip, streaming, draft => { if (generation.current === id) setDraft(draft) }); if (generation.current === id) setResearch(result) }
    catch (e) { if (generation.current === id) setError(e instanceof Error ? e.message : 'Research failed. Please retry.') }
    finally { if (generation.current === id) { setBusy(false); setDraft(null) } }
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
            <div className="fare-modes" role="group" aria-label="Search type">{MODES.map(({ kind, label, Icon }) => <button key={kind} aria-pressed={trip.kind === kind} className={trip.kind === kind ? 'selected' : ''} onClick={() => change({ kind: kind as TripKind })}><Icon size={17} />{label}{kind !== 'flights' && <span className="fare-soon">live prices coming soon</span>}</button>)}</div>
            <form onSubmit={e => { e.preventDefault(); if (trip.kind === 'flights') runLive(); else search() }}>
              <div className="fare-fields">
                {trip.kind === 'flights' && <AirportInput label="From" value={trip.origin} onChange={origin => change({ origin })} />}
                {trip.kind === 'flights' ? <AirportInput label="Destination" value={trip.destination} onChange={destination => change({ destination })} /> : <label>{trip.kind === 'cars' ? 'Pickup city or airport' : 'Destination'}<input required maxLength={150} value={trip.destination} placeholder="Where are you going?" onChange={e => change({ destination: e.target.value })} /></label>}
                <label>{trip.kind === 'stays' ? 'Check in' : trip.kind === 'cars' ? 'Pickup date' : 'Departure'}<input required type="date" min={localDate()} value={trip.start} onChange={e => change({ start: e.target.value })} /></label>
                <label>{trip.kind === 'stays' ? 'Check out' : trip.kind === 'cars' ? 'Drop-off date' : 'Return'}<input required type="date" min={trip.start} value={trip.end} onChange={e => change({ end: e.target.value })} /></label>
                <label>Adults<select aria-label="Adults" value={trip.travelers} onChange={e => change({ travelers: Number(e.target.value) })}>{Array.from({ length: 9 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
                <label>Total trip budget<div className="fare-budget"><input type="number" min="1" step="any" value={trip.budget} placeholder="Optional" onChange={e => change({ budget: e.target.value })} /><select aria-label="Currency" value={trip.currency} onChange={e => change({ currency: e.target.value })}>{['USD', 'EUR', 'GBP', 'CAD', 'AUD'].map(c => <option key={c}>{c}</option>)}</select></div></label>
              </div>
              <label className="fare-flex"><input type="checkbox" checked={trip.flexible} onChange={e => change({ flexible: e.target.checked })} /> I can shift my dates by up to 3 days</label>
              <div className="fare-actions"><button className="fare-primary" type="submit">{trip.kind === 'flights' ? 'Find live fares' : 'Compare providers'} <ArrowRight size={16} /></button>{trip.kind === 'flights' && <button type="button" onClick={search}><ExternalLink size={16} /> Open a booking site</button>}<button type="button" disabled={busy} onClick={() => void runAI()}>{busy ? <Loader2 size={16} className="fare-spin" /> : <Sparkles size={16} />}{busy ? 'Researching…' : 'AI deal research'}</button><button type="button" onClick={save}><BookmarkPlus size={16} /> Save trip</button></div>
              <p className="fare-form-note">Compare opens a supported booking site with your trip details. Compare again to try another site. Final prices and availability are confirmed by the provider.</p>
            </form>
            {error && <p className="fare-error" role="alert">{error}</p>}
            {notice && <p className="fare-notice" role="status">{notice}</p>}
          </section>
          {saved.find(item => item.id === costTripId) && (() => { const item = saved.find(savedItem => savedItem.id === costTripId)!; return <TripCostBoard trip={item.trip} estimate={item.estimate} onChange={estimate => updateEstimate(item.id, estimate)} /> })()}
          {trip.kind === 'flights' && fares.state.phase !== 'idle' && <section className="fare-live" aria-label="Live fares">
            {fares.state.phase === 'private' && <p className="fare-notice">Live fares are off in Incognito windows — booking sites would store cookies. Use “Open a booking site” instead.</p>}
            <SourceChips sites={fares.state.sites} onOpenSite={onOpenBooking} onOpenVisible={openVisible} />
            {query && <FlexDateStrip days={fares.state.flex} current={query.depart}
              currentPrice={rows.length ? Math.min(...rows.map(r => r.best)) : null}
              onPick={(depart, ret) => change({ start: depart, end: ret })} />}
            <AiPickCard row={rows.find(r => r.key === pick?.key) ?? null} reason={pick?.reason ?? ''} loading={picking} />
            {fares.state.offers.length > 0 && <FareTable offers={fares.state.offers} adults={trip.travelers} onBook={onOpenBooking} onRowsRanked={onRowsRanked} />}
            {query && fares.state.phase === 'done' && lowestFare !== null && <AlertForm key={fares.state.searchId ?? ''} query={query} title={alertTitle(query)} lowest={lowestFare} budget={trip.budget} onDone={setNotice} />}
            {(allFailed || fares.state.phase === 'error') && <p className="fare-notice">No site could be read just now. These open with your trip filled in:</p>}
            {fares.state.phase !== 'searching' && handoff.length > 0 && <div className="fare-handoff">{handoff.map(h => <button key={h.name} onClick={() => onOpenBooking(h.url)}>{h.name} <ExternalLink size={12} /></button>)}</div>}
            <p className="fare-form-note">Prices found on each site moments ago. Final price and availability are confirmed on the booking site.</p>
          </section>}
          {searched && <DestinationGallery trip={searched} onNavigate={onOpenBooking} />}
          {searched && trip.kind !== 'flights' && <section className="fare-results" aria-label="Provider comparisons"><div className="fare-section-heading"><h2>Compare your options</h2><span>Searches, not live quotes</span></div><p>{tripDescription(searched)}</p><div className="fare-provider-list">{bookingSearches(searched).map(p => <button key={p.name} onClick={() => onOpenBooking(p.url)}><div><strong>{p.name}</strong><span>{p.detail}</span></div><ExternalLink size={17} /></button>)}</div><small>Confirm dates, travelers, currency and the final total on the provider’s page. Availability and prices can change. Car pickup times and driver age are selected with the rental provider.</small></section>}
          {busy && <div className="fare-research" role="status"><Loader2 size={18} className="fare-spin" /> {draft ? `Writing your comparison from ${draft.sources.length} sources…` : 'Searching travel sources and preparing your comparison…'}{draft && <ResearchBrief research={draft} onNavigate={onNavigate} />}</div>}
          {research && <section className="fare-research" aria-label="AI travel research"><div className="fare-section-heading"><h2><Sparkles size={18} /> Your comparison brief</h2><span>{new Date(research.at).toLocaleString()}</span></div><ResearchBrief research={research} onNavigate={onNavigate} /><h3>Research sources</h3><div className="fare-sources">{research.sources.map((s, i) => <button key={`${s.url}-${i}`} onClick={() => onNavigate(s.url)}><span>[{i + 1}] {s.title}</span><small>{new URL(s.url).hostname}</small></button>)}</div><small>Prepared with {research.provider}. Search excerpts are research, not confirmed fares. Check the final price before booking.</small></section>}
          {!searched && <section className="fare-empty"><h2>Find the value behind the price.</h2><p>Compare providers for your dates, then ask AI what to check: nearby airports, flexible dates, baggage, insurance and cancellation terms.</p><div><span>01 · Plan the trip</span><span>02 · Compare the full cost</span><span>03 · Book with the provider</span></div></section>}
        </main>
        <aside className="fare-aside">
          <section><h2>Before you book</h2><ul>{(trip.kind === 'flights' ? ['Include checked bags and seat fees.', 'Compare nearby airports and extra transfer costs.', 'Check layover length and separate-ticket connections.', 'Compare the airline’s direct price.'] : trip.kind === 'cars' ? ['Check the deposit and credit-card requirements.', 'Compare full insurance and excess charges.', 'Confirm mileage and fuel policy.', 'Check driver age, pickup hours and cancellation.'] : ['Include cleaning fees, taxes and deposits.', 'Compare cancellation deadlines.', 'Check the location and transport costs.', 'Read recent reviews and confirm check-in rules.']).map(t => <li key={t}>{t}</li>)}</ul></section>
          <section><h2>Saved trips <span>{saved.length}/20</span></h2>{!saved.length && <p>Your saved plans stay on this device.</p>}{saved.map(s => { const sq = tripToQuery(s.trip); return <React.Fragment key={s.id}><div className="fare-saved"><button onClick={() => restore(s.trip)}><strong>{s.trip.destination}</strong><span>{s.trip.kind} · {s.trip.start} → {s.trip.end}</span></button>{sq && <button aria-label={`Watch price for ${s.trip.destination}`} aria-expanded={alertFor === s.id} title="Alert me when the price drops" onClick={() => setAlertFor(alertFor === s.id ? '' : s.id)}><Bell size={15} /></button>}<button aria-label={`Open cost board for ${s.trip.destination}`} title="Open trip cost board" onClick={() => setCostTripId(s.id)}><Wallet size={15} /></button><button aria-label={`Remove saved trip to ${s.trip.destination}`} onClick={() => { if (costTripId === s.id) setCostTripId(''); persist(saved.filter(x => x.id !== s.id)) }}><Trash2 size={15} /></button></div>
                {sq && alertFor === s.id && <AlertForm query={sq} title={alertTitle(sq)} lowest={null} budget={s.trip.budget} onDone={m => { setAlertFor(''); setNotice(m) }} />}</React.Fragment> })}</section>
          {trip.kind === 'flights' && <AlertList onOpen={openAlert} />}
        </aside>
      </div>
    </div>
  </div>
}
