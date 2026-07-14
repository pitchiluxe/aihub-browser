import { app, BrowserWindow, BrowserView, ipcMain, shell, nativeTheme, session, Menu, MenuItem, clipboard, dialog, webContents as electronWebContents } from 'electron'
import { join, resolve as pathResolve, relative as pathRelative, isAbsolute as pathIsAbsolute, dirname, extname } from 'path'
import zlib from 'zlib'
import http from 'http'
import https from 'https'
import dns from 'dns'
import os from 'os'
import fs from 'fs'
import { execSync, execFileSync } from 'child_process'
import { recordVisit, generateRecommendations, saveRecommendations, getStoredRecommendations, buildProfile } from './ai-brain'
import { registerGmailIpc } from './gmail/ipc'

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
  { id: 'bm-3',  url: 'https://quickbooks-playground.vercel.app/login', title: 'QuickBooks',       favicon: '', category: 'Finance',       addedAt: 0, color: '#4ade80' },
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
    // First run follows the OS appearance — users who run Windows in light
    // mode get the light theme by default; either can be changed in Settings.
    theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
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
async function checkOllamaRunning(): Promise<{ running: boolean; models: string[] }> {
  const { olBase } = getAIConfig()
  // Try both the configured base AND a 127.0.0.1 fallback to handle systems
  // where 'localhost' resolves differently in packaged Electron.
  const bases = [olBase, 'http://127.0.0.1:11434']
  const uniqueBases = [...new Set(bases)]

  for (const base of uniqueBases) {
    for (const path of ['/api/tags', '/api/version']) {
      try {
        const { status, body } = await httpGet(`${base}${path}`, 4000)
        if (status >= 200 && status < 400) {
          try {
            const json = JSON.parse(body)
            const models = (json.models || []).map((m: any) => (typeof m === 'string' ? m : m.name || 'unknown')).filter(Boolean)
            return { running: true, models: models.length ? models : ['llama3'] }
          } catch {
            return { running: true, models: ['llama3'] }
          }
        }
      } catch { /* try next */ }
    }
  }
  return { running: false, models: [] }
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

// ── Window ─────────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow

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
// Client-Hint brands matching the UA, including the "Google Chrome" brand
// Chromium's default omits. Google cross-checks Sec-CH-UA against the UA.
const CHROME_SEC_CH_UA =
  `"Not)A;Brand";v="8", "Chromium";v="${CHROME_MAJOR}", "Google Chrome";v="${CHROME_MAJOR}"`
const CHROME_SEC_CH_UA_FULL_VERSION_LIST =
  `"Not)A;Brand";v="8.0.0.0", "Chromium";v="${CHROME_FULL_VERSION}", "Google Chrome";v="${CHROME_FULL_VERSION}"`

// X-Client-Data: a Google-proprietary header that ONLY real Chrome/Chromium
// (built with Google's variations service) sends, and ONLY to Google-owned
// domains. Electron omits it entirely — and its absence on a request that
// otherwise claims to be Chrome is a cheap, reliable "embedded browser" tell
// that Google's sign-in uses to bounce the flow to /v3/signin/rejected right
// after email entry (confirmed 2026-07-04: identity was otherwise flawless —
// UA, brands, high-entropy hints, webdriver:false — yet still rejected, and the
// only missing header vs. real Chrome was this one).
//
// The value is a base64 ClientVariations protobuf (schema: repeated int32
// variation_id = 1; repeated int32 trigger_variation_id = 3). We ship a small
// set of real, currently-active variation IDs so it decodes cleanly server-side
// rather than looking like forged garbage. Google tolerates stale/partial seeds
// (every Chrome install sends a different subset), so an exact match isn't
// required — only that it's a valid, plausible protobuf.
function buildXClientData(): string {
  const varIds = [3300118, 3300130, 3313321, 3324960, 3330198, 3362821]
  const trigIds = [3313321, 3324960]
  const bytes: number[] = []
  const putVarint = (n: number) => { while (n > 0x7f) { bytes.push((n & 0x7f) | 0x80); n >>>= 7 } bytes.push(n) }
  for (const id of varIds)  { bytes.push(0x08); putVarint(id) } // field 1, wire type 0 (varint)
  for (const id of trigIds) { bytes.push(0x18); putVarint(id) } // field 3, wire type 0 (varint)
  return Buffer.from(bytes).toString('base64')
}
const X_CLIENT_DATA = buildXClientData()
// Google sends X-Client-Data only to these eTLD+1s; scope it the same way so we
// never leak the header to non-Google origins (that itself would be anomalous).
const GOOGLE_XCD_HOSTS = /(^|\.)(google\.com|google\.[a-z.]+|youtube\.com|gstatic\.com|googleapis\.com|googleusercontent\.com|ggpht\.com|doubleclick\.net)$/i

// The header rewrite fixes network requests, but Google's sign-in ALSO reads
// navigator.userAgentData in page JS — plain setUserAgent leaves that reporting
// bare "Chromium" (no "Google Chrome" brand), which trips the identifier-page
// block. Confirmed load-bearing 2026-07-03: removing this regressed the app
// from reaching the passkey step back to blocking right after email entry.
// Only CDP's Emulation.setUserAgentOverride sets userAgentData consistently.
const CHROME_UA_METADATA = {
  brands: [
    { brand: 'Not)A;Brand', version: '8' },
    { brand: 'Chromium', version: CHROME_MAJOR },
    { brand: 'Google Chrome', version: CHROME_MAJOR },
  ],
  fullVersionList: [
    { brand: 'Not)A;Brand', version: '8.0.0.0' },
    { brand: 'Chromium', version: CHROME_FULL_VERSION },
    { brand: 'Google Chrome', version: CHROME_FULL_VERSION },
  ],
  fullVersion: CHROME_FULL_VERSION,
  platform: 'Windows',
  platformVersion: '15.0.0',
  architecture: 'x86',
  model: '',
  mobile: false,
  bitness: '64',
  wow64: false,
}

// Push userAgentData via CDP and KEEP the debugger attached for the life of
// the webContents. Detaching clears the override: verified 2026-07-04 with a
// standalone Electron 28 test — after detach() the very next navigation
// reverted to the default Electron UA and empty userAgentData. (The old
// detach-immediately version only appeared to work because the first
// navigation raced ahead of the async detach; every LATER page — Google's
// password/challenge steps — saw the bare "Chromium" brand and got blocked.)
function applyBrowserIdentity(wc: Electron.WebContents) {
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
    wc.debugger.sendCommand('Emulation.setUserAgentOverride', {
      userAgent: CHROME_UA,
      // No explicit q-values — Chromium appends them itself; passing
      // "en;q=0.9" here produced the malformed "en;q=0.9;q=0.9" on the wire.
      acceptLanguage: 'en-US,en',
      platform: 'Windows',
      userAgentMetadata: CHROME_UA_METADATA,
    }).catch(() => {})
  } catch {}
}

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
function safelySend(channel: string, ...args: any[]) {
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args)
    }
  } catch {}
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
  const ctrl = input.control || input.meta
  if (!ctrl || input.alt) return null
  const key = input.key.toLowerCase()
  if (key === 't' && !input.shift) return 'new-tab'
  if (key === 'w' && !input.shift) return 'close-tab'
  if (key === 'tab') return input.shift ? 'prev-tab' : 'next-tab'
  if (key === 'l' && !input.shift) return 'focus-url'
  if (key === 'r' && !input.shift) return 'reload-tab'
  return null
}

