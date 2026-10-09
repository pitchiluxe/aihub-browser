/**
 * AIHub DJ — local music library.
 *
 * The renderer never sees a raw `file://` path it can load. Every audio file a
 * listing returns gets a random, per-run token, and the `aihub-media://` scheme
 * serves only tokens this process handed out. A page in a tab therefore cannot
 * read arbitrary files by guessing a URL, and nothing but audio is ever served.
 */
import { app, dialog, ipcMain, protocol, BrowserWindow } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { Readable } from 'stream'
import { parseId3, id3TagSize } from './id3'
import { isAudioFile, matchesQuery, parseRange } from './media'
import { registerYouTubeDeckIpc } from './youtubeDeck'

export const MEDIA_SCHEME = 'aihub-media'

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
  '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.opus': 'audio/ogg',
  '.webm': 'audio/webm', '.weba': 'audio/webm',
  // Music videos: the deck plays their sound, the monitor shows the picture.
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
}

const MAX_SEARCH_RESULTS = 500
const MAX_SEARCH_DIRS = 6000
const MAX_SEARCH_DEPTH = 10
const MAX_TAG_BYTES = 8 * 1024 * 1024
const MAX_COVER_BYTES = 600 * 1024

export interface DjFolder { name: string; path: string }
export interface DjTrack { token: string; name: string; path: string; size: number; ext: string }

// ── Token registry ──────────────────────────────────────────────────────────
const tokenToPath = new Map<string, string>()
const pathToToken = new Map<string, string>()

function tokenFor(p: string): string {
  const existing = pathToToken.get(p)
  if (existing) return existing
  const t = crypto.randomBytes(16).toString('hex')
  tokenToPath.set(t, p)
  pathToToken.set(p, t)
  return t
}

function isHiddenName(name: string): boolean {
  return name.startsWith('.') || name.startsWith('$') || name === 'System Volume Information' || name === 'node_modules'
}

function trackFor(full: string, size: number): DjTrack {
  return { token: tokenFor(full), name: path.basename(full), path: full, size, ext: path.extname(full).slice(1).toLowerCase() }
}

// ── Listing ─────────────────────────────────────────────────────────────────
function roots(): { places: DjFolder[]; drives: DjFolder[] } {
  const places: DjFolder[] = []
  const add = (name: string, key: Parameters<typeof app.getPath>[0]) => {
    try {
      const p = app.getPath(key)
      if (fs.existsSync(p)) places.push({ name, path: p })
    } catch { /* not available on this platform */ }
  }
  add('Music', 'music')
  add('Desktop', 'desktop')
  add('Downloads', 'downloads')
  add('Documents', 'documents')
  add('Videos', 'videos')
  places.push({ name: 'Home', path: os.homedir() })

  const drives: DjFolder[] = []
  if (process.platform === 'win32') {
    for (let c = 67; c <= 90; c++) { // C: … Z:
      const d = `${String.fromCharCode(c)}:\\`
      try { if (fs.existsSync(d)) drives.push({ name: `${String.fromCharCode(c)}:`, path: d }) } catch { /* ignore */ }
    }
  } else {
    drives.push({ name: '/', path: '/' })
    for (const base of ['/Volumes', '/media', '/mnt']) {
      try {
        for (const e of fs.readdirSync(base, { withFileTypes: true })) {
          if (e.isDirectory()) drives.push({ name: e.name, path: path.join(base, e.name) })
        }
      } catch { /* not present */ }
    }
  }
  return { places, drives }
}

