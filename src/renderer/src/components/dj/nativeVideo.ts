// Native deck video: a YouTube deck's player is shown directly over the page's
// video area (by the main process, as a view in this window), so it plays at
// YouTube's own frame rate — the canvas copy of a hidden, captured player
// managed 4–14 fps (measured 2026-10-12). A native view cannot be blended or
// drawn over, so: one deck's picture at a time (the one the mix favours), and
// whenever anything on the page covers the area — a menu, a drawer, a dialog —
// the view is hidden and the canvas underneath (the old path) shows instead.
import { useEffect } from 'react'
import { crossfadeGains, deckSide, faderGain, type Deck, type DeckId, type DjEngine } from './engine/DjEngine'
import { ytBridge } from './engine/youtubeDeck'

type DeckLike = Pick<Deck, 'id' | 'track' | 'active' | 'held' | 'volume'>

/** The deck whose YouTube player should be shown, or null (canvas shows covers / local video). */
export function pickNativeDeck(decks: DeckLike[], crossfader: number): DeckId | null {
  const live = decks.filter(d => !!d.track && (d.active || d.held))
  if (!live.length) return null
  const xg = crossfadeGains(crossfader)
  const top = live.map(d => ({ d, w: xg[deckSide(d.id)] * faderGain(d.volume) })).sort((a, b) => b.w - a.w)[0].d
  return top.track?.youtubeId ? top.id : null
}

/** Which video area last placed each deck's player: only that area may hide it. */
const placedBy = new Map<DeckId, symbol>()

/** Re-checked this often: placement follows layout changes, and covers are noticed within it. */
const CHECK_MS = 200

/** True when nothing on the page covers `el` (sampled at its centre and near each corner). */
function uncovered(el: Element, r: DOMRect): boolean {
  const ix = Math.min(12, r.width / 4), iy = Math.min(12, r.height / 4)
  const pts: [number, number][] = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + ix, r.top + iy], [r.right - ix, r.top + iy], [r.left + ix, r.bottom - iy], [r.right - ix, r.bottom - iy]]
  for (const [x, y] of pts) {
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false
    const top = document.elementFromPoint(x, y)
    if (!top || !el.contains(top)) return false
  }
  return true
}

/**
 * Keep the right deck's YouTube player over `ref`'s element while it is on
 * screen and uncovered; hide every player otherwise (and on unmount).
 */
export function useNativeVideo(engine: DjEngine, ref: React.RefObject<HTMLElement>, enabled: boolean): void {
  useEffect(() => {
    const bridge = ytBridge()
    if (!bridge?.show) return
    const ids: DeckId[] = ['A', 'B']
    let shown: { deck: DeckId; key: string } | null = null
    const me = Symbol('video area')
    // Only ever hide what THIS area placed last: another area (the stage over
    // the console) may be showing the same deck right now.
    const hideMine = () => {
      if (shown && placedBy.get(shown.deck) === me) { placedBy.delete(shown.deck); void bridge.show(shown.deck, null) }
      shown = null
    }
    if (!enabled) return
    const tick = () => {
      const el = ref.current
      const r = el?.getBoundingClientRect()
      const deck = !document.hidden && el && r && r.width > 8 && r.height > 8 && uncovered(el, r)
        ? pickNativeDeck(ids.map(id => engine.decks[id]), engine.crossfader) : null
      if (!deck || !r) { hideMine(); return }
      const key = `${deck}|${Math.round(r.left)}|${Math.round(r.top)}|${Math.round(r.width)}|${Math.round(r.height)}`
      if (shown?.key === key && placedBy.get(deck) === me) return
      if (shown && shown.deck !== deck) hideMine()
      placedBy.set(deck, me)
      void bridge.show(deck, { x: r.left, y: r.top, width: r.width, height: r.height })
      shown = { deck, key }
    }
    tick()
    const timer = window.setInterval(tick, CHECK_MS)
    return () => { window.clearInterval(timer); hideMine() }
  }, [engine, ref, enabled])
}