function attachAppShortcuts(wc: Electron.WebContents) {
  wc.on('before-input-event', (e, input) => {
    const action = matchAppShortcut(input)
    if (!action) return
    e.preventDefault()
    // Focusing the URL bar needs keyboard focus back on the host UI first —
    // otherwise the input focuses but keys keep going to the BrowserView.
    if (action === 'focus-url') mainWindow?.webContents.focus()
    safelySend('app-shortcut', action)
  })
}

function attachContextMenu(wc: Electron.WebContents) {
  wc.on('context-menu', (_e, params) => {
    const menu = new Menu()
    if (params.editFlags.canUndo) menu.append(new MenuItem({ label: 'Undo', role: 'undo', accelerator: 'Ctrl+Z' }))
    if (params.editFlags.canRedo) menu.append(new MenuItem({ label: 'Redo', role: 'redo', accelerator: 'Ctrl+Y' }))
    if (params.editFlags.canUndo || params.editFlags.canRedo) menu.append(new MenuItem({ type: 'separator' }))
    if (params.editFlags.canCut)  menu.append(new MenuItem({ label: 'Cut',  role: 'cut',  accelerator: 'Ctrl+X' }))
    if (params.editFlags.canCopy || params.selectionText) menu.append(new MenuItem({ label: 'Copy', role: 'copy', accelerator: 'Ctrl+C' }))
    if (params.editFlags.canPaste) menu.append(new MenuItem({ label: 'Paste', role: 'paste', accelerator: 'Ctrl+V' }))
    if (params.editFlags.canSelectAll) {
      menu.append(new MenuItem({ type: 'separator' }))
      menu.append(new MenuItem({ label: 'Select All', role: 'selectAll', accelerator: 'Ctrl+A' }))
    }
    if (params.linkURL) {
      menu.append(new MenuItem({ type: 'separator' }))
      menu.append(new MenuItem({ label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) }))
      menu.append(new MenuItem({ label: 'Open in New Tab', click: () => safelySend('open-in-new-tab', params.linkURL) }))
    }
    if (menu.items.length > 0) menu.popup({ window: mainWindow })
  })
}

