import { parentPort } from 'node:worker_threads'
import { rankDocs } from './semantic'
import type { SearchDoc } from './semantic'

const uploads = new Map<number, { docs: SearchDoc[]; vectors: Map<string, number[]> }>()

parentPort?.on('message', ({ id, args, chunk, entries, query, vector, now }) => {
  if (chunk) {
    let upload = uploads.get(id)
    if (!upload) {
      if (uploads.size >= 4) return
      upload = { docs: [], vectors: new Map() }; uploads.set(id, upload)
    }
    upload.docs.push(...chunk)
    for (const [key, value] of entries || []) upload.vectors.set(key, value)
    return
  }
  const upload = uploads.get(id)
  uploads.delete(id)
  try { parentPort!.postMessage({ id, results: args ? rankDocs(...args as Parameters<typeof rankDocs>) : rankDocs(upload?.docs || [], query, vector, upload?.vectors || new Map(), now) }) }
  catch { parentPort!.postMessage({ id, error: 'Ranking failed' }) }
})
