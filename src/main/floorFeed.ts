/**
 * Floor-energy feed for the vibe check: an optional listener on 127.0.0.1 that
 * takes readings from outside the app (a crowd-noise meter, a motion sensor, a
 * lighting desk) and hands them to the suggester.
 *
 *   POST http://127.0.0.1:47800/floor   {"energy": 0.72, "source": "crowd-mic"}
 *
 * Off until the DJ switches it on; loopback only; one number per request.
 * Browsers are refused (see `fromBrowserOrRebound`): a web page open on the
 * same machine must not be able to steer the set.
 */
import http from 'http'

export const FLOOR_PORT = 47800
let server: http.Server | null = null

export function parseFloorReading(body: string): { energy: number; source: string } | null {
  try {
    const j = JSON.parse(body)
    const e = Number(j?.energy)
    if (!Number.isFinite(e)) return null
    // 0..1, or 0..100 from meters that report percent.
    const energy = e > 1 && e <= 100 ? e / 100 : e
    if (energy < 0 || energy > 1) return null
    return { energy, source: typeof j?.source === 'string' ? j.source.slice(0, 40) : 'external' }
  } catch { return null }
}

/**
 * A request a web page could have made: browsers always send Origin on a
 * cross-site POST, and a JSON Content-Type forces a preflight this server never
 * answers. A Host other than the loopback address is DNS rebinding.
 */
export function fromBrowserOrRebound(h: { origin?: string; host?: string; 'content-type'?: string }): boolean {
  if (h.origin !== undefined) return true
  if (!/^application\/json/i.test(h['content-type'] || '')) return true
  return h.host !== `127.0.0.1:${FLOOR_PORT}` && h.host !== `localhost:${FLOOR_PORT}`
}

export function setFloorFeed(on: boolean, send: (reading: { energy: number; source: string; at: number }) => void): Promise<{ on: boolean; port: number; error?: string }> {
  if (!on) {
    server?.close(); server = null
    return Promise.resolve({ on: false, port: FLOOR_PORT })
  }
  if (server) return Promise.resolve({ on: true, port: FLOOR_PORT })
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/floor') { res.writeHead(404).end(); return }
      if (fromBrowserOrRebound(req.headers)) { res.writeHead(403).end(); return }
      let body = ''
      req.on('data', c => { body += c; if (body.length > 2048) req.destroy() })
      req.on('end', () => {
        const r = parseFloorReading(body)
        if (!r) { res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"ok":false}'); return }
        send({ ...r, at: Date.now() })
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}')
      })
    })
    s.once('error', (e: any) => { server = null; resolve({ on: false, port: FLOOR_PORT, error: e?.code === 'EADDRINUSE' ? `Port ${FLOOR_PORT} is in use` : String(e?.message || e) }) })
    s.listen(FLOOR_PORT, '127.0.0.1', () => { server = s; resolve({ on: true, port: FLOOR_PORT }) })
  })
}
