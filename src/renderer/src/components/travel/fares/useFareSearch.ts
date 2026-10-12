// src/renderer/src/components/travel/fares/useFareSearch.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FareOffer, FareQuery, SiteId } from '../../../../../shared/fares/types'

export type SiteStatus = 'loading' | 'done' | 'cached' | 'blocked' | 'unreadable' | 'empty' | 'timeout' | 'error'
export interface SiteProgress { searchId: string; site: SiteId; label: string; status: SiteStatus; offers: FareOffer[]; url: string; at: number }
export interface FlexDay { depart: string; ret: string; price: number | null }
export interface SiteState { site: SiteId; label: string; status: SiteStatus; count: number; url: string; at: number }
export interface FareSearchState { phase: 'idle' | 'searching' | 'done' | 'private' | 'error'; sites: SiteState[]; offers: FareOffer[]; flex: FlexDay[] }

export const initialFareState = (): FareSearchState => ({ phase: 'idle', sites: [], offers: [], flex: [] })

/** Pure: fold one progress event into the state. Stale searches are ignored. */
export function reduceProgress(state: FareSearchState, p: SiteProgress, activeId: string | null): FareSearchState {
  if (!activeId || p.searchId !== activeId) return state
  const site: SiteState = { site: p.site, label: p.label, status: p.status, count: p.offers.length, url: p.url, at: p.at }
  const sites = state.sites.some(s => s.site === p.site)
    ? state.sites.map(s => s.site === p.site ? site : s)
    : [...state.sites, site]
  const offers = p.status === 'loading' ? state.offers : [...state.offers.filter(o => o.source !== p.site), ...p.offers]
  const allFinal = sites.length > 0 && sites.every(s => s.status !== 'loading')
  return { ...state, sites, offers, phase: allFinal ? 'done' : state.phase }
}

export function useFareSearch() {
  const [state, setState] = useState<FareSearchState>(initialFareState)
  const active = useRef<string | null>(null)
  const api = (window as any).electronAPI?.fares

  useEffect(() => {
    if (!api) return
    const offP = api.onProgress((p: SiteProgress) => setState(s => reduceProgress(s, p, active.current)))
    const offF = api.onFlexDay((d: FlexDay) => setState(s => s.phase === 'idle' ? s : { ...s, flex: [...s.flex.filter(x => x.depart !== d.depart), d].sort((a, b) => a.depart.localeCompare(b.depart)) }))
    return () => { offP(); offF(); if (active.current) void api.cancel(active.current) }
  }, [api])

  const cancel = useCallback(() => {
    if (active.current && api) void api.cancel(active.current)
    active.current = null
    setState(initialFareState())
  }, [api])

  const start = useCallback(async (q: FareQuery) => {
    if (!api) { setState({ ...initialFareState(), phase: 'error' }); return }
    if (active.current) void api.cancel(active.current)
    active.current = null
    setState({ ...initialFareState(), phase: 'searching' })
    const res = await api.search(q)
    if (res?.error === 'private') { setState({ ...initialFareState(), phase: 'private' }); return }
    if (!res?.searchId) { setState({ ...initialFareState(), phase: 'error' }); return }
    active.current = res.searchId
    // Flex strip runs after the main search; failures just leave it empty.
    void (async () => {
      const id = res.searchId
      while (active.current === id) {
        await new Promise(r => setTimeout(r, 1000))
        let finished = false
        setState(s => { finished = s.phase === 'done'; return s })
        if (finished) break
      }
      if (active.current === id) void api.flex(q).catch(() => {})
    })()
  }, [api])

  return { state, start, cancel }
}
