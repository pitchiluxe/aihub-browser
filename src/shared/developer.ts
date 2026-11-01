export interface ApiRequest { id: string; url: string; method: string; headers: Record<string, string>; body?: string; status?: number; type?: string; paused?: boolean; ts: number }
export interface ApiResponse { status: number; headers: Record<string, string>; body: string; truncated: boolean; elapsedMs: number }
export interface LocalService { port: number; url: string; reachable: boolean }
export const DEFAULT_DEV_PORTS = [3000, 3001, 4173, 4200, 5000, 5173, 5432, 8000, 8080, 8888, 9000, 11434]
export const SECRET_FIELD = /auth|cookie|token|secret|password|api[-_]?key|credential|signature|session|csrf|^code$|^key$/i
export function httpUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 8192) throw Error('Enter an HTTP or HTTPS URL.')
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Use HTTP or HTTPS without embedded credentials.')
  return url
}
export function isLoopback(value: unknown): boolean {
  try {
    const host = httpUrl(value).hostname.toLowerCase()
    return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]'
  } catch { return false }
}
export function sanitizeRequest(input: Partial<ApiRequest>): ApiRequest {
  const url = httpUrl(input.url)
  for (const name of [...url.searchParams.keys()]) if (SECRET_FIELD.test(name)) url.searchParams.set(name, '[redacted]')
  url.hash = ''
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(input.headers || {}).slice(0, 100)) {
    if (!SECRET_FIELD.test(name)) headers[name.slice(0, 100)] = String(value).slice(0, 4096)
  }
  return { id: String(input.id || '').slice(0, 100), url: url.href, method: String(input.method || 'GET').slice(0, 16).toUpperCase(), headers, ts: Number(input.ts) || Date.now(), status: input.status, type: input.type }
}
export function validateReplay(input: unknown): Pick<ApiRequest, 'url' | 'method' | 'headers' | 'body'> {
  if (!input || typeof input !== 'object') throw Error('Choose a request.')
  const value = input as ApiRequest
  const url = httpUrl(value.url).href
  const method = String(value.method || 'GET').toUpperCase()
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method)) throw Error('Unsupported request method.')
  const body = typeof value.body === 'string' ? value.body : ''
  if (body.length > 256_000) throw Error('Request bodies must be smaller than 256 KB.')
  const headers: Record<string, string> = {}
  for (const [key, val] of Object.entries(value.headers || {}).slice(0, 100)) {
    if (/^(host|content-length|connection|transfer-encoding|proxy-.*|sec-.*)$/i.test(key)) continue
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(key) || typeof val !== 'string' || /[\r\n]/.test(val) || val.length > 8192) throw Error('Invalid request header.')
    headers[key] = val
  }
  return { url, method, headers, ...(!['GET', 'HEAD'].includes(method) && body ? { body } : {}) }
}
export function validatePorts(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > 32 || value.some(port => !Number.isInteger(port) || port < 1 || port > 65535)) throw Error('Choose up to 32 ports between 1 and 65535.')
  return [...new Set(value)]
}

export function localDevelopmentHeaders(target: string, referrer: string, original: Record<string, string[]>, approved: ReadonlySet<string>): Record<string, string[]> | null {
  if (!isLoopback(target) || !isLoopback(referrer)) return null
  const origin = new URL(referrer).origin
  if (!approved.has(origin) || !approved.has(new URL(target).origin)) return null
  const headers: Record<string, string[]> = {}
  const vary = new Set(['Origin'])
  for (const [key, value] of Object.entries(original)) {
    if (key.toLowerCase() === 'vary') { for (const part of value.join(',').split(',')) if (part.trim()) vary.add(part.trim()); continue }
    if (!/^access-control-allow-|^access-control-max-age$/i.test(key)) headers[key] = value
  }
  return { ...headers, 'Access-Control-Allow-Origin': [origin], 'Access-Control-Allow-Methods': ['GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS'], 'Access-Control-Allow-Headers': ['Content-Type, Authorization, X-Requested-With'], 'Access-Control-Allow-Credentials': ['true'], 'Vary': [[...vary].join(', ')] }
}