// ── Tab content views (BrowserView) ────────────────────────────────────────
// Electron 28 predates WebContentsView (needs v30+). BrowserView gives the
// identical fix for the <webview> guest-viewport desync bug: the main process
// owns sizing directly via setBounds(), so there's no GuestViewContainer
// ResizeObserver/FrameMsg_Resize round-trip for window.innerHeight to lose sync with.
const tabViews = new Map<string, BrowserView>()
let activeTabViewId: string | null = null
let tabViewBounds = { x: 0, y: 0, width: 0, height: 0 }
let tabViewOverlayHidden = false // true while a host HTML overlay (modal) must render above tab content

function sendTabEvent(tabId: string, type: string, payload?: any) {
  safelySend('tabview:event', tabId, type, payload)
}

// BrowserView always paints above mainWindow's own webContents — there is no
// z-index control from the renderer side. Overlays that must appear above tab
// content (e.g. AddBookmarkModal) call tabview:setOverlayHidden(true) to detach
// the view instead.
function syncActiveBrowserView() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const view = (!tabViewOverlayHidden && activeTabViewId) ? tabViews.get(activeTabViewId) : undefined
  const current = mainWindow.getBrowserView()
  if (view) {
    if (current !== view) mainWindow.setBrowserView(view)
    view.setBounds({
      x: Math.round(tabViewBounds.x), y: Math.round(tabViewBounds.y),
      width: Math.max(0, Math.round(tabViewBounds.width)), height: Math.max(0, Math.round(tabViewBounds.height)),
    })
  } else if (current) {
    mainWindow.setBrowserView(null)
  }
}