async function listDir(dir: string): Promise<{ folders: DjFolder[]; tracks: DjTrack[] }> {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('Folder path must be absolute')
  const resolved = path.resolve(dir)
  const entries = await fs.promises.readdir(resolved, { withFileTypes: true })
  const folders: DjFolder[] = []
  const tracks: DjTrack[] = []
  for (const e of entries) {
    if (isHiddenName(e.name)) continue
    const full = path.join(resolved, e.name)
    if (e.isDirectory()) folders.push({ name: e.name, path: full })
    else if (e.isFile() && isAudioFile(e.name)) {
      try { tracks.push(trackFor(full, (await fs.promises.stat(full)).size)) } catch { /* vanished */ }
    }
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  folders.sort(byName)
  tracks.sort(byName)
  return { folders, tracks }
}

/** Breadth-first search under `dir` for audio files whose name matches. Bounded. */
async function searchDir(dir: string, query: string): Promise<{ tracks: DjTrack[]; truncated: boolean }> {
  if (!path.isAbsolute(dir)) throw new Error('Folder path must be absolute')
  const q = String(query || '').trim()
  const tracks: DjTrack[] = []
  const queue: { p: string; depth: number }[] = [{ p: path.resolve(dir), depth: 0 }]
  let visited = 0
  while (queue.length) {
    const { p, depth } = queue.shift()!
    if (++visited > MAX_SEARCH_DIRS) return { tracks, truncated: true }
    let entries: fs.Dirent[]
    try { entries = await fs.promises.readdir(p, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (isHiddenName(e.name)) continue
      const full = path.join(p, e.name)
      if (e.isDirectory()) {
        if (depth < MAX_SEARCH_DEPTH) queue.push({ p: full, depth: depth + 1 })
      } else if (e.isFile() && isAudioFile(e.name) && (!q || matchesQuery(e.name, q))) {
        try { tracks.push(trackFor(full, (await fs.promises.stat(full)).size)) } catch { continue }
        if (tracks.length >= MAX_SEARCH_RESULTS) return { tracks, truncated: true }
      }
    }
  }
  return { tracks, truncated: false }
}

async function readMeta(token: string) {
  const p = tokenToPath.get(token)
  if (!p) return null
  const fh = await fs.promises.open(p, 'r')
  try {
    const head = Buffer.alloc(10)
    await fh.read(head, 0, 10, 0)
    const total = id3TagSize(head)
    if (!total) return {}
    const len = Math.min(total, MAX_TAG_BYTES)
    const buf = Buffer.alloc(len)
    await fh.read(buf, 0, len, 0)
    const t = parseId3(buf)
    return {
      title: t.title, artist: t.artist, album: t.album, bpm: t.bpm, key: t.key,
      durationSec: t.lengthMs ? t.lengthMs / 1000 : undefined,
      cover: t.cover && t.cover.data.length <= MAX_COVER_BYTES
        ? `data:${t.cover.mime};base64,${t.cover.data.toString('base64')}`
        : undefined,
    }
  } finally {
    await fh.close()
  }
}

// ── Protocol ────────────────────────────────────────────────────────────────

/** Must run before app.whenReady(). */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: MEDIA_SCHEME,
    // corsEnabled + ACAO lets the renderer route the <audio> element through
    // Web Audio; a cross-origin source without CORS plays as silence there.
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  }])
}

export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async request => {
    let token = ''
    try { token = new URL(request.url).hostname } catch { return new Response('Bad request', { status: 400 }) }
    if (!/^[0-9a-f]{32}$/.test(token)) return new Response('Not found', { status: 404 })
    const p = tokenToPath.get(token)
    if (!p) return new Response('Not found', { status: 404 })

    let size: number
    try { size = (await fs.promises.stat(p)).size } catch { return new Response('Not found', { status: 404 }) }

    const base: Record<string, string> = {
      'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    }
    const range = parseRange(request.headers.get('range'), size)
    if (range === 'invalid') {
      return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } })
    }
    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers: { ...base, 'Content-Length': String(size) } })
    }
    const { start, end } = range ?? { start: 0, end: size - 1 }
    const body = Readable.toWeb(fs.createReadStream(p, { start, end })) as unknown as ReadableStream
    return new Response(body, {
      status: range ? 206 : 200,
      headers: {
        ...base,
        'Content-Length': String(end - start + 1),
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
      },
    })
  })
}

// ── IPC ─────────────────────────────────────────────────────────────────────
export function registerDjIpc(): void {
  registerYouTubeDeckIpc()
  ipcMain.handle('dj:roots', () => roots())
  ipcMain.handle('dj:list', (_e, dir: string) => listDir(dir))
  ipcMain.handle('dj:search', (_e, dir: string, query: string) => searchDir(dir, query))
  // A single audio file the user dropped onto a deck from outside the app.
  ipcMain.handle('dj:registerFile', async (_e, p: string) => {
    if (typeof p !== 'string' || !path.isAbsolute(p) || !isAudioFile(p)) return null
    try {
      const st = await fs.promises.stat(p)
      return st.isFile() ? trackFor(path.resolve(p), st.size) : null
    } catch { return null }
  })
  ipcMain.handle('dj:meta', (_e, token: string) => (typeof token === 'string' ? readMeta(token) : null))
  ipcMain.handle('dj:pickFolder', async e => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const r = await dialog.showOpenDialog(win!, { title: 'Add a music folder', properties: ['openDirectory'] })
    return r.canceled || !r.filePaths[0] ? null : { name: path.basename(r.filePaths[0]) || r.filePaths[0], path: r.filePaths[0] }
  })
  ipcMain.handle('dj:saveRecording', async (e, data: ArrayBuffer, ext: string) => {
    if (!(data instanceof ArrayBuffer) || data.byteLength === 0) return { success: false, error: 'Empty recording' }
    const safeExt = /^(webm|ogg|wav)$/.test(ext) ? ext : 'webm'
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const r = await dialog.showSaveDialog(win!, {
      title: 'Save mix recording',
      defaultPath: path.join(app.getPath('music'), `AIHub-DJ-mix-${stamp}.${safeExt}`),
      filters: [{ name: 'Audio', extensions: [safeExt] }],
    })
    if (r.canceled || !r.filePath) return { success: false }
    await fs.promises.writeFile(r.filePath, Buffer.from(data))
    return { success: true, path: r.filePath }
  })
}
