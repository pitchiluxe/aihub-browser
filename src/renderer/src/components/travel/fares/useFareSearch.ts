// One live fare search, keyed by a single id that every event carries:
// site progress, flex-date days and (in the page) the AI pick. Anything
// tagged with another id belongs to a search the user has moved past.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FareOffer, FareQuery, SiteId } from '../../../../../shared/fares/types'

export type SiteStatus = 'loading' | 'done' | 'cached' | 'blocked' | 'unreadable' | 'empty' | 'timeout' | 'error'
/** `total`: how many sites the search covers (see engine.ts). */
export interface SiteProgress { searchId: string; site: SiteId; label: string; status: SiteStatus; offers: FareOffer[]; url: string; at: number; total?: number }
export interface FlexDay { searchId?: string; depart: string; ret: string; price: number | null }
export interface SiteState { site: SiteId; label: string; status: SiteStatus; count: number; url: string; at: number }
export interface FareSearchState {
  phase: 'idle' | 'searching' | 'done' | 'private' | 'error'
  /** Id of the search these results belong to; null when idle. */
  searchId: string | null
  sites: SiteState[]
  offers: FareOffer[]
  flex: FlexDay[]
}

export const initialFareState = (): FareSearchState => ({ phase: 'idle', searchId: null, sites: [], offers: [], flex: [] })

/** Pure: fold one progress event into the state. Stale searches are ignored. */
export function reduceProgress(state: FareSearchState, p: SiteProgress, activeId: string | null): FareSearchState {
  if (!activeId || p.searchId !== activeId) return state
  const site: SiteState = { site: p.site, label: p.label, status: p.status, count: p.offers.length, url: p.url, at: p.at }
  const sites = state.sites.some(s => s.site === p.site)
    ? state.sites.map(s => s.site === p.site ? site : s)
    : [...state.sites, site]
  const offers = p.status === 'loading' ? state.offers : [...state.offers.filter(o => o.source !== p.site), ...p.offers]
  // A cached site can report before the others have said "loading": only
  // every site the search covers being final means done.
  const heardFromAll = sites.length >= (p.total ?? sites.length)
  const allFinal = sites.length > 0 && heardFromAll && sites.every(s => s.status !== 'loading')
  return { ...state, sites, offers, phase: allFinal ? 'done' : 'searching' }
}

export function useFareSearch() {
  const [state, setState] = useState<FareSearchState>(initialFareState)
  const active = useRef<string | null>(null)
  const query = useRef<FareQuery | null>(null)
  const flexStarted = useRef<string | null>(null)
  const api = (window as any).electronAPI?.fares

  useEffect(() => {
    if (!api) return
    const offP = api.onProgress((p: SiteProgress) => setState(s => reduceProgress(s, p, active.current)))
    const offF = api.onFlexDay((d: FlexDay) => setState(s => {
      if (!d.searchId || d.searchId !== active.current || s.searchId !== d.searchId) return s
      return { ...s, flex: [...s.flex.filter(x => x.depart !== d.depart), d].sort((a, b) => a.depart.localeCompare(b.depart)) }
    }))
    return () => {
      offP(); offF()
      if (active.current) void api.cancel(active.current)
      active.current = null
    }
  }, [api])

  // The flex strip follows the main search: once, for that search, when every
  // site is final. An effect rather than a polling loop, so leaving the page
  // mid-search leaves nothing running.
  useEffect(() => {
    const id = state.searchId
    if (!api || state.phase !== 'done' || !id || id !== active.current || flexStarted.current === id || !query.current) return
    flexStarted.current = id
    void api.flex(query.current, id).catch(() => {})
  }, [api, state.phase, state.searchId])

  const cancel = useCallback(() => {
    if (active.current && api) void api.cancel(active.current)
    active.current = null
    setState(initialFareState())
  }, [api])

  const start = useCallback(async (q: FareQuery) => {
    if (!api) { setState({ ...initialFareState(), phase: 'error' }); return }
    if (active.current) void api.cancel(active.current)
    // The id is ours and set BEFORE the call: main emits each site's
    // `loading` event while the call is still in flight, and those events
    // would otherwise be dropped as stale — no "searching…" chips, and the
    // search declared done as soon as the first site finished.
    const clientId = `fr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    active.current = clientId
    query.current = q
    setState({ ...initialFareState(), phase: 'searching', searchId: clientId })
    const res = await api.search(q, clientId)
    if (active.current !== clientId) return  // superseded while in flight
    if (res?.error === 'private') { setState({ ...initialFareState(), phase: 'private' }); return }
    if (!res?.searchId) { setState({ ...initialFareState(), phase: 'error' }); return }
    if (res.searchId !== clientId) {
      // An older main process that ignores client ids: adopt its id.
      active.current = res.searchId
      setState(s => ({ ...s, searchId: res.searchId }))
    }
  }, [api])

  return { state, start, cancel }
}