function createTabView(tabId: string, url: string) {
  if (tabViews.has(tabId)) return
  const view = new BrowserView({
    webPreferences: {
      partition: 'persist:main',
      contextIsolation: true,
      // Keep web security ON for tab content — this is the page real sites
      // (incl. Google sign-in) run in. Disabling it is detectable and makes
      // Google refuse with "this browser or app may not be secure". The old
      // <webview> guests ran with security on, which is why login worked then.
      webSecurity: true,
      nodeIntegration: false,
    },
  })
  tabViews.set(tabId, view)
  const wc = view.webContents
  // Belt-and-suspenders: force the clean Chrome UA on this view before it
  // loads anything, so no request ever goes out with the Electron default.
  try { wc.setUserAgent(CHROME_UA) } catch {}
  // Push the full browser identity (incl. navigator.userAgentData) via CDP so
  // Google's client-side "secure browser" check passes. DevTools opening on
  // this view detaches the debugger, so re-apply once it closes.
  applyBrowserIdentity(wc)
  wc.on('devtools-closed', () => applyBrowserIdentity(wc))

  attachContextMenu(wc)
  attachAppShortcuts(wc)
  sendTabEvent(tabId, 'wc-id', { wcId: wc.id })

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
      safelySend('open-in-new-tab', targetUrl)
    }
    return { action: 'deny' }
  })

  // Popups need the same browser identity as tabs, or Google blocks them.
  wc.on('did-create-window', (childWin) => {
    const cwc = childWin.webContents
    try { cwc.setUserAgent(CHROME_UA) } catch {}
    applyBrowserIdentity(cwc)
    attachContextMenu(cwc)
    // Links clicked inside a popup go to a main-window tab; nested scripted
    // popups (rare, but some IdPs chain them) stay real windows.
    cwc.setWindowOpenHandler(({ url: popupUrl, disposition }) => {
      if (disposition === 'new-window') {
        return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } }
      }
      if (popupUrl && !popupUrl.startsWith('devtools://') && !popupUrl.startsWith('chrome-extension://')) {
        safelySend('open-in-new-tab', popupUrl)
      }
      return { action: 'deny' }
    })
  })

  wc.on('did-navigate', (_e, navUrl) => sendTabEvent(tabId, 'did-navigate', { url: navUrl }))
  wc.on('did-navigate-in-page', (_e, navUrl) => sendTabEvent(tabId, 'did-navigate-in-page', { url: navUrl }))
  wc.on('did-start-loading', () => sendTabEvent(tabId, 'did-start-loading'))
  wc.on('did-stop-loading', () => {
    let title = ''; let curUrl = ''
    try { title = wc.getTitle() } catch {}
    try { curUrl = wc.getURL() } catch {}
    sendTabEvent(tabId, 'did-stop-loading', { title, url: curUrl })
  })
  wc.on('did-fail-load', (_e, errorCode) => { if (errorCode !== -3) sendTabEvent(tabId, 'did-fail-load', { errorCode }) })
  wc.on('page-title-updated', (_e, title) => sendTabEvent(tabId, 'page-title-updated', { title }))
  wc.on('page-favicon-updated', (_e, favicons) => sendTabEvent(tabId, 'page-favicon-updated', { favicons }))

  // Hide the page's native scrollbar track — re-inserted on every document
  // since insertCSS doesn't survive navigation.
  wc.on('dom-ready', () => {
    wc.insertCSS('::-webkit-scrollbar{width:0!important;height:0!important;background:transparent!important}').catch(() => {})
  })

  wc.loadURL(url)
}

function destroyTabView(tabId: string) {
  const view = tabViews.get(tabId)
  if (!view) return
  if (activeTabViewId === tabId) { activeTabViewId = null; syncActiveBrowserView() }
  try { mainWindow?.removeBrowserView(view) } catch {}
  try { view.webContents.close() } catch {}
  tabViews.delete(tabId)
}

