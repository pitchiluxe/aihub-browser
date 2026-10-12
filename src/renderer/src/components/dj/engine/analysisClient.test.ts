import { describe, it, expect } from 'vitest'
import { analyzeOffThread, prepareDeckOffThread, type WorkerLike } from './analysisClient'
import { analyze } from './analysis'
import { scratchCopy } from './scratchCopy'

const tone = (n: number) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = Math.sin(i / 7) * (i % 4410 < 400 ? 1 : 0.1); return a }

/** A worker that answers like analysis.worker.ts, on the next tick. */
function fakeWorker(mode: 'ok' | 'error' = 'ok') {
  const sent: any[] = []
  const w: WorkerLike & { sent: any[] } = {
    sent,
    onmessage: null, onerror: null,
    postMessage(msg: any, transfer?: Transferable[]) {
      sent.push({ msg, transfer })
      setTimeout(() => {
        if (mode === 'error') { w.onerror?.({ message: 'boom' } as any); return }
        w.onmessage?.({ data: { id: msg.id, analysis: analyze(msg.channels, msg.sampleRate), ...(msg.withScratch ? { scratch: scratchCopy(msg.channels, msg.sampleRate) } : {}) } } as any)
      }, 0)
    },
  }
  return w
}

describe('prepareDeckOffThread — analysis AND the scratch buffer off the UI thread', () => {
  it('returns the analysis plus the half-rate mono scratch copy', async () => {
    const ch = tone(44100 * 2)
    const w = fakeWorker()
    const { analysis, scratch } = await prepareDeckOffThread([ch, ch], 44100, () => w)
    expect(analysis.env.rate).toBe(100)
    expect(scratch).toEqual(scratchCopy([ch, ch], 44100))
    expect(w.sent[0].msg.withScratch).toBe(true)
  })
  it('falls back to the UI thread when the worker fails', async () => {
    const ch = tone(22050)
    const { scratch } = await prepareDeckOffThread([ch], 22050, () => fakeWorker('error'))
    expect(scratch.rate).toBe(22050)
  })
})

describe('analyzeOffThread — deck analysis never blocks the browser UI', () => {
  it('runs the analysis in the worker and resolves with its result', async () => {
    const ch = tone(44100 * 3)
    const w = fakeWorker()
    const a = await analyzeOffThread([ch], 44100, () => w)
    expect(w.sent).toHaveLength(1)
    expect(a.env.amp.length).toBe(analyze([ch], 44100).env.amp.length)
  })

  it('sends copies, so the decoded AudioBuffer data stays usable for playback', async () => {
    const ch = tone(44100)
    const w = fakeWorker()
    await analyzeOffThread([ch], 44100, () => w)
    expect(ch.length).toBe(44100)                       // not detached
    expect(w.sent[0].msg.channels[0]).not.toBe(ch)
    expect(w.sent[0].transfer.length).toBe(1)           // the copy is transferred, not cloned again
  })

  it('falls back to analysing here when the worker fails — never hangs', async () => {
    const ch = tone(44100)
    const a = await analyzeOffThread([ch], 44100, () => fakeWorker('error'))
    expect(a.env.amp.length).toBe(analyze([ch], 44100).env.amp.length)
  })

  it('falls back when workers are unavailable', async () => {
    const ch = tone(44100)
    const a = await analyzeOffThread([ch], 44100, () => null)
    expect(a.env.rate).toBe(100)
  })
})
