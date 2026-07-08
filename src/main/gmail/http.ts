import http from 'http'
import https from 'https'
import { URL } from 'url'

// Minimal request helper for Gmail + OAuth. Returns the raw body string and
// status; callers parse JSON. Kept separate from index.ts's httpPost because
// that one is POST/JSON-only and Gmail needs GET plus form-encoded token calls.
export function httpJson(
  method: 'GET' | 'POST',
  url: string,
  opts: { headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const lib = parsed.protocol === 'https:' ? https : http
    const headers: Record<string, string> = { ...(opts.headers || {}) }
    if (opts.body != null) headers['Content-Length'] = String(Buffer.byteLength(opts.body))
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method, headers, timeout: opts.timeoutMs ?? 30000,
    }, res => {
      let b = ''
      res.on('data', c => { b += c })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: b }))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    if (opts.body != null) req.write(opts.body)
    req.end()
  })
}