function createWindow(): void {
  nativeTheme.themeSource = 'dark'
  const settings = getData().settings
  const glassMode = settings.transparency !== 'none'

  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    show: false, frame: false, titleBarStyle: 'hidden',
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

  mainWindow.on('closed', () => {
    tabViews.forEach(v => { try { v.webContents.close() } catch {} })
    tabViews.clear()
    activeTabViewId = null
  })

  applyTransparency(mainWindow, settings.transparency)
  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    applyWindowOpacity(mainWindow, settings.windowOpacity ?? 1)
    safelySend('theme:transparency', settings.transparency)
  })

  // F12 / Ctrl+Shift+I toggles DevTools in dev mode
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (!isDev) return
    if (input.type !== 'keyDown') return
    const devKey = input.key === 'F12' || (input.control && input.shift && input.key === 'I')
    if (devKey) {
      if (mainWindow.webContents.isDevToolsOpened()) mainWindow.webContents.closeDevTools()
      else mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  })

  // Configure the persist:main session used by all <webview partition="persist:main"> tags.
  const webviewSession = session.fromPartition('persist:main')

  // Spoof Chrome UA so sites serve full content (many degrade or block Electron's default UA).
  webviewSession.setUserAgent(CHROME_UA)

  // Force Client-Hint headers to match the spoofed UA. Rewriting existing
  // headers isn't enough: Electron 28 doesn't emit Sec-CH-UA at all (verified
  // on the wire 2026-07-04 via httpbingo.org/headers), while every real Chrome
  // sends the low-entropy hints on ALL HTTPS requests — their absence is
  // exactly the kind of mismatch Google's "secure browser" check keys on.
  webviewSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders
    if (details.url.startsWith('https://')) {
      for (const key of Object.keys(headers)) {
        const k = key.toLowerCase()
        if (k.startsWith('sec-ch-ua')) delete headers[key]
        else if (k === 'x-client-data') delete headers[key]
      }
      headers['sec-ch-ua'] = CHROME_SEC_CH_UA
      headers['sec-ch-ua-mobile'] = '?0'
      headers['sec-ch-ua-platform'] = '"Windows"'
      // Add X-Client-Data only for Google-owned hosts, matching real Chrome.
      try {
        const host = new URL(details.url).hostname
        if (GOOGLE_XCD_HOSTS.test(host)) headers['X-Client-Data'] = X_CLIENT_DATA
      } catch {}
    }
    callback({ requestHeaders: headers })
  })

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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url && !url.startsWith('devtools://') && !url.startsWith('chrome-extension://')) {
      safelySend('open-in-new-tab', url)
    }
    return { action: 'deny' }
  })

  // ── Right-click context menu (copy / paste / cut / select-all) ──────────
  attachContextMenu(mainWindow.webContents)
  attachAppShortcuts(mainWindow.webContents)

  // ── Download tracking — covers mainWindow + all webviews ──────────────
  const handleDownload = (_e: any, item: any) => {
    const dls = readJson(DL_FILE, [])
    const dl: any = {
      id: `dl-${Date.now()}`, filename: item.getFilename(), url: item.getURL(),
      savePath: '', totalBytes: item.getTotalBytes(), receivedBytes: 0,
      state: 'progressing', startedAt: Date.now(), completedAt: null,
    }
    const persist = () => {
      const i = dls.findIndex((x: any) => x.id === dl.id)
      if (i !== -1) dls[i] = { ...dl }; else dls.unshift({ ...dl })
      writeJson(DL_FILE, dls.slice(0, 500))
      safelySend('download:update', dl)
    }
    item.on('updated', (_ev, state) => { dl.receivedBytes = item.getReceivedBytes(); dl.state = state; persist() })
    item.on('done', (_ev, state) => {
      dl.state = state; dl.savePath = item.getSavePath()
      dl.completedAt = Date.now(); dl.receivedBytes = item.getReceivedBytes()
      persist()
    })
    dls.unshift({ ...dl }); writeJson(DL_FILE, dls.slice(0, 500))
    safelySend('download:update', dl)
  }

  // Attach to default session (covers webviews) + mainWindow session
  session.defaultSession.on('will-download', handleDownload)
  if (mainWindow.webContents.session !== session.defaultSession) {
    mainWindow.webContents.session.on('will-download', handleDownload)
  }

  app.on('web-contents-created', (_e, wc) => {
    wc.session.on('will-download', handleDownload)
    let wcType: string | undefined
    try { wcType = wc.getType() } catch {}
    if (wcType !== 'webview' && wcType !== 'browserView') return

    process.nextTick(() => { try { wc.setUserAgent(CHROME_UA) } catch {} })
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))

  // Flush a URL we were launched with (cold start as default browser) once the
  // renderer has actually mounted its 'open-in-new-tab' listener — sending any
  // earlier is a silent no-op since nothing is listening yet.
  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingOpenUrl) {
      safelySend('open-in-new-tab', pendingOpenUrl)
      pendingOpenUrl = null
    }
  })

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
let vpnActive: { protocol: string; host: string; port: number; username?: string; password?: string } | null = null

ipcMain.handle('vpn:getStatus', () => ({ connected: !!vpnActive, config: vpnActive }))

ipcMain.handle('vpn:setProxy', async (_e, cfg: { protocol: string; host: string; port: number; username?: string; password?: string }) => {
  try {
    let rules = `${cfg.protocol.toLowerCase()}://`
    if (cfg.username && cfg.password) rules += `${encodeURIComponent(cfg.username)}:${encodeURIComponent(cfg.password)}@`
    rules += `${cfg.host}:${cfg.port}`
    await session.defaultSession.setProxy({ proxyRules: rules })
    vpnActive = cfg
    return { success: true }
  } catch (e: any) { return { success: false, error: e.message } }
})

ipcMain.handle('vpn:clearProxy', async () => {
  try {
    await session.defaultSession.setProxy({ mode: 'direct' })
    vpnActive = null
    return { success: true }
  } catch (e: any) { return { success: false, error: e.message } }
})

ipcMain.handle('vpn:getIp', async () => {
  try {
    const { status, body } = await httpGet('https://ipinfo.io/json', 8000)
    if (status === 200) {
      const d = JSON.parse(body)
      return { success: true, ip: d.ip, city: d.city, region: d.region, country: d.country, org: d.org }
    }
    return { success: false, error: `HTTP ${status}` }
  } catch (e: any) { return { success: false, error: e.message } }
})

