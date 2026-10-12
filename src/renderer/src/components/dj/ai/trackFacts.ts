// In-memory view of the main-process facts store. Reads are synchronous for
// the planner; `load` fills the cache for a batch of candidates first.
import type { TrackFacts } from './types'

const cache = new Map<string, TrackFacts>()
const api = () => (window as any).electronAPI?.dj?.facts

export const factsCache = {
  get(id: string): TrackFacts | null { return cache.get(id) ?? null },
  async load(ids: string[]): Promise<void> {
    const missing = ids.filter(id => !cache.has(id))
    if (!missing.length || !api()) return
    try {
      const got = await api().getMany(missing) as Record<string, TrackFacts>
      for (const [id, f] of Object.entries(got || {})) cache.set(id, f)
    } catch { /* offline store: measure again */ }
  },
  put(id: string, f: TrackFacts): void {
    cache.set(id, f)
    void api()?.put(id, f).catch(() => {})
  },
}
