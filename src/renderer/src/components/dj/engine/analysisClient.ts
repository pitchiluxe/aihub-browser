// Runs deck analysis in a worker so loading a song never freezes the browser
// UI (measured 2026-10-12: 0.65–0.93 s per local file on the UI thread, plus
// ~0.3 s building the scratch buffer — enough, with other load, to tip Windows
// into "Not Responding"). Falls back to the UI thread only when no worker can
// run, or the worker fails — never hangs.
import { analyze, type Analysis } from './analysis'
import { scratchCopy } from './scratchCopy'

export interface WorkerLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent) => void) | null
  onerror: ((e: ErrorEvent) => void) | null
}
export interface Scratch { data: Float32Array; rate: number }
interface Reply { analysis: Analysis; scratch?: Scratch }

let shared: WorkerLike | null | undefined
function defaultWorker(): WorkerLike | null {
  if (shared !== undefined) return shared
  try {
    shared = typeof Worker === 'undefined' ? null : new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike
  } catch { shared = null }
  return shared
}

let seq = 0
const pending = new Map<number, { resolve: (r: Reply) => void; fallback: () => void }>()
const wired = new WeakSet<WorkerLike>()

function run(channels: Float32Array[], sampleRate: number, withScratch: boolean, getWorker: () => WorkerLike | null): Promise<Reply> {
  const here = (): Reply => ({ analysis: analyze(channels, sampleRate), ...(withScratch ? { scratch: scratchCopy(channels, sampleRate) } : {}) })
  const w = getWorker()
  if (!w) return Promise.resolve(here())
  if (!wired.has(w)) {
    wired.add(w)
    w.onmessage = e => {
      const { id, analysis, scratch, error } = e.data as { id: number; analysis?: Analysis; scratch?: Scratch; error?: string }
      const p = pending.get(id); if (!p) return
      pending.delete(id)
      if (analysis && !error) p.resolve({ analysis, scratch }); else p.fallback()
    }
    // A broken worker fails every job still waiting on it.
    w.onerror = () => { for (const [id, p] of pending) { pending.delete(id); p.fallback() } }
  }
  // Copies: the originals are the decoded AudioBuffer's data, still needed here.
  const copies = channels.map(c => c.slice())
  const id = ++seq
  return new Promise<Reply>(resolve => {
    pending.set(id, { resolve, fallback: () => resolve(here()) })
    try { w.postMessage({ id, channels: copies, sampleRate, withScratch }, copies.map(c => c.buffer)) }
    catch { pending.delete(id); resolve(here()) }
  })
}

/** Tempo, key and waveform envelope, measured in the worker. */
export async function analyzeOffThread(channels: Float32Array[], sampleRate: number, getWorker: () => WorkerLike | null = defaultWorker): Promise<Analysis> {
  return (await run(channels, sampleRate, false, getWorker)).analysis
}

/** Everything a freshly decoded deck needs: the analysis and its scratch buffer. */
export async function prepareDeckOffThread(channels: Float32Array[], sampleRate: number, getWorker: () => WorkerLike | null = defaultWorker): Promise<{ analysis: Analysis; scratch: Scratch }> {
  const r = await run(channels, sampleRate, true, getWorker)
  return { analysis: r.analysis, scratch: r.scratch ?? scratchCopy(channels, sampleRate) }
}
