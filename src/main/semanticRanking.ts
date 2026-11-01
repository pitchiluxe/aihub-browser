import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { rankDocs, type ScoredDoc } from './semantic'

let worker: Worker | null = null
let sequence = 0
const pending = new Map<number, { resolve: (value: ScoredDoc[]) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()

export function stopSemanticWorker() {
  const old = worker
  worker = null
  if (old) void old.terminate()
  for (const request of pending.values()) {
    clearTimeout(request.timer)
    request.reject(new Error('Ranking worker stopped'))
  }
  pending.clear()
}

function getWorker(): Worker {
  if (worker) return worker
  const current = new Worker(join(__dirname, 'semanticRankWorker.js'))
  current.unref()
  current.on('message', ({ id, results, error }) => {
    const request = pending.get(id)
    if (!request) return
    clearTimeout(request.timer); pending.delete(id)
    if (error) request.reject(new Error(error))
    else request.resolve(results)
  })
  current.on('error', () => { if (worker === current) stopSemanticWorker() })
  current.on('exit', () => { if (worker === current) stopSemanticWorker() })
  worker = current
  return current
}

/** Worker failure falls back in small batches, yielding between them. */
export async function rankInBackground(...args: Parameters<typeof rankDocs>): Promise<ScoredDoc[]> {
  try {
    if (pending.size >= 4) throw new Error('Ranking queue full')
    const current = getWorker()
    const id = ++sequence
    return await new Promise<ScoredDoc[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (worker === current) stopSemanticWorker()
      }, 15_000)
      pending.set(id, { resolve, reject, timer })
      void (async () => {
        const [docs, query, vector, vectors, now = Date.now()] = args
        for (let offset = 0; offset < docs.length; offset += 16) {
          if (!pending.has(id)) return
          const chunk = docs.slice(offset, offset + 16)
          const entries = chunk.filter(doc => vectors.has(doc.id)).map(doc => [doc.id, vectors.get(doc.id)])
          current.postMessage({ id, chunk, entries })
          await new Promise<void>(done => setImmediate(done))
        }
        if (pending.has(id)) current.postMessage({ id, query, vector, now })
      })().catch(error => {
        clearTimeout(timer); pending.delete(id); reject(error)
        if (worker === current) stopSemanticWorker()
      })
    })
  } catch {
    const [docs, query, vector, vectors, now = Date.now()] = args
    const results: ScoredDoc[] = []
    for (let offset = 0; offset < docs.length; offset += 32) {
      results.push(...rankDocs(docs.slice(offset, offset + 32), query, vector, vectors, now))
      await new Promise<void>(resolve => setImmediate(resolve))
    }
    return results.sort((a, b) => b.score - a.score)
  }
}
