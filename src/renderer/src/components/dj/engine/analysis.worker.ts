import { analyze } from './analysis'
import { scratchCopy } from './scratchCopy'

// Deck analysis (envelope, tempo, key) and the scratch buffer off the UI thread:
// on a 4-minute song they are ~1 s of CPU, and the DJ console shares its thread
// with the whole browser UI.
self.onmessage = (e: MessageEvent<{ id: number; channels: Float32Array[]; sampleRate: number; withScratch?: boolean }>) => {
  const { id, channels, sampleRate, withScratch } = e.data
  try {
    const analysis = analyze(channels, sampleRate)
    const scratch = withScratch ? scratchCopy(channels, sampleRate) : undefined
    const transfer: Transferable[] = [analysis.env.amp.buffer, analysis.env.low.buffer]
    if (scratch) transfer.push(scratch.data.buffer)
    ;(self as any).postMessage({ id, analysis, scratch }, transfer)
  } catch (err) {
    ;(self as any).postMessage({ id, error: String(err) })
  }
}
