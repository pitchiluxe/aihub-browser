import { measureFacts } from './measureFacts'

self.onmessage = (e: MessageEvent<{ id: number; pcm: Float32Array; rate: number }>) => {
  const { id, pcm, rate } = e.data
  try { (self as any).postMessage({ id, facts: measureFacts(pcm, rate) }) }
  catch (err) { (self as any).postMessage({ id, error: String(err) }) }
}
