import { app, BrowserWindow, BrowserView, ipcMain, shell, nativeTheme, session, Menu, MenuItem, clipboard, dialog, Notification, webContents as electronWebContents } from 'electron'
import { join, resolve as pathResolve, relative as pathRelative, isAbsolute as pathIsAbsolute, dirname, extname } from 'path'
import zlib from 'zlib'
import http from 'http'
import https from 'https'
import dns from 'dns'
import os from 'os'
import fs from 'fs'
import { execSync, execFileSync, spawn } from 'child_process'
import { recordVisit, generateRecommendations, saveRecommendations, getStoredRecommendations, buildProfile } from './ai-brain'
import { registerGoogleIpc } from './google'
import { initAutoUpdater } from './updater'

const isDev = process.env.NODE_ENV === 'development'

// Prefer IPv4 when a host resolves to both. openrouter.ai returns IPv6
// addresses first, and Node 17+ hands them to connect() in that order —
// on networks with broken or blocked IPv6 that surfaces as getaddrinfo
// ENOTFOUND / connection failures even though a working IPv4 exists. This
// mirrors the IPv4-forcing we already do for Ollama's localhost.
try { dns.setDefaultResultOrder('ipv4first') } catch {}

// ── Set paths BEFORE app is ready ─────────────────────────────────────────
// Must run before app.whenReady() — setting after has no effect on Chromium.
const APP_DIR = join(os.homedir(), '.aihub-browser')
app.setPath('userData', APP_DIR)

// Point GPU and disk caches to our writable directory so Chromium
// doesn't fight over temp paths that other processes may have locked.
app.commandLine.appendSwitch('disk-cache-dir',     join(APP_DIR, 'cache'))
app.commandLine.appendSwitch('gpu-disk-cache-dir', join(APP_DIR, 'gpu-cache'))
// Disable problematic GPU sandbox on Windows to avoid cache permission errors
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}

// ── Single-instance lock — prevent cache conflicts ─────────────────────────
// If a second instance launches, focus the existing window instead.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // Another instance is already running — quit immediately
  app.quit()
  process.exit(0)
}

// ── SimpleStore ────────────────────────────────────────────────────────────
const DATA_FILE   = join(APP_DIR, 'data.json')
const HIST_FILE   = join(APP_DIR, 'history.json')
const DL_FILE     = join(APP_DIR, 'downloads.json')
const AGENTS_FILE = join(APP_DIR, 'agents.json')

const DEFAULT_BOOKMARKS = [
  { id: 'bm-g',  url: 'https://www.google.com',                        title: 'Google',           favicon: '', category: 'Search',        addedAt: 0, color: '#4285F4' },
  { id: 'bm-yt', url: 'https://www.youtube.com',                       title: 'YouTube',          favicon: '', category: 'Entertainment',  addedAt: 0, color: '#FF0000' },
  { id: 'bm-nf', url: 'https://www.netflix.com',                       title: 'Netflix',          favicon: '', category: 'Entertainment',  addedAt: 0, color: '#E50914' },
  { id: 'bm-1',  url: 'https://aihub-eight-xi.vercel.app/dashboard',   title: 'AIHub Dashboard',  favicon: '', category: 'AI',            addedAt: 0, color: '#a78bfa' },
  { id: 'bm-2',  url: 'https://www.technobiztrader.net/',               title: 'TechnoBiz Trader', favicon: '', category: 'Trading',       addedAt: 0, color: '#fb923c' },
  { id: 'bm-4',  url: 'https://technobiz-trader-agent.vercel.app/',     title: 'TechnoBiz Agent',  favicon: '', category: 'AI',            addedAt: 0, color: '#a78bfa' },
]

function ensureDir() { if (!fs.existsSync(APP_DIR)) fs.mkdirSync(APP_DIR, { recursive: true }) }
function readJson(f: string, fb: any): any { try { return JSON.parse(fs.readFileSync(f, 'utf-8')) } catch { return fb } }
function writeJson(f: string, d: any) { try { ensureDir(); fs.writeFileSync(f, JSON.stringify(d, null, 2)) } catch {} }

let _data: any = null
function getData(): any {
  if (!_data) {
    const s = readJson(DATA_FILE, null)
    _data = s
      ? { ...{ bookmarks: DEFAULT_BOOKMARKS, settings: defaultSettings() }, ...s, settings: { ...defaultSettings(), ...(s.settings || {}) } }
      : { bookmarks: DEFAULT_BOOKMARKS.map(b => ({ ...b, addedAt: Date.now() })), settings: defaultSettings() }
  }
  return _data
}
function defaultSettings() {
  return {
    // AIHub's own UI defaults to its dark theme (its colors come from CSS
    // variables, not prefers-color-scheme). Changeable in Settings. Note: the
    // global nativeTheme.themeSource is set to 'light' (see createWindow) so
    // that *web pages* render in their natural light colors — that must not be
    // read here as the app's own default, or the app would start light.
    theme: 'dark',
    aiModel: 'llama3', transparency: 'none', glassIntensity: 'medium',
    sidebarVisible: true, searchEngine: 'google',
    // AI API config — set via Settings page or baked from .env.local at build time
    openrouterKey:   '',
    openrouterBase:  '',
    openrouterModel: '',
    ollamaUrl:       '',
  }
}
function saveData() { writeJson(DATA_FILE, _data) }

// ── Dynamic AI config ──────────────────────────────────────────────────────
function validHttpUrl(url: string): boolean {
  try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:' } catch { return false }
}

// Priority: stored settings → build-time env vars (from .env.local via vite define)
// Strip non-ASCII — HTTP headers only allow bytes 0-255
function toAscii(s: string) { return s.replace(/[^\x00-\x7F]/g, '') }

// Confirmed-working free models on OpenRouter (verified live 2026-07-03).
// OpenRouter retired most old :free variants ("unavailable for free" 404s),
// so this list must be models that exist on the CURRENT free tier.
const OR_DEFAULT_MODEL = 'qwen/qwen3-coder:free'

function getAIConfig() {
  const s = getData().settings
  const orKey   = s.openrouterKey   || process.env.ANTHROPIC_AUTH_TOKEN  || ''
  const orBase  = (s.openrouterBase  || process.env.ANTHROPIC_BASE_URL   || 'https://openrouter.ai/api').replace(/\/$/, '') + '/v1'
  const orMdl   = s.openrouterModel  || process.env.ANTHROPIC_MODEL      || OR_DEFAULT_MODEL
  // Validate stored Ollama URL — bad values (e.g. "::1:11434") cause ECONNREFUSED
  const rawOl   = s.ollamaUrl || process.env.NEXT_PUBLIC_OLLAMA_BASE_URL || ''
  // Force IPv4: on Windows, Node resolves "localhost" to ::1 (IPv6) first, but
  // Ollama binds 127.0.0.1 only — the mismatch is ECONNREFUSED ::1:11434.
  const olBase  = ((rawOl && validHttpUrl(rawOl)) ? rawOl : 'http://127.0.0.1:11434')
    .replace('://localhost', '://127.0.0.1')
  return { orKey, orBase, orMdl, olBase }
}

// ── DNS fallback lookup ────────────────────────────────────────────────────
// getaddrinfo ENOTFOUND with a working connection usually means the system
// resolver is broken/blocked (ISP DNS outage, captive portal, aggressive
// filtering). Fall back to well-known public resolvers, which use Node's
// c-ares network resolver instead of the OS getaddrinfo path.
const publicResolver = new dns.promises.Resolver()
publicResolver.setServers(['1.1.1.1', '8.8.8.8'])
const dnsCache = new Map<string, { addr: string; ts: number }>()
const DNS_CACHE_TTL = 5 * 60_000

function fallbackLookup(
  hostname: string,
  options: any,
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
): void {
  dns.lookup(hostname, options, (err, address, family) => {
    if (!err && address) return callback(null, address as string, family as number)
    const cached = dnsCache.get(hostname)
    if (cached && Date.now() - cached.ts < DNS_CACHE_TTL) return callback(null, cached.addr, 4)
    publicResolver.resolve4(hostname)
      .then(addrs => {
        if (!addrs.length) return callback(err, '', 4)
        dnsCache.set(hostname, { addr: addrs[0], ts: Date.now() })
        callback(null, addrs[0], 4)
      })
      .catch(() => callback(err, '', 4)) // surface the ORIGINAL getaddrinfo error
  })
}

// ── Native HTTP helpers (more reliable than axios in packaged Electron) ────
function httpGet(url: string, timeoutMs = 5000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http
    const req = lib.get(url, { timeout: timeoutMs, lookup: fallbackLookup }, (res) => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

// Transient network failures (DNS blips, dropped connections, IPv6 fallbacks)
// that are worth retrying rather than failing the whole request on.
const TRANSIENT_NET_CODES = ['ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH']
function isTransientNetError(e: any): boolean {
  return !!e && (TRANSIENT_NET_CODES.includes(e.code) || e.message === 'timeout')
}

// Retry an async network op a few times on transient errors, with linear backoff.
async function withNetRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 700): Promise<T> {
  let lastErr: any
  for (let i = 0; i < attempts; i++) {
    try { return await fn() }
    catch (e: any) {
      lastErr = e
      if (!isTransientNetError(e) || i === attempts - 1) throw e
      await new Promise(r => setTimeout(r, delayMs * (i + 1)))
    }
  }
  throw lastErr
}

function httpPost(url: string, data: object, headers: Record<string, string> = {}, timeoutMs = 60000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data)
    const parsed = new URL(url)
    const lib = url.startsWith('https') ? https : http
    const req = lib.request({
      hostname: parsed.hostname,
      port:     parsed.port || (url.startsWith('https') ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      timeout:  timeoutMs,
      lookup:   fallbackLookup,
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers },
    }, (res) => {
      let b = ''
      res.on('data', c => { b += c })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: b }))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.write(body)
    req.end()
  })
}

