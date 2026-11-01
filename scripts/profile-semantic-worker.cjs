const { Worker } = require('node:worker_threads')
const { join } = require('node:path')
const assert = require('node:assert/strict')
const { performance } = require('node:perf_hooks')

async function main() {
  const worker = new Worker(join(__dirname, '../out/main/semanticRankWorker.js'))
  let ticks = 0
  let previous = performance.now(), maximumGapMs = 0
  const heartbeat = setInterval(() => {
    const now = performance.now()
    maximumGapMs = Math.max(maximumGapMs, now - previous)
    previous = now; ticks++
  }, 5)
  const docs = Array.from({ length: 2400 }, (_, i) => ({
    id: String(i), title: `Page ${i}`, url: `https://example.com/${i}`,
    text: 'browser rendering worker performance '.repeat(500), ts: Date.now(),
  }))
  const start = performance.now()
  try {
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker timed out')), 30_000)
      worker.once('error', error => { clearTimeout(timeout); reject(error) })
      worker.once('message', value => { clearTimeout(timeout); resolve(value) })
      void (async () => {
        for (let offset = 0; offset < docs.length; offset += 16) {
          worker.postMessage({ id: 1, chunk: docs.slice(offset, offset + 16), entries: [] })
          await new Promise(done => setImmediate(done))
        }
        worker.postMessage({ id: 1, query: 'rendering performance', vector: null, now: Date.now() })
      })().catch(reject)
    })
    assert.equal(result.id, 1)
    assert.equal(result.results.length, docs.length)
    assert.ok(ticks > 0, 'Main event loop must progress during ranking')
    console.log(JSON.stringify({ documents: docs.length, elapsedMs: Math.round(performance.now() - start), mainLoopHeartbeats: ticks, maximumGapMs: Math.round(maximumGapMs) }))
  } finally { clearInterval(heartbeat); await worker.terminate() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