// ── IPC: Window ────────────────────────────────────────────────────────────
ipcMain.handle('window:minimize',    () => mainWindow?.minimize())
ipcMain.handle('window:maximize',    () => { mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize() })
ipcMain.handle('window:close',       () => mainWindow?.close())
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized())

// ── IPC: Tab context menu ───────────────────────────────────────────────────
// Native menu — an HTML menu in the tab strip would be clipped by the 40px
// bar and painted over by the active tab's BrowserView. Resolves with the
// chosen action id, or '' if dismissed.
ipcMain.handle('tabs:showContextMenu', (_e, info: { isBrowser: boolean; hasRight: boolean; count: number }) => {
  return new Promise<string>((resolve) => {
    let resolved = false
    const done = (action: string) => { if (!resolved) { resolved = true; resolve(action) } }
    const menu = Menu.buildFromTemplate([
      { label: 'New Tab',                 click: () => done('new-tab') },
      { label: 'Duplicate Tab',           click: () => done('duplicate') },
      { type: 'separator' },
      { label: 'Reload',                  enabled: info.isBrowser, click: () => done('reload') },
      { type: 'separator' },
      { label: 'Close Tab',               click: () => done('close') },
      { label: 'Close Other Tabs',        enabled: info.count > 1, click: () => done('close-others') },
      { label: 'Close Tabs to the Right', enabled: info.hasRight,  click: () => done('close-right') },
    ])
    // callback fires on dismiss too; defer so a click handler wins the race
    menu.popup({ window: mainWindow ?? undefined, callback: () => setTimeout(() => done(''), 0) })
  })
})
ipcMain.handle('window:setTransparency', (_e, mode: string) => {
  const d = getData(); d.settings.transparency = mode; saveData()
  if (mainWindow) {
    applyTransparency(mainWindow, mode)
    safelySend('theme:transparency', mode)
  }
})
ipcMain.handle('window:setOpacity', (_e, opacity: number) => {
  const d = getData(); d.settings.windowOpacity = opacity; saveData()
  if (mainWindow) applyWindowOpacity(mainWindow, opacity)
})

registerGmailIpc(safelySend)

