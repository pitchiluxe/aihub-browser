import { createConnection } from 'node:net'
import { validatePorts, validateReplay } from '../shared/developer'

function probe(port: number): Promise<{ port: number; url: string; reachable: boolean }> {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const done = (reachable: boolean) => { socket.destroy(); resolve({ port, url: `http://localhost:${port}`, reachable }) }
    socket.setTimeout(450)
    socket.once('connect', () => done(true)); socket.once('error', () => done(false)); socket.once('timeout', () => done(false))
  })
}
const port = (process as any).parentPort as {
  on(event: 'message', listener: (event: { data: { id: number; operation: string; input: unknown } }) => void): void
  postMessage(value: unknown): void
}
port.on('message', async ({ data: { id, operation, input } }) => {
  try {
    let result: unknown
    if (operation === 'probe') {
      const ports = validatePorts(input)
      const services: Array<{ port: number; url: string; reachable: boolean }> = []
      for (let offset = 0; offset < ports.length; offset += 8) services.push(...await Promise.all(ports.slice(offset, offset + 8).map(probe)))
      result = services
    } else if (operation === 'replay') {
      const request = validateReplay(input)
      const start = performance.now()
      const response = await fetch(request.url, { ...request, redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(15_000) })
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let body = '', bytes = 0, truncated = false
      try {
        while (reader) {
          const { done, value } = await reader.read()
          if (done) break
          const room = 1_000_000 - bytes
          body += decoder.decode(value.subarray(0, room), { stream: true })
          bytes += value.length
          if (bytes >= 1_000_000) { truncated = true; await reader.cancel(); break }
        }
        body += decoder.decode()
      } finally { reader?.releaseLock() }
      const headers = Object.fromEntries([...response.headers].filter(([name]) => !/set-cookie|authorization/i.test(name)))
      result = { status: response.status, headers, body, truncated, elapsedMs: Math.round(performance.now() - start) }
    } else throw Error('Unknown developer operation.')
    port.postMessage({ id, result })
  } catch (error) { port.postMessage({ id, error: error instanceof Error ? error.message : 'Developer operation failed.' }) }
})