// ── Streaming Ollama chat ──────────────────────────────────────────────────
// stream:false keeps the socket silent for the ENTIRE generation, and Node's
// `timeout` is an IDLE timeout — so a slow machine loading a cold model
// looked like "timeout" even though Ollama was working fine. Streaming keeps
// tokens flowing, so the idle timer only fires when Ollama truly stalls.
function ollamaChatStream(
  base: string, model: string, messages: any[], idleTimeoutMs = 120000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(`${base}/api/chat`)
    const body = JSON.stringify({ model, messages, stream: true, options: { num_ctx: 8192 } })
    const req = http.request({
      hostname: parsed.hostname,
      port:     parsed.port || 80,
      path:     parsed.pathname,
      method:   'POST',
      timeout:  idleTimeoutMs,
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      if ((res.statusCode ?? 0) >= 400) {
        let eb = ''
        res.on('data', c => { eb += c })
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${eb.slice(0, 200)}`)))
        return
      }
      let content = ''
      let buf = ''
      res.on('data', c => {
        buf += c
        // NDJSON: one {"message":{"content":"…"},"done":false} object per line
        let nl: number
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line) continue
          try {
            const j = JSON.parse(line)
            if (j.message?.content) content += j.message.content
            if (j.error) return reject(new Error(String(j.error)))
          } catch { /* partial line — wait for more */ }
        }
      })
      res.on('end', () => resolve(content))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout — Ollama stopped responding mid-generation')) })
    req.write(body)
    req.end()
  })
}

// ── Ollama detection using native http ────────────────────────────────────
// Short-lived cache: ai:chat, ai:summarize and the status poller all call this,
// so without it every AI action re-probes the network before doing any work.
// A "not running" result probes up to 4 endpoints — cache it briefly so a user
// without Ollama isn't stalled on repeated timeouts before the cloud fallback.
let ollamaProbeCache: { at: number; value: { running: boolean; models: string[] } } | null = null
const OLLAMA_PROBE_TTL = 5000

async function checkOllamaRunning(force = false): Promise<{ running: boolean; models: string[] }> {
  if (!force && ollamaProbeCache && Date.now() - ollamaProbeCache.at < OLLAMA_PROBE_TTL) {
    return ollamaProbeCache.value
  }
  const { olBase } = getAIConfig()
  // Try both the configured base AND a 127.0.0.1 fallback to handle systems
  // where 'localhost' resolves differently in packaged Electron.
  const bases = [olBase, 'http://127.0.0.1:11434']
  const uniqueBases = [...new Set(bases)]

  const cache = (value: { running: boolean; models: string[] }) => {
    ollamaProbeCache = { at: Date.now(), value }
    return value
  }

  for (const base of uniqueBases) {
    for (const path of ['/api/tags', '/api/version']) {
      try {
        // 1.5s per probe (was 4s): Ollama on localhost answers in a few ms when
        // present, so a longer wait only ever adds dead time when it's absent.
        const { status, body } = await httpGet(`${base}${path}`, 1500)
        if (status >= 200 && status < 400) {
          try {
            const json = JSON.parse(body)
            const models = (json.models || []).map((m: any) => (typeof m === 'string' ? m : m.name || 'unknown')).filter(Boolean)
            return cache({ running: true, models: models.length ? models : ['llama3'] })
          } catch {
            return cache({ running: true, models: ['llama3'] })
          }
        }
      } catch { /* try next */ }
    }
  }
  return cache({ running: false, models: [] })
}

// ── Default-browser launch URL ──────────────────────────────────────────────
// When Windows launches us as the default browser (user clicked a link in
// another app), the URL arrives as a plain argv token — either on our own
// process.argv (cold start) or via the 'second-instance' commandLine (already
// running). Filter for the first http(s) URL rather than assuming position,
// since packaged vs. dev argv layouts differ (extra flags, exe path, etc).
function extractLaunchUrl(argv: string[]): string | null {
  for (const a of argv) if (/^https?:\/\//i.test(a)) return a
  return null
}
let pendingOpenUrl: string | null = extractLaunchUrl(process.argv)

// ── Windows ────────────────────────────────────────────────────────────────
// Every app window is a full browser: its own tab strip, sidebar, AI panel and
// toolbar. Detaching a tab therefore opens another complete window rather than
// a bare page, so all tab state has to be scoped per window instead of global.
interface AppWin {
  win: BrowserWindow
  /** Tab content views owned by THIS window, keyed by renderer tabId */
  views: Map<string, BrowserView>
  activeId: string | null
  bounds: { x: number; y: number; width: number; height: number }
  /** True while a host HTML overlay (a modal) must paint above tab content */
  overlayHidden: boolean
}

// Keyed by the window's own renderer webContents id, which is what arrives on
// every IPC event as `e.sender.id`.
const appWins = new Map<number, AppWin>()

// The first window opened. Kept for things that are genuinely app-global —
// the auto-updater and the OAuth flow — not for tab or chrome operations.
let mainWindow: BrowserWindow

/** The window that sent an IPC message. */
function ctxFromEvent(e: { sender: Electron.WebContents }): AppWin | undefined {
  return appWins.get(e.sender.id)
}

/** The window owning a webContents — either its renderer or one of its tabs. */
function ctxOwning(wc: Electron.WebContents): AppWin | undefined {
  const direct = appWins.get(wc.id)
  if (direct) return direct
  for (const ctx of appWins.values()) {
    for (const v of ctx.views.values()) {
      if (!v.webContents.isDestroyed() && v.webContents === wc) return ctx
    }
  }
  return undefined
}

function winFrom(e: { sender: Electron.WebContents }): BrowserWindow | undefined {
  return ctxFromEvent(e)?.win
    ?? BrowserWindow.fromWebContents(e.sender)
    ?? (mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined)
}

/** Send to one specific window. */
function sendTo(ctx: AppWin | undefined, channel: string, ...args: any[]) {
  try {
    if (ctx && !ctx.win.isDestroyed() && !ctx.win.webContents.isDestroyed()) {
      ctx.win.webContents.send(channel, ...args)
    }
  } catch {}
}

// Electron's default UA carries "aihub-browser/x" and "Electron/x" tokens
// that make Google's sign-in reject the tab ("This browser or app may not be
// secure"). Build a clean, plain-Chrome UA.
//
// We deliberately claim a CURRENT Chrome version, NOT the bundled Chromium
// version (Electron 28 ships Chromium 120, old enough that Google's sign-in
// flags it). This value goes stale the same way — bump it every few months
// to the latest stable (https://chromiumdash.appspot.com/releases?platform=Windows).
// 149.0.7827.201 = Windows stable as of 2026-07-04.
const CHROME_FULL_VERSION = '149.0.7827.201'
const CHROME_MAJOR = CHROME_FULL_VERSION.split('.')[0]
// Real Chrome sends a REDUCED UA — minor/build/patch frozen to 0.0.0. Sending
// the full build number here is itself a tell (no real Chrome does it); the
// full version only travels via Client Hints / userAgentData.
const CHROME_UA =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`

// ── Google sign-in identity: keep it SIMPLE (regression fix, 2026-07-14) ────
// This app used to sign in to Gmail/Google fine. It regressed after a stack of
// "secure browser" spoofing was layered on: a per-tab CDP debugger held
// attached for the webContents' lifetime (Emulation.setUserAgentOverride +
// userAgentData), plus forced Sec-CH-UA and X-Client-Data request headers.
// None of it ever actually got Google sign-in through — but a permanently
// attached DevTools-Protocol session is itself a textbook automation/insecure
// signal, and hand-forged client hints that don't match the real network stack
// add mismatches, not authenticity. The old, working version (see
// src_backup/main/index.ts) did NONE of this: it just set a clean Chrome UA and
// let Chromium send its own natural headers. We deliberately revert to that
// minimal identity — a plain modern Chrome UA, no CDP, no header forgery — so
// the browser presents exactly as it did when login worked.

// Global default UA for every webContents. Set at module load (before app is
// ready and before any BrowserView loads), so tabs never fall back to the
// Electron-branded default. This is what actually reaches Google's servers.
app.userAgentFallback = CHROME_UA

const ALLOWED_PERMISSIONS = new Set([
  'notifications', 'media', 'geolocation', 'fullscreen',
  'pointerLock', 'clipboard-read', 'clipboard-sanitized-write', 'midi', 'midiSysex',
])

// Safe IPC sender — prevents "Render frame was disposed" crash when webContents
// transitions (navigation, tab switch) happen just as a send is attempted.
// Broadcast app-wide state (theme, VPN status, downloads, updates) to every
// open window so they all stay in agreement.
function safelySend(channel: string, ...args: any[]) {
  for (const ctx of appWins.values()) {
    try {
      if (!ctx.win.isDestroyed() && ctx.win.webContents && !ctx.win.webContents.isDestroyed()) {
        ctx.win.webContents.send(channel, ...args)
      }
    } catch {}
  }
}

function applyTransparency(win: BrowserWindow, mode: string) {
  if (process.platform !== 'win32') return
  try {
    const mat = ['acrylic', 'mica', 'tabbed', 'auto'].includes(mode) ? mode : 'none'
    ;(win as any).setBackgroundMaterial(mat)
  } catch {}
}

// Whole-window opacity (0.7–1). Independent of the DWM material — dims the
// entire window including tab content, unlike glass which only fades the UI.
function applyWindowOpacity(win: BrowserWindow, opacity: number) {
  try {
    const v = Math.min(1, Math.max(0.7, Number(opacity) || 1))
    win.setOpacity(v)
  } catch {}
}

// ── Browser keyboard shortcuts ─────────────────────────────────────────────
// Handled in the main process via before-input-event so they work no matter
// what has focus — the host UI or a page inside a tab's BrowserView (renderer
// keydown listeners never see keys typed into a BrowserView).
function matchAppShortcut(input: Electron.Input): string | null {
  if (input.type !== 'keyDown') return null
  const key = input.key.toLowerCase()
  const ctrl = input.control || input.meta
  if (!ctrl) {
    // Chrome-style modifierless / Alt navigation keys
    if (input.alt && key === 'arrowleft')  return 'nav-back'
    if (input.alt && key === 'arrowright') return 'nav-forward'
    if (!input.alt && key === 'f5') return 'reload-tab'
    return null
  }
  if (input.alt) return null
  if (key === 't') return input.shift ? 'reopen-tab' : 'new-tab'
  if (key === 'w' && !input.shift) return 'close-tab'
  if (key === 'tab') return input.shift ? 'prev-tab' : 'next-tab'
  if (key === 'l' && !input.shift) return 'focus-url'
  if (key === 'k' && !input.shift) return 'command-palette'
  if (key === 'r' && !input.shift) return 'reload-tab'
  if (key === 'd' && !input.shift) return 'bookmark-page'
  if (key === 'h' && !input.shift) return 'open-history'
  if (key === 'j' && !input.shift) return 'open-downloads'
  if (key === 'f' && !input.shift) return 'find-in-page'
  if (key === 'p' && !input.shift) return 'print-page'
  if (key === '=' || key === '+') return 'zoom-in'
  if (key === '-') return 'zoom-out'
  if (key === '0') return 'zoom-reset'
  // Ctrl+Shift+V — paste the clipboard URL into the address bar AND go, one
  // stroke, no matter what has focus.
  if (key === 'v' && input.shift) return 'paste-and-go'
  return null
}

// Actions that operate on a page's own webContents (zoom, print, back/forward)
// resolve to: the view the key was typed into, or — when typed into the host
// UI — the currently active tab's view.
function resolvePageWc(wc: Electron.WebContents): Electron.WebContents | null {
  const ctx = ctxOwning(wc)
  if (!ctx) return null
  for (const v of ctx.views.values()) if (v.webContents === wc) return wc
  return (ctx.activeId && ctx.views.get(ctx.activeId)?.webContents) || null
}

function attachAppShortcuts(wc: Electron.WebContents) {
  wc.on('before-input-event', (e, input) => {
    const action = matchAppShortcut(input)
    if (!action) return
    e.preventDefault()
    const page = resolvePageWc(wc)
    switch (action) {
      case 'nav-back':    { try { if (page?.canGoBack())    page.goBack() } catch {} return }
      case 'nav-forward': { try { if (page?.canGoForward()) page.goForward() } catch {} return }
      case 'zoom-in':     { try { page?.setZoomLevel(Math.min(page.getZoomLevel() + 0.5, 8)) } catch {} return }
      case 'zoom-out':    { try { page?.setZoomLevel(Math.max(page.getZoomLevel() - 0.5, -7)) } catch {} return }
      case 'zoom-reset':  { try { page?.setZoomLevel(0) } catch {} return }
      case 'print-page':  { try { page?.print() } catch {} return }
    }
    // Focusing the URL bar (and the find bar) needs keyboard focus back on the
    // host UI first — otherwise the input focuses but keys keep going to the
    // BrowserView.
    const ctx = ctxOwning(wc)
    if (action === 'focus-url' || action === 'find-in-page' || action === 'command-palette') ctx?.win.webContents.focus()
    // Paste-and-Go carries the clipboard text with it so the renderer doesn't
    // need a separate clipboard round-trip.
    if (action === 'paste-and-go') { sendTo(ctx, 'urlbar-paste-and-go', clipboard.readText().trim()); return }
    sendTo(ctx, 'app-shortcut', action)
  })
}

// Native right-click menu for the address bar. Standard edit roles operate on
// the focused host input directly; "Paste and Go" ships the clipboard text
// back to the renderer, which navigates with the same smart URL/search logic
// as pressing Enter.
ipcMain.handle('urlbar:showContextMenu', (e, hasText: boolean) => {
  const clip = clipboard.readText().trim()
  const menu = Menu.buildFromTemplate([
    { label: 'Cut',  role: 'cut',  enabled: hasText },
    { label: 'Copy', role: 'copy', enabled: hasText },
    { label: 'Paste', role: 'paste', enabled: !!clip },
    {
      label: 'Paste and Go', enabled: !!clip,
      click: () => safelySend('urlbar-paste-and-go', clip),
    },
    { type: 'separator' },
    { label: 'Select All', role: 'selectAll' },
  ])
  menu.popup({ window: winFrom(e) })
})

// Full page right-click menu. `opts.tabId` is set only for real browsing tabs
// (BrowserViews) — page-specific actions (reload, print, save, QR, Add to
// Sphere, page-level AI) are shown only then. Edit/link/image/selection actions
// are always available. App-feature actions (AI, Research, Agent, Annotation,
// Sphere) are forwarded to the renderer via the 'page-context-action' channel.
function attachContextMenu(wc: Electron.WebContents, opts?: { tabId?: string }) {
  wc.on('context-menu', (_e, params) => {
    const tabId = opts?.tabId
    const onPage = !!tabId
    let pageUrl = ''
    try { pageUrl = wc.getURL() } catch {}
    const isWebPage = /^https?:\/\//i.test(pageUrl)
    const sel = (params.selectionText || '').trim()
    const isImage = params.mediaType === 'image'

    const menuCtx = ctxOwning(wc)
    const sendAction = (action: string, extra?: Record<string, any>) =>
      sendTo(menuCtx, 'page-context-action', { action, tabId, url: pageUrl, selection: sel, ...extra })

    const menu = new Menu()
    const sep = () => { if (menu.items.length && menu.items[menu.items.length - 1].type !== 'separator') menu.append(new MenuItem({ type: 'separator' })) }

    // ── Navigation (browsing tabs only) ──
    if (onPage) {
      let canBack = false, canFwd = false
      try { canBack = wc.canGoBack() } catch {}
      try { canFwd = wc.canGoForward() } catch {}
      menu.append(new MenuItem({ label: 'Back',    enabled: canBack, accelerator: 'Alt+Left',  click: () => { try { wc.goBack() } catch {} } }))
      menu.append(new MenuItem({ label: 'Forward', enabled: canFwd,  accelerator: 'Alt+Right', click: () => { try { wc.goForward() } catch {} } }))
      menu.append(new MenuItem({ label: 'Reload',  accelerator: 'Ctrl+R', click: () => { try { wc.reload() } catch {} } }))
      menu.append(new MenuItem({ label: 'Hard Reload (Clear Cache)', click: () => { try { wc.reloadIgnoringCache() } catch {} } }))
    }

    // ── Edit actions (contextual) ──
    if (params.editFlags.canUndo || params.editFlags.canRedo) {
      sep()
      if (params.editFlags.canUndo) menu.append(new MenuItem({ label: 'Undo', role: 'undo', accelerator: 'Ctrl+Z' }))
      if (params.editFlags.canRedo) menu.append(new MenuItem({ label: 'Redo', role: 'redo', accelerator: 'Ctrl+Y' }))
    }
    if (params.editFlags.canCut || params.editFlags.canCopy || sel || params.editFlags.canPaste) {
      sep()
      if (params.editFlags.canCut)  menu.append(new MenuItem({ label: 'Cut',  role: 'cut',  accelerator: 'Ctrl+X' }))
      if (params.editFlags.canCopy || sel) menu.append(new MenuItem({ label: 'Copy', role: 'copy', accelerator: 'Ctrl+C' }))
      if (params.editFlags.canPaste) menu.append(new MenuItem({ label: 'Paste', role: 'paste', accelerator: 'Ctrl+V' }))
      if (params.editFlags.canSelectAll) menu.append(new MenuItem({ label: 'Select All', role: 'selectAll', accelerator: 'Ctrl+A' }))
    }

    // ── Selected text ──
    if (sel) {
      sep()
      const short = sel.length > 24 ? sel.slice(0, 24) + '…' : sel
      menu.append(new MenuItem({ label: `Ask AI about “${short}”`, click: () => sendAction('ai', { selection: sel }) }))
      menu.append(new MenuItem({ label: `Search Google for “${short}”`, click: () => sendTo(menuCtx, 'open-in-new-tab', `https://www.google.com/search?q=${encodeURIComponent(sel)}`) }))
    }

    // ── Link ──
    if (params.linkURL) {
      sep()
      menu.append(new MenuItem({ label: 'Open Link in New Tab', click: () => sendTo(menuCtx, 'open-in-new-tab', params.linkURL) }))
      menu.append(new MenuItem({ label: 'Open Link in New Window', click: () => { try { openDetachedWindow(params.linkURL) } catch {} } }))
      menu.append(new MenuItem({ label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) }))
    }

    // ── Image ──
    if (isImage && params.srcURL) {
      sep()
      menu.append(new MenuItem({ label: 'Copy Image', click: () => { try { wc.copyImageAt(params.x, params.y) } catch {} } }))
      menu.append(new MenuItem({ label: 'Copy Image Address', click: () => clipboard.writeText(params.srcURL) }))
      menu.append(new MenuItem({ label: 'Save Image As…', click: () => { try { wc.downloadURL(params.srcURL) } catch {} } }))
      menu.append(new MenuItem({ label: 'Open Image in New Tab', click: () => sendTo(menuCtx, 'open-in-new-tab', params.srcURL) }))
    }

    // ── AIHub actions ──
    sep()
    menu.append(new MenuItem({ label: 'AI Assistant', click: () => sendAction('ai') }))
    menu.append(new MenuItem({ label: 'Research', click: () => sendAction('research') }))
    menu.append(new MenuItem({ label: 'Agent', click: () => sendAction('agent') }))
    menu.append(new MenuItem({ label: 'Annotation', click: () => sendAction('annotation') }))

    // ── Bookmark sphere ──
    sep()
    menu.append(new MenuItem({ label: 'Bookmark Sphere', click: () => sendAction('sphere') }))
    if (isWebPage) menu.append(new MenuItem({ label: 'Add to Sphere', click: () => sendAction('add-to-sphere') }))

    // ── Page tools (browsing tabs only) ──
    if (onPage && isWebPage) {
      sep()
      menu.append(new MenuItem({ label: 'Create QR Code for this Page', click: () => sendAction('qr') }))
      menu.append(new MenuItem({ label: 'Copy Page URL', click: () => clipboard.writeText(pageUrl) }))
      menu.append(new MenuItem({ label: 'Translate this Page', click: () => safelySend('open-in-new-tab', `https://translate.google.com/translate?sl=auto&tl=en&u=${encodeURIComponent(pageUrl)}`) }))
      menu.append(new MenuItem({ label: 'Print…', accelerator: 'Ctrl+P', click: () => { try { wc.print() } catch {} } }))
      menu.append(new MenuItem({ label: 'Save Page As…', accelerator: 'Ctrl+S', click: () => savePageAs(wc) }))
      menu.append(new MenuItem({ label: 'View Page Source', click: () => safelySend('open-in-new-tab', `view-source:${pageUrl}`) }))
    }

    // ── Inspect (always last) ──
    sep()
    menu.append(new MenuItem({ label: 'Inspect Element', click: () => { try { wc.inspectElement(params.x, params.y) } catch {} } }))

    if (menu.items.length > 0) menu.popup({ window: menuCtx?.win ?? mainWindow })
  })
}

// Save the current page to disk via a native Save dialog (HTML + assets).
async function savePageAs(wc: Electron.WebContents) {
  try {
    let title = 'page'
    try { title = (wc.getTitle() || 'page').replace(/[<>:"/\\|?*]+/g, '_').slice(0, 80) } catch {}
    const result = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow() ?? mainWindow, {
      title: 'Save Page As',
      defaultPath: `${title}.html`,
      filters: [{ name: 'Web Page, Complete', extensions: ['html'] }],
    })
    if (result.canceled || !result.filePath) return
    await wc.savePage(result.filePath, 'HTMLComplete')
  } catch {}
}

// ── Tab content views (BrowserView) ────────────────────────────────────────
// Electron 28 predates WebContentsView (needs v30+). BrowserView gives the
// identical fix for the <webview> guest-viewport desync bug: the main process
// owns sizing directly via setBounds(), so there's no GuestViewContainer
// ResizeObserver/FrameMsg_Resize round-trip for window.innerHeight to lose sync with.
function sendTabEvent(ctx: AppWin | undefined, tabId: string, type: string, payload?: any) {
  sendTo(ctx, 'tabview:event', tabId, type, payload)
}

// BrowserView always paints above the window's own webContents — there is no
// z-index control from the renderer side. Overlays that must appear above tab
// content (e.g. AddBookmarkModal) call tabview:setOverlayHidden(true) to detach
// the view instead.
function syncActiveBrowserView(ctx: AppWin | undefined) {
  if (!ctx || ctx.win.isDestroyed()) return
  const view = (!ctx.overlayHidden && ctx.activeId) ? ctx.views.get(ctx.activeId) : undefined
  const current = ctx.win.getBrowserView()
  if (view) {
    if (current !== view) ctx.win.setBrowserView(view)
    view.setBounds({
      x: Math.round(ctx.bounds.x), y: Math.round(ctx.bounds.y),
      width: Math.max(0, Math.round(ctx.bounds.width)), height: Math.max(0, Math.round(ctx.bounds.height)),
    })
  } else if (current) {
    ctx.win.setBrowserView(null)
  }
}

function createTabView(ctx: AppWin | undefined, tabId: string, url: string) {
  if (!ctx || ctx.views.has(tabId)) return
  const tabViews = ctx.views
  const view = new BrowserView({
    webPreferences: {
      partition: 'persist:main',
      contextIsolation: true,
      // Keep web security ON for tab content — this is the page real sites
      // (incl. Google sign-in) run in. Disabling it is detectable and makes
      // Google refuse with "this browser or app may not be secure". The old
      // <webview> guests ran with security on, which is why login worked then.
      webSecurity: true,
      // Background tabs may throttle timers/rAF — big CPU/battery win with
      // many tabs open; the active tab is never throttled.
      backgroundThrottling: true,
      // Cache compiled JS eagerly — repeat visits skip re-parse/compile.
      v8CacheOptions: 'bypassHeatCheck',
      nodeIntegration: false,
    },
  })
  // Opaque white backing for tab content. The app window is transparent for
  // Mica/acrylic glass, and a BrowserView inherits that transparency — so any
  // site whose <body>/<html> has no background of its own (e.g. ollama.com's
  // hero) let the desktop show through, making a light page look dark. Painting
  // the view white first means those pages render on white, exactly as in
  // Chrome, regardless of the app's own light/dark theme.
  try { view.setBackgroundColor('#ffffff') } catch {}
  tabViews.set(tabId, view)
  const wc = view.webContents
  // Set the clean Chrome UA on this view before it loads anything, so no request
  // ever goes out with the Electron default. This clean UA is the whole identity
  // — no CDP debugger, no header forgery (see the CHROME_UA note above).
  try { wc.setUserAgent(CHROME_UA) } catch {}

  attachContextMenu(wc, { tabId })
  attachAppShortcuts(wc)
  sendTabEvent(ctx, tabId, 'wc-id', { wcId: wc.id })

  // Scripted popups (window.open with features — OAuth flows like
  // "Sign in with Google" on TradingView) must open as real child windows:
  // the popup posts its result back through window.opener, so routing it
  // into a disconnected tab strands the flow after account selection.
  // Plain target=_blank links still open as tabs.
  wc.setWindowOpenHandler(({ url: targetUrl, disposition }) => {
    if (disposition === 'new-window') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: {
            partition: 'persist:main',
            contextIsolation: true,
            webSecurity: true,
            nodeIntegration: false,
          },
        },
      }
    }
    if (targetUrl && !targetUrl.startsWith('devtools://') && !targetUrl.startsWith('chrome-extension://')) {
      sendTo(ctx, 'open-in-new-tab', targetUrl)
    }
    return { action: 'deny' }
  })

  // Popups (OAuth windows) get the same clean UA as tabs.
  wc.on('did-create-window', (childWin) => {
    const cwc = childWin.webContents
    try { cwc.setUserAgent(CHROME_UA) } catch {}
    attachContextMenu(cwc)
    // Links clicked inside a popup go to a main-window tab; nested scripted
    // popups (rare, but some IdPs chain them) stay real windows.
    cwc.setWindowOpenHandler(({ url: popupUrl, disposition }) => {
      if (disposition === 'new-window') {
        return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } }
      }
      if (popupUrl && !popupUrl.startsWith('devtools://') && !popupUrl.startsWith('chrome-extension://')) {
        sendTo(ctx, 'open-in-new-tab', popupUrl)
      }
      return { action: 'deny' }
    })
  })

  wc.on('did-navigate', (_e, navUrl) => sendTabEvent(ctx, tabId, 'did-navigate', { url: navUrl }))
  wc.on('did-navigate-in-page', (_e, navUrl) => sendTabEvent(ctx, tabId, 'did-navigate-in-page', { url: navUrl }))
  wc.on('did-start-loading', () => sendTabEvent(ctx, tabId, 'did-start-loading'))
  wc.on('did-stop-loading', () => {
    let title = ''; let curUrl = ''
    try { title = wc.getTitle() } catch {}
    try { curUrl = wc.getURL() } catch {}
    sendTabEvent(ctx, tabId, 'did-stop-loading', { title, url: curUrl })
  })
  wc.on('did-fail-load', (_e, errorCode) => { if (errorCode !== -3) sendTabEvent(ctx, tabId, 'did-fail-load', { errorCode }) })
  wc.on('page-title-updated', (_e, title) => sendTabEvent(ctx, tabId, 'page-title-updated', { title }))
  wc.on('page-favicon-updated', (_e, favicons) => sendTabEvent(ctx, tabId, 'page-favicon-updated', { favicons }))
  wc.on('found-in-page', (_e, result) => sendTabEvent(ctx, tabId, 'found-in-page', {
    matches: result.matches, activeMatchOrdinal: result.activeMatchOrdinal, finalUpdate: result.finalUpdate,
  }))

  // Hide the page's native scrollbar track — re-inserted on every document
  // since insertCSS doesn't survive navigation.
  wc.on('dom-ready', () => {
    wc.insertCSS('::-webkit-scrollbar{width:0!important;height:0!important;background:transparent!important}').catch(() => {})
  })

  wc.loadURL(url)
}

