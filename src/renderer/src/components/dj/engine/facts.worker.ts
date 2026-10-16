import { measureFacts } from './measureFacts'
import type { TempoHint } from './analysis'

self.onmessage = (e: MessageEvent<{ id: number; pcm: Float32Array; rate: number; tempo?: TempoHint }>) => {
  const { id, pcm, rate, tempo } = e.data
  try { (self as any).postMessage({ id, facts: measureFacts(pcm, rate, tempo) }) }
  catch (err) { (self as any).postMessage({ id, error: String(err) }) }
}
