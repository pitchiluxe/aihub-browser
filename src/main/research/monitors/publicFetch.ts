import dns from 'node:dns/promises'
import https from 'node:https'
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { MONITOR_LIMITS, type Observation } from '../../../shared/research/monitorTypes'
import { extractPublicText } from './publicText'

export function assertPublicAddress(address: string): void {
  const family = net.isIP(address)
  if (family === 4) {
    const octets = address.split('.').map(Number), [a, b, c] = octets
    const denied = a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2) || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113) || a === 255
    if (denied) throw Error('This address is not publicly routable.')
    return
  }
  if (family !== 6 || address.includes('%')) throw Error('Invalid public network address.')
  const words = ipv6Words(address)
  if (words.slice(0, 5).every((n, i) => n === [0, 0, 0, 0, 0][i]) && words[5] === 0xffff) {
    assertPublicAddress(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`)
    return
  }
  // Global unicast only. Excludes unspecified, loopback, translation, ULA,
  // link-local, multicast, documentation and special-purpose ranges.
  if ((words[0] & 0xe000) !== 0x2000 || words[0] === 0x2002 || (words[0] === 0x2001 && words[1] <= 0x01ff) || (words[0] === 0x2001 && words[1] === 0x0db8)) throw Error('This address is not publicly routable.')
}

function ipv6Words(input: string): number[] {
  let value = input.toLowerCase()
  if (value.includes('.')) {
    const at = value.lastIndexOf(':')
    const v4 = value.slice(at + 1)
    if (net.isIP(v4) !== 4) throw Error('Invalid IPv6 address.')
    const o = v4.split('.').map(Number)
    value = `${value.slice(0, at)}:${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`
  }
  const halves = value.split('::')
  if (halves.length > 2) throw Error('Invalid IPv6 address.')
  const left = halves[0] ? halves[0].split(':') : [], right = halves[1] ? halves[1].split(':') : []
  const fill = 8 - left.length - right.length
  if ((halves.length === 1 && fill !== 0) || (halves.length === 2 && fill < 1)) throw Error('Invalid IPv6 address.')
  const all = [...left, ...Array(fill).fill('0'), ...right]
  if (all.length !== 8 || all.some(x => !/^[0-9a-f]{1,4}$/.test(x))) throw Error('Invalid IPv6 address.')
  return all.map(x => parseInt(x, 16))
}

type Address = { address: string; family: number }
type Response = { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }
type FetchDeps = {
  resolve(host: string): Promise<Address[]>
  request(url: URL, pinned: Address, signal: AbortSignal): Promise<Response>
  now?: () => Date
}

function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(Error('Public check timed out or was cancelled.'))
  return new Promise((resolve, reject) => {
    const abort = () => reject(Error('Public check timed out or was cancelled.'))
    signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

function requestHttps(url: URL, pinned: Address, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = https.request({ protocol: 'https:', hostname: url.hostname, servername: url.hostname, port: url.port || 443, path: `${url.pathname}${url.search}`, method: 'GET', headers: { Accept: 'text/html, application/xhtml+xml', 'Accept-Encoding': 'identity', 'User-Agent': 'AIHubResearchMonitor/1.0' }, lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family) }, response => {
      const chunks: Buffer[] = []; let bytes = 0
      response.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > MONITOR_LIMITS.bodyBytes) request.destroy(Error('Public page is larger than 1 MB.')); else chunks.push(Buffer.from(chunk)) })
      response.on('end', () => resolve({ status: response.statusCode || 0, headers: response.headers, body: Buffer.concat(chunks) }))
      response.on('error', reject)
    })
    const abort = () => request.destroy(Error('Public check cancelled.'))
    signal.addEventListener('abort', abort, { once: true })
    request.on('error', reject)
    request.on('close', () => signal.removeEventListener('abort', abort))
    request.end()
  })
}

function validateUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname || url.hostname.endsWith('.localhost') || url.hostname === 'localhost' || url.hostname.endsWith('.local')) throw Error('Choose a public HTTPS page without sign-in credentials.')
  return url
}

export function createPublicFetcher(deps: FetchDeps) {
  return async function fetchPublicObservation(value: string, parentSignal: AbortSignal): Promise<Observation> {
    const requested = validateUrl(value)
    const controller = new AbortController(), abort = () => controller.abort()
    if (parentSignal.aborted) throw Error('Public check cancelled.')
    parentSignal.addEventListener('abort', abort, { once: true })
    const deadline = setTimeout(abort, MONITOR_LIMITS.deadlineMs)
    try {
      let url = requested
      for (let redirects = 0; ; redirects++) {
        if (controller.signal.aborted) throw Error('Public check timed out or was cancelled.')
        const records = await withAbort(deps.resolve(url.hostname), controller.signal)
        if (controller.signal.aborted) throw Error('Public check timed out or was cancelled.')
        if (!records.length) throw Error('The page host did not resolve.')
        records.forEach(record => assertPublicAddress(record.address))
        const response = await withAbort(deps.request(url, records[0], controller.signal), controller.signal)
        if (controller.signal.aborted) throw Error('Public check timed out or was cancelled.')
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (redirects >= 3) throw Error('The page redirected too many times.')
          const location = response.headers.location
          if (!location || Array.isArray(location)) throw Error('The page returned an invalid redirect.')
          url = validateUrl(new URL(location, url).toString())
          continue
        }
        if (response.status < 200 || response.status >= 300) throw Error(`The public page returned HTTP ${response.status}.`)
        const contentType = response.headers['content-type']
        if (typeof contentType !== 'string' || !/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(contentType)) throw Error('The page does not provide public HTML.')
        if (response.body.byteLength > MONITOR_LIMITS.bodyBytes) throw Error('Public page is larger than 1 MB.')
        const extracted = extractPublicText(response.body.toString('utf8'))
        return { id: randomUUID(), requestedUrl: requested.toString(), finalUrl: url.toString(), checkedAt: (deps.now || (() => new Date()))().toISOString(), ...extracted, kind: 'public-html' }
      }
    } finally { clearTimeout(deadline); parentSignal.removeEventListener('abort', abort) }
  }
}

export const fetchPublicObservation = createPublicFetcher({
  resolve: async host => dns.lookup(host, { all: true, verbatim: true }),
  request: requestHttps,
})