function destroyTabView(ctx: AppWin | undefined, tabId: string) {
  if (!ctx) return
  const view = ctx.views.get(tabId)
  if (!view) return
  if (ctx.activeId === tabId) { ctx.activeId = null; syncActiveBrowserView(ctx) }
  try { if (!ctx.win.isDestroyed()) ctx.win.removeBrowserView(view) } catch {}
  try { view.webContents.close() } catch {}
  ctx.views.delete(tabId)
}

// One-time app-wide setup: shared session config, download tracking and the
// auto-updater. These are global concerns — running them per window would
// stack duplicate listeners (and duplicate download entries).
let sharedSetupDone = false
function setupSharedApp(firstWin: BrowserWindow): void {
  // Configure the persist:main session used by all <webview partition="persist:main"> tags.
  const webviewSession = session.fromPartition('persist:main')

  // Spoof Chrome UA so sites serve full content (many degrade or block Electron's default UA).
  // We do NOT rewrite Sec-CH-UA / X-Client-Data here anymore: forcing hand-forged
  // client hints was part of the "secure browser" spoofing that broke Google
  // sign-in. The old, working version let Chromium emit its own headers — so we
  // do the same and only override the UA string. (See the CHROME_UA note above.)
  webviewSession.setUserAgent(CHROME_UA)

  webviewSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission))
  })

  // Strip X-Frame-Options and CSP ONLY on sub-frame (iframe) requests, so
  // cross-origin embeds still load. Tab BrowserViews are top-level, not
  // iframes — X-Frame-Options / frame-ancestors never block them. Stripping
  // CSP off a top-level document (e.g. Google sign-in) makes the site detect
  // the missing policy as tampering and refuse with "this browser or app may
  // not be secure". Leaving main-frame headers untouched is what restores
  // Google login (regression: this used to strip every response).
  const STRIP_HEADERS = new Set(['x-frame-options', 'content-security-policy'])
  webviewSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'subFrame') {
      callback({})
      return
    }
    const headers: Record<string, string[]> = {}
    for (const [key, val] of Object.entries(details.responseHeaders || {})) {
      if (!STRIP_HEADERS.has(key.toLowerCase())) {
        headers[key] = val as string[]
      }
    }
    callback({ responseHeaders: headers })
  })

  // ── Auto-update (GitHub Releases) — checks on startup + periodically and
  // notifies the renderer when a newer version is published. No-op in dev. ──
  initAutoUpdater(() => mainWindow, safelySend)

  // ── Download tracking — covers mainWindow + all webviews ──────────────
  // Sessions are shared: every webview created with the same partition returns
  // the SAME Session object, so attaching a listener per web-contents stacked
  // N listeners on one session → one download produced N entries. Guard with a
  // WeakSet so each unique Session is hooked exactly once.
  let dlSeq = 0
  const handleDownload = (_e: any, item: any) => {
    const dls = readJson(DL_FILE, [])
    const dl: any = {
      id: `dl-${Date.now()}-${++dlSeq}`, filename: item.getFilename(), url: item.getURL(),
      savePath: '', totalBytes: item.getTotalBytes(), receivedBytes: 0,
      state: 'progressing', startedAt: Date.now(), completedAt: null,
    }
    const persist = () => {
      const i = dls.findIndex((x: any) => x.id === dl.id)
      if (i !== -1) dls[i] = { ...dl }; else dls.unshift({ ...dl })
      writeJson(DL_FILE, dls.slice(0, 500))
      safelySend('download:update', dl)
    }
    // Progress ticks fire many times per second on fast links — rewriting the
    // json every tick hammers the disk. Throttle progress persists; state
    // transitions and completion always write immediately.
    let lastProgressWrite = 0
    item.on('updated', (_ev, state) => {
      dl.receivedBytes = item.getReceivedBytes()
      const stateChanged = dl.state !== state
      dl.state = state
      const now = Date.now()
      if (stateChanged || now - lastProgressWrite >= 500) { lastProgressWrite = now; persist() }
    })
    item.on('done', (_ev, state) => {
      dl.state = state; dl.savePath = item.getSavePath()
      dl.completedAt = Date.now(); dl.receivedBytes = item.getReceivedBytes()
      persist()
    })
    dls.unshift({ ...dl }); writeJson(DL_FILE, dls.slice(0, 500))
    safelySend('download:update', dl)
  }

  const hookedSessions = new WeakSet<Electron.Session>()
  const hookDownloadSession = (sess: Electron.Session) => {
    if (!sess || hookedSessions.has(sess)) return
    hookedSessions.add(sess)
    sess.on('will-download', handleDownload)
  }

  // Attach to default session (covers webviews) + mainWindow session
  hookDownloadSession(session.defaultSession)
  hookDownloadSession(firstWin.webContents.session)

  app.on('web-contents-created', (_e, wc) => {
    hookDownloadSession(wc.session)
    let wcType: string | undefined
    try { wcType = wc.getType() } catch {}
    if (wcType !== 'webview' && wcType !== 'browserView') return

    process.nextTick(() => { try { wc.setUserAgent(CHROME_UA) } catch {} })
  })

}

// Creates a COMPLETE browser window — tab strip, sidebar, toolbar, AI panel,
// VPN control, annotation, screenshot and recording all included. Used both for
// the first window at launch and for every tab detached into its own window,
// so a detached tab is indistinguishable from a freshly opened browser.
function createAppWindow(initialUrl?: string): AppWin {
  // Render web pages in their natural (light) colors. Forcing 'dark' here made
  // every site that honours prefers-color-scheme serve its dark variant, which
  // users found dim and hard to read (e.g. sign-up pages showing near-black).
  // The AIHub app UI itself is unaffected — its theme comes from CSS variables
  // applied by applyThemeToDom(), not from this media query.
  nativeTheme.themeSource = 'light'
  const settings = getData().settings
  const glassMode = settings.transparency !== 'none'

  // Cascade extra windows so a detached tab doesn't land exactly on top of the
  // window it came from.
  const offset = appWins.size * 28

  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    ...(offset ? { x: 60 + offset, y: 40 + offset } : {}),
    show: false, frame: false,
    // macOS: keep the native traffic lights but inset them so they sit
    // vertically centered inside the custom tab strip instead of floating
    // over the tabs. Renderer reserves matching left padding (TabBar) and
    // hides its own window buttons on darwin.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 12 } } : {}),
    // Windows 11 native DWM rounded corners (no-op on older Windows/macOS)
    roundedCorners: true,
    // NOTE: never set transparent:true here — a transparent window drops the
    // DWM frame entirely (square corners, no shadow) and conflicts with
    // setBackgroundMaterial. Mica/acrylic only need the fully transparent
    // backgroundColor to show through.
    backgroundColor: glassMode ? '#00000000' : '#17182B',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false, webviewTag: false,
      nodeIntegration: false, contextIsolation: true, webSecurity: false,
    }
  })

  const ctx: AppWin = {
    win,
    views: new Map(),
    activeId: null,
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    overlayHidden: false,
  }
  // Capture the id up front: by the time 'closed' fires the window is already
  // destroyed and touching win.webContents throws "Object has been destroyed".
  const winId = win.webContents.id
  appWins.set(winId, ctx)
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = win

  win.on('closed', () => {
    ctx.views.forEach(v => { try { v.webContents.close() } catch {} })
    ctx.views.clear()
    ctx.activeId = null
    appWins.delete(winId)
    // Keep mainWindow pointing at a window that still exists
    if (mainWindow === win) {
      const next = appWins.values().next()
      mainWindow = next.done ? (undefined as unknown as BrowserWindow) : next.value.win
    }
  })

  applyTransparency(win, settings.transparency)
  win.on('ready-to-show', () => {
    win.show()
    applyWindowOpacity(win, settings.windowOpacity ?? 1)
    sendTo(ctx, 'theme:transparency', settings.transparency)
  })

  // Keep the renderer's maximize button in sync when the OS changes the state
  win.on('maximize',   () => sendTo(ctx, 'window:maximized', true))
  win.on('unmaximize', () => sendTo(ctx, 'window:maximized', false))

  // F12 / Ctrl+Shift+I toggles DevTools in dev mode
  win.webContents.on('before-input-event', (_e, input) => {
    if (!isDev) return
    if (input.type !== 'keyDown') return
    const devKey = input.key === 'F12' || (input.control && input.shift && input.key === 'I')
    if (devKey) {
      if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools()
      else win.webContents.openDevTools({ mode: 'detach' })
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url && !url.startsWith('devtools://') && !url.startsWith('chrome-extension://')) {
      sendTo(ctx, 'open-in-new-tab', url)
    }
    return { action: 'deny' }
  })

  // ── Right-click context menu (copy / paste / cut / select-all) ──────────
  attachContextMenu(win.webContents)
  attachAppShortcuts(win.webContents)

  // Mouse back / forward side buttons (Windows/Linux fire app-command).
  // Navigate the active tab of THIS window, matching Alt+←/→.
  win.on('app-command', (_e, cmd) => {
    const page = ctx.activeId ? ctx.views.get(ctx.activeId)?.webContents : undefined
    if (!page) return
    try {
      if (cmd === 'browser-backward' && page.canGoBack()) page.goBack()
      else if (cmd === 'browser-forward' && page.canGoForward()) page.goForward()
    } catch {}
  })

  if (!sharedSetupDone) { sharedSetupDone = true; setupSharedApp(win) }

  // A detached tab arrives as ?initialUrl=… so the new window opens straight
  // onto that page instead of the home screen.
  const query = initialUrl ? `?initialUrl=${encodeURIComponent(initialUrl)}` : ''
  if (isDev && process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'] + query)
  else win.loadFile(join(__dirname, '../renderer/index.html'), initialUrl ? { search: query } : undefined)

  // Flush a URL we were launched with (cold start as default browser) once the
  // renderer has actually mounted its 'open-in-new-tab' listener — sending any
  // earlier is a silent no-op since nothing is listening yet.
  win.webContents.on('did-finish-load', () => {
    if (pendingOpenUrl) {
      sendTo(ctx, 'open-in-new-tab', pendingOpenUrl)
      pendingOpenUrl = null
    }
  })

  return ctx
}

function createWindow(): void {
  createAppWindow()

  // Background AI recommendation refresh
  setTimeout(async () => {
    try {
      const { olBase } = getAIConfig()
      const recs = await generateRecommendations(olBase, getData().settings.aiModel || 'llama3')
      saveRecommendations(recs)
      safelySend('brain:recommendations', recs)
    } catch {}
  }, 8000)

  // Warm the OpenRouter live-model cache so the FIRST real chat/summarize
  // request doesn't pay the ~6s catalog-fetch latency inline — without this
  // buildOrCandidates() would block the user's first message on a cold cache.
  setTimeout(() => {
    const { orBase } = getAIConfig()
    getLiveFreeModelIds(orBase).catch(() => {})
  }, 3000)
}

// Focus existing window when second instance tries to open, and — this is the
// actual default-browser flow on Windows — forward whatever URL it was
// launched with. Without this the OS successfully relaunches us with the
// clicked URL on the command line, we just never read it, so the window pops
// up on whatever tab was already open.
app.on('second-instance', (_event, commandLine) => {
  const wins = BrowserWindow.getAllWindows()
  if (wins.length > 0) {
    const win = wins[0]
    if (win.isMinimized()) win.restore()
    win.focus()
  }
  const url = extractLaunchUrl(commandLine)
  if (url) safelySend('open-in-new-tab', url)
})