// ── IPC: Tab content views (BrowserView) ────────────────────────────────────
ipcMain.handle('tabview:create', (_e, tabId: string, url: string) => createTabView(tabId, url))
ipcMain.handle('tabview:destroy', (_e, tabId: string) => destroyTabView(tabId))
ipcMain.handle('tabview:setActive', (_e, tabId: string | null) => {
  activeTabViewId = tabId
  syncActiveBrowserView()
})
ipcMain.handle('tabview:setBounds', (_e, bounds: { x: number; y: number; width: number; height: number }) => {
  tabViewBounds = bounds
  syncActiveBrowserView()
})
ipcMain.handle('tabview:setOverlayHidden', (_e, hidden: boolean) => {
  tabViewOverlayHidden = hidden
  syncActiveBrowserView()
})
ipcMain.handle('tabview:navigate', (_e, tabId: string, url: string) => {
  try { tabViews.get(tabId)?.webContents.loadURL(url) } catch {}
})
ipcMain.handle('tabview:goBack', (_e, tabId: string) => {
  const wc = tabViews.get(tabId)?.webContents
  try { if (wc?.canGoBack()) wc.goBack() } catch {}
})
ipcMain.handle('tabview:goForward', (_e, tabId: string) => {
  const wc = tabViews.get(tabId)?.webContents
  try { if (wc?.canGoForward()) wc.goForward() } catch {}
})
ipcMain.handle('tabview:reload', (_e, tabId: string) => {
  try { tabViews.get(tabId)?.webContents.reload() } catch {}
})
ipcMain.handle('tabview:getNavState', (_e, tabId: string) => {
  const wc = tabViews.get(tabId)?.webContents
  try { return { canGoBack: wc?.canGoBack() ?? false, canGoForward: wc?.canGoForward() ?? false } }
  catch { return { canGoBack: false, canGoForward: false } }
})
// Runs a script inside a tab's page and returns its completion value — the
// agent layer uses this to read pages and drive forms (fill fields, click).
// userGesture=true so synthesized clicks count as real user interaction.
ipcMain.handle('tabview:execJs', async (_e, tabId: string, script: string) => {
  const wc = tabViews.get(tabId)?.webContents
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
  const dls = readJson(DL_FILE, []) as any[]
  let changed = false
  for (const dl of dls) {
    if (dl.state === 'progressing') { dl.state = 'interrupted'; changed = true }
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
ipcMain.handle('ollama:status', async () => checkOllamaRunning())
ipcMain.handle('ollama:pull', async (_e, model: string) => {
  const { olBase } = getAIConfig()
  try {
    const { status, body } = await httpPost(`${olBase}/api/pull`, { name: model, stream: false }, {}, 180000)
    if (status >= 200 && status < 400) return { success: true }
    return { success: false, error: body }
  } catch (e: any) { return { success: false, error: e.message } }
})

// ── IPC: WiFi ──────────────────────────────────────────────────────────────
ipcMain.handle('wifi:scan', async () => {
  if (process.platform !== 'win32') return { networks: [], error: 'WiFi scan only on Windows' }
  try {
    const raw = execSync('netsh wlan show networks mode=bssid', { encoding: 'utf-8', timeout: 8000 })
    return { networks: parseWifiNetworks(raw) }
  } catch (e: any) { return { networks: [], error: e.message } }
})
ipcMain.handle('wifi:connect', async (_e, ssid: string, open?: boolean) => {
  if (process.platform !== 'win32') return { success: false, error: 'Windows only' }
  // netsh can only "connect name=" to an SSID that already has a saved WLAN
  // profile. Open networks the user has never joined have none, so the bare
  // connect silently fails — that's the "nothing happens" bug. For open
  // networks, write a minimal open-auth profile, import it, THEN connect.
  try {
    if (open) {
      // SSID → hex, so exotic characters in the name can't break the XML.
      const hex = Buffer.from(ssid, 'utf-8').toString('hex').toUpperCase()
      const xml = `<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>${escapeXml(ssid)}</name>
  <SSIDConfig><SSID><hex>${hex}</hex><name>${escapeXml(ssid)}</name></SSID></SSIDConfig>
  <connectionType>ESS</connectionType>
  <connectionMode>manual</connectionMode>
  <MSM><security>
    <authEncryption><authentication>open</authentication><encryption>none</encryption><useOneX>false</useOneX></authEncryption>
  </security></MSM>
</WLANProfile>`
      const tmp = join(os.tmpdir(), `aihub-wifi-${Date.now()}.xml`)
      fs.writeFileSync(tmp, xml, 'utf-8')
      // execFileSync (no shell) — the SSID is an untrusted AP-supplied string,
      // so it must never be interpolated into a shell command line.
      try { execFileSync('netsh', ['wlan', 'add', 'profile', `filename=${tmp}`, 'user=all'], { timeout: 8000 }) }
      finally { try { fs.unlinkSync(tmp) } catch {} }
    }
    execFileSync('netsh', ['wlan', 'connect', `name=${ssid}`], { timeout: 12000 })
    return { success: true }
  } catch (e: any) {
    // netsh writes the useful message to stdout, not the thrown Error.
    const detail = (e.stdout?.toString?.() || '').trim() || e.message
    return { success: false, error: detail }
  }
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
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
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
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
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
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
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

// ── IPC: Save any text file the agent produced (resume, code, csv…) ───────
function sanitizeFilename(name: string, fallback: string): string {
  const clean = (name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 80)
  return clean || fallback
}

ipcMain.handle('file:saveText', async (_e, { filename, content }: { filename: string; content: string }) => {
  const safe = sanitizeFilename(filename, 'agent-output.txt')
  const ext = extname(safe).replace('.', '') || 'txt'
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
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
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
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
ipcMain.handle('recorder:getSourceId', () => {
  try { return mainWindow.getMediaSourceId() } catch { return null }
})

// ── IPC: Live AI news from Hacker News ────────────────────────────────────
const AI_NEWS_KEYWORDS = [
  'ai ', ' ai', 'llm', 'gpt', 'claude', 'gemini', 'openai', 'anthropic',
  'deepseek', 'language model', 'neural', 'chatgpt', 'artificial intelligence',
  'machine learning', 'mistral', 'llama', 'groq', 'hugging face', 'diffusion',
  'transformer', 'copilot', 'stable diffusion', 'midjourney', 'sora',
]

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
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
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
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
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
