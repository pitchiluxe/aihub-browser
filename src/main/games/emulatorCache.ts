import { net, protocol } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The Game room's emulator (EmulatorJS) is fetched from its CDN the first
// time a cartridge is played, then kept on disk. Every later launch is served
// from the copy, so a flaky connection — or none at all — no longer stops a
// game the user has played before. Only this pinned version is ever stored.
export const EMULATOR_SCHEME = 'aihub-emu'
const VERSION = '4.2.3'
const MIRRORS = [`https://cdn.emulatorjs.org/${VERSION}/`, `https://cdn.jsdelivr.net/gh/EmulatorJS/EmulatorJS@v${VERSION}/`]
const CACHE_DIR = path.join(os.homedir(), '.aihub-browser', 'emulator', VERSION)
const MIME: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }
const pending = new Map<string, Promise<Buffer>>()

export function registerEmulatorScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: EMULATOR_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])
}

/** `data/cores/x.data` style paths only: no traversal, no absolute paths, no query tricks. */
export function emulatorCachePath(urlPath: string): string | null {
  const clean = decodeURIComponent(urlPath).replace(/^\/+/, '')
  if (!/^data\/[\w.\-/]+$/.test(clean) || clean.split('/').some(part => part === '..' || part === '.')) return null
  return clean
}

async function download(relative: string): Promise<Buffer> {
  let lastError: unknown
  for (const mirror of MIRRORS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await net.fetch(mirror + relative, { cache: 'no-store' })
        if (response.status === 404) break
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return Buffer.from(await response.arrayBuffer())
      } catch (error) { lastError = error }
    }
  }
  throw lastError ?? new Error('not found')
}

async function load(relative: string): Promise<Buffer> {
  const file = path.join(CACHE_DIR, relative)
  try { return await fs.promises.readFile(file) } catch { /* Not cached yet. */ }
  let job = pending.get(relative)
  if (!job) {
    job = download(relative).then(async bytes => {
      await fs.promises.mkdir(path.dirname(file), { recursive: true })
      // Write then rename, so an interrupted download never leaves a truncated core behind.
      const temporary = `${file}.${process.pid}.part`
      await fs.promises.writeFile(temporary, bytes); await fs.promises.rename(temporary, file)
      return bytes
    }).finally(() => pending.delete(relative))
    pending.set(relative, job)
  }
  return job
}

export function registerEmulatorProtocol(): void {
  protocol.handle(EMULATOR_SCHEME, async request => {
    let relative: string | null = null
    try { relative = emulatorCachePath(new URL(request.url).pathname) } catch { /* Malformed URL. */ }
    const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }
    if (!relative) return new Response('Not found', { status: 404, headers })
    try {
      const bytes = await load(relative)
      return new Response(new Uint8Array(bytes), { status: 200, headers: { ...headers, 'Content-Type': MIME[path.extname(relative)] || 'application/octet-stream' } })
    } catch {
      return new Response('Unavailable', { status: 503, headers })
    }
  })
}