app.whenReady().then(() => {
  getData()
  if (process.platform === 'win32') app.setAppUserModelId('com.mydigitalsolutions.aihub-browser')
  if (isDev) {
    app.on('browser-window-created', (_, w) => {
      w.webContents.on('before-input-event', (_e, i) => { if (i.key === 'F12') w.webContents.toggleDevTools() })
    })
  }
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

// Network service crashes and restarts automatically — this is non-fatal.
// Without this handler Electron 28+ may surface it as an unhandled event.
app.on('child-process-gone', (_event, details) => {
  if (details.type === 'Utility' && details.name?.includes('network')) return
  if (details.reason === 'clean-exit') return
  console.warn('[aihub] child-process-gone:', details.type, details.reason)
})

// ── IPC: Default browser ───────────────────────────────────────────────────
ipcMain.handle('app:isDefaultBrowser', () => {
  try { return app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https') }
  catch { return false }
})
ipcMain.handle('app:setDefaultBrowser', async () => {
  try {
    const exePath = app.getPath('exe').replace(/\\/g, '\\\\')
    if (process.platform === 'win32') {
      // Register AIHub Browser in Windows registry so it appears in Default Apps picker
      const regCmds = [
        `reg add "HKCU\\Software\\Classes\\AIhubBrowser" /ve /t REG_SZ /d "AIHub Browser" /f`,
        `reg add "HKCU\\Software\\Classes\\AIhubBrowser\\Application" /v "ApplicationName" /t REG_SZ /d "AIHub Browser" /f`,
        `reg add "HKCU\\Software\\Classes\\AIhubBrowser\\Application" /v "ApplicationDescription" /t REG_SZ /d "AI-Powered Web Browser" /f`,
        `reg add "HKCU\\Software\\Classes\\AIhubBrowser\\Application" /v "ApplicationIcon" /t REG_SZ /d "${exePath},0" /f`,
        `reg add "HKCU\\Software\\Classes\\AIhubBrowser\\shell\\open\\command" /ve /t REG_SZ /d "\\"${exePath}\\" \\"%1\\"" /f`,
        `reg add "HKCU\\Software\\Classes\\AIhubBrowser\\DefaultIcon" /ve /t REG_SZ /d "${exePath},0" /f`,
        `reg add "HKCU\\Software\\Clients\\StartMenuInternet\\AIhubBrowser" /ve /t REG_SZ /d "AIHub Browser" /f`,
        `reg add "HKCU\\Software\\Clients\\StartMenuInternet\\AIhubBrowser\\Capabilities" /v "ApplicationDescription" /t REG_SZ /d "AI-Powered Web Browser by My Digital Solutions" /f`,
        `reg add "HKCU\\Software\\Clients\\StartMenuInternet\\AIhubBrowser\\Capabilities" /v "ApplicationName" /t REG_SZ /d "AIHub Browser" /f`,
        `reg add "HKCU\\Software\\Clients\\StartMenuInternet\\AIhubBrowser\\Capabilities\\URLAssociations" /v "http" /t REG_SZ /d "AIhubBrowser" /f`,
        `reg add "HKCU\\Software\\Clients\\StartMenuInternet\\AIhubBrowser\\Capabilities\\URLAssociations" /v "https" /t REG_SZ /d "AIhubBrowser" /f`,
        `reg add "HKCU\\Software\\Clients\\StartMenuInternet\\AIhubBrowser\\Capabilities\\FileAssociations" /v ".htm" /t REG_SZ /d "AIhubBrowser" /f`,
        `reg add "HKCU\\Software\\Clients\\StartMenuInternet\\AIhubBrowser\\Capabilities\\FileAssociations" /v ".html" /t REG_SZ /d "AIhubBrowser" /f`,
        `reg add "HKCU\\Software\\Clients\\StartMenuInternet\\AIhubBrowser\\shell\\open\\command" /ve /t REG_SZ /d "\\"${exePath}\\"" /f`,
        `reg add "HKCU\\Software\\RegisteredApplications" /v "AIhubBrowser" /t REG_SZ /d "Software\\Clients\\StartMenuInternet\\AIhubBrowser\\Capabilities" /f`,
      ]
      for (const cmd of regCmds) {
        try { execSync(cmd, { stdio: 'ignore' }) } catch {}
      }
    }
    app.setAsDefaultProtocolClient('http')
    app.setAsDefaultProtocolClient('https')
    await shell.openExternal('ms-settings:defaultapps')
    return { success: true }
  } catch (e: any) { return { success: false, error: e.message } }
})

// ── IPC: VPN / Proxy ──────────────────────────────────────────────────────
let vpnActive: {
  protocol: string; host: string; port: number
  username?: string; password?: string
  free?: boolean; countryCode?: string; countryName?: string
} | null = null

ipcMain.handle('vpn:getStatus', () => ({ connected: !!vpnActive, config: vpnActive }))

// Push VPN state to the renderer so the toolbar indicator stays truthful no
// matter which surface (toolbar or VPN page) made the change.
function broadcastVpnState() {
  safelySend('vpn:state', { connected: !!vpnActive, config: vpnActive })
}

// ── Free VPN engine ────────────────────────────────────────────────────────
// Community proxy lists (no account, no API key). We pull candidates for the
// requested country from two independent public sources, then verify each one
// by routing a real request through Chromium's network stack — a proxy only
// "wins" if it answers AND reports a different public IP than the direct line.
const FREE_PROXY_RULE = /^(socks5|socks4|https?):\/\/\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/

async function fetchFreeProxyList(cc: string): Promise<string[]> {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (raw: string) => {
    const rule = raw.trim().toLowerCase()
    if (FREE_PROXY_RULE.test(rule) && !seen.has(rule)) { seen.add(rule); out.push(rule) }
  }
  // Source 1: Proxifly free-proxy-list (per-country JSON, refreshed on GitHub CDN)
  try {
    const { status, body } = await httpGet(
      `https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/countries/${cc.toUpperCase()}/data.json`, 10000)
    if (status === 200) {
      for (const p of JSON.parse(body)) {
        if (typeof p?.proxy === 'string') push(p.proxy)
        else if (p?.protocol && p?.ip && p?.port) push(`${p.protocol}://${p.ip}:${p.port}`)
      }
    }
  } catch {}
  // Source 2: ProxyScrape free list API (country-filtered)
  try {
    const { status, body } = await httpGet(
      `https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&country=${cc.toLowerCase()}&proxy_format=protocolipport&format=text`, 10000)
    if (status === 200) for (const line of body.split(/\r?\n/)) push(line)
  } catch {}
  // SOCKS5 first — they tunnel HTTPS most reliably — then shuffle within groups
  const socks = out.filter(r => r.startsWith('socks5')), rest = out.filter(r => !r.startsWith('socks5'))
  for (const arr of [socks, rest]) arr.sort(() => Math.random() - 0.5)
  return [...socks, ...rest]
}

// The VPN proxies ONLY the browsing session. Tab content runs in BrowserViews
// on the 'persist:main' partition — a different session from defaultSession —
// so proxying defaultSession (as an earlier version did) left real browsing
// going out direct while "connected" showed green. The app's own defaultSession
// (AI requests, update checks, favicons) is deliberately left direct: routing
// it through a flaky free proxy would stall the UI without protecting anything
// the user cares about. The VPN exists so websites see the chosen country.
function trafficSessions(): Electron.Session[] {
  return [session.fromPartition('persist:main')]
}

async function applyProxyToTraffic(config: Electron.ProxyConfig): Promise<void> {
  for (const ses of trafficSessions()) {
    try { await ses.setProxy(config) } catch {}
  }
}

/** Public IP as seen by the session tab content uses — the honest answer. */
async function currentPublicIp(timeoutMs = 12000): Promise<string> {
  const ses = session.fromPartition('persist:main')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await ses.fetch('https://api.ipify.org?format=json', { signal: ctrl.signal, cache: 'no-store' })
    if (!res.ok) return ''
    const d = await res.json()
    return typeof d?.ip === 'string' ? d.ip : ''
  } catch { return '' } finally { clearTimeout(timer) }
}

// Route a probe through an isolated in-memory session so testing never touches
// the user's real browsing session. Returns the IP seen through the proxy AND
// how long the round-trip took, so the connect logic can pick the FASTEST
// working server rather than merely the first to answer — free proxies vary
// wildly in speed and the first responder is often a slow one.
async function probeProxy(rule: string, partition: string, timeoutMs: number): Promise<{ ip: string; ms: number } | null> {
  try {
    const ses = session.fromPartition(partition)
    await ses.setProxy({ proxyRules: rule })
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const t0 = Date.now()
    try {
      const res = await ses.fetch('https://api.ipify.org?format=json', { signal: ctrl.signal, cache: 'no-store' })
      if (!res.ok) return null
      const d = await res.json()
      if (typeof d?.ip !== 'string') return null
      return { ip: d.ip, ms: Date.now() - t0 }
    } finally { clearTimeout(timer) }
  } catch { return null }
}

let freeVpnCancelled = false

ipcMain.handle('vpn:freeConnect', async (_e, cc: string, countryName?: string) => {
  freeVpnCancelled = false
  const label = countryName || cc
  try {
    // Direct IP first — the yardstick that proves a proxy actually masks us.
    let directIp = ''
    try { directIp = JSON.parse((await httpGet('https://api.ipify.org?format=json', 8000)).body).ip || '' } catch {}

    safelySend('vpn:freeProgress', { phase: 'fetching', country: cc })
    // Free proxies have a low success rate for HTTPS tunnelling — most are
    // dead or refuse CONNECT. Sampling only a few dozen frequently found
    // nothing even though the pool holds hundreds, so cast a wider net and
    // probe more of them at once rather than waiting on slow serial batches.
    const candidates = (await fetchFreeProxyList(cc)).slice(0, 150)
    if (!candidates.length) {
      return { success: false, error: `No free ${label} servers available right now. Try another country or retry in a few minutes.` }
    }

    const BATCH = 15
    for (let i = 0; i < candidates.length; i += BATCH) {
      if (freeVpnCancelled) return { success: false, error: 'Cancelled', cancelled: true }
      safelySend('vpn:freeProgress', { phase: 'testing', tried: i, total: candidates.length, country: cc })
      const batch = candidates.slice(i, i + BATCH)
      const results = await Promise.all(
        // Dead proxies fail fast; working ones answer well inside 5s
        batch.map((rule, j) => probeProxy(rule, `vpn-probe-${j}`, 5000).then(res => ({ rule, res })))
      )
      // Every proxy that answered AND masks the real IP, fastest first — so we
      // connect through the quickest server in the batch, not just the first
      // one to reply. Directly helps the "everything is slow" experience.
      const workers = results
        .filter(r => r.res && r.res.ip && r.res.ip !== directIp)
        .sort((a, b) => a.res!.ms - b.res!.ms)

      for (const w of workers) {
        if (freeVpnCancelled) return { success: false, error: 'Cancelled', cancelled: true }
        const u = new URL(w.rule)
        // Apply to the sessions real browsing uses, then PROVE it took effect
        // by re-checking the public IP through the tab session. Without this
        // check "connected" could be reported while pages still went out
        // direct — which is exactly what used to happen.
        await applyProxyToTraffic({ proxyRules: w.rule, proxyBypassRules: '<local>' })
        const liveIp = await currentPublicIp(9000)
        if (!liveIp || (directIp && liveIp === directIp)) {
          // Not actually routing — undo and try the next-fastest
          await applyProxyToTraffic({ mode: 'direct' })
          continue
        }
        vpnActive = {
          protocol: u.protocol.replace(':', ''), host: u.hostname, port: Number(u.port),
          free: true, countryCode: cc, countryName: label,
        }
        broadcastVpnState()
        return { success: true, ip: liveIp, proxy: w.rule, ms: w.res!.ms }
      }
    }
    return {
      success: false,
      error: `All ${candidates.length} free ${label} servers are busy or offline right now. Free servers come and go — retry in a minute or pick another country.`,
    }
  } catch (e: any) { return { success: false, error: e.message } }
})

ipcMain.handle('vpn:freeCancel', () => { freeVpnCancelled = true; return { success: true } })

// ── Focus sessions ─────────────────────────────────────────────────────────
// While a focus session is active the renderer sends the blocked domains here.
// We intercept only top-level navigations to those domains on the browsing
// session and redirect them to a small "blocked" page — everything else passes
// straight through, and the whole thing is torn down when focus ends.
// Chromium refuses to redirect a top-level navigation to a data: URL, so the
// "blocked" page is hosted on the landing site. The blocked domain rides along
// as ?site= for a tailored message.
const FOCUS_BLOCK_PAGE = 'https://landing-sooty-omega-22.vercel.app/blocked.html'

let focusBlocked: string[] | null = null
function hostRoot(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase() } catch { return '' }
}

ipcMain.handle('focus:apply', (_e, blocked: string[] | null) => {
  focusBlocked = (Array.isArray(blocked) && blocked.length)
    ? blocked.map(d => String(d).replace(/^www\./, '').toLowerCase()).filter(Boolean)
    : null
  const ses = session.fromPartition('persist:main')
  try {
    if (focusBlocked) {
      ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, cb) => {
        try {
          if (details.resourceType === 'mainFrame' && focusBlocked) {
            const host = hostRoot(details.url)
            // Don't re-block the block page itself, or we'd loop.
            if (host && host !== 'landing-sooty-omega-22.vercel.app' &&
                focusBlocked.some(b => host === b || host.endsWith('.' + b))) {
              cb({ redirectURL: `${FOCUS_BLOCK_PAGE}?site=${encodeURIComponent(host)}` }); return
            }
          }
        } catch {}
        cb({}) // fail-open: never block anything we didn't mean to
      })
    } else {
      ses.webRequest.onBeforeRequest(null)
    }
    return { ok: true }
  } catch (e: any) { return { ok: false, error: e.message } }
})

// Native country picker for the toolbar VPN button. It has to be a native
// menu: the nav bar is host HTML, and the active tab's BrowserView paints
// above host HTML, so an HTML dropdown hanging below the bar is invisible
// behind the page (same reason the tab menu is native).
// Resolves with 'connect:<CC>', 'disconnect', or '' when dismissed.
ipcMain.handle('vpn:showMenu', (e, countries: { cc: string; name: string }[]) => {
  return new Promise<string>((resolve) => {
    let resolved = false
    const done = (v: string) => { if (!resolved) { resolved = true; resolve(v) } }

    const active = vpnActive
    const items: Electron.MenuItemConstructorOptions[] = [
      {
        label: active
          ? `VPN on — ${active.countryName || `${active.host}:${active.port}`}`
          : 'VPN off — pick a country',
        enabled: false,
      },
      { type: 'separator' },
    ]

    // Country names only, no emoji — flag glyphs render as tofu boxes in
    // native Windows menus.
    for (const c of (Array.isArray(countries) ? countries : [])) {
      items.push({
        label: c.name,
        type: 'checkbox',
        checked: !!active?.free && active.countryCode === c.cc,
        click: () => done(`connect:${c.cc}`),
      })
    }

    if (active) {
      items.push({ type: 'separator' })
      items.push({ label: 'Turn VPN off', click: () => done('disconnect') })
    }

    const menu = Menu.buildFromTemplate(items)
    // callback also fires on dismiss — defer so a real click wins the race
    menu.popup({ window: winFrom(e), callback: () => setTimeout(() => done(''), 0) })
  })
})

ipcMain.handle('vpn:setProxy', async (_e, cfg: { protocol: string; host: string; port: number; username?: string; password?: string }) => {
  try {
    let rules = `${cfg.protocol.toLowerCase()}://`
    if (cfg.username && cfg.password) rules += `${encodeURIComponent(cfg.username)}:${encodeURIComponent(cfg.password)}@`
    rules += `${cfg.host}:${cfg.port}`
    await applyProxyToTraffic({ proxyRules: rules, proxyBypassRules: '<local>' })
    // Confirm the proxy actually carries traffic before reporting success
    const liveIp = await currentPublicIp(9000)
    if (!liveIp) {
      await applyProxyToTraffic({ mode: 'direct' })
      return { success: false, error: 'That proxy did not respond — nothing was changed.' }
    }
    vpnActive = cfg
    broadcastVpnState()
    return { success: true, ip: liveIp }
  } catch (e: any) { return { success: false, error: e.message } }
})

ipcMain.handle('vpn:clearProxy', async () => {
  try {
    await applyProxyToTraffic({ mode: 'direct' })
    vpnActive = null
    broadcastVpnState()
    return { success: true }
  } catch (e: any) { return { success: false, error: e.message } }
})

ipcMain.handle('vpn:getIp', async () => {
  // Query through the SAME session tab content uses ('persist:main'), not
  // defaultSession and not Node's https module. Node bypasses Chromium's proxy
  // entirely, and defaultSession is not what pages load through — reading
  // either one reports an IP that has nothing to do with real browsing.
  try {
    const ses = session.fromPartition('persist:main')
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 12000)
    try {
      const res = await ses.fetch('https://ipinfo.io/json', { signal: ctrl.signal, cache: 'no-store' })
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` }
      const d = await res.json()
      return { success: true, ip: d.ip, city: d.city, region: d.region, country: d.country, org: d.org }
    } finally { clearTimeout(timer) }
  } catch (e: any) { return { success: false, error: e.message } }
})

// ── IPC: Window ────────────────────────────────────────────────────────────
ipcMain.handle('window:minimize',    (e) => winFrom(e)?.minimize())
ipcMain.handle('window:maximize',    (e) => { const w = winFrom(e); if (!w) return; w.isMaximized() ? w.unmaximize() : w.maximize() })
ipcMain.handle('window:close',       (e) => winFrom(e)?.close())
ipcMain.handle('window:isMaximized', (e) => !!winFrom(e)?.isMaximized())

// Detach a page into its own window — drag a tab out of the strip, use the tab
// context menu, or "Open Link in New Window". The result is a COMPLETE browser
// window (tab strip, sidebar, toolbar, AI panel, VPN, annotation, screenshot,
// recording), identical to launching the app fresh, just opened on this page.
function openDetachedWindow(url: string, _title?: string) {
  return createAppWindow(url).win
}

ipcMain.handle('window:detachTab', (_e, url: string, title?: string) => {
  try {
    if (!/^https?:\/\//i.test(url)) return { success: false, error: 'Only web pages can move to their own window' }
    openDetachedWindow(url, title)
    return { success: true }
  } catch (e: any) { return { success: false, error: e.message } }
})

// ── IPC: Tab context menu ───────────────────────────────────────────────────
// Native menu — an HTML menu in the tab strip would be clipped by the 40px
// bar and painted over by the active tab's BrowserView. Resolves with the
// chosen action id, or '' if dismissed.
ipcMain.handle('tabs:showContextMenu', (e, info: { tabId?: string; isBrowser: boolean; hasRight: boolean; count: number; canSleep?: boolean }) => {
  return new Promise<string>((resolve) => {
    let resolved = false
    const done = (action: string) => { if (!resolved) { resolved = true; resolve(action) } }
    const tabWc = info.tabId ? ctxFromEvent(e)?.views.get(info.tabId)?.webContents : undefined
    let muted = false
    try { muted = !!tabWc?.isAudioMuted() } catch {}
    const menu = Menu.buildFromTemplate([
      { label: 'New Tab',                 click: () => done('new-tab') },
      { label: 'Duplicate Tab',           click: () => done('duplicate') },
      { label: 'Move Tab to New Window',  enabled: info.isBrowser, click: () => done('detach') },
      { label: 'Sleep Tab (free memory)', enabled: !!info.canSleep, click: () => done('sleep') },
      { type: 'separator' },
      { label: 'Reload',                  enabled: info.isBrowser, click: () => done('reload') },
      { label: 'Copy Page URL',           enabled: info.isBrowser && !!tabWc, click: () => {
          try { const u = tabWc!.getURL(); if (u) clipboard.writeText(u) } catch {}
          done('')
        } },
      { label: muted ? 'Unmute Tab' : 'Mute Tab', enabled: info.isBrowser && !!tabWc, click: () => {
          try { tabWc!.setAudioMuted(!muted) } catch {}
          done('')
        } },
      { type: 'separator' },
      { label: 'Close Tab',               click: () => done('close') },
      { label: 'Close Other Tabs',        enabled: info.count > 1, click: () => done('close-others') },
      { label: 'Close Tabs to the Right', enabled: info.hasRight,  click: () => done('close-right') },
    ])
    // callback fires on dismiss too; defer so a click handler wins the race
    menu.popup({ window: winFrom(e), callback: () => setTimeout(() => done(''), 0) })
  })
})
ipcMain.handle('window:setTransparency', (e, mode: string) => {
  const d = getData(); d.settings.transparency = mode; saveData()
  const w = winFrom(e)
  if (w) {
    applyTransparency(w, mode)
    safelySend('theme:transparency', mode)
  }
})
ipcMain.handle('window:setOpacity', (e, opacity: number) => {
  const d = getData(); d.settings.windowOpacity = opacity; saveData()
  const w = winFrom(e); if (w) applyWindowOpacity(w, opacity)
})

registerGoogleIpc(safelySend)

// ── IPC: Tab content views (BrowserView) ────────────────────────────────────
ipcMain.handle('tabview:create', (e, tabId: string, url: string) => createTabView(ctxFromEvent(e), tabId, url))
ipcMain.handle('tabview:destroy', (e, tabId: string) => destroyTabView(ctxFromEvent(e), tabId))
ipcMain.handle('tabview:setActive', (e, tabId: string | null) => {
  const ctx = ctxFromEvent(e); if (!ctx) return
  ctx.activeId = tabId
  syncActiveBrowserView(ctx)
})
ipcMain.handle('tabview:setBounds', (e, bounds: { x: number; y: number; width: number; height: number }) => {
  const ctx = ctxFromEvent(e); if (!ctx) return
  ctx.bounds = bounds
  syncActiveBrowserView(ctx)
})
ipcMain.handle('tabview:setOverlayHidden', (e, hidden: boolean) => {
  const ctx = ctxFromEvent(e); if (!ctx) return
  ctx.overlayHidden = hidden
  syncActiveBrowserView(ctx)
})
ipcMain.handle('tabview:navigate', (e, tabId: string, url: string) => {
  try { ctxFromEvent(e)?.views.get(tabId)?.webContents.loadURL(url) } catch {}
})
ipcMain.handle('tabview:goBack', (e, tabId: string) => {
  const wc = ctxFromEvent(e)?.views.get(tabId)?.webContents
  try { if (wc?.canGoBack()) wc.goBack() } catch {}
})
ipcMain.handle('tabview:goForward', (e, tabId: string) => {
  const wc = ctxFromEvent(e)?.views.get(tabId)?.webContents
  try { if (wc?.canGoForward()) wc.goForward() } catch {}
})
ipcMain.handle('tabview:reload', (e, tabId: string) => {
  try { ctxFromEvent(e)?.views.get(tabId)?.webContents.reload() } catch {}
})
ipcMain.handle('tabview:getNavState', (e, tabId: string) => {
  const wc = ctxFromEvent(e)?.views.get(tabId)?.webContents
  try { return { canGoBack: wc?.canGoBack() ?? false, canGoForward: wc?.canGoForward() ?? false } }
  catch { return { canGoBack: false, canGoForward: false } }
})
// Runs a script inside a tab's page and returns its completion value — the
// agent layer uses this to read pages and drive forms (fill fields, click).
// userGesture=true so synthesized clicks count as real user interaction.
ipcMain.handle('tabview:find', (e, tabId: string, text: string, forward?: boolean, findNext?: boolean) => {
  const wc = ctxFromEvent(e)?.views.get(tabId)?.webContents
  if (!wc || !text) return
  try { wc.findInPage(text, { forward: forward !== false, findNext: !!findNext }) } catch {}
})
ipcMain.handle('tabview:stopFind', (e, tabId: string, action?: 'clearSelection' | 'keepSelection' | 'activateSelection') => {
  try { ctxFromEvent(e)?.views.get(tabId)?.webContents.stopFindInPage(action || 'clearSelection') } catch {}
})
ipcMain.handle('tabview:zoom', (e, tabId: string, dir: 'in' | 'out' | 'reset') => {
  const wc = ctxFromEvent(e)?.views.get(tabId)?.webContents
  if (!wc) return
  try {
    if (dir === 'reset') wc.setZoomLevel(0)
    else wc.setZoomLevel(Math.max(-7, Math.min(8, wc.getZoomLevel() + (dir === 'in' ? 0.5 : -0.5))))
  } catch {}
})
ipcMain.handle('tabview:execJs', async (e, tabId: string, script: string) => {
  const wc = ctxFromEvent(e)?.views.get(tabId)?.webContents
  if (!wc || wc.isDestroyed()) return { error: 'tab not found — it may be a home/app tab, not a web page' }
  try {
    const result = await wc.executeJavaScript(script, true)
    return { result }
  } catch (e: any) {
    return { error: e?.message || String(e) }
  }
})

// ── IPC: Bookmarks ─────────────────────────────────────────────────────────
ipcMain.handle('bookmarks:getAll', () => getData().bookmarks)
ipcMain.handle('bookmarks:add', (_e, bm) => {
  const d = getData(); const b = { ...bm, id: `bm-${Date.now()}`, addedAt: Date.now() }
  d.bookmarks.push(b); saveData(); return b
})
ipcMain.handle('bookmarks:remove', (_e, id: string) => {
  const d = getData(); d.bookmarks = d.bookmarks.filter((b: any) => b.id !== id); saveData(); return true
})
ipcMain.handle('bookmarks:update', (_e, id: string, u: any) => {
  const d = getData(); const i = d.bookmarks.findIndex((b: any) => b.id === id)
  if (i !== -1) d.bookmarks[i] = { ...d.bookmarks[i], ...u }; saveData(); return d.bookmarks[i]
})

// ── IPC: History ───────────────────────────────────────────────────────────
ipcMain.handle('history:getAll',     () => readJson(HIST_FILE, []))
ipcMain.handle('history:clear',      () => { writeJson(HIST_FILE, []); return true })
ipcMain.handle('history:deleteItem', (_e, id: string) => {
  const h = readJson(HIST_FILE, []); writeJson(HIST_FILE, h.filter((x: any) => x.id !== id)); return true
})
ipcMain.handle('history:add', (_e, entry: { url: string; title: string; favicon?: string }) => {
  if (!entry.url || entry.url === 'home' || entry.url.startsWith('aihub://')) return
  const h = readJson(HIST_FILE, [])
  const recent = h.filter((x: any) => !(x.url === entry.url && Date.now() - x.timestamp < 30000))
  recent.unshift({ ...entry, timestamp: Date.now(), id: `h-${Date.now()}` })
  writeJson(HIST_FILE, recent.slice(0, 2000))
  recordVisit(entry.url, entry.title)
  return true
})

// ── IPC: Downloads ─────────────────────────────────────────────────────────
ipcMain.handle('downloads:getAll',       () => {
  // A download can only be "progressing" while its BrowserView is alive. If any
  // entry is still marked progressing on read, its download died with a previous
  // app session (crash / quit mid-transfer) and will never emit 'done' — left
  // as-is it shows a spinner that buffers forever on the Downloads page. Settle
  // these stale rows to 'interrupted' once, on load.
  const raw = readJson(DL_FILE, []) as any[]
  let changed = false
  for (const dl of raw) {
    if (dl.state === 'progressing') { dl.state = 'interrupted'; changed = true }
  }
  // Legacy duplicate cleanup: stacked will-download listeners (fixed) used to
  // record one real download as N entries — same url+filename started within
  // a 2s window. Keep the best row per group (completed beats interrupted,
  // then most-recent) so history written by older builds heals itself.
  const dls: any[] = []
  const rank = (d: any) => (d.state === 'completed' ? 2 : d.state === 'progressing' ? 1 : 0)
  for (const dl of raw) {
    const dup = dls.find(x =>
      x.url === dl.url && x.filename === dl.filename &&
      Math.abs((x.startedAt || 0) - (dl.startedAt || 0)) < 2000)
    if (!dup) { dls.push(dl); continue }
    changed = true
    if (rank(dl) > rank(dup)) dls[dls.indexOf(dup)] = dl
  }
  if (changed) writeJson(DL_FILE, dls)
  return dls
})
ipcMain.handle('downloads:clear',        () => { writeJson(DL_FILE, []); return true })
ipcMain.handle('downloads:openFile',     (_e, p: string) => shell.openPath(p))
ipcMain.handle('downloads:showInFolder', (_e, p: string) => shell.showItemInFolder(p))

// ── IPC: Cache ─────────────────────────────────────────────────────────────
ipcMain.handle('cache:clear', async () => {
  // Tabs load in the 'persist:main' partition, not defaultSession — clearing
  // only defaultSession left tab cookies/site-data (incl. Google's) untouched.
  // defaultSession is the HOST UI's session: its localStorage holds app data
  // (custom extensions, toggle states), so clear only its HTTP cache — wiping
  // its storage deleted every installed extension. Web-content storage lives
  // in the tab partition, which still gets the full clear.
  const tabSession = session.fromPartition('persist:main')
  await Promise.all([
    session.defaultSession.clearCache(),
    tabSession.clearCache(),
    tabSession.clearStorageData(),
  ])
  return true
})

// ── IPC: Extension store — disk copy of custom extensions + toggle states ──
// localStorage alone proved fragile (one storage clear deleted everything);
// this file is the durable source the renderer re-hydrates from on boot.
const EXT_FILE = join(APP_DIR, 'extensions.json')
ipcMain.handle('extstore:load', () => readJson(EXT_FILE, { customExts: [], states: {} }))
ipcMain.handle('extstore:save', (_e, patch: { customExts?: any[]; states?: any }) => {
  const cur = readJson(EXT_FILE, { customExts: [], states: {} })
  writeJson(EXT_FILE, { ...cur, ...patch })
  return true
})

// ── IPC: Settings ──────────────────────────────────────────────────────────
ipcMain.handle('settings:get', () => getData().settings)
ipcMain.handle('settings:set', (_e, u: any) => { const d = getData(); d.settings = { ...d.settings, ...u }; saveData() })

// Expose the resolved AI config so Settings page can show current values
ipcMain.handle('settings:getAIConfig', () => {
  const cfg = getAIConfig()
  const s   = getData().settings
  return {
    openrouterKey:   s.openrouterKey   || '',
    openrouterBase:  s.openrouterBase  || '',
    openrouterModel: s.openrouterModel || '',
    ollamaUrl:       s.ollamaUrl       || '',
    // Resolved values (from env or settings) — shown as placeholders
    resolvedKey:     cfg.orKey  ? cfg.orKey.slice(0, 12) + '…' : '',
    resolvedModel:   cfg.orMdl,
    resolvedOllama:  cfg.olBase,
  }
})
ipcMain.handle('settings:setAIConfig', (_e, cfg: { openrouterKey?: string; openrouterBase?: string; openrouterModel?: string; ollamaUrl?: string }) => {
  const d = getData()
  d.settings = { ...d.settings, ...cfg }
  saveData()
  _data = null // flush cache so getAIConfig() picks up new values immediately
  getData()
})

// ── IPC: AI Brain ──────────────────────────────────────────────────────────
ipcMain.handle('brain:getRecommendations',    () => getStoredRecommendations())
ipcMain.handle('brain:getProfile',            () => buildProfile())
ipcMain.handle('brain:refreshRecommendations', async () => {
  const { olBase } = getAIConfig()
  const model = getData().settings.aiModel || 'llama3'
  const recs = await generateRecommendations(olBase, model)
  saveRecommendations(recs)
  safelySend('brain:recommendations', recs)
  return recs
})

// ── IPC: Ollama ────────────────────────────────────────────────────────────
// Explicit, user-driven status checks (Settings "Check", AI panel open) force a
// fresh probe so a just-started Ollama is detected immediately; the internal
// ai:chat / summarize probes use the short cache.
ipcMain.handle('ollama:status', async () => checkOllamaRunning(true))
ipcMain.handle('ollama:pull', async (_e, model: string) => {
  const { olBase } = getAIConfig()
  try {
    const { status, body } = await httpPost(`${olBase}/api/pull`, { name: model, stream: false }, {}, 180000)
    if (status >= 200 && status < 400) { ollamaProbeCache = null; return { success: true } }
    return { success: false, error: body }
  } catch (e: any) { return { success: false, error: e.message } }
})

// ── IPC: WiFi ──────────────────────────────────────────────────────────────
ipcMain.handle('wifi:scan', async () => {
  if (process.platform !== 'win32') return { networks: [], error: 'WiFi scan only on Windows' }
  try {
    const raw = execSync('netsh wlan show networks mode=bssid', { encoding: 'utf-8', timeout: 8000 })
    const networks = parseWifiNetworks(raw)
    // Saved profiles let us connect to a secured network without asking for
    // the password again — mark those so the UI can offer one-click connect.
    let saved: string[] = []
    try {
      const profRaw = execSync('netsh wlan show profiles', { encoding: 'utf-8', timeout: 8000 })
      saved = [...profRaw.matchAll(/(?:All User Profile|User Profile)\s*:\s*(.+)/g)].map(m => m[1].trim())
    } catch {}
    for (const n of networks) n.saved = saved.includes(n.ssid)
    return { networks, connectedSsid: currentWifiSsid() }
  } catch (e: any) { return { networks: [], error: e.message } }
})

// SSID the WLAN interface is actually associated with right now ('' if none).
function currentWifiSsid(): string {
  try {
    const raw = execSync('netsh wlan show interfaces', { encoding: 'utf-8', timeout: 8000 })
    if (!/^\s*State\s*:\s*connected/im.test(raw)) return ''
    const m = raw.match(/^\s*SSID\s*:\s*(.+)$/im)
    return m ? m[1].trim() : ''
  } catch { return '' }
}

function buildWlanProfileXml(ssid: string, security: { auth: string; encryption: string; password?: string }) {
  // SSID → hex, so exotic characters in the name can't break the XML.
  const hex = Buffer.from(ssid, 'utf-8').toString('hex').toUpperCase()
  const sharedKey = security.password
    ? `\n    <sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>${escapeXml(security.password)}</keyMaterial></sharedKey>`
    : ''
  return `<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>${escapeXml(ssid)}</name>
  <SSIDConfig><SSID><hex>${hex}</hex><name>${escapeXml(ssid)}</name></SSIDConfig>
  <connectionType>ESS</connectionType>
  <connectionMode>manual</connectionMode>
  <MSM><security>
    <authEncryption><authentication>${security.auth}</authentication><encryption>${security.encryption}</encryption><useOneX>false</useOneX></authEncryption>${sharedKey}
  </security></MSM>
</WLANProfile>`
}

function addWlanProfile(xml: string) {
  const tmp = join(os.tmpdir(), `aihub-wifi-${Date.now()}.xml`)
  fs.writeFileSync(tmp, xml, 'utf-8')
  // execFileSync (no shell) — the SSID is an untrusted AP-supplied string,
  // so it must never be interpolated into a shell command line.
  try { execFileSync('netsh', ['wlan', 'add', 'profile', `filename=${tmp}`, 'user=all'], { timeout: 8000 }) }
  finally { try { fs.unlinkSync(tmp) } catch {} }
}

ipcMain.handle('wifi:connect', async (_e, ssid: string, open?: boolean, password?: string, auth?: string) => {
  if (process.platform !== 'win32') return { success: false, error: 'Windows only' }
  // netsh can only "connect name=" to an SSID that already has a saved WLAN
  // profile. Open networks get a minimal open-auth profile; secured networks
  // the user hasn't joined before get a WPA2/WPA3 profile built from the
  // password they typed. Either way: add profile → connect → VERIFY, because
  // "netsh wlan connect" reports success before association even starts.
  let addedProfile = false
  try {
    if (open) {
      addWlanProfile(buildWlanProfileXml(ssid, { auth: 'open', encryption: 'none' }))
      addedProfile = true
    } else if (password) {
      if (password.length < 8 || password.length > 63) {
        return { success: false, error: 'WiFi passwords are 8–63 characters', needsPassword: true }
      }
      const wpa3 = /wpa3/i.test(auth || '')
      addWlanProfile(buildWlanProfileXml(ssid, { auth: wpa3 ? 'WPA3SAE' : 'WPA2PSK', encryption: 'AES', password }))
      addedProfile = true
    }
    try {
      execFileSync('netsh', ['wlan', 'connect', `name=${ssid}`], { timeout: 12000 })
    } catch (e: any) {
      const detail = (e.stdout?.toString?.() || '').trim() || e.message
      // No saved profile for this secured network → the UI should ask for a password.
      if (/no profile/i.test(detail) && !open && !password) {
        return { success: false, needsPassword: true, error: 'Password needed for this network' }
      }
      throw e
    }
    // Poll the interface — association takes a few seconds, and a wrong
    // password just quietly never reaches "connected".
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 1000))
      if (currentWifiSsid() === ssid) return { success: true }
    }
    // Never associated. If we just wrote a profile from a typed password,
    // remove it so the bad key doesn't stick around poisoning future attempts.
    if (addedProfile && password) {
      try { execFileSync('netsh', ['wlan', 'delete', 'profile', `name=${ssid}`], { timeout: 8000 }) } catch {}
      return { success: false, needsPassword: true, error: 'Could not connect — wrong password or weak signal. Try again.' }
    }
    return { success: false, error: 'Could not connect — the network did not respond. Move closer and retry.' }
  } catch (e: any) {
    // netsh writes the useful message to stdout, not the thrown Error.
    const detail = (e.stdout?.toString?.() || '').trim() || e.message
    return { success: false, error: detail }
  }
})

// ── IPC: Sticky notes (annotation) ─────────────────────────────────────────
// Notes used to live only in each site's localStorage, which made them
// invisible outside that exact page and easy to lose. The app file is now
// the source of truth: keyed by origin+pathname, one entry per page.
// ── Per-site AI memory ─────────────────────────────────────────────────────
// Freeform context the assistant should remember for a given site, keyed by
// origin (so it applies across the whole site, not one page). Injected into the
// AI system prompt when the user is on that origin, and writable both by the
// user (memory editor) and the AI (the `remember` tool).
const SITE_MEMORY_FILE = join(APP_DIR, 'site-memory.json')
let _siteMemory: Record<string, { title?: string; text: string; updatedAt: number }> | null = null
function getSiteMemory() {
  if (!_siteMemory) _siteMemory = readJson(SITE_MEMORY_FILE, {}) || {}
  return _siteMemory!
}
function originKey(url: string): string {
  try { return new URL(url).origin } catch { return '' }
}
ipcMain.handle('siteMemory:get', (_e, url: string) => {
  const k = originKey(url)
  return k ? (getSiteMemory()[k]?.text || '') : ''
})
ipcMain.handle('siteMemory:set', (_e, url: string, text: string, title?: string) => {
  try {
    const store = getSiteMemory()
    const k = originKey(url)
    if (!k) return { ok: false, error: 'no origin' }
    const clean = String(text || '').trim()
    if (!clean) delete store[k]
    else store[k] = { title, text: clean.slice(0, 4000), updatedAt: Date.now() }
    writeJson(SITE_MEMORY_FILE, store)
    safelySend('siteMemory:changed', { origin: k })
    return { ok: true }
  } catch (e: any) { return { ok: false, error: e.message } }
})
ipcMain.handle('siteMemory:getAll', () => getSiteMemory())

// ── Rewind / Time Machine ──────────────────────────────────────────────────
// A local, searchable record of the readable content of pages the user has
// actually dwelt on. Lets them find "that article I read last week" by what it
// SAID, not just its URL. Stored locally, capped, never leaves the machine.
interface RewindEntry { id: string; url: string; title: string; favicon: string; text: string; ts: number }
const REWIND_FILE = join(APP_DIR, 'rewind.json')
let _rewind: RewindEntry[] | null = null
function getRewind(): RewindEntry[] { if (!_rewind) _rewind = (readJson(REWIND_FILE, []) as RewindEntry[]) || []; return _rewind! }
const REWIND_CAP = 3000

function rewindListItem(e: RewindEntry, snippet?: string) {
  return { id: e.id, url: e.url, title: e.title, favicon: e.favicon, ts: e.ts, snippet: snippet ?? e.text.slice(0, 180) }
}
function rewindSnippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase()
  let at = -1
  for (const t of terms) { const i = lower.indexOf(t); if (i !== -1 && (at === -1 || i < at)) at = i }
  if (at === -1) return text.slice(0, 180)
  const start = Math.max(0, at - 60)
  return (start > 0 ? '…' : '') + text.slice(start, start + 220).trim() + '…'
}

ipcMain.handle('rewind:add', (_e, entry: { url: string; title?: string; favicon?: string; text?: string }) => {
  try {
    if (!entry?.url || !/^https?:\/\//i.test(entry.url)) return { ok: false }
    const store = getRewind()
    // Merge captures of the same URL within 30 min instead of piling up dupes.
    const recent = store.find(e => e.url === entry.url && Date.now() - e.ts < 30 * 60 * 1000)
    if (recent) {
      if (entry.title) recent.title = entry.title
      if (entry.text) recent.text = entry.text.slice(0, 6000)
      recent.ts = Date.now()
    } else {
      store.unshift({
        id: `rw-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        url: entry.url, title: entry.title || entry.url, favicon: entry.favicon || '',
        text: (entry.text || '').slice(0, 6000), ts: Date.now(),
      })
      if (store.length > REWIND_CAP) store.length = REWIND_CAP
    }
    writeJson(REWIND_FILE, store)
    return { ok: true }
  } catch (e: any) { return { ok: false, error: e.message } }
})

ipcMain.handle('rewind:search', (_e, query: string) => {
  const q = String(query || '').toLowerCase().trim()
  const store = getRewind()
  if (!q) return store.slice(0, 80).map(e => rewindListItem(e))
  const terms = q.split(/\s+/).filter(Boolean)
  const scored: { e: RewindEntry; score: number }[] = []
  for (const e of store) {
    const title = e.title.toLowerCase(), hay = `${title} ${e.url.toLowerCase()} ${e.text.toLowerCase()}`
    let score = 0, missed = false
    for (const t of terms) {
      const n = hay.split(t).length - 1
      if (n === 0) { missed = true; break }
      score += n + (title.includes(t) ? 5 : 0) // title matches weigh more
    }
    if (missed) continue
    score += Math.max(0, 7 - (Date.now() - e.ts) / 86400000) * 0.4 // gentle recency boost
    scored.push({ e, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 100).map(s => rewindListItem(s.e, rewindSnippet(s.e.text, terms)))
})

ipcMain.handle('rewind:stats', () => {
  const store = getRewind()
  return { count: store.length, oldest: store.length ? store[store.length - 1].ts : 0 }
})
ipcMain.handle('rewind:remove', (_e, id: string) => {
  const store = getRewind(); const i = store.findIndex(e => e.id === id)
  if (i !== -1) { store.splice(i, 1); writeJson(REWIND_FILE, store) }
  return { ok: true }
})
ipcMain.handle('rewind:clear', () => { _rewind = []; writeJson(REWIND_FILE, []); return { ok: true } })

// ── Watch & Ping ───────────────────────────────────────────────────────────
// Background monitors: re-check a page on a schedule and fire a desktop
// notification when it changes (or when a keyword appears). Turns the browser
// into a watchdog — "tell me when this drops in price / this issue closes".
interface Watch {
  id: string; url: string; title: string
  mode: 'change' | 'contains'; keyword?: string
  intervalMin: number
  active: boolean
  lastHash?: string; lastChecked?: number; lastChanged?: number
  triggered?: boolean // currently in a fired state (until re-armed by the user)
}
const WATCHES_FILE = join(APP_DIR, 'watches.json')
let _watches: Watch[] | null = null
function getWatches(): Watch[] { if (!_watches) _watches = (readJson(WATCHES_FILE, []) as Watch[]) || []; return _watches! }
function saveWatches() { writeJson(WATCHES_FILE, getWatches()); safelySend('watch:changed', null) }
function hashStr(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) { h = (Math.imul(31, h) + s.charCodeAt(i)) | 0 }
  return String(h >>> 0)
}

ipcMain.handle('watch:list', () => getWatches())
ipcMain.handle('watch:add', (_e, w: { url: string; title?: string; mode?: 'change' | 'contains'; keyword?: string; intervalMin?: number }) => {
  try {
    if (!w?.url || !/^https?:\/\//i.test(w.url)) return { ok: false, error: 'a full http(s) url is required' }
    const watches = getWatches()
    const watch: Watch = {
      id: `w-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      url: w.url, title: w.title || w.url,
      mode: w.mode === 'contains' ? 'contains' : 'change',
      keyword: (w.keyword || '').trim() || undefined,
      intervalMin: Math.max(5, Math.min(1440, w.intervalMin || 30)),
      active: true,
    }
    watches.unshift(watch)
    saveWatches()
    checkWatch(watch).catch(() => {}) // establish a baseline immediately
    return { ok: true, id: watch.id }
  } catch (e: any) { return { ok: false, error: e.message } }
})
ipcMain.handle('watch:remove', (_e, id: string) => {
  const watches = getWatches(); const i = watches.findIndex(w => w.id === id)
  if (i !== -1) { watches.splice(i, 1); saveWatches() }
  return { ok: true }
})
ipcMain.handle('watch:toggle', (_e, id: string) => {
  const w = getWatches().find(x => x.id === id)
  if (w) { w.active = !w.active; if (w.active) w.triggered = false; saveWatches() }
  return { ok: true }
})
// Re-arm a fired watch (acknowledge and keep watching) or check one now.
ipcMain.handle('watch:rearm', (_e, id: string) => {
  const w = getWatches().find(x => x.id === id)
  if (w) { w.triggered = false; saveWatches() }
  return { ok: true }
})
ipcMain.handle('watch:checkNow', async (_e, id: string) => {
  const w = getWatches().find(x => x.id === id)
  if (w) await checkWatch(w, true)
  return { ok: true }
})

async function checkWatch(w: Watch, force = false) {
  try {
    const { status, body } = await fetchHtml(w.url, 12000)
    if (status >= 400) { w.lastChecked = Date.now(); saveWatches(); return }
    const text = htmlToText(body)
    w.lastChecked = Date.now()
    if (w.mode === 'contains') {
      const hit = w.keyword ? text.toLowerCase().includes(w.keyword.toLowerCase()) : false
      if (hit && !w.triggered) { w.triggered = true; w.lastChanged = Date.now(); notifyWatch(w, `“${w.keyword}” appeared on the page`) }
    } else {
      const hash = hashStr(text)
      if (w.lastHash === undefined || force && w.lastHash === undefined) { w.lastHash = hash }
      else if (hash !== w.lastHash) {
        w.lastHash = hash; w.lastChanged = Date.now()
        if (!w.triggered) { w.triggered = true; notifyWatch(w, 'This page changed since you last looked') }
      }
    }
    saveWatches()
  } catch { w.lastChecked = Date.now(); saveWatches() }
}

function notifyWatch(w: Watch, body: string) {
  try {
    if (!Notification.isSupported()) return
    const n = new Notification({ title: `🔔 ${w.title}`, body, silent: false })
    n.on('click', () => {
      const ctx = appWins.values().next()
      if (!ctx.done) { const win = ctx.value.win; if (win.isMinimized()) win.restore(); win.focus(); sendTo(ctx.value, 'open-in-new-tab', w.url) }
    })
    n.show()
  } catch {}
  safelySend('watch:triggered', { id: w.id, title: w.title, url: w.url, body })
}

// Scheduler — one tick a minute; check whichever active watches are due.
setInterval(() => {
  const now = Date.now()
  for (const w of getWatches()) {
    if (!w.active || w.triggered) continue
    if (!w.lastChecked || now - w.lastChecked >= w.intervalMin * 60000) checkWatch(w).catch(() => {})
  }
}, 60 * 1000)

const NOTES_FILE = join(APP_DIR, 'sticky-notes.json')
let _stickyNotes: Record<string, { url: string; pageTitle: string; updatedAt: number; notes: any[] }> | null = null

function getNotesStore() {
  if (!_stickyNotes) _stickyNotes = readJson(NOTES_FILE, {}) || {}
  return _stickyNotes!
}
function noteKey(url: string): string {
  try { const u = new URL(url); return u.origin + u.pathname } catch { return url }
}

ipcMain.handle('notes:getForUrl', (_e, url: string) => getNotesStore()[noteKey(url)]?.notes || [])

ipcMain.handle('notes:saveForUrl', (_e, url: string, notes: any[], pageTitle?: string) => {
  try {
    const store = getNotesStore()
    const k = noteKey(url)
    if (!Array.isArray(notes) || notes.length === 0) delete store[k]
    else store[k] = { url, pageTitle: pageTitle || store[k]?.pageTitle || '', updatedAt: Date.now(), notes }
    writeJson(NOTES_FILE, store)
    return { success: true }
  } catch (e: any) { return { success: false, error: e.message } }
})

ipcMain.handle('notes:getAll', () => getNotesStore())

ipcMain.handle('notes:deleteUrl', (_e, url: string) => {
  try {
    const store = getNotesStore()
    delete store[noteKey(url)]
    writeJson(NOTES_FILE, store)
    return { success: true }
  } catch (e: any) { return { success: false, error: e.message } }
})

ipcMain.handle('notes:deleteNote', (_e, url: string, noteId: string) => {
  try {
    const store = getNotesStore()
    const k = noteKey(url)
    const entry = store[k]
    if (entry) {
      entry.notes = entry.notes.filter((n: any) => n?.id !== noteId)
      if (entry.notes.length === 0) delete store[k]
      else entry.updatedAt = Date.now()
      writeJson(NOTES_FILE, store)
    }
    return { success: true }
  } catch (e: any) { return { success: false, error: e.message } }
})

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, c => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string
  ))
}

function parseWifiNetworks(raw: string) {
  const networks: any[] = []
  for (const block of raw.split(/SSID \d+ :/).slice(1)) {
    const lines = block.split('\n').map((l: string) => l.trim())
    const ssid   = lines[0]?.trim()
    const auth   = lines.find((l: string) => l.startsWith('Authentication'))?.split(':')[1]?.trim() || ''
    const signal = lines.find((l: string) => l.startsWith('Signal'))?.split(':')[1]?.trim() || ''
    const bssid  = lines.find((l: string) => l.match(/^BSSID \d+/))?.split(':').slice(1).join(':').trim() || ''
    if (ssid) networks.push({ ssid, auth, signal, bssid, open: auth === 'Open' })
  }
  return networks
}

// ── IPC: AI duplicate / categorize ────────────────────────────────────────
ipcMain.handle('ai:checkDuplicate', async (_e, url: string, existing: string[]) => {
  try {
    const u = new URL(url), dom = u.hostname.replace('www.', '')
    const exact     = existing.find(e => { try { return new URL(e).href === u.href } catch { return false } })
    if (exact) return { isDuplicate: true, reason: 'URL already bookmarked', matchedUrl: exact }
    const pathMatch = existing.find(e => { try { const eu = new URL(e); return eu.hostname.replace('www.', '') === dom && eu.pathname === u.pathname } catch { return false } })
    if (pathMatch) return { isDuplicate: true, reason: 'Same page already bookmarked', matchedUrl: pathMatch }
    const domMatch  = existing.find(e => { try { return new URL(e).hostname.replace('www.', '') === dom } catch { return false } })
    return { isDuplicate: false, isSameDomain: !!domMatch, matchedUrl: domMatch }
  } catch { return { isDuplicate: false } }
})

ipcMain.handle('ai:categorizeBookmark', async (_e, url: string, title: string) => {
  const cats = ['AI','Development','Finance','Trading','Education','Business','Entertainment','Personal','News','Tools','Search']
  const cols: Record<string,string> = {
    AI:'#a78bfa', Development:'#38bdf8', Finance:'#4ade80', Trading:'#fb923c',
    Education:'#fbbf24', Business:'#c084fc', Entertainment:'#f43f5e',
    Personal:'#f87171', News:'#34d399', Tools:'#60a5fa', Search:'#4285F4',
  }
  const heuristic = () => {
    const u = url.toLowerCase()
    if (u.includes('youtube') || u.includes('netflix') || u.includes('twitch')) return 'Entertainment'
    if (u.includes('google')) return 'Search'
    if (u.includes('trade') || u.includes('stock')) return 'Trading'
    if (u.includes('finance') || u.includes('quickbooks')) return 'Finance'
    if (u.includes('ai') || u.includes('aihub') || u.includes('agent')) return 'AI'
    if (u.includes('github') || u.includes('vercel')) return 'Development'
    return 'Tools'
  }
  const { olBase, orKey, orBase, orMdl } = getAIConfig()
  const prompt = `Category for "${title}" (${url})? Pick exactly one from: ${cats.join(', ')}. Reply with ONLY the category name.`

  // Try Ollama first
  try {
    const ol = await checkOllamaRunning()
    if (ol.running && ol.models.length > 0) {
      const pref  = getData().settings.aiModel || ''
      const model = (pref && ol.models.includes(pref)) ? pref : ol.models[0]
      const { body } = await httpPost(`${olBase}/api/chat`,
        { model, messages: [{ role: 'user', content: prompt }], stream: false, options: { temperature: 0 } }, {}, 10000)
      const raw = JSON.parse(body)?.message?.content?.trim() || ''
      const cat = cats.find(c => raw.toLowerCase().includes(c.toLowerCase())) || heuristic()
      return { category: cat, color: cols[cat] }
    }
  } catch {}

  // Try OpenRouter
  if (orKey) {
    try {
      const { body } = await httpPost(`${orBase}/chat/completions`,
        { model: orMdl, messages: [{ role: 'user', content: prompt }], max_tokens: 20, temperature: 0, include_reasoning: false },
        { Authorization: `Bearer ${toAscii(orKey)}`, 'HTTP-Referer': 'https://aihub-browser.app', 'X-Title': 'AIHub Browser' }, 10000)
      const raw = stripThinkTags(JSON.parse(body)?.choices?.[0]?.message?.content?.trim() || '')
      const cat = cats.find(c => raw.toLowerCase().includes(c.toLowerCase())) || heuristic()
      return { category: cat, color: cols[cat] }
    } catch {}
  }

  const cat = heuristic(); return { category: cat, color: cols[cat] }
})

// Fallback chain re-verified against the live OpenRouter free tier 2026-07-03
// (the June list was mostly retired — those slugs now 404 with "unavailable
// for free"). Ordered by quality for code generation; 'openrouter/free' is a
// meta-router that picks any available free model, so it terminates the chain
// with something that practically always answers.
// Nemotron sits last before the meta-router: it's a hidden-reasoning model
// that burns most of the completion budget on reasoning tokens (observed
// 4909/8192 on the extension-generation prompt), truncating the visible
// answer mid-JSON. Non-reasoning instruct models go first.
const OR_FREE_FALLBACKS = [
  'qwen/qwen3-coder:free',
  'openai/gpt-oss-120b:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-4-31b-it:free',
  'openai/gpt-oss-20b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'openrouter/free',
]

// ── Live OpenRouter model catalog ───────────────────────────────────────────
// The hardcoded list above is exactly the problem it warns about in its own
// comment: OpenRouter retires free-tier slugs without notice, so any fixed
// list drifts stale and starts eating 404s ("unavailable for free") that cost
// a full round-trip per dead model before falling through. Pull the live
// catalog (GET /models, no auth needed) and use it to drop retired slugs
// before we ever request them, and to pick up new free models automatically.
// Cached for 6h — the catalog doesn't churn hourly, and this keeps it off the
// hot path of every chat request. A failed/slow fetch degrades to the last
// good cache, or to the raw hardcoded list if we've never fetched successfully
// — offline shouldn't mean "no AI", it means "can't verify, so just try".
let orModelsCache: { ids: string[]; ts: number } | null = null
const OR_MODELS_TTL = 6 * 60 * 60_000

async function getLiveFreeModelIds(orBase: string): Promise<string[]> {
  if (orModelsCache && Date.now() - orModelsCache.ts < OR_MODELS_TTL) return orModelsCache.ids
  try {
    const { status, body } = await httpGet(`${orBase}/models`, 6000)
    if (status !== 200) return orModelsCache?.ids ?? []
    const data = JSON.parse(body)?.data || []
    const ids: string[] = data
      .filter((m: any) => m.id?.endsWith(':free') || (m.pricing?.prompt === '0' && m.pricing?.completion === '0'))
      .map((m: any) => m.id)
    if (ids.length) orModelsCache = { ids, ts: Date.now() }
    return ids.length ? ids : (orModelsCache?.ids ?? [])
  } catch {
    return orModelsCache?.ids ?? []
  }
}

// Build the ordered candidate chain for a chat request: the user's configured
// model first (if it's actually still alive), then the hand-tuned fallbacks
// filtered against the live catalog (retired ones silently drop out), then
// any other live free models as a last resort. If the catalog fetch failed
// entirely (empty, no cache), fall back to the old static behavior rather
// than refusing to try anything.
async function buildOrCandidates(orBase: string, orMdl: string): Promise<string[]> {
  const live = await getLiveFreeModelIds(orBase)
  if (!live.length) return [...new Set([orMdl, ...OR_FREE_FALLBACKS])]
  const liveSet = new Set(live)
  const ordered = [
    ...(liveSet.has(orMdl) ? [orMdl] : []),
    ...OR_FREE_FALLBACKS.filter(m => liveSet.has(m)),
    ...live.filter(m => m !== orMdl),
  ]
  return [...new Set(ordered)]
}

// Strip DeepSeek/reasoning model chain-of-thought tags before returning content
function stripThinkTags(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
}

async function openRouterChat(
  orBase: string, orKey: string, model: string,
  messages: any[], maxTokens = 2048
): Promise<string | null> {
  try {
    const { status, body } = await withNetRetry(() => httpPost(
      `${orBase}/chat/completions`,
      { model, messages, max_tokens: maxTokens, temperature: 0.7, include_reasoning: false },
      {
        Authorization: `Bearer ${toAscii(orKey)}`,
        'HTTP-Referer': toAscii('https://aihub-browser.app'),
        'X-Title': 'AIHub Browser',
      },
      30000
    ))
    if (status === 200) {
      const choice = JSON.parse(body)?.choices?.[0]
      // finish_reason 'length' at an 8192 budget means the model ran out of
      // tokens (reasoning models burn the budget invisibly) — the reply is
      // cut mid-sentence/mid-JSON. Fail over to the next model instead.
      if (choice?.finish_reason === 'length') return null
      const raw = choice?.message?.content || ''
      return stripThinkTags(raw) || null
    }
    // 404 = model not found on this account, 429 = rate-limited — skip to next model
    if (status === 404 || status === 429) return null
    // 401 = bad key, 5xx = server error — stop chain immediately
    throw new Error(`HTTP ${status}: ${body.slice(0, 200)}`)
  } catch (e: any) {
    if (e.message?.startsWith('HTTP 404') || e.message?.startsWith('HTTP 429')) return null
    throw e
  }
}

// ── IPC: AI chat ──────────────────────────────────────────────────────────
// Default order: Ollama first (private & free), OpenRouter as fallback.
// opts.preferCloud flips that — structured-output features (extension
// generation) need models that reliably emit strict JSON, which small local
// models fumble; cloud goes first and Ollama becomes the fallback.
ipcMain.handle('ai:chat', async (_e, messages: any[], preferredModel?: string, opts?: { preferCloud?: boolean }) => {
  const { olBase, orKey, orBase, orMdl } = getAIConfig()

  let ollamaDiag = ''
  const tryOllama = async (): Promise<{ content: string; model: string; provider: string } | null> => {
    try {
      const ol = await checkOllamaRunning()
      if (ol.running && ol.models.length > 0) {
        const preferred = preferredModel || getData().settings.aiModel || ''
        const model = (preferred && ol.models.includes(preferred)) ? preferred : ol.models[0]
        try {
          // Streamed so slow hardware / cold model loads can't trip the idle
          // timeout mid-generation; num_ctx 8192 so long replies aren't
          // truncated (Ollama's 4096 default cut extension JSON mid-output).
          const raw = await ollamaChatStream(olBase, model, messages)
          const content = stripThinkTags(raw)
          if (content) return { content, model, provider: 'ollama' }
          ollamaDiag = `Ollama returned an empty response (model: ${model})`
        } catch (e: any) {
          ollamaDiag = `Ollama request failed: ${e?.message || e} (model: ${model})`
        }
      }
    } catch (e: any) {
      ollamaDiag = `Ollama check failed: ${e?.message || e}`
    }
    if (ollamaDiag) console.warn('[aihub] ai:chat Ollama fallback:', ollamaDiag)
    return null
  }

  let cloudError = ''
  const tryCloud = async (): Promise<{ content: string; model: string; provider: string } | null> => {
    if (!orKey) return null
    // Candidate list: configured model first, then live-verified free fallbacks
    const candidates = await buildOrCandidates(orBase, orMdl)
    for (const model of candidates) {
      try {
        // 8192 tokens: long structured replies (extension generation emits
        // 5-10 objects with code) blow through the old 2048 default and get
        // truncated mid-JSON — same failure the Ollama path fixed via num_ctx.
        const content = await openRouterChat(orBase, orKey, model, messages, 8192)
        if (content) return { content, model, provider: 'openrouter' }
        // null = 404/429 on this model, try next
      } catch (e: any) {
        cloudError = e.message
        break // non-retryable error — stop trying
      }
    }
    return null
  }

  const order = opts?.preferCloud ? [tryCloud, tryOllama] : [tryOllama, tryCloud]
  for (const attempt of order) {
    const result = await attempt()
    if (result) return result
  }

  if (orKey) {
    if (cloudError) {
      const isNetIssue = /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ECONNRESET|timeout/i.test(cloudError)
      const tips = isNetIssue
        ? `Try:\n• Check your internet connection — the DNS lookup / connection to the AI server failed\n• If you're on a VPN or proxy, try disabling it\n• Wait 1–2 minutes and retry`
        : `Try:\n• Wait 1–2 minutes and retry\n• Install Ollama (ollama.com) for private local AI\n• Check your OpenRouter API key in Settings → AI Configuration`
      return {
        content: `Cloud AI error: ${cloudError}${ollamaDiag ? `\n\n(Local Ollama also failed: ${ollamaDiag})` : ''}\n\n${tips}`,
        model: 'error', provider: 'error',
      }
    }
    return {
      content: `All cloud models are currently unavailable.${ollamaDiag ? `\n\n(Local Ollama also failed: ${ollamaDiag})` : ''}\n\n• Wait 1–2 minutes and retry\n• Install Ollama at ollama.com and run: ollama pull llama3.1\n• Check your OpenRouter API key in Settings → AI Configuration`,
      model: 'none', provider: 'none',
    }
  }

  return {
    content: ollamaDiag
      ? `Ollama is set up but the request failed: ${ollamaDiag}\n\nTry:\n• Wait 1–2 minutes and retry\n• Restart Ollama\n• OR go to Settings → AI Configuration and paste an OpenRouter API key as a cloud fallback\n\nGet a free key at openrouter.ai`
      : 'No AI configured.\n\n• Install Ollama at ollama.com, then run: ollama pull llama3.1\n• OR go to Settings → AI Configuration and paste your OpenRouter API key\n\nGet a free key at openrouter.ai',
    model: 'none', provider: 'none',
  }
})

// ── IPC: AI summarize ─────────────────────────────────────────────────────
ipcMain.handle('ai:summarizePage', async (_e, pageText: string, url: string) => {
  const { olBase, orKey, orBase, orMdl } = getAIConfig()

  // Build prompt — use real extracted page text if available, else URL-based summary
  const userContent = pageText && pageText.length > 100
    ? `Summarize the following web page content in 3-5 concise bullet points. Focus on key takeaways, what the page is about, and who it's for.\n\nURL: ${url}\n\nPAGE CONTENT:\n${pageText.slice(0, 6000)}`
    : `Summarize the website at ${url} in 3-5 concise bullet points. Focus on what it does and who it's for.`

  const msgs = [{ role: 'user', content: userContent }]

  let ollamaDiag = ''
  try {
    const ol = await checkOllamaRunning()
    if (ol.running && ol.models.length > 0) {
      const pref  = getData().settings.aiModel || ''
      const model = (pref && ol.models.includes(pref)) ? pref : ol.models[0]
      try {
        const { status, body } = await httpPost(`${olBase}/api/chat`, { model, messages: msgs, stream: false }, {}, 45000)
        if (status >= 200 && status < 400) {
          const raw = JSON.parse(body)?.message?.content || ''
          const summary = stripThinkTags(raw)
          if (summary) return { summary }
          ollamaDiag = `Ollama returned an empty response (model: ${model})`
        } else {
          ollamaDiag = `Ollama request failed (HTTP ${status}, model: ${model})`
        }
      } catch (e: any) {
        ollamaDiag = `Ollama request failed: ${e?.message || e} (model: ${model})`
      }
    }
  } catch (e: any) {
    ollamaDiag = `Ollama check failed: ${e?.message || e}`
  }
  if (ollamaDiag) console.warn('[aihub] ai:summarizePage Ollama fallback:', ollamaDiag)

  if (orKey) {
    const candidates = await buildOrCandidates(orBase, orMdl)
    for (const model of candidates) {
      try {
        const summary = await openRouterChat(orBase, orKey, model, msgs, 800)
        if (summary) return { summary }
      } catch { break }
    }
  }

  return {
    summary: ollamaDiag
      ? `Unable to summarize — local Ollama failed: ${ollamaDiag}${orKey ? ' (cloud fallback also failed)' : ' and no cloud API key configured'}.`
      : 'Unable to summarize — Ollama offline and no cloud API key configured.',
  }
})

// ── IPC: Save summary as Markdown ─────────────────────────────────────────
ipcMain.handle('file:saveMd', async (_e, { title, content }: { title: string; content: string }) => {
  const safeName = title.replace(/[^a-z0-9\s]/gi, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'summary'
  const { filePath, canceled } = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow() ?? mainWindow, {
    title: 'Save Summary as Markdown',
    defaultPath: join(os.homedir(), 'Documents', `${safeName}.md`),
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })
  if (canceled || !filePath) return { success: false }
  try {
    fs.writeFileSync(filePath, content, 'utf-8')
    return { success: true, filePath }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

// ── IPC: Save screenshot as PNG ────────────────────────────────────────────
ipcMain.handle('file:saveImage', async (_e, { dataUrl, baseName }: { dataUrl: string; baseName?: string }) => {
  const safeName = (baseName || 'screenshot').replace(/[^a-z0-9\s-]/gi, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'screenshot'
  const { filePath, canceled } = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow() ?? mainWindow, {
    title: 'Save Screenshot',
    defaultPath: join(os.homedir(), 'Documents', `${safeName}-${Date.now()}.png`),
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
  })
  if (canceled || !filePath) return { success: false }
  try {
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'))
    return { success: true, filePath }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

// ── IPC: Save tab recording as WebM ────────────────────────────────────────
ipcMain.handle('file:saveVideo', async (_e, { buffer }: { buffer: ArrayBuffer }) => {
  const { filePath, canceled } = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow() ?? mainWindow, {
    title: 'Save Recording',
    defaultPath: join(os.homedir(), 'Documents', `recording-${Date.now()}.webm`),
    filters: [{ name: 'WebM Video', extensions: ['webm'] }],
  })
  if (canceled || !filePath) return { success: false }
  try {
    fs.writeFileSync(filePath, Buffer.from(buffer))
    return { success: true, filePath }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

// ── Agent store: saved custom agents + archived conversations ─────────────
function readAgentsStore(): { customAgents: any[]; conversations: any[] } {
  const s = readJson(AGENTS_FILE, null)
  return {
    customAgents:  Array.isArray(s?.customAgents)  ? s.customAgents  : [],
    conversations: Array.isArray(s?.conversations) ? s.conversations : [],
  }
}

ipcMain.handle('agents:load', () => readAgentsStore())

ipcMain.handle('agents:saveAgent', (_e, agent: any) => {
  if (!agent?.id || !agent?.name) return false
  const s = readAgentsStore()
  const i = s.customAgents.findIndex(a => a.id === agent.id)
  if (i >= 0) s.customAgents[i] = agent
  else s.customAgents.unshift(agent)
  writeJson(AGENTS_FILE, s)
  return true
})

ipcMain.handle('agents:deleteAgent', (_e, id: string) => {
  const s = readAgentsStore()
  s.customAgents = s.customAgents.filter(a => a.id !== id)
  writeJson(AGENTS_FILE, s)
  return true
})

ipcMain.handle('agents:saveConversation', (_e, convo: any) => {
  if (!convo?.id) return false
  const s = readAgentsStore()
  const i = s.conversations.findIndex(c => c.id === convo.id)
  if (i >= 0) s.conversations[i] = convo
  else s.conversations.unshift(convo)
  // Newest first, capped so the archive can't grow unbounded
  s.conversations.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  s.conversations = s.conversations.slice(0, 100)
  writeJson(AGENTS_FILE, s)
  return true
})

ipcMain.handle('agents:deleteConversation', (_e, id: string) => {
  const s = readAgentsStore()
  s.conversations = s.conversations.filter(c => c.id !== id)
  writeJson(AGENTS_FILE, s)
  return true
})

// ── Agent file-system access ───────────────────────────────────────────────
// Agents may read/write files ONLY inside the user's home folder. Every path
// is resolved and containment-checked with path.relative so "..", absolute
// paths outside home, and drive changes are all rejected.
function resolveAgentPath(p: string): { path: string } | { error: string } {
  if (!p || typeof p !== 'string') return { error: 'path is required' }
  let raw = p.trim().replace(/^["']|["']$/g, '')
  if (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) raw = join(os.homedir(), raw.slice(1))
  const resolved = pathResolve(raw)
  const rel = pathRelative(pathResolve(os.homedir()), resolved)
  if (rel.startsWith('..') || pathIsAbsolute(rel)) {
    return { error: 'access denied — agents can only access files inside your user folder' }
  }
  return { path: resolved }
}

// Minimal ZIP entry extraction (stored + deflate) — enough to pull
// word/document.xml out of a .docx without adding a zip dependency.
function extractZipEntry(buf: Buffer, wantedName: string): Buffer | null {
  let eocd = -1
  const stop = Math.max(0, buf.length - 22 - 65535)
  for (let i = buf.length - 22; i >= stop; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd === -1) return null
  const count = buf.readUInt16LE(eocd + 10)
  let ptr = buf.readUInt32LE(eocd + 16)
  for (let n = 0; n < count; n++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== 0x02014b50) return null
    const method     = buf.readUInt16LE(ptr + 10)
    const compSize   = buf.readUInt32LE(ptr + 20)
    const nameLen    = buf.readUInt16LE(ptr + 28)
    const extraLen   = buf.readUInt16LE(ptr + 30)
    const commentLen = buf.readUInt16LE(ptr + 32)
    const localOff   = buf.readUInt32LE(ptr + 42)
    const name = buf.toString('utf-8', ptr + 46, ptr + 46 + nameLen)
    if (name === wantedName) {
      const lNameLen  = buf.readUInt16LE(localOff + 26)
      const lExtraLen = buf.readUInt16LE(localOff + 28)
      const dataStart = localOff + 30 + lNameLen + lExtraLen
      const data = buf.subarray(dataStart, dataStart + compSize)
      if (method === 0) return Buffer.from(data)
      if (method === 8) { try { return zlib.inflateRawSync(data) } catch { return null } }
      return null
    }
    ptr += 46 + nameLen + extraLen + commentLen
  }
  return null
}

function docxToText(buf: Buffer): string | null {
  const xml = extractZipEntry(buf, 'word/document.xml')
  if (!xml) return null
  return xml.toString('utf-8')
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

ipcMain.handle('agentfs:listDir', (_e, p: string) => {
  const r = resolveAgentPath(p)
  if ('error' in r) return r
  try {
    const stat = fs.statSync(r.path)
    if (!stat.isDirectory()) return { error: 'not a folder — use read_file for files' }
    const entries = fs.readdirSync(r.path, { withFileTypes: true }).slice(0, 200).map(d => {
      let size = 0, modified = 0
      try { const s = fs.statSync(join(r.path, d.name)); size = s.size; modified = s.mtimeMs } catch {}
      return { name: d.name, dir: d.isDirectory(), size, modified }
    })
    return { path: r.path, entries }
  } catch (e: any) {
    return { error: e?.code === 'ENOENT' ? 'folder not found' : (e?.message || String(e)) }
  }
})

ipcMain.handle('agentfs:readFile', (_e, p: string) => {
  const r = resolveAgentPath(p)
  if ('error' in r) return r
  try {
    const stat = fs.statSync(r.path)
    if (stat.isDirectory()) return { error: 'that is a folder — use list_dir' }
    if (stat.size > 10 * 1024 * 1024) return { error: 'file too large (over 10 MB)' }
    const ext = extname(r.path).toLowerCase()
    if (ext === '.docx') {
      const text = docxToText(fs.readFileSync(r.path))
      if (!text) return { error: 'could not extract text from this .docx file' }
      return { path: r.path, text: text.slice(0, 60000) }
    }
    if (ext === '.pdf' || ext === '.doc') {
      return { error: `cannot read ${ext} directly — ask the user for a .docx, .txt or .md version of the document` }
    }
    const buf = fs.readFileSync(r.path)
    // Reject binary content: a real text file has no NUL bytes
    const probe = buf.subarray(0, 4096)
    if (probe.includes(0)) return { error: 'this looks like a binary file, not text' }
    return { path: r.path, text: buf.toString('utf-8').slice(0, 60000) }
  } catch (e: any) {
    return { error: e?.code === 'ENOENT' ? 'file not found' : (e?.message || String(e)) }
  }
})

ipcMain.handle('agentfs:writeFile', (_e, p: string, content: string, overwrite?: boolean) => {
  const r = resolveAgentPath(p)
  if ('error' in r) return r
  if (typeof content !== 'string') return { error: 'content is required' }
  try {
    if (fs.existsSync(r.path) && !overwrite) {
      return { error: 'file already exists — pass overwrite:true to replace it' }
    }
    fs.mkdirSync(dirname(r.path), { recursive: true })
    fs.writeFileSync(r.path, content, 'utf-8')
    return { ok: true, path: r.path }
  } catch (e: any) {
    return { error: e?.message || String(e) }
  }
})

// ── IPC: Agent project directory picker ────────────────────────────────────
// Lets the user point the agent at a target folder for codebase generation.
// Native dialog = the choice is always the user's, never the model's.
ipcMain.handle('agentfs:pickDirectory', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() ?? mainWindow, {
    title: 'Choose a folder for the agent to work in',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: os.homedir(),
  })
  if (canceled || !filePaths?.[0]) return { canceled: true }
  const r = resolveAgentPath(filePaths[0])
  if ('error' in r) return r
  return { path: r.path }
})

// ── IPC: Agent command execution ───────────────────────────────────────────
// Runs a shell command in an agent-writable directory so the agent can
// install deps / build / test the code it generated. The renderer shows an
// Approve/Run card for every command BEFORE invoking this — this handler is
// only ever reached after explicit user approval in the chat panel. Guards
// here: cwd confined to the user folder, hard timeout, output caps.
const EXEC_OUTPUT_CAP = 120_000  // chars kept per stream
ipcMain.handle('agentfs:exec', async (_e, { command, cwd, timeoutMs }: { command: string; cwd: string; timeoutMs?: number }) => {
  if (!command || typeof command !== 'string') return { error: 'command is required' }
  if (command.length > 2000) return { error: 'command too long' }
  const r = resolveAgentPath(cwd || '~')
  if ('error' in r) return r
  try {
    const stat = fs.statSync(r.path)
    if (!stat.isDirectory()) return { error: 'cwd must be a folder' }
  } catch { return { error: 'cwd folder not found' } }

  const timeout = Math.min(Math.max(timeoutMs || 120_000, 5_000), 300_000)
  return await new Promise(resolve => {
    let stdout = '', stderr = '', done = false
    const child = spawn(command, {
      cwd: r.path, shell: true, windowsHide: true,
      env: { ...process.env, CI: '1' },  // CI=1 keeps most tools non-interactive
    })
    const finish = (result: any) => { if (!done) { done = true; resolve(result) } }
    const killer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
      finish({ error: `command timed out after ${Math.round(timeout / 1000)}s`, stdout: stdout.slice(-EXEC_OUTPUT_CAP), stderr: stderr.slice(-EXEC_OUTPUT_CAP) })
    }, timeout)
    child.stdout?.on('data', d => { if (stdout.length < EXEC_OUTPUT_CAP * 2) stdout += String(d) })
    child.stderr?.on('data', d => { if (stderr.length < EXEC_OUTPUT_CAP * 2) stderr += String(d) })
    child.on('error', e => { clearTimeout(killer); finish({ error: e.message }) })
    child.on('close', code => {
      clearTimeout(killer)
      finish({
        exitCode: code ?? -1,
        stdout: stdout.slice(-EXEC_OUTPUT_CAP),
        stderr: stderr.slice(-EXEC_OUTPUT_CAP),
      })
    })
  })
})

// ── IPC: App info — lets the AI assistant know exactly what it's running in ─
ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
}))

// ── IPC: Save any text file the agent produced (resume, code, csv…) ───────
function sanitizeFilename(name: string, fallback: string): string {
  const clean = (name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 80)
  return clean || fallback
}

ipcMain.handle('file:saveText', async (_e, { filename, content }: { filename: string; content: string }) => {
  const safe = sanitizeFilename(filename, 'agent-output.txt')
  const ext = extname(safe).replace('.', '') || 'txt'
  const { filePath, canceled } = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow() ?? mainWindow, {
    title: 'Save File',
    defaultPath: join(os.homedir(), 'Downloads', safe),
    filters: [{ name: ext.toUpperCase() + ' File', extensions: [ext] }, { name: 'All Files', extensions: ['*'] }],
  })
  if (canceled || !filePath) return { success: false, canceled: true }
  try {
    fs.writeFileSync(filePath, content ?? '', 'utf-8')
    return { success: true, filePath }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

// ── IPC: Bundle generated files into a downloadable ZIP ────────────────────
// Hand-rolled ZIP writer (deflate via zlib + CRC-32) — no dependency needed.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

function buildZip(files: { path: string; content: string }[]): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const entryName = (f.path || 'file.txt').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.\.(\/|$)/g, '')
    const nameBuf = Buffer.from(entryName, 'utf-8')
    const data = Buffer.from(f.content ?? '', 'utf-8')
    const deflated = zlib.deflateRawSync(data)
    const useDeflate = deflated.length < data.length
    const payload = useDeflate ? deflated : data
    const method = useDeflate ? 8 : 0
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)          // version needed to extract
    local.writeUInt16LE(0x0800, 6)      // flags: UTF-8 filenames
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    chunks.push(local, nameBuf, payload)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(method, 10)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(payload.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([cd, nameBuf]))
    offset += 30 + nameBuf.length + payload.length
  }
  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, cdBuf, eocd])
}

ipcMain.handle('file:saveZip', async (_e, { filename, files }: { filename?: string; files: { path: string; content: string }[] }) => {
  if (!Array.isArray(files) || files.length === 0) return { success: false, error: 'no files to zip' }
  let safe = sanitizeFilename(filename || '', 'agent-files.zip')
  if (!safe.toLowerCase().endsWith('.zip')) safe += '.zip'
  const { filePath, canceled } = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow() ?? mainWindow, {
    title: 'Save ZIP Archive',
    defaultPath: join(os.homedir(), 'Downloads', safe),
    filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
  })
  if (canceled || !filePath) return { success: false, canceled: true }
  try {
    fs.writeFileSync(filePath, buildZip(files.slice(0, 200)))
    return { success: true, filePath, fileCount: files.length }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

// ── IPC: Media source id for tab/window recording ─────────────────────────
// getMediaSourceId() (no-arg BrowserWindow method) hands back an id usable
// directly as chromeMediaSourceId in a renderer-side getUserMedia call,
// scoped to this app's own window — no desktopCapturer.getSources() call or
// OS screen-picker permission dance needed for capturing our own window.
ipcMain.handle('recorder:getSourceId', (e) => {
  try { return (winFrom(e) ?? mainWindow).getMediaSourceId() } catch { return null }
})

// ── IPC: Live AI news from Hacker News ────────────────────────────────────
const AI_NEWS_KEYWORDS = [
  'ai ', ' ai', 'llm', 'gpt', 'claude', 'gemini', 'openai', 'anthropic',
  'deepseek', 'language model', 'neural', 'chatgpt', 'artificial intelligence',
  'machine learning', 'mistral', 'llama', 'groq', 'hugging face', 'diffusion',
  'transformer', 'copilot', 'stable diffusion', 'midjourney', 'sora',
]

// ── IPC: AI research tools (web search + page fetch) ───────────────────────
// HTTP GET with a real browser UA, following up to `hops` redirects — many
// sites 301 to www/https variants and DDG needs a UA to answer at all.
function fetchHtml(url: string, timeoutMs = 12000, hops = 4): Promise<{ status: number; body: string; finalUrl: string }> {
  return new Promise((resolve, reject) => {
    if (hops < 0) { reject(new Error('too many redirects')); return }
    const lib = url.startsWith('https') ? https : http
    const req = lib.get(url, {
      timeout: timeoutMs,
      headers: { 'User-Agent': CHROME_UA, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en' },
      lookup: fallbackLookup,
    }, (res) => {
      const loc = res.headers.location
      if (loc && res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
        res.resume()
        try { resolve(fetchHtml(new URL(loc, url).href, timeoutMs, hops - 1)) }
        catch (e) { reject(e) }
        return
      }
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, finalUrl: url }))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*/g, '\n\n').trim()
}

ipcMain.handle('ai:webSearch', async (_e, query: string) => {
  try {
    const q = String(query || '').trim()
    if (!q) return { success: false, error: 'query is required' }
    const { body } = await fetchHtml(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, 12000)
    const results: { title: string; url: string; snippet: string }[] = []
    // DDG's html endpoint groups each hit in a result block; links are
    // redirect-wrapped (uddg= param carries the real destination).
    const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
    const snips: string[] = []
    const snipRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
    let sm: RegExpExecArray | null
    while ((sm = snipRe.exec(body)) !== null) snips.push(htmlToText(sm[1]))
    let m: RegExpExecArray | null
    let snipIdx = 0
    while ((m = linkRe.exec(body)) !== null && results.length < 8) {
      let url = m[1]
      try {
        const parsed = new URL(url.startsWith('//') ? 'https:' + url : url)
        const real = parsed.searchParams.get('uddg')
        if (real) url = real
      } catch {}
      // Skip sponsored/ad rows — DDG wraps those through y.js / bing aclick
      // redirects, which aren't real organic results.
      if (/duckduckgo\.com\/y\.js|bing\.com\/aclick|ad_provider=|ad_domain=/i.test(url)) { snipIdx++; continue }
      if (!/^https?:\/\//i.test(url)) { snipIdx++; continue }
      results.push({ title: htmlToText(m[2]), url, snippet: snips[snipIdx] || '' })
      snipIdx++
    }
    if (!results.length) return { success: false, error: 'no results — try different keywords' }
    return { success: true, query: q, results }
  } catch (e: any) { return { success: false, error: e.message } }
})

ipcMain.handle('ai:fetchPage', async (_e, url: string) => {
  try {
    if (!/^https?:\/\//i.test(String(url || ''))) return { success: false, error: 'a full http(s) url is required' }
    const { status, body, finalUrl } = await fetchHtml(url, 12000)
    if (status >= 400) return { success: false, error: `HTTP ${status}` }
    const titleM = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    return {
      success: true, url: finalUrl,
      title: titleM ? htmlToText(titleM[1]) : '',
      text: htmlToText(body).slice(0, 14000),
    }
  } catch (e: any) { return { success: false, error: e.message } }
})

ipcMain.handle('ai:getLatestNews', async () => {
  try {
    const { status: s1, body: b1 } = await httpGet('https://hacker-news.firebaseio.com/v0/topstories.json', 8000)
    if (s1 !== 200) return { success: false, articles: [] }
    const ids: number[] = JSON.parse(b1).slice(0, 60)

    const settled = await Promise.allSettled(
      ids.map(id => httpGet(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, 5000))
    )

    const articles: any[] = []
    for (const r of settled) {
      if (r.status !== 'fulfilled' || r.value.status !== 200) continue
      try {
        const item = JSON.parse(r.value.body)
        if (!item || item.type !== 'story' || !item.title) continue
        const low = item.title.toLowerCase()
        if (AI_NEWS_KEYWORDS.some(k => low.includes(k))) {
          articles.push({
            title: item.title,
            url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
            score: item.score || 0,
            by: item.by,
            hnUrl: `https://news.ycombinator.com/item?id=${item.id}`,
          })
        }
      } catch {}
    }

    articles.sort((a, b) => b.score - a.score)
    return { success: true, articles: articles.slice(0, 8) }
  } catch (e: any) {
    return { success: false, articles: [], error: String(e.message) }
  }
})

// ── IPC: Bookmark export ───────────────────────────────────────────────────
ipcMain.handle('bookmarks:export', async (_e, format: 'json' | 'html') => {
  const { filePath, canceled } = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow() ?? mainWindow, {
    title: 'Export Bookmarks',
    defaultPath: `aihub-bookmarks.${format}`,
    filters: format === 'json'
      ? [{ name: 'JSON', extensions: ['json'] }]
      : [{ name: 'HTML', extensions: ['html'] }],
  })
  if (canceled || !filePath) return { success: false }

  const bms = getData().bookmarks
  try {
    if (format === 'json') {
      fs.writeFileSync(filePath, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), bookmarks: bms }, null, 2), 'utf-8')
    } else {
      const rows = bms.map((b: any) =>
        `    <DT><A HREF="${escHtml(b.url)}" ADD_DATE="${Math.floor((b.addedAt || Date.now()) / 1000)}" TAGS="${escHtml(b.category || '')}">${escHtml(b.title)}</A>`
      ).join('\n')
      const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<!-- AIHub Browser Bookmarks -->\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>AIHub Bookmarks</TITLE>\n<H1>AIHub Bookmarks</H1>\n<DL><p>\n${rows}\n</DL><p>`
      fs.writeFileSync(filePath, html, 'utf-8')
    }
    return { success: true, count: bms.length, path: filePath }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

// ── IPC: Bookmark import ───────────────────────────────────────────────────
ipcMain.handle('bookmarks:import', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() ?? mainWindow, {
    title: 'Import Bookmarks',
    filters: [{ name: 'Bookmark Files', extensions: ['json', 'html', 'htm'] }],
    properties: ['openFile'],
  })
  if (canceled || !filePaths.length) return { success: false }

  try {
    const raw = fs.readFileSync(filePaths[0], 'utf-8')
    const ext = filePaths[0].split('.').pop()?.toLowerCase()
    let imported: any[] = []

    if (ext === 'json') {
      const parsed = JSON.parse(raw)
      // Support both { bookmarks: [] } and plain []
      const list = Array.isArray(parsed) ? parsed : (parsed.bookmarks || [])
      imported = list.filter((b: any) => b.url && b.title).map((b: any) => ({
        url: b.url, title: b.title, category: b.category || 'Tools',
        color: b.color || '#60a5fa', favicon: b.favicon || '',
      }))
    } else {
      // Parse Netscape HTML bookmark format (Chrome, Firefox, Edge exports)
      const matches = [...raw.matchAll(/<A\s[^>]*HREF="([^"]+)"[^>]*>([^<]+)<\/A>/gi)]
      imported = matches.map(m => ({ url: m[1], title: m[2].trim(), category: 'Tools', color: '#60a5fa', favicon: '' }))
        .filter(b => b.url.startsWith('http'))
    }

    if (!imported.length) return { success: false, error: 'No valid bookmarks found in file' }

    const d = getData()
    const existingUrls = new Set(d.bookmarks.map((b: any) => b.url))
    const fresh = imported.filter(b => !existingUrls.has(b.url))
    fresh.forEach(b => d.bookmarks.push({ ...b, id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, addedAt: Date.now() }))
    saveData()
    return { success: true, imported: fresh.length, skipped: imported.length - fresh.length }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

// ── IPC: Capture webview screenshot ──────────────────────────────────────
ipcMain.handle('webview:capture', async (_e, wcId: number) => {
  try {
    const wc = electronWebContents.fromId(wcId)
    if (!wc) return null
    const img = await wc.capturePage()
    return img.toDataURL()
  } catch { return null }
})

// ── IPC: Execute script inside webview via webContents ────────────────────
ipcMain.handle('webview:execScript', async (_e, wcId: number, script: string) => {
  try {
    const wc = electronWebContents.fromId(wcId)
    if (!wc) return { ok: false, error: 'webContents not found for id ' + wcId }
    const result = await wc.executeJavaScript(script, true)
    return { ok: true, result }
  } catch (e: any) { return { ok: false, error: e?.message || String(e) } }
})

function escHtml(s: string) { return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
