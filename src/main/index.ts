import { app, BrowserWindow, BrowserView, ipcMain, shell, nativeTheme, session, Menu, MenuItem, clipboard, dialog, Notification, desktopCapturer, webContents as electronWebContents } from 'electron'
import { join, resolve as pathResolve, relative as pathRelative, isAbsolute as pathIsAbsolute, dirname, extname, basename } from 'path'
import zlib from 'zlib'
import http from 'http'
import https from 'https'
import dns from 'dns'
import os from 'os'
import fs from 'fs'
import { pathToFileURL, fileURLToPath } from 'url'
import { execSync, execFileSync, spawn } from 'child_process'
import { recordVisit, generateRecommendations, saveRecommendations, getStoredRecommendations, buildProfile } from './ai-brain'
import { registerGoogleIpc } from './google'
import { registerCommunityIpc, releaseCommunityWindow, shutdownCommunityBackend } from './community'
import { registerAttachmentScheme, registerAttachmentProtocol } from './community/attachments'
import { registerFaviconIpc } from './favicons'
import { initAutoUpdater } from './updater'
import { pickAgentModel, orderFreeModels, suggestFasterModel } from './modelRouting'
import {
  normalizeModels, filterModels, modelExists as catalogHasModel,
  classifyOpenRouterStatus,
  OPENROUTER_FREE_AUTO, type CatalogModel, type ModelFilter,
} from './openRouterCatalog'
import {
  routeGenerate, summarizeOpenRouterSkips,
  type RoutingSettings, type OpenRouterFailure,
} from './aiRouting'
import { createManagedJsonStore, flushAllJsonStores } from './jsonStore'
import { createSessionManager, type SessionTab } from './sessions'
import axios from 'axios'
import { createSemanticIndex, type SearchDoc } from './semantic'
import { splitPanes } from '../shared/splitLayout'
import { writeNote, describeVault, type NoteKind } from './obsidian'
import { contentHash, describeChange, containsKeyword } from './watchDiff'
import {
  partitionFor, addContainer, removeContainer, DEFAULT_CONTAINERS, type Container,
} from './containers'
import { encryptJson, decryptJson, mergePayloads, syncableSettings, type SyncPayload } from './syncCrypto'
import { subfolderFor } from './downloadSorting'
import { createVault } from './vault'
import { extractPdfText, looksLikePdf } from './pdfText'
import { parseTradingViewText, describeReading, isChartUrl } from './trading/chartReader'
import { analyseReading } from './trading/barAnalysis'
import {
  READ_BARS_SCRIPT, normalizeRuntimeBars, describeResolution, splitSymbol,
  toDailyCandles, isDailyOrHigher,
} from './trading/chartRuntime'
import { buildLevels, buildTradePlan, trendContext, buildBracketPlan } from './trading/levels'
import {
  buildBackup, validateBackup, backupFileName, BACKUP_EXTENSION,
  mergeBibleMarks, mergeBibleStudy, EMPTY_BIBLE_STUDY, studyHasContent,
  mergeBookmarks as mergeBackupBookmarks, mergeRecords, mergeById,
  type BackupSections, type BibleStudyData,
} from './backup'
import {
  parseSearchResults, searchUrl, GOSPEL_QUERIES, type YouTubeVideo,
} from './youtubeSearch'
import {
  forOllama, forOpenRouter, withoutImages, hasImages, looksVisionCapable, pickVisionModel,
} from './visionMessages'
import { pushSync, pullSync, clearSync } from './google/apis/sync'
import {
  decideRequest, hostOf, emptyStats, recordBlock,
  DEFAULT_ADBLOCK_CONFIG, type AdblockConfig,
} from './blocking'
import { BLOCKLIST_SIZE } from './blocking/adblockList'

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

// Community attachments are served over their own scheme. Registering it has
// to happen here, before app is ready: registerSchemesAsPrivileged is ignored
// afterwards, and without the privilege Chromium treats every attachment URL
// as an opaque origin and refuses to render it in an <img>.
registerAttachmentScheme()

// Point GPU and disk caches to our writable directory so Chromium
// doesn't fight over temp paths that other processes may have locked.
app.commandLine.appendSwitch('disk-cache-dir',     join(APP_DIR, 'cache'))
app.commandLine.appendSwitch('gpu-disk-cache-dir', join(APP_DIR, 'gpu-cache'))
// Disable problematic GPU sandbox on Windows to avoid cache permission errors
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
  // Windows-only: Chromium's native occlusion detection repeatedly decides our
  // frameless/transparent window is hidden and throttles or blanks the tab's
  // renderer, which shows up as a page that "stops loading" until you click it.
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
}

// ── Browsing performance ──────────────────────────────────────────────────
// 512 MB of on-disk HTTP cache (Chromium's default for a fresh profile is far
// smaller) so revisited sites come off disk instead of the network.
app.commandLine.appendSwitch('disk-cache-size', String(512 * 1024 * 1024))
// Split a single download across connections, and let the GPU do raster work
// instead of the CPU — both are straight wins for page paint on this hardware.
app.commandLine.appendSwitch('enable-features', 'ParallelDownloading')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')

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
  { id: 'bm-c',  url: 'aihub://community',                              title: 'Community',        favicon: '', category: 'Social',        addedAt: 0, color: '#34d399' },
  { id: 'bm-b',  url: 'aihub://bible',                                  title: 'Bible',            favicon: '', category: 'Reading',       addedAt: 0, color: '#DC2626' },
  { id: 'bm-m',  url: 'aihub://mail',                                   title: 'Mail',             favicon: '', category: 'Productivity',  addedAt: 0, color: '#EA4335' },
  { id: 'bm-g',  url: 'https://www.google.com',                        title: 'Google',           favicon: '', category: 'Search',        addedAt: 0, color: '#4285F4' },
  { id: 'bm-yt', url: 'https://www.youtube.com',                       title: 'YouTube',          favicon: '', category: 'Entertainment',  addedAt: 0, color: '#FF0000' },
  { id: 'bm-nf', url: 'https://www.netflix.com',                       title: 'Netflix',          favicon: '', category: 'Entertainment',  addedAt: 0, color: '#E50914' },
  { id: 'bm-1',  url: 'https://aihub-eight-xi.vercel.app/dashboard',   title: 'AIHub Dashboard',  favicon: '', category: 'AI',            addedAt: 0, color: '#a78bfa' },
  { id: 'bm-2',  url: 'https://www.technobiztrader.net/',               title: 'TechnoBiz Trader', favicon: '', category: 'Trading',       addedAt: 0, color: '#fb923c' },
  { id: 'bm-4',  url: 'https://technobiz-trader-agent.vercel.app/',     title: 'TechnoBiz Agent',  favicon: '', category: 'AI',            addedAt: 0, color: '#a78bfa' },
]

// Defaults that must sit at the top of the home grid, in this order. A saved
// data.json replaces the whole bookmark list, so installs that predate a new
// pinned default would never see it — seed it once per id and record that in
// `seededBookmarks`, so a bookmark the user later deletes stays deleted.
const PINNED_DEFAULT_IDS = ['bm-c', 'bm-b', 'bm-m']

// Permanent bookmarks: the home grid always keeps a way into the reader and into
// the Community lounge, so those two tiles can't be removed. Matched on url, not
// id, so a copy the user added by hand is protected too and the seeding above
// stays consistent with it.
const UNDELETABLE_BOOKMARK_URLS = ['aihub://community', 'aihub://bible']

function seedPinnedBookmarks(d: any): boolean {
  const seeded: string[] = Array.isArray(d.seededBookmarks) ? d.seededBookmarks : []
  const bms: any[] = Array.isArray(d.bookmarks) ? d.bookmarks : []
  let changed = false

  // Reverse order: each unshift pushes the previous one down, so the array ends
  // up in PINNED_DEFAULT_IDS order.
  for (const id of [...PINNED_DEFAULT_IDS].reverse()) {
    if (seeded.includes(id)) continue
    seeded.push(id)
    changed = true
    const def = DEFAULT_BOOKMARKS.find(b => b.id === id)
    if (!def) continue
    // Already present (possibly added by hand under another id) — move, don't duplicate.
    const at = bms.findIndex(b => b.id === id || b.url === def.url)
    bms.unshift(at >= 0 ? bms.splice(at, 1)[0] : { ...def, addedAt: Date.now() })
  }

  d.bookmarks = bms
  d.seededBookmarks = seeded
  return changed
}

function ensureDir() { if (!fs.existsSync(APP_DIR)) fs.mkdirSync(APP_DIR, { recursive: true }) }
function readJson(f: string, fb: any): any { try { return JSON.parse(fs.readFileSync(f, 'utf-8')) } catch { return fb } }
// Write through a temp file and rename over the target: rename is atomic, so a
// crash or power cut mid-write leaves the previous file intact instead of a
// truncated one. Plain writeFileSync could destroy the user's bookmarks and
// settings at the moment it was trying to save them.
function writeJson(f: string, d: any) {
  const tmp = `${f}.${process.pid}.tmp`
  try {
    ensureDir()
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2))
    fs.renameSync(tmp, f)
  } catch {
    try { fs.unlinkSync(tmp) } catch {}
  }
}

let _data: any = null
function getData(): any {
  if (!_data) {
    const s = readJson(DATA_FILE, null)
    _data = s
      ? { ...{ bookmarks: DEFAULT_BOOKMARKS, settings: defaultSettings() }, ...s, settings: { ...defaultSettings(), ...(s.settings || {}) } }
      : { bookmarks: DEFAULT_BOOKMARKS.map(b => ({ ...b, addedAt: Date.now() })), settings: defaultSettings() }
    if (seedPinnedBookmarks(_data)) saveData()
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
    // Provider routing. Local first: Ollama is private, free and already on
    // the machine, so it answers unless it genuinely can't. OpenRouter is the
    // safety net, defaulted to its free meta-router so a user with no credits
    // still gets an answer instead of an HTTP 402.
    primaryProvider:  'ollama',
    fallbackEnabled:  true,
    fallbackProvider: 'openrouter',
    // Ad/tracker blocking — on by default; see src/main/blocking.
    adblock: { enabled: true, allowlist: [] as string[], custom: [] as string[] },
    // Reopen the tabs that were open when the app last closed.
    restoreSession: true,
    // 'horizontal' (classic top strip) or 'vertical' (left rail).
    tabLayout: 'horizontal',
    // Folder of the user's Obsidian vault; empty until they pick one.
    obsidianVault: '',
    // Site containers — isolated cookie jars a tab can be opened in.
    containers: DEFAULT_CONTAINERS,
    // File downloads into Documents/Images/Video/… folders by type.
    sortDownloads: true,
    // 'off' | 'cloudflare' | 'google' | 'quad9'
    dohProvider: 'off',
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

// OpenRouter's free meta-router. Any hardcoded slug goes stale — the free tier
// is re-cut without notice, and a retired default means every request opens
// with a guaranteed 404 before falling through. `openrouter/free` picks from
// whatever is actually live at request time, so it never rots.
const OR_DEFAULT_MODEL = OPENROUTER_FREE_AUTO

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

/** The provider-routing half of the AI settings, defaulted for old profiles
 *  saved before these keys existed. */
function getRoutingSettings(preferredOllamaModel?: string): RoutingSettings {
  const s = getData().settings
  const { orMdl } = getAIConfig()
  return {
    primaryProvider:  s.primaryProvider === 'openrouter' ? 'openrouter' : 'ollama',
    ollamaModel:      preferredOllamaModel || s.aiModel || '',
    fallbackEnabled:  s.fallbackEnabled !== false,
    fallbackProvider: s.fallbackProvider === 'none' ? 'none'
      : s.fallbackProvider === 'ollama' ? 'ollama' : 'openrouter',
    openRouterModel:  orMdl,
  }
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
// Two budgets, because the two waits are nothing alike. Nothing streams while
// Ollama loads the model and evaluates the prompt — and this app's prompt is
// large (tool docs + bookmarks + page context), so on a CPU-bound machine the
// first token can legitimately be minutes away. Once tokens start, a 2-minute
// gap really does mean it stalled. One 120s socket timeout for both was killing
// healthy generations before they ever produced a byte.
//
// The first-token budget is 120s, not the 420s it used to be. Seven minutes
// was chosen to let a cold 7B model finish loading, but it turned "this model
// is too heavy for this machine" into seven minutes of a spinner followed by
// an OpenRouter error the user could do nothing about. A model that cannot
// start answering in two minutes here is not going to be usable for chat, so
// hand the turn to the fallback while the user is still watching.
function ollamaChatStream(
  base: string, model: string, messages: any[],
  idleTimeoutMs = 120000, firstTokenTimeoutMs = 120000,
  onDelta?: (text: string, reset?: boolean) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let streamStarted = false
    const parsed = new URL(`${base}/api/chat`)
    // keep_alive: Ollama evicts an idle model after 5 minutes by default, so
    // the next message in a conversation pays the full multi-second reload.
    // Holding it resident for 30m makes follow-up replies start almost
    // instantly, which is most of the perceived "AI is slow" problem.
    // num_ctx sized to the prompt actually being sent. Too small and Ollama
    // truncates from the FRONT — which eats the system prompt and invalidates
    // the cached prefix, so every turn re-processes the whole thing. Agent
    // turns (tool manual + history + page text) routinely pass 8k; plain chat
    // stays at the cheap default rather than allocating a window it won't use.
    const promptChars = messages.reduce((n, m) => n + String(m?.content || '').length, 0)
    const needed = Math.ceil(promptChars / 3.5) + 1536 // + room for the reply
    const numCtx = needed <= 8192 ? 8192 : needed <= 12288 ? 12288 : 16384
    const body = JSON.stringify({
      model, messages, stream: true, keep_alive: '30m', options: { num_ctx: numCtx },
    })
    const req = http.request({
      hostname: parsed.hostname,
      port:     parsed.port || 80,
      path:     parsed.pathname,
      method:   'POST',
      timeout:  firstTokenTimeoutMs,
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
        // First byte back: drop to the tighter between-tokens budget.
        if (!streamStarted) { streamStarted = true; req.setTimeout(idleTimeoutMs) }
        buf += c
        // NDJSON: one {"message":{"content":"…"},"done":false} object per line
        let nl: number
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line) continue
          try {
            const j = JSON.parse(line)
            if (j.message?.content) {
              content += j.message.content
              // Hand the token straight on. Tokens were already arriving one
              // at a time here; they were just accumulated in silence until
              // the whole generation finished, so a 30-second answer looked
              // like 30 seconds of nothing.
              if (onDelta) { try { onDelta(j.message.content) } catch {} }
            }
            if (j.error) return reject(new Error(String(j.error)))
          } catch { /* partial line — wait for more */ }
        }
      })
      res.on('end', () => resolve(content))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error(streamStarted
        ? 'timeout — Ollama stopped responding mid-generation'
        // No advice here — the caller knows what is installed and appends a
        // named model. "Try a smaller model" is not an instruction when the
        // user has eight of them.
        : `timeout — Ollama took over ${Math.round(firstTokenTimeoutMs / 1000)}s to start replying. Ollama is running; the model just cannot process a prompt this size here in time. Without a usable GPU it is prompt processing, not generation, that runs out of budget — the model produces nothing at all rather than answering slowly.`))
    })
    req.write(body)
    req.end()
  })
}

// ── Ollama detection using native http ────────────────────────────────────
// Short-lived cache: ai:chat, ai:summarize and the status poller all call this,
// so without it every AI action re-probes the network before doing any work.
// A "not running" result probes up to 4 endpoints — cache it briefly so a user
// without Ollama isn't stalled on repeated timeouts before the cloud fallback.
interface OllamaModelInfo { name: string; tools: boolean; params: number; cloud: boolean }
interface OllamaProbe { running: boolean; models: string[]; info?: OllamaModelInfo[] }
let ollamaProbeCache: { at: number; value: OllamaProbe } | null = null
// Positive results expire quickly (a model list can change as the user pulls
// models). A NEGATIVE result is cached far longer: when Ollama isn't installed
// every probe round costs up to 4 × 1.5s of dead time, and with a 5s TTL that
// was re-paid on essentially every chat message before falling back to the
// cloud. Settings' explicit "check again" passes force=true.
const OLLAMA_PROBE_TTL = 5000
const OLLAMA_MISS_TTL  = 60000

async function checkOllamaRunning(force = false): Promise<OllamaProbe> {
  if (!force && ollamaProbeCache) {
    const ttl = ollamaProbeCache.value.running ? OLLAMA_PROBE_TTL : OLLAMA_MISS_TTL
    if (Date.now() - ollamaProbeCache.at < ttl) return ollamaProbeCache.value
  }
  const { olBase } = getAIConfig()
  // Try both the configured base AND a 127.0.0.1 fallback to handle systems
  // where 'localhost' resolves differently in packaged Electron.
  const bases = [olBase, 'http://127.0.0.1:11434']
  const uniqueBases = [...new Set(bases)]

  const cache = (value: OllamaProbe) => {
    ollamaProbeCache = { at: Date.now(), value }
    return value
  }

  for (const base of uniqueBases) {
    // /api/tags is the only endpoint that lists installed models. It gets a
    // longer budget than the liveness probe because a busy Ollama (loading a
    // model into VRAM) can take a second or two to answer, and a timeout here
    // used to leave us with no model list at all.
    try {
      const { status, body } = await httpGet(`${base}/api/tags`, 4000)
      if (status >= 200 && status < 400) {
        const json = JSON.parse(body)
        const entries: OllamaModelInfo[] = (json.models || [])
          .map((m: any) => {
            const name = typeof m === 'string' ? m : m.name || ''
            const caps: string[] = Array.isArray(m?.capabilities) ? m.capabilities : []
            const sizeStr = String(m?.details?.parameter_size || '')
            const params = parseFloat(sizeStr) || 0   // "7.6B" → 7.6, "134.52M" → 134.52
            return {
              name,
              tools: caps.includes('tools'),
              // Parameter counts arrive as "7.6B" or "134.52M" — normalise to B.
              params: /M$/i.test(sizeStr) ? params / 1000 : params,
              cloud: !!m?.remote_host,
            }
          })
          .filter((e: OllamaModelInfo) => e.name && !/embed/i.test(e.name))
        const models = entries.map(e => e.name)
        if (models.length) return cache({ running: true, models, info: entries })
      }
    } catch { /* fall through to the liveness probe */ }

    // Ollama answered but we couldn't read its model list (timeout, or a
    // version endpoint that doesn't carry one). Report it as running with an
    // UNKNOWN model list — never invent a model name here: a fabricated
    // 'llama3' is what produced "model 'llama3' not found" 404s on machines
    // whose actual models were fine.
    try {
      const { status } = await httpGet(`${base}/api/version`, 1500)
      if (status >= 200 && status < 400) return cache({ running: true, models: [] })
    } catch { /* try next base */ }
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
  /** Second tab shown beside the active one in split view, if any. */
  splitId: string | null
  /** Share of the content width given to the LEFT (active) pane, 0.2–0.8. */
  splitRatio: number
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

// Electron's default UA carries "aihub-browser/x" and "Electron/x" tokens that
// make Google's sign-in reject the tab ("This browser or app may not be
// secure"). We present as plain Chrome instead — but as the Chrome we ACTUALLY
// ARE, not a newer one.
//
// Measured live against accounts.google.com, 2026-08-05, typing a (nonexistent)
// address into the real sign-in form with real keystrokes:
//
//   UA claims Chrome 138, engine is Chromium 132  → /v3/signin/rejected
//   UA claims the true engine version             → normal account lookup
//
// Every version we claim above the engine's own is a mismatch the gate can see:
// `navigator.userAgentData` and the TLS ClientHello are generated by the real
// build and cannot be rewritten from here, so a forward-spoofed UA contradicts
// them. Chasing a "recent enough" Chrome string was the wrong lever for a year
// of attempts (see git history); honesty plus the window.chrome surface
// restored in src/preload/webcontent.ts is what actually clears it.
//
// Derived from process.versions.chrome so it can never drift: bumping Electron
// bumps the claim automatically. Chrome reports only the major in the UA and
// zeroes the rest — the full build travels via client hints.
const CHROME_FULL = process.versions.chrome
const CHROME_MAJOR = CHROME_FULL.split('.')[0]
// Match the OS we're actually running on: a Windows UA on a Mac contradicts
// navigator.platform and re-creates exactly the inconsistency described above.
const UA_PLATFORM =
  process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7'
  : process.platform === 'linux' ? 'X11; Linux x86_64'
  : 'Windows NT 10.0; Win64; x64'
const CHROME_UA =
  `Mozilla/5.0 (${UA_PLATFORM}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`
// Low-entropy hint sent on every secure request. GREASE brand first, matching
// real Chrome's ordering; Google parses the Chromium / Google Chrome entries.
const SEC_CH_UA = `"Not/A)Brand";v="8", "Chromium";v="${CHROME_MAJOR}", "Google Chrome";v="${CHROME_MAJOR}"`
// High-entropy list, only sent once the server requests it via Accept-CH.
const SEC_CH_UA_FULL = `"Not/A)Brand";v="8.0.0.0", "Chromium";v="${CHROME_FULL}", "Google Chrome";v="${CHROME_FULL}"`
const SEC_CH_UA_PLATFORM =
  process.platform === 'darwin' ? '"macOS"' : process.platform === 'linux' ? '"Linux"' : '"Windows"'

// Attached to site content only (tab views + OAuth popups) — never to the app
// UI, which loads ../preload/index.ts. Restores the window.chrome surface that
// Electron omits; see src/preload/webcontent.ts for the measurements.
const WEB_CONTENT_PRELOAD = join(__dirname, '../preload/webcontent.js')

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
  // Scoped to the window whose address bar was right-clicked. This used to
  // broadcast: pasting a link in a detached window navigated the tab it was
  // detached FROM as well, because every window received the same event and
  // renderer tab ids restart at tab-1 in each one.
  const ctx = ctxFromEvent(e)
  const menu = Menu.buildFromTemplate([
    { label: 'Cut',  role: 'cut',  enabled: hasText },
    { label: 'Copy', role: 'copy', enabled: hasText },
    { label: 'Paste', role: 'paste', enabled: !!clip },
    {
      label: 'Paste and Go', enabled: !!clip,
      click: () => sendTo(ctx, 'urlbar-paste-and-go', clip),
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

// Clip the current page (or just the selected passage) into the Obsidian vault
// as a markdown note. Runs in the main process because that is where both the
// page's text and the vault live — the renderer never needs to see either.
async function clipToVault(wc: Electron.WebContents, selection?: string) {
  const vaultPath = getData().settings?.obsidianVault || ''
  if (!vaultPath) {
    notifyQuiet('No Obsidian vault yet', 'Pick your vault folder in Settings → Obsidian, then try again.')
    return
  }
  let title = 'Web page'
  let url = ''
  try { url = wc.getURL(); title = wc.getTitle() || url } catch {}

  let body = (selection || '').trim()
  if (!body) {
    try {
      // Readable text only: script and style content would land in the note as
      // noise, and Obsidian would index every line of it.
      body = await wc.executeJavaScript(`(() => {
        const root = document.querySelector('article') || document.querySelector('main') || document.body
        if (!root) return ''
        const clone = root.cloneNode(true)
        clone.querySelectorAll('script,style,noscript,svg,iframe').forEach(n => n.remove())
        return (clone.innerText || '').replace(/
{3,}/g, '

').trim().slice(0, 20000)
      })()`)
    } catch { body = '' }
  }

  const result = writeNote(vaultPath, {
    kind: 'clip',
    title,
    url,
    content: body || '_(no readable text on this page)_',
    tags: selection ? ['highlight'] : [],
  })
  if (result.ok) notifyQuiet('Saved to Obsidian', title)
  else notifyQuiet('Could not save to Obsidian', result.error || 'Unknown error')
}

// A notification that never steals focus or plays a sound — this is a
// confirmation, not an alert.
function notifyQuiet(title: string, body: string) {
  try {
    if (!Notification.isSupported()) return
    new Notification({ title, body, silent: true }).show()
  } catch {}
}

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
      menu.append(new MenuItem({ label: 'Save Selection to Obsidian', click: () => { void clipToVault(wc, sel) } }))
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
      menu.append(new MenuItem({ label: 'Save Page to Obsidian', click: () => { void clipToVault(wc) } }))
      menu.append(new MenuItem({ label: 'Translate this Page', click: () => sendTo(menuCtx, 'open-in-new-tab', `https://translate.google.com/translate?sl=auto&tl=en&u=${encodeURIComponent(pageUrl)}`) }))
      menu.append(new MenuItem({ label: 'Print…', accelerator: 'Ctrl+P', click: () => { try { wc.print() } catch {} } }))
      menu.append(new MenuItem({ label: 'Save Page As…', accelerator: 'Ctrl+S', click: () => savePageAs(wc) }))
      menu.append(new MenuItem({ label: 'View Page Source', click: () => sendTo(menuCtx, 'open-in-new-tab', `view-source:${pageUrl}`) }))
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
  const hidden = ctx.overlayHidden
  const primary = (!hidden && ctx.activeId) ? ctx.views.get(ctx.activeId) : undefined
  // A split partner only counts while it still exists and is not the active tab
  // itself (closing the partner must not leave half the window empty).
  const secondary = (!hidden && ctx.splitId && ctx.splitId !== ctx.activeId)
    ? ctx.views.get(ctx.splitId)
    : undefined

  // Detach any view that should no longer be on screen. Electron keeps every
  // added BrowserView attached until told otherwise, so a stale split partner
  // would keep painting over the window after the split ended.
  for (const attached of ctx.win.getBrowserViews()) {
    if (attached !== primary && attached !== secondary) {
      try { ctx.win.removeBrowserView(attached) } catch {}
    }
  }

  if (!primary) return

  const nudge = (view: BrowserView) => {
    // A view that was detached is treated as hidden by Chromium; on re-attach
    // it can show a blank or stale frame until something forces a paint.
    const wc = view.webContents
    try { wc.invalidate() } catch {}
    for (const delay of [4, 12, 32, 80]) {
      setTimeout(() => { try { if (!wc.isDestroyed()) wc.invalidate() } catch {} }, delay)
    }
  }

  const alreadyAttached = new Set(ctx.win.getBrowserViews())
  const place = (view: BrowserView, bounds: { x: number; y: number; width: number; height: number }) => {
    const reattaching = !alreadyAttached.has(view)
    if (reattaching) { try { ctx.win.addBrowserView(view) } catch {} }
    const next = {
      x: Math.round(bounds.x), y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)), height: Math.max(0, Math.round(bounds.height)),
    }
    let previous: Electron.Rectangle | null = null
    try { previous = view.getBounds() } catch {}
    const resized = !previous || previous.width !== next.width || previous.height !== next.height
    view.setBounds(next)
    // Nudge on RESIZE, not only on re-attach. setBounds moves the view, but an
    // already-attached view's renderer can keep its old viewport: entering
    // split view left the page laid out at full width inside a half-width
    // pane, so the site was silently clipped down the middle. Measured: main
    // reported 597px while the page still reported innerWidth 1200.
    if (reattaching || resized) nudge(view)
  }

  if (secondary) {
    // Split view: the panes share the content area with a hairline gutter, so
    // the window background reads as a divider between two live pages.
    const [left, right] = splitPanes(ctx.bounds, ctx.splitRatio)
    place(primary, left)
    place(secondary, right)
  } else {
    place(primary, ctx.bounds)
  }
}

// Self-contained "this page crashed" document, shown only when a page crashes
// twice in a row (see the render-process-gone handler). It carries no preload
// and no IPC — the Reload button is a plain location.replace() back to the site,
// which is all a fresh attempt needs and keeps the page safe to render in a
// crashed tab's respawned renderer.
function crashPageDataUrl(crashedUrl: string, reason: string): string {
  const safeUrl = crashedUrl.replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const host = (() => { try { return new URL(crashedUrl).hostname } catch { return crashedUrl } })()
  const html = `<!doctype html><meta charset="utf-8"><title>Page crashed</title>
<style>
  :root{color-scheme:light}
  body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
       font:15px/1.6 -apple-system,"Segoe UI",system-ui,sans-serif;color:#1c1d2b;background:#f7f8fc}
  .card{max-width:460px;padding:40px;text-align:center}
  .glyph{width:56px;height:56px;margin:0 auto 22px;border-radius:16px;background:#eceefb;
         display:flex;align-items:center;justify-content:center;font-size:26px}
  h1{margin:0 0 10px;font-size:20px;font-weight:650;letter-spacing:-.01em}
  p{margin:0 0 8px;color:#5b5d78}
  .host{font-weight:600;color:#1c1d2b}
  .why{margin-top:18px;font-size:13px;color:#8a8ca6}
  button{margin-top:26px;padding:11px 26px;border:0;border-radius:10px;cursor:pointer;
         font:inherit;font-weight:600;color:#fff;background:#4f46e5}
  button:hover{background:#4338ca}
</style>
<div class="card">
  <div class="glyph">⚠️</div>
  <h1>This page stopped responding</h1>
  <p><span class="host">${host}</span> crashed while loading, twice in a row.</p>
  <p class="why">Reason reported by the browser engine: ${reason}</p>
  <button onclick="location.replace('${safeUrl}')">Reload page</button>
</div>`
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

// The crash page is an internal document — the tab must keep showing the site's
// own address and title, not the data: URL we swapped in underneath it.
const isCrashPage = (u: string) => u.startsWith('data:text/html')

function createTabView(ctx: AppWin | undefined, tabId: string, url: string, containerId?: string | null) {
  if (!ctx || ctx.views.has(tabId)) return
  const tabViews = ctx.views
  // A tab in a container gets its own cookie jar, configured exactly like the
  // main one so the only difference is isolation (see configureContentSession).
  const partition = partitionFor(containerId)
  configureContentSession(session.fromPartition(partition))
  const view = new BrowserView({
    webPreferences: {
      partition,
      contextIsolation: true,
      // Chromium ships a PDF viewer, but only when plugins are enabled. Off,
      // a link to a PDF downloads the file and the tab goes nowhere — the
      // document leaves the browser, and with it every AI, note and clipping
      // feature the app has. On, the PDF renders in the tab like any page.
      plugins: true,
      // Site-facing preload: no IPC, no Node — it only restores the
      // window.chrome members Electron omits, which Google's sign-in gate
      // requires. Safe alongside contextIsolation: it talks to the page
      // through webFrame.executeJavaScript, not through a bridged object.
      preload: WEB_CONTENT_PRELOAD,
      // Keep web security ON for tab content — this is the page real sites
      // (incl. Google sign-in) run in. Disabling it is detectable and makes
      // Google refuse with "this browser or app may not be secure". The old
      // <webview> guests ran with security on, which is why login worked then.
      webSecurity: true,
      // JavaScript and image loading kept explicitly ON: sites like USAjobs.gov
      // and login.gov are script-driven and won't render or sign in without
      // them. Cookies persist automatically through the 'persist:main'
      // partition above, so logins and sessions survive across tabs and
      // restarts — nothing here blocks first- or third-party cookies.
      javascript: true,
      images: true,
      // Keep background tabs fully alive. With throttling on, a tab you
      // switched away from had its timers/rAF frozen and its renderer marked
      // hidden, so returning to it showed a stale or blank page until it
      // "woke up" — which is exactly the "every previous tab goes idle, I have
      // to reload" complaint. Off, a backgrounded page keeps running and
      // re-appears instantly with live content when you switch back. Costs a
      // little CPU with many heavy tabs; the 30-minute sleep still reclaims
      // memory from tabs left untouched.
      backgroundThrottling: false,
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
            // Same jar as the tab that opened it — an OAuth popup from a Work
            // tab must see the Work session, not the default one.
            partition,
            contextIsolation: true,
            webSecurity: true,
            javascript: true,
            nodeIntegration: false,
            // "Sign in with Google" runs its whole flow in this popup, so it
            // needs the same Chrome surface as a tab or it hits the same
            // "browser may not be secure" rejection.
            preload: WEB_CONTENT_PRELOAD,
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
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            webPreferences: {
              partition,
              contextIsolation: true,
              webSecurity: true,
              nodeIntegration: false,
              preload: WEB_CONTENT_PRELOAD,
            },
          },
        }
      }
      if (popupUrl && !popupUrl.startsWith('devtools://') && !popupUrl.startsWith('chrome-extension://')) {
        sendTo(ctx, 'open-in-new-tab', popupUrl)
      }
      return { action: 'deny' }
    })
  })

  wc.on('did-navigate', (_e, navUrl) => {
    if (isCrashPage(navUrl)) return
    // The request filter judges subresources against the page that requested
    // them, so it needs to know this tab's document host before the page's
    // own assets start loading.
    notePageHost(wc.id, navUrl)
    sendTabEvent(ctx, tabId, 'did-navigate', { url: navUrl })
  })
  wc.on('did-navigate-in-page', (_e, navUrl) => {
    notePageHost(wc.id, navUrl)
    sendTabEvent(ctx, tabId, 'did-navigate-in-page', { url: navUrl })
  })
  wc.on('did-start-navigation', (_e, navUrl, _isInPlace, isMainFrame) => {
    if (isMainFrame && navUrl && !isCrashPage(navUrl)) notePageHost(wc.id, navUrl)
  })
  wc.on('did-start-loading', () => sendTabEvent(ctx, tabId, 'did-start-loading'))
  wc.on('did-stop-loading', () => {
    let title = ''; let curUrl = ''
    try { title = wc.getTitle() } catch {}
    try { curUrl = wc.getURL() } catch {}
    if (isCrashPage(curUrl)) { curUrl = ''; title = '' }
    sendTabEvent(ctx, tabId, 'did-stop-loading', { title, url: curUrl })
  })

  // ── Renderer crash recovery ───────────────────────────────────────────────
  // A tab's renderer process can die outright — segfault, out-of-memory, GPU
  // fault. Nothing at page level reports it: the navigation already succeeded,
  // so 'did-fail-load' never fires and the title and favicon stay put. The view
  // just stops painting, which is exactly what a "site loads, then goes blank
  // forever" tab is. 'render-process-gone' is the only event that sees it.
  //
  // Most crashes are one-off, so the first one silently reloads — the user sees
  // a flicker instead of a dead tab. The retry MUST be bounded: a page that
  // crashes deterministically would otherwise respawn a renderer that dies on
  // the same code path, forever. A second crash inside the window therefore
  // stops retrying and shows the crash page, which offers a manual reload.
  const CRASH_RETRY_WINDOW_MS = 30_000
  let lastCrashAt = 0
  wc.on('render-process-gone', (_e, details) => {
    // A tab being closed or navigated away tears its renderer down normally.
    if (details.reason === 'clean-exit') return
    let crashedUrl = url
    try { const u = wc.getURL(); if (u && !isCrashPage(u)) crashedUrl = u } catch {}

    const now = Date.now()
    const isRepeat = now - lastCrashAt < CRASH_RETRY_WINDOW_MS
    lastCrashAt = now
    sendTabEvent(ctx, tabId, 'render-process-gone', { reason: details.reason, willRetry: !isRepeat })

    if (!isRepeat) {
      // Small delay: reloading in the same tick as the crash can race the
      // browser process finishing its teardown of the dead renderer.
      setTimeout(() => { try { if (!wc.isDestroyed()) wc.reload() } catch {} }, 300)
      return
    }
    try { if (!wc.isDestroyed()) wc.loadURL(crashPageDataUrl(crashedUrl, details.reason)) } catch {}
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
// Every partition that shows web content — the default one and each site
// container — needs identical treatment: the same browser identity, the same
// request filter, the same permission rules. A container that quietly behaved
// differently from the main session would be a fingerprinting tell and a
// support nightmare, so this is written once and applied to each.
const configuredSessions = new WeakSet<Electron.Session>()

function configureContentSession(ses: Electron.Session): Electron.Session {
  if (configuredSessions.has(ses)) return ses
  configuredSessions.add(ses)

  // Spoof Chrome UA so sites serve full content (many degrade or block Electron's default UA).
  ses.setUserAgent(CHROME_UA)

  // Keep the Sec-CH-UA client-hint headers in lockstep with the UA. Both now
  // describe the real engine (see CHROME_UA), so this only guarantees the two
  // stay identical if Chromium ever formats a hint differently from our string
  // — a server that sees UA and hints disagree treats the browser as spoofed
  // and blocks sign-in. We only touch requests that ALREADY carry the hints (a
  // real Chrome sends them only on secure/https contexts) and only the
  // sec-ch-ua* family — never inventing hints where a browser sends none, and
  // never touching auth tokens or anything else. Matching values in, matching
  // values out: Google sees one consistent, recent Chrome. (See CHROME_MAJOR.)
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders
    // Find the actual casing Chromium used for the low-entropy brand hint; its
    // presence is our signal that this request carries client hints at all.
    const brandKey = Object.keys(headers).find(k => k.toLowerCase() === 'sec-ch-ua')
    if (brandKey) {
      for (const key of Object.keys(headers)) {
        const lk = key.toLowerCase()
        if (lk === 'sec-ch-ua') headers[key] = SEC_CH_UA
        else if (lk === 'sec-ch-ua-full-version-list') headers[key] = SEC_CH_UA_FULL
        else if (lk === 'sec-ch-ua-full-version') headers[key] = `"${CHROME_FULL}"`
        else if (lk === 'sec-ch-ua-mobile') headers[key] = '?0'
        else if (lk === 'sec-ch-ua-platform') headers[key] = SEC_CH_UA_PLATFORM
      }
    }
    callback({ requestHeaders: headers })
  })

  // One request filter for the whole session — ad blocking and focus mode both
  // resolve through it (Electron only allows a single onBeforeRequest).
  installRequestFilter(ses)

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
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
  ses.webRequest.onHeadersReceived((details, callback) => {
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

  return ses
}

function setupSharedApp(firstWin: BrowserWindow): void {
  // Configure the persist:main session used by all <webview partition="persist:main"> tags.
  configureContentSession(session.fromPartition('persist:main'))

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
    // File the download by type before the transfer starts — setSavePath is
    // only honoured while the item is still 'progressing'. Unrecognised types
    // keep the default location rather than disappearing into an "Other" bin.
    if (getData().settings?.sortDownloads !== false) {
      try {
        const folder = subfolderFor(item.getFilename())
        if (folder) {
          const target = join(app.getPath('downloads'), folder)
          fs.mkdirSync(target, { recursive: true })
          item.setSavePath(join(target, item.getFilename()))
        }
      } catch {
        // Permission denied or a read-only disk: let Chromium use its default.
      }
    }
    const dl: any = {
      id: `dl-${Date.now()}-${++dlSeq}`, filename: item.getFilename(), url: item.getURL(),
      savePath: '', totalBytes: item.getTotalBytes(), receivedBytes: 0,
      state: 'progressing', startedAt: Date.now(), completedAt: null,
    }
    const persist = () => {
      downloadsStore.update(list => {
        const i = list.findIndex((x: any) => x.id === dl.id)
        if (i !== -1) list[i] = { ...dl }; else list.unshift({ ...dl })
        if (list.length > 500) list.length = 500
      })
      safelySend('download:update', dl)
    }
    // Progress ticks fire many times per second on fast links. The store
    // debounces the disk write, but the renderer broadcast and the array walk
    // are still per-call, so keep the throttle: state transitions and
    // completion notify immediately, plain progress at most twice a second.
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
    persist()
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

  // YouTube's embedded player refuses a request that reaches it without a
  // Referer, and reports it as "Error 153 — video player configuration error".
  // A packaged build serves the renderer from file://, which sends no Referer
  // at all, so the Gospel room's embed failed on every real install while
  // working perfectly against the dev server on http://localhost.
  //
  // The header is set to the app's own site, which is precisely what a Referer
  // is for: telling YouTube who is embedding. Nothing is impersonated, and
  // nothing restricted is reached — these are public videos the uploader
  // marked embeddable. A request that already carries a Referer (a real web
  // page in a browser tab that embeds YouTube itself) is left untouched.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://www.youtube-nocookie.com/*', 'https://www.youtube.com/*'] },
    (details, callback) => {
      const headers = { ...details.requestHeaders }
      const hasReferer = Object.keys(headers).some(k => k.toLowerCase() === 'referer')
      if (!hasReferer) headers['Referer'] = 'https://aihub-browser.app/'
      callback({ requestHeaders: headers })
    },
  )

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
    splitId: null,
    splitRatio: 0.5,
  }
  // Capture the id up front: by the time 'closed' fires the window is already
  // destroyed and touching win.webContents throws "Object has been destroyed".
  const winId = win.webContents.id
  appWins.set(winId, ctx)
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = win

  // Captured before 'closed', because webContents is gone by the time it fires.
  const communityPeerId = win.webContents.id

  win.on('closed', () => {
    ctx.views.forEach(v => { try { v.webContents.close() } catch {} })
    ctx.views.clear()
    ctx.activeId = null
    appWins.delete(winId)
    // Nobody clicks Disconnect before closing a window. Without this the room
    // keeps them in its roster, holding a peer connection with no one behind it.
    try { releaseCommunityWindow(communityPeerId) } catch {}
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
  // The link opens in ONE window — the one we just brought forward. Broadcasting
  // it opened the same page in every open window at once.
  const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (target) {
    if (target.isMinimized()) target.restore()
    target.focus()
  }
  const url = extractLaunchUrl(commandLine)
  if (!url) return
  const ctx = target ? appWins.get(target.webContents.id) : undefined
  if (ctx) sendTo(ctx, 'open-in-new-tab', url)
  else safelySend('open-in-new-tab', url) // no window yet — first one to load takes it
})

/**
 * Let getDisplayMedia() work inside the app.
 *
 * Chromium's own screen picker belongs to Chrome, not to embedders, so an
 * Electron app that does nothing here has getDisplayMedia() reject every call.
 * The handler below is what makes screen sharing possible at all.
 *
 * The renderer asks the user which screen or window first (community:screenSources
 * feeds that chooser) and passes the chosen id through, so the selection is
 * still a deliberate human act — this never picks a screen on the user's behalf.
 * A request with no prior choice is denied rather than defaulted to screen 0,
 * because silently sharing a whole desktop is the one outcome nobody wants.
 */
const pendingScreenShare = new Map<number, string>()

/** The renderer records the user's choice here, then calls getDisplayMedia(). */
ipcMain.handle('community:screenShareChoice', (e, sourceId: string) => {
  pendingScreenShare.set(e.sender.id, String(sourceId))
  return { ok: true }
})

function registerScreenShareHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    // Resolve the request back to the exact webContents that made it, so one
    // window's pending choice can never satisfy another window's request.
    const asker = request.frame ? electronWebContents.fromFrame(request.frame) : null
    const sourceId = asker ? pendingScreenShare.get(asker.id) : undefined
    if (asker) pendingScreenShare.delete(asker.id)

    // No prior choice means no share. Defaulting to the first screen would
    // silently hand over a whole desktop, which is the one outcome nobody wants.
    if (!sourceId) return callback(undefined as never)

    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
    const source = sources.find(s => s.id === sourceId)
    if (!source) return callback(undefined as never)

    // 'loopback' shares system audio along with a screen on Windows; it is
    // ignored where the platform cannot do it rather than failing the share.
    callback({ video: source, audio: 'loopback' })
  })
}

app.whenReady().then(() => {
  // Restore the DNS preference before the first navigation, or the session
  // would resolve its first hostnames in plaintext regardless of the setting.
  try { applyDoh(getData().settings?.dohProvider || 'off') } catch {}
  getData()
  registerAttachmentProtocol()
  registerScreenShareHandler()
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

// State lives in memory and reaches the disk on a debounce (see jsonStore), so
// quitting inside that window would drop the last few navigations or download
// rows. Flush synchronously here — 'before-quit' still runs on the main thread
// with the process alive, which an async write would not survive.
app.on('before-quit', () => {
  flushAllJsonStores()
  // The community's push queue lives in memory too, and a message sitting in it
  // when the app closes has been written to this disk and to nobody else's.
  // Fired without awaiting for the same reason the flush above is synchronous:
  // 'before-quit' will not wait for a promise, so this is a best effort that
  // usually wins the race against process exit, backed by the queue's own
  // retry on next launch when it does not.
  void shutdownCommunityBackend()
})

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


ipcMain.handle('focus:apply', (_e, blocked: string[] | null) => {
  focusBlocked = (Array.isArray(blocked) && blocked.length)
    ? blocked.map(d => String(d).replace(/^www\./, '').toLowerCase()).filter(Boolean)
    : null
  // The filter itself is installed once for the session (see
  // installRequestFilter): focus mode only publishes its list. It used to own
  // the session's single onBeforeRequest slot outright, which meant turning
  // focus mode off tore down every other blocking rule with it.
  return { ok: true }
})

// ── Ad and tracker blocking ────────────────────────────────────────────────
const adblockStats = emptyStats()
// Host of each tab's top-level document, so a request can be judged in the
// context of the page that made it (that is what makes "allow on this site"
// and the never-block-your-own-domain rule work). Kept as a map rather than
// resolved per request: onBeforeRequest runs for every subresource on the
// page, and a webContents lookup per request is real overhead on a heavy site.
const pageHostByWc = new Map<number, string>()

function notePageHost(webContentsId: number, url: string) {
  const host = hostOf(url)
  if (host) pageHostByWc.set(webContentsId, host)
}

function adblockConfig(): AdblockConfig {
  const raw = getData().settings?.adblock
  return { ...DEFAULT_ADBLOCK_CONFIG, ...(raw || {}) }
}

function saveAdblockConfig(next: Partial<AdblockConfig>) {
  const data = getData()
  data.settings = { ...data.settings, adblock: { ...adblockConfig(), ...next } }
  saveData()
  return adblockConfig()
}

function installRequestFilter(ses: Electron.Session) {
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, cb) => {
    try {
      const wcId = (details as any).webContentsId as number | undefined
      let pageHost = wcId !== undefined ? pageHostByWc.get(wcId) : undefined
      if (pageHost === undefined && wcId !== undefined) {
        // First request of a fresh document — resolve once, then it is cached
        // by the did-navigate hook.
        try { pageHost = hostOf(electronWebContents.fromId(wcId)?.getURL() || '') } catch { pageHost = '' }
        if (pageHost) pageHostByWc.set(wcId, pageHost)
      }
      const decision = decideRequest(
        { url: details.url, resourceType: details.resourceType, webContentsId: wcId },
        adblockConfig(), focusBlocked, pageHost || '', FOCUS_BLOCK_PAGE,
      )
      if (decision.redirectURL) { cb({ redirectURL: decision.redirectURL }); return }
      if (decision.cancel) {
        recordBlock(adblockStats, hostOf(details.url), wcId)
        cb({ cancel: true })
        return
      }
    } catch {}
    cb({}) // fail-open: a bug in the filter must never break browsing
  })
}

ipcMain.handle('adblock:get', () => ({
  config: adblockConfig(),
  stats: { total: adblockStats.total, topDomains: adblockStats.topDomains },
  listSize: BLOCKLIST_SIZE,
}))
ipcMain.handle('adblock:setEnabled', (_e, enabled: boolean) => saveAdblockConfig({ enabled: !!enabled }))
ipcMain.handle('adblock:countForTab', (_e, wcId: number) => adblockStats.perTab[wcId] || 0)
ipcMain.handle('adblock:toggleSite', (_e, url: string) => {
  const host = hostOf(url)
  if (!host) return adblockConfig()
  const cfg = adblockConfig()
  const allowlist = cfg.allowlist.includes(host)
    ? cfg.allowlist.filter(h => h !== host)
    : [...cfg.allowlist, host]
  return saveAdblockConfig({ allowlist })
})
ipcMain.handle('adblock:setCustom', (_e, domains: string[]) => saveAdblockConfig({
  custom: (Array.isArray(domains) ? domains : [])
    .map(d => String(d).trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase())
    .filter(Boolean),
}))

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

// ── Windows: listing, and moving tabs back between them ────────────────────
// Detaching a tab was a one-way trip: once a page had its own window there was
// no way to put it back, so a workspace that got split up stayed split up.
// Windows are addressed by the id of their renderer webContents — the same id
// every IPC event already carries, so no separate registry can drift.
function windowLabel(ctx: AppWin, index: number): string {
  try {
    const active = ctx.activeId ? ctx.views.get(ctx.activeId)?.webContents : undefined
    const title = active?.getTitle?.()
    if (title && title.trim() && !/^https?:/i.test(title)) return title.slice(0, 48)
    const url = active?.getURL?.()
    if (url) { try { return new URL(url).hostname.replace(/^www\./, '') } catch {} }
  } catch {}
  return index === 0 ? 'Main window' : `Window ${index + 1}`
}

function listWindows(callerId?: number) {
  return [...appWins.entries()]
    .filter(([, ctx]) => !ctx.win.isDestroyed())
    .map(([id, ctx], index) => ({
      id,
      label: windowLabel(ctx, index),
      tabCount: ctx.views.size,
      isCurrent: id === callerId,
    }))
}

ipcMain.handle('windows:list', (e) => listWindows(e.sender.id))

// Hand a page to another window: that window opens it, and the caller closes
// its own copy. The page reloads there rather than being transplanted —
// Electron cannot move a BrowserView between windows without tearing down its
// renderer anyway, and a reload is honest about what happens to page state.
ipcMain.handle('window:sendTabTo', (_e, targetId: number, tab: { url: string; title?: string }) => {
  const target = appWins.get(targetId)
  if (!target || target.win.isDestroyed()) return { success: false, error: 'That window is gone' }
  if (!tab?.url) return { success: false, error: 'Nothing to move' }
  try {
    sendTo(target, 'open-in-new-tab', tab.url)
    if (target.win.isMinimized()) target.win.restore()
    target.win.focus()
    return { success: true }
  } catch (err: any) { return { success: false, error: err.message } }
})

// Ask every other window to hand its tabs to this one and close itself.
ipcMain.handle('windows:mergeAllInto', (e) => {
  const targetId = e.sender.id
  let asked = 0
  for (const [id, ctx] of appWins) {
    if (id === targetId || ctx.win.isDestroyed()) continue
    sendTo(ctx, 'merge-into-window', targetId)
    asked++
  }
  return { success: true, windows: asked }
})

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
ipcMain.handle('tabs:showContextMenu', (e, info: { tabId?: string; isBrowser: boolean; hasRight: boolean; count: number; canSleep?: boolean; isActive?: boolean; isSplit?: boolean }) => {
  return new Promise<string>((resolve) => {
    let resolved = false
    const done = (action: string) => { if (!resolved) { resolved = true; resolve(action) } }
    const tabWc = info.tabId ? ctxFromEvent(e)?.views.get(info.tabId)?.webContents : undefined
    let muted = false
    try { muted = !!tabWc?.isAudioMuted() } catch {}
    const otherWindows = listWindows(e.sender.id).filter(w => !w.isCurrent)
    const menu = Menu.buildFromTemplate([
      { label: 'New Tab',                 click: () => done('new-tab') },
      { label: 'Duplicate Tab',           click: () => done('duplicate') },
      { label: info.isSplit ? 'Leave Split View' : 'Split View with This Tab',
        enabled: info.isBrowser && !info.isActive, click: () => done('split') },
      { label: 'Move Tab to New Window',  enabled: info.isBrowser, click: () => done('detach') },
      // The way back. Only shown when there is somewhere to move it to, so the
      // menu doesn't carry a permanently empty submenu.
      ...(otherWindows.length ? [{
        label: 'Move Tab to Window',
        enabled: info.isBrowser,
        submenu: otherWindows.map(w => ({
          label: `${w.label}${w.tabCount ? ` (${w.tabCount} tab${w.tabCount === 1 ? '' : 's'})` : ''}`,
          click: () => done(`move:${w.id}`),
        })),
      }] : []),
      ...(otherWindows.length ? [{ label: 'Bring All Tabs Here', click: () => done('merge-all') }] : []),
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
registerCommunityIpc()
registerFaviconIpc()

// ── IPC: Tab content views (BrowserView) ────────────────────────────────────
ipcMain.handle('tabview:create', (e, tabId: string, url: string, containerId?: string | null) =>
  createTabView(ctxFromEvent(e), tabId, url, containerId))

// ── Picture-in-picture ─────────────────────────────────────────────────────
// Chromium already implements PiP; it just needs a user gesture to start. The
// script picks the video that is actually playing (or the biggest one) so it
// works on pages with several players, and toggles rather than always opening.
ipcMain.handle('tabview:pictureInPicture', async (e, tabId: string) => {
  const wc = ctxFromEvent(e)?.views.get(tabId)?.webContents
  if (!wc) return { ok: false, error: 'No page' }
  try {
    return await wc.executeJavaScript(`(async () => {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
        return { ok: true, active: false }
      }
      const videos = [...document.querySelectorAll('video')]
      if (!videos.length) return { ok: false, error: 'No video on this page' }
      const playing = videos.filter(v => !v.paused && !v.ended && v.readyState > 2)
      const pick = (playing.length ? playing : videos)
        .sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0]
      if (!pick || pick.disablePictureInPicture) return { ok: false, error: 'This video cannot pop out' }
      await pick.requestPictureInPicture()
      return { ok: true, active: true }
    })()`, true)   // userGesture: PiP is refused without one
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Picture-in-picture failed' }
  }
})

// ── Full-page screenshot ───────────────────────────────────────────────────
// Chromium only paints what is on screen, so a scrolling capture has to walk
// the page: resize the view to the document height, capture once, restore.
// That is one image with no seams, unlike stitching viewport tiles.
ipcMain.handle('tabview:captureFullPage', async (e, tabId: string) => {
  const ctx = ctxFromEvent(e)
  const view = ctx?.views.get(tabId)
  if (!view || !ctx) return { ok: false, error: 'No page' }
  const wc = view.webContents
  const original = view.getBounds()
  try {
    const size = await wc.executeJavaScript(`({
      width: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
      height: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
    })`)
    // Cap the height: a lazy-loading feed can report a document taller than any
    // sane bitmap, and a 60000px capture would exhaust memory.
    const height = Math.min(Math.max(Math.round(size?.height || original.height), original.height), 16000)
    view.setBounds({ ...original, height })
    // Give the page a beat to paint the newly revealed area.
    await new Promise(r => setTimeout(r, 350))
    const image = await wc.capturePage()
    const buffer = image.toPNG()
    view.setBounds(original)

    const title = (wc.getTitle() || 'page').replace(/[\/:*?"<>|]/g, ' ').trim().slice(0, 60) || 'page'
    const target = join(app.getPath('pictures'), `${title} — full page.png`)
    fs.writeFileSync(target, buffer)
    notifyQuiet('Full-page screenshot saved', target)
    return { ok: true, path: target, height }
  } catch (err: any) {
    try { view.setBounds(original) } catch {}
    return { ok: false, error: err?.message || 'Capture failed' }
  }
})

// ── DNS-over-HTTPS ─────────────────────────────────────────────────────────
// Plain DNS is the last part of browsing that leaks every hostname you visit to
// whoever runs the network. Chromium can resolve over HTTPS instead; Electron
// exposes it as a host-resolver setting that must be applied before requests.
const DOH_PROVIDERS: Record<string, string> = {
  cloudflare: 'https://cloudflare-dns.com/dns-query',
  google: 'https://dns.google/dns-query',
  quad9: 'https://dns.quad9.net/dns-query',
}

function applyDoh(provider: string) {
  try {
    if (!provider || provider === 'off') {
      app.configureHostResolver({ secureDnsMode: 'off' })
      return { ok: true, provider: 'off' }
    }
    const server = DOH_PROVIDERS[provider]
    if (!server) return { ok: false, error: 'Unknown DNS provider' }
    app.configureHostResolver({ secureDnsMode: 'secure', secureDnsServers: [server] })
    return { ok: true, provider }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not configure DNS' }
  }
}

ipcMain.handle('privacy:getDoh', () => ({
  provider: getData().settings?.dohProvider || 'off',
  providers: Object.keys(DOH_PROVIDERS),
}))
ipcMain.handle('privacy:setDoh', (_e, provider: string) => {
  const res = applyDoh(provider)
  if (res.ok) {
    const data = getData()
    data.settings = { ...data.settings, dohProvider: provider }
    saveData()
  }
  return res
})

// ── IPC: Site containers ───────────────────────────────────────────────────
ipcMain.handle('containers:list', () => {
  const stored = getData().settings?.containers
  return Array.isArray(stored) && stored.length ? stored as Container[] : DEFAULT_CONTAINERS
})
ipcMain.handle('containers:add', (_e, name: string, color: string) => {
  const data = getData()
  const current: Container[] = Array.isArray(data.settings?.containers) && data.settings.containers.length
    ? data.settings.containers : DEFAULT_CONTAINERS
  const next = addContainer(current, name, color || '#6B4EFF')
  data.settings = { ...data.settings, containers: next }
  saveData()
  return next
})
ipcMain.handle('containers:remove', (_e, id: string) => {
  const data = getData()
  const current: Container[] = Array.isArray(data.settings?.containers) && data.settings.containers.length
    ? data.settings.containers : DEFAULT_CONTAINERS
  const next = removeContainer(current, id)
  data.settings = { ...data.settings, containers: next }
  saveData()
  return next
})
// Signing out of everything in one container, without touching the others.
ipcMain.handle('containers:clear', async (_e, id: string) => {
  try {
    const ses = session.fromPartition(partitionFor(id))
    await ses.clearStorageData()
    return { ok: true }
  } catch (e: any) { return { ok: false, error: e?.message } }
})
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
// What the window actually shows right now: which views are attached and the
// exact pixels each one occupies. Used to verify split view rather than trust
// that a setBounds call landed.
ipcMain.handle('tabview:getLayout', (e) => {
  const ctx = ctxFromEvent(e)
  if (!ctx) return null
  const boundsOf = (id: string | null) => {
    if (!id) return null
    const view = ctx.views.get(id)
    try { return view ? view.getBounds() : null } catch { return null }
  }
  return {
    activeId: ctx.activeId,
    splitId: ctx.splitId,
    ratio: ctx.splitRatio,
    content: ctx.bounds,
    attached: ctx.win.getBrowserViews().length,
    primary: boundsOf(ctx.activeId),
    secondary: boundsOf(ctx.splitId),
  }
})

ipcMain.handle('tabview:setSplit', (e, tabId: string | null, ratio?: number) => {
  const ctx = ctxFromEvent(e); if (!ctx) return
  ctx.splitId = tabId && ctx.views.has(tabId) ? tabId : null
  if (typeof ratio === 'number' && isFinite(ratio)) ctx.splitRatio = Math.min(0.8, Math.max(0.2, ratio))
  syncActiveBrowserView(ctx)
  return { split: ctx.splitId, ratio: ctx.splitRatio }
})
ipcMain.handle('tabview:setOverlayHidden', (e, hidden: boolean) => {
  const ctx = ctxFromEvent(e); if (!ctx) return
  ctx.overlayHidden = hidden
  syncActiveBrowserView(ctx)
})
ipcMain.handle('tabview:navigate', (e, tabId: string, url: string) => {
  try { ctxFromEvent(e)?.views.get(tabId)?.webContents.loadURL(url) } catch {}
})
ipcMain.handle('tabview:stop', (e, tabId: string) => {
  try { ctxFromEvent(e)?.views.get(tabId)?.webContents.stop() } catch {}
})
// Warm DNS + TCP + TLS for a host before the page is actually asked for. The
// renderer fires this the moment a navigation is requested, so the handshake
// overlaps the React re-render and BrowserView creation that follow instead of
// happening after them. Purely additive — a failed preconnect costs nothing.
ipcMain.handle('tabview:preconnect', (_e, url: string) => {
  try {
    const origin = new URL(url).origin
    session.fromPartition('persist:main').preconnect({ url: origin, numSockets: 2 })
  } catch {}
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
  const d = getData()
  const bm = d.bookmarks.find((b: any) => b.id === id)
  // Refused here rather than only in the UI, so no other caller — the sphere,
  // the agent tools, a future import/sync — can drop a protected bookmark.
  if (bm && UNDELETABLE_BOOKMARK_URLS.includes(bm.url)) return false
  d.bookmarks = d.bookmarks.filter((b: any) => b.id !== id); saveData(); return true
})
ipcMain.handle('bookmarks:update', (_e, id: string, u: any) => {
  const d = getData(); const i = d.bookmarks.findIndex((b: any) => b.id === id)
  if (i !== -1) d.bookmarks[i] = { ...d.bookmarks[i], ...u }; saveData(); return d.bookmarks[i]
})

// ── IPC: History ───────────────────────────────────────────────────────────
// history:add runs on EVERY navigation. Re-reading and rewriting the whole
// 2000-entry file each time cost ~9 ms of blocked main thread per page load
// (measured at the cap), which the user feels as tab-switch and typing lag
// because this thread also drives every tab's IPC and view bounds. In memory
// the same work is ~0.01 ms; the disk sees one debounced write per burst.
const HISTORY_CAP = 2000
const historyStore = createManagedJsonStore<any[]>(HIST_FILE, () => [])

ipcMain.handle('history:getAll',     () => historyStore.get())
ipcMain.handle('history:clear',      () => { historyStore.set([]); return true })
ipcMain.handle('history:deleteItem', (_e, id: string) => {
  historyStore.update(h => h.filter((x: any) => x.id !== id))
  return true
})
ipcMain.handle('history:add', (_e, entry: { url: string; title: string; favicon?: string }) => {
  if (!entry.url || entry.url === 'home' || entry.url.startsWith('aihub://')) return
  historyStore.update(h => {
    // Collapse a re-visit of the same page within 30s (reloads, redirects)
    // into one row. Scanning from the front stops at the first candidate
    // instead of walking all 2000 entries like the old filter() did.
    const now = Date.now()
    for (let i = 0; i < h.length; i++) {
      const x = h[i]
      if (now - x.timestamp >= 30000) break
      if (x.url === entry.url) { h.splice(i, 1); break }
    }
    h.unshift({ ...entry, timestamp: now, id: `h-${now}` })
    if (h.length > HISTORY_CAP) h.length = HISTORY_CAP
  })
  recordVisit(entry.url, entry.title)
  return true
})

// ── IPC: Read the chart the user is actually looking at ───────────────────
// The assistant used to answer chart questions from imagination — inventing a
// table of candles dated five months in the past. Now it reads the live page:
// symbol, timeframe, the real OHLC of the bar on screen, the quote and the
// watchlist, all of which TradingView prints as text. Levels and the plan are
// COMPUTED from those numbers (see trading/barAnalysis), never guessed.
ipcMain.handle('trading:readChart', async (e, tabId: string) => {
  const ctx = ctxFromEvent(e)
  const wc = tabId ? ctx?.views.get(tabId)?.webContents : undefined
  if (!wc) return { ok: false, error: 'No page is open in that tab' }

  let url = ''
  let title = ''
  try { url = wc.getURL(); title = wc.getTitle() } catch {}

  // Read, and give a still-rendering chart one more chance: TradingView paints
  // its legend after the data arrives, so the first look can land early.
  const readText = async () => {
    try {
      return await wc.executeJavaScript(`(() => (document.body ? document.body.innerText : '').slice(0, 20000))()`)
    } catch { return '' }
  }
  let text = await readText()
  let reading = parseTradingViewText(text, title)
  if (!reading.ohlc) {
    await new Promise(r => setTimeout(r, 1200))
    const second = await readText()
    const retry = parseTradingViewText(second, title)
    // Keep whichever read saw more — never overwrite a good bar with a blank one.
    if (retry.ohlc || (!reading.usable && retry.usable)) { text = second; reading = retry }
  }

  // ── The real series, from TradingView's own chart runtime ──
  // Page text is useless on a serious layout: the candles, fair-value gaps and
  // order blocks are painted on canvases, so innerText sees ~190 characters
  // while the screen is covered in structure. The runtime holds the same bars
  // the chart is drawing — the user's own data, their symbol, their timeframe,
  // no third-party quote.
  try {
    const runtime = normalizeRuntimeBars(await wc.executeJavaScript(READ_BARS_SCRIPT))
    if (runtime.candles.length >= 20) {
      const { exchange, ticker } = splitSymbol(runtime.symbol)
      const interval = describeResolution(runtime.resolution)
      const last = runtime.candles[runtime.candles.length - 1]
      reading = {
        ...reading,
        symbol: ticker || reading.symbol,
        exchange: exchange || reading.exchange,
        interval: interval || reading.interval,
        ohlc: { open: last.o, high: last.h, low: last.l, close: last.c },
        price: reading.price ?? last.c,
        usable: true,
      }

      // With real history, prior-day levels and swing structure are computable
      // — the analysis one bar could never support.
      const daily = isDailyOrHigher(runtime.resolution) ? runtime.candles : toDailyCandles(runtime.candles)
      const levelSet = buildLevels(runtime.candles, daily)
      const plan = buildTradePlan(levelSet)
      const trend = trendContext(runtime.candles)
      // "No trend, wait" is true and useless on its own. When structure has not
      // confirmed a direction, give BOTH sides: which level triggers each, where
      // the stop goes, and what it pays.
      const bracket = plan.direction === 'none' ? buildBracketPlan(levelSet) : []

      let shot: string | undefined
      try { shot = (await wc.capturePage()).resize({ width: 900 }).toDataURL() } catch {}

      return {
        ok: true,
        url,
        source: 'chart-runtime',
        reading,
        summary: describeReading(reading),
        analysis: {
          bias: levelSet.bias,
          levels: levelSet.levels,
          plan,
          atr: levelSet.atr,
          digits: levelSet.digits,
          barsRead: runtime.candles.length,
          trend,
          bracket,
          reasoning: `Market structure across ${runtime.candles.length} ${reading.interval || ''} bars read from your chart. ${trend.note}`,
          limits: [],
        },
        candles: runtime.candles.slice(-60),
        screenshot: shot,
        readAt: Date.now(),
      }
    }
  } catch { /* fall through to the text-based reading below */ }

  if (!reading.usable) {
    return {
      ok: false,
      isChart: isChartUrl(url),
      error: isChartUrl(url)
        ? 'The chart is still loading — give it a moment and ask again.'
        : 'The active tab is not a chart. Open the chart you want analysed, then ask again.',
    }
  }

  const analysis = analyseReading(reading)

  // A picture of exactly what was read, so the numbers can be checked against
  // the chart rather than taken on trust.
  let screenshot: string | undefined
  try {
    const image = await wc.capturePage()
    screenshot = image.resize({ width: 900 }).toDataURL()
  } catch {}

  return {
    ok: true,
    url,
    reading,
    summary: describeReading(reading),
    analysis,
    screenshot,
    readAt: Date.now(),
  }
})

// ── IPC: Export / import everything to another computer ───────────────────
// Sync keeps two machines in step continuously; this is the file you carry.
// Assembled here because most of it lives on disk, with the renderer handing
// over the few things that live in localStorage (custom themes and window
// styles). See src/main/backup.ts for what travels and what deliberately does
// not.
const BACKUP_LOCAL_KEYS = ['aihub-custom-themes', 'aihub-custom-window-styles', 'aihub-custom-exts']

function collectBackupSections(local: Record<string, string> | undefined): BackupSections {
  const data = getData()
  return {
    bible: readBibleMarksForBackup(),
    bibleStudy: readBibleStudy(),
    bookmarks: data.bookmarks || [],
    stickyNotes: readJson(NOTES_FILE, {}),
    siteMemory: readJson(SITE_MEMORY_FILE, {}),
    watches: getWatches(),
    extensions: readJson(EXT_FILE, { customExts: [], states: {} }),
    settings: data.settings || {},
    local: local || {},
  }
}

ipcMain.handle('backup:export', async (e, local: Record<string, string>) => {
  try {
    const backup = buildBackup(collectBackupSections(local), {
      device: os.hostname(),
      appVersion: app.getVersion(),
    })
    const res = await dialog.showSaveDialog(winFrom(e) || mainWindow!, {
      title: 'Save your AIHub backup',
      defaultPath: join(app.getPath('documents'), backupFileName()),
      filters: [{ name: 'AIHub Backup', extensions: [BACKUP_EXTENSION.replace('.', '')] }],
    })
    if (res.canceled || !res.filePath) return { cancelled: true }
    // Pretty-printed: a backup is something people open, inspect and trust.
    fs.writeFileSync(res.filePath, JSON.stringify(backup, null, 2), 'utf-8')
    return { ok: true, path: res.filePath, summary: validateBackup(backup).summary }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Could not write the backup' }
  }
})

// Read and CHECK a file, returning what it holds — nothing is written yet, so
// the user confirms against real numbers before their data changes.
ipcMain.handle('backup:preview', async (e) => {
  try {
    const res = await dialog.showOpenDialog(winFrom(e) || mainWindow!, {
      title: 'Choose an AIHub backup',
      properties: ['openFile'],
      filters: [{ name: 'AIHub Backup', extensions: [BACKUP_EXTENSION.replace('.', ''), 'json'] }],
    })
    if (res.canceled || !res.filePaths[0]) return { cancelled: true }
    const raw = fs.readFileSync(res.filePaths[0], 'utf-8')
    const check = validateBackup(raw)
    if (!check.ok) return { ok: false, error: check.error }
    pendingImport = check.backup!
    return { ok: true, path: res.filePaths[0], summary: check.summary, device: check.backup!.device, createdAt: check.backup!.createdAt }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Could not read that file' }
  }
})

let pendingImport: ReturnType<typeof validateBackup>['backup'] = undefined

ipcMain.handle('backup:apply', (_e) => {
  if (!pendingImport) return { ok: false, error: 'Choose a backup file first' }
  const sections = pendingImport.sections || {}
  try {
    // Bible first and most carefully — it is the irreplaceable part.
    if (sections.bible) {
      const merged = mergeBibleMarks(readBibleMarksForBackup(), sections.bible)
      writeBibleMarks(merged)
    }
    if (sections.bibleStudy) {
      writeBibleStudy(mergeBibleStudy(readBibleStudy(), sections.bibleStudy))
    }

    const data = getData()
    if (sections.bookmarks?.length) {
      data.bookmarks = mergeBackupBookmarks(data.bookmarks || [], sections.bookmarks)
    }
    if (sections.settings) {
      // Imported preferences fill gaps; anything already set here wins.
      data.settings = { ...sections.settings, ...data.settings }
    }
    saveData()

    if (sections.stickyNotes) {
      writeJson(NOTES_FILE, mergeRecords(readJson(NOTES_FILE, {}), sections.stickyNotes))
      _stickyNotes = null
    }
    if (sections.siteMemory) {
      writeJson(SITE_MEMORY_FILE, mergeRecords(readJson(SITE_MEMORY_FILE, {}), sections.siteMemory))
    }
    if (sections.watches?.length) {
      const merged = mergeById(getWatches(), sections.watches, 'id')
      _watches = merged as any
      saveWatches()
    }
    if (sections.extensions) {
      const current = readJson(EXT_FILE, { customExts: [], states: {} })
      writeJson(EXT_FILE, {
        customExts: mergeById(current.customExts || [], sections.extensions.customExts || [], 'id'),
        states: mergeRecords(current.states || {}, sections.extensions.states || {}),
      })
    }

    const summary = validateBackup(pendingImport).summary
    const local = sections.local || {}
    pendingImport = undefined
    safelySend('bookmarks:changed', getData().bookmarks)
    // The renderer merges the localStorage-only parts itself and reloads.
    return { ok: true, summary, local, localKeys: BACKUP_LOCAL_KEYS }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Import failed' }
  }
})

// ── IPC: Encrypted sync over the user's own Google Drive ──────────────────
// Bookmarks and preferences are encrypted on this machine with the user's
// passphrase, then parked in Drive's hidden app-data folder. Google stores a
// blob it cannot read; another machine with the same account and passphrase
// merges it back. Everything device-specific (API keys, vault path, cookie
// jars) is filtered out before encryption — see syncCrypto.
function localSyncPayload(): SyncPayload {
  const data = getData()
  return {
    bookmarks: (data.bookmarks || []).map((b: any) => ({ ...b })),
    settings: syncableSettings(data.settings || {}),
    updatedAt: Number(data.syncUpdatedAt) || Date.now(),
  }
}

ipcMain.handle('sync:status', async () => {
  const data = getData()
  const status = {
    lastSyncAt: Number(data.settings?.lastSyncAt) || 0,
    bookmarks: (data.bookmarks || []).length,
    remote: null as null | { updatedAt: number; device: string },
    error: '' as string,
  }
  try {
    const remote = await pullSync()
    if (remote) status.remote = { updatedAt: remote.updatedAt, device: remote.device }
  } catch (e: any) {
    // Not connected to Google, or offline — a status call must not throw at the UI.
    status.error = e?.message || 'Could not reach Google Drive'
  }
  return status
})

ipcMain.handle('sync:push', async (_e, passphrase: string) => {
  try {
    if (!passphrase) return { ok: false, error: 'Enter a passphrase first' }
    const payload = { ...localSyncPayload(), updatedAt: Date.now() }
    await pushSync({
      blob: encryptJson(payload, passphrase),
      updatedAt: payload.updatedAt,
      device: os.hostname(),
    })
    const data = getData()
    data.settings = { ...data.settings, lastSyncAt: payload.updatedAt }
    saveData()
    return { ok: true, uploaded: payload.bookmarks.length, at: payload.updatedAt }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Upload failed' }
  }
})

ipcMain.handle('sync:pull', async (_e, passphrase: string) => {
  try {
    if (!passphrase) return { ok: false, error: 'Enter a passphrase first' }
    const remote = await pullSync()
    if (!remote) return { ok: false, error: 'Nothing has been synced from any device yet' }

    let decrypted: SyncPayload
    try {
      decrypted = decryptJson<SyncPayload>(remote.blob, passphrase)
    } catch {
      // GCM authentication failed: wrong passphrase, or the file was altered.
      return { ok: false, error: 'That passphrase does not open the synced file' }
    }

    const merged = mergePayloads(localSyncPayload(), decrypted)
    const data = getData()
    data.bookmarks = merged.bookmarks
    data.settings = { ...data.settings, ...merged.settings, lastSyncAt: Date.now() }
    data.syncUpdatedAt = merged.updatedAt
    saveData()
    safelySend('bookmarks:changed', data.bookmarks)
    return { ok: true, bookmarks: merged.bookmarks.length, from: remote.device }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Download failed' }
  }
})

ipcMain.handle('sync:clear', async () => {
  try { await clearSync(); return { ok: true } }
  catch (e: any) { return { ok: false, error: e?.message } }
})

// ── IPC: Obsidian vault ────────────────────────────────────────────────────
// A vault is a folder of markdown files, so "integration" means writing plain
// notes into it — no plugin to install, and the vault stays readable if this
// browser disappears tomorrow.
ipcMain.handle('obsidian:status', () => {
  const vaultPath = getData().settings?.obsidianVault || ''
  return { vaultPath, ...describeVault(vaultPath) }
})

ipcMain.handle('obsidian:chooseVault', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Choose your Obsidian vault folder',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (res.canceled || !res.filePaths[0]) return { cancelled: true }
  const vaultPath = res.filePaths[0]
  const data = getData()
  data.settings = { ...data.settings, obsidianVault: vaultPath }
  saveData()
  return { vaultPath, ...describeVault(vaultPath) }
})

ipcMain.handle('obsidian:clearVault', () => {
  const data = getData()
  data.settings = { ...data.settings, obsidianVault: '' }
  saveData()
  return { vaultPath: '', exists: false, isVault: false }
})

ipcMain.handle('obsidian:save', (_e, note: {
  kind: NoteKind; title: string; url?: string; content: string; tags?: string[]
  extra?: Record<string, string | number | boolean>
}) => {
  const vaultPath = getData().settings?.obsidianVault || ''
  return writeNote(vaultPath, note)
})

// ── IPC: Conversation history ──────────────────────────────────────────────
// The assistant's chat used to live only in renderer state, so closing the app
// threw away every answer it had given. Kept on disk instead, capped so a long
// running conversation cannot grow without bound.
const CHAT_CAP = 200
const chatStore = createManagedJsonStore<{ role: string; content: string }[]>(
  join(APP_DIR, 'chat-history.json'), () => [], { debounceMs: 2500 },
)

ipcMain.handle('chat:load', () => chatStore.get())
ipcMain.handle('chat:save', (_e, messages: { role: string; content: string }[]) => {
  const clean = (Array.isArray(messages) ? messages : [])
    .filter(m => m && typeof m.content === 'string' && m.role !== 'system')
    .slice(-CHAT_CAP)
  chatStore.set(clean)
  return true
})
ipcMain.handle('chat:clear', () => { chatStore.set([]); return true })

// ── IPC: Sessions and workspaces ───────────────────────────────────────────
// The renderer owns tab state (a sleeping or crashed view still belongs in the
// session), so it publishes snapshots and the main process persists them.
const sessions = createSessionManager(APP_DIR)
// Freeze the on-disk session as "previous" before this run starts overwriting
// it — otherwise opening the app immediately destroys what you wanted back.
sessions.captureLaunchSnapshot()

ipcMain.handle('session:save', (_e, tabs: SessionTab[], activeIndex: number) => sessions.save(tabs, activeIndex))
ipcMain.handle('session:getLast', () => sessions.getLast())
ipcMain.handle('session:getPrevious', () => sessions.getPrevious())
ipcMain.handle('workspace:list', () => sessions.listWorkspaces())
ipcMain.handle('workspace:save', (_e, name: string, tabs: SessionTab[], activeIndex: number) =>
  sessions.saveWorkspace(name, tabs, activeIndex))
ipcMain.handle('workspace:get', (_e, id: string) => sessions.getWorkspace(id))
ipcMain.handle('workspace:delete', (_e, id: string) => sessions.deleteWorkspace(id))

// ── IPC: Downloads ─────────────────────────────────────────────────────────
// Progress ticks rewrite this list several times a second during a transfer;
// same in-memory + debounced-write treatment as history.
const downloadsStore = createManagedJsonStore<any[]>(DL_FILE, () => [])

ipcMain.handle('downloads:getAll',       () => {
  // A download can only be "progressing" while its BrowserView is alive. If any
  // entry is still marked progressing on read, its download died with a previous
  // app session (crash / quit mid-transfer) and will never emit 'done' — left
  // as-is it shows a spinner that buffers forever on the Downloads page. Settle
  // these stale rows to 'interrupted' once, on load.
  const raw = downloadsStore.get()
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
  if (changed) downloadsStore.set(dls)
  return dls
})
ipcMain.handle('downloads:clear',        () => { downloadsStore.set([]); return true })

// ── IPC: Page Vault ────────────────────────────────────────────
// Snapshots are taken from the live view, so capture has to run here where the
// webContents lives. Everything else is bookkeeping the renderer asks for.
const vault = createVault(APP_DIR)

ipcMain.handle('vault:list',   () => vault.list())
ipcMain.handle('vault:latestFor', (_e, url: string) => vault.latestFor(url))
ipcMain.handle('vault:remove', (_e, id: string) => vault.remove(id))
ipcMain.handle('vault:clear',  () => vault.clear())
ipcMain.handle('vault:reveal', (_e, p: string) => shell.showItemInFolder(p))

// ── IPC: PDF text ───────────────────────────────────────────────
// Chromium renders a PDF inside a plugin, so there is no DOM for the usual
// page extraction to read. The bytes are fetched again through the tab's own
// session — not a bare fetch — so a PDF behind a login is readable for exactly
// as long as the tab that is showing it is.
ipcMain.handle('pdf:extract', async (_e, url: string) => {
  const target = String(url || '')
  try {
    let bytes: Uint8Array
    if (target.startsWith('file://')) {
      bytes = new Uint8Array(fs.readFileSync(fileURLToPath(target)))
    } else if (/^https?:/i.test(target)) {
      const res = await session.fromPartition('persist:main').fetch(target)
      if (!res.ok) return { ok: false, error: `The server returned ${res.status}.` }
      bytes = new Uint8Array(await res.arrayBuffer())
    } else {
      return { ok: false, error: 'Not a fetchable address.' }
    }

    if (!looksLikePdf(bytes)) return { ok: false, error: 'That file is not a PDF.' }
    const out = extractPdfText(bytes)
    if (!out.text) {
      // Say which kind of nothing this is. "No text" reads as a bug; "this is
      // a scan" is a fact the user can act on.
      return {
        ok: false,
        error: out.encrypted
          ? 'This PDF is encrypted, so its text cannot be read.'
          : 'This PDF has no text layer — it is almost certainly a scan.',
        encrypted: out.encrypted,
      }
    }
    return { ok: true, text: out.text, streams: out.streams, decoded: out.decoded }
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) }
  }
})

/**
 * Archive what a tab is showing right now. Returns the snapshot, or null when
 * the page was not eligible or the capture failed — callers treat a null as
 * "no copy was taken", never as an error, because the action that triggered
 * this (bookmarking) must succeed either way.
 */
ipcMain.handle('vault:capture', async (e, args: { tabId: string; url: string; title?: string; favicon?: string; origin?: 'auto' | 'manual' }) => {
  const wc = ctxFromEvent(e)?.views.get(args?.tabId)?.webContents
  if (!wc || wc.isDestroyed()) return null
  try {
    return await vault.capture(wc, {
      url: args.url || wc.getURL(),
      title: args.title,
      favicon: args.favicon,
      origin: args.origin,
    })
  } catch { return null }
})

/**
 * Open a snapshot in the tab that asked for it. The file:// load is what makes
 * a dead bookmark usable again — Chromium renders .mhtml natively, so the
 * archived page comes back with its layout, images and links intact.
 */
ipcMain.handle('vault:open', (e, args: { tabId: string; id: string }) => {
  const snap = vault.list().find(s => s.id === args?.id)
  if (!snap) return { success: false, error: 'That snapshot is gone.' }
  if (!fs.existsSync(snap.path)) {
    vault.remove(snap.id)
    return { success: false, error: 'The snapshot file was deleted from disk.' }
  }
  const wc = ctxFromEvent(e)?.views.get(args.tabId)?.webContents
  if (!wc || wc.isDestroyed()) return { success: false, error: 'No tab to open it in.' }
  try {
    wc.loadURL(pathToFileURL(snap.path).toString())
    return { success: true, url: snap.url, title: snap.title, createdAt: snap.createdAt }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
})

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

// Expose the resolved AI config so Settings page can show current values.
//
// The API key is NEVER returned in full. The main process is this app's
// backend — it is the only place that should hold the secret — and handing the
// raw key to the renderer put it one XSS or one devtools session away from a
// page's reach for no benefit: Settings only ever needs to show that a key is
// present, and a new one is always typed in fresh.
ipcMain.handle('settings:getAIConfig', () => {
  const cfg = getAIConfig()
  const s   = getData().settings
  return {
    hasKey:          !!cfg.orKey,
    openrouterBase:  s.openrouterBase  || '',
    openrouterModel: s.openrouterModel || '',
    ollamaUrl:       s.ollamaUrl       || '',
    // Provider routing
    primaryProvider:  s.primaryProvider  === 'openrouter' ? 'openrouter' : 'ollama',
    fallbackEnabled:  s.fallbackEnabled !== false,
    fallbackProvider: s.fallbackProvider === 'none' ? 'none' : s.fallbackProvider === 'ollama' ? 'ollama' : 'openrouter',
    // Resolved values (from env or settings) — shown as placeholders
    // Enough to tell WHICH key is loaded, not enough to be one. A leading
    // slice showed the first 12 characters, which is more of the secret than
    // any UI needs — the last four identify it just as well.
    resolvedKey:     cfg.orKey  ? '••••••••' + cfg.orKey.slice(-4) : '',
    resolvedModel:   cfg.orMdl,
    resolvedOllama:  cfg.olBase,
  }
})
ipcMain.handle('settings:setAIConfig', (_e, cfg: {
  openrouterKey?: string; openrouterBase?: string; openrouterModel?: string; ollamaUrl?: string
  primaryProvider?: string; fallbackEnabled?: boolean; fallbackProvider?: string
}) => {
  const d = getData()
  // An empty key means "leave it alone", not "erase it" — Settings never
  // receives the current key, so it cannot send it back unchanged.
  const patch: any = { ...cfg }
  if (!cfg.openrouterKey) delete patch.openrouterKey
  d.settings = { ...d.settings, ...patch }
  saveData()
  _data = null // flush cache so getAIConfig() picks up new values immediately
  getData()
})

// ── IPC: OpenRouter model catalog ──────────────────────────────────────────
// Dynamic, never hardcoded (§44): the free tier is re-cut without notice, so
// the app asks OpenRouter what exists rather than shipping a list that rots.
// `refresh` is the Settings button; everything else reads the 15-minute cache.
ipcMain.handle('ai:models', async (_e, opts?: { filter?: ModelFilter; refresh?: boolean }) => {
  const { orBase, orMdl } = getAIConfig()
  const all = await getOpenRouterCatalog(orBase, !!opts?.refresh)
  const models = filterModels(all, opts?.filter || 'all')
  return {
    models,
    total: all.length,
    freeCount: all.filter(m => m.free).length,
    // A failed fetch must not destroy the user's configuration (§33) — the
    // UI shows a "couldn't refresh" note and keeps the saved selection.
    stale: all.length === 0,
    selected: orMdl,
    // §32: a selection that has since been retired is flagged, not silently
    // swapped — the user decides what replaces it.
    selectedDeprecated: all.some(m => m.id === orMdl && m.deprecated),
    selectedMissing: !catalogHasModel(all, orMdl),
    freeAutoId: OPENROUTER_FREE_AUTO,
  }
})

// What the Settings page shows as the live routing summary (§23).
ipcMain.handle('ai:routing', async () => {
  const { orKey } = getAIConfig()
  const s = getRoutingSettings()
  const ol = await checkOllamaRunning()
  return {
    ...s,
    ollamaAvailable: ol.running,
    ollamaModels: ol.models,
    openRouterConfigured: !!orKey,
  }
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

// ── Meaning-based search over the Rewind archive ───────────────────────────
// Embeddings come from the user's own Ollama, so page text never leaves the
// machine. Two model attempts: the purpose-built embedding model first, then
// whatever chat model is configured — Ollama exposes /api/embeddings for both,
// and asking the user to pull a second model before search works would make
// the feature invisible on most installs.
const EMBED_MODELS = ['nomic-embed-text', 'all-minilm']
let embedModel: string | null = null

async function ollamaEmbed(text: string): Promise<number[] | null> {
  const { olBase } = getAIConfig()
  const candidates = embedModel ? [embedModel] : [...EMBED_MODELS, getData().settings?.aiModel || 'llama3.2:3b']
  for (const model of candidates) {
    try {
      const res = await axios.post(`${olBase}/api/embeddings`, { model, prompt: text }, { timeout: 20000 })
      const vector = res.data?.embedding
      if (Array.isArray(vector) && vector.length) { embedModel = model; return vector }
    } catch {
      // Model missing or Ollama not running — try the next candidate.
    }
  }
  return null
}

const semanticIndex = createSemanticIndex(APP_DIR, ollamaEmbed)

const rewindDocs = (): SearchDoc[] =>
  getRewind().map(e => ({ id: e.id, title: e.title, url: e.url, text: e.text, ts: e.ts }))

ipcMain.handle('rewind:smartSearch', async (_e, query: string) => {
  const docs = rewindDocs()
  const { results, semantic } = await semanticIndex.search(String(query || ''), docs)
  const byId = new Map(docs.map(d => [d.id, d]))
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
  const entries = getRewind()
  return {
    semantic,
    results: results.map(r => {
      const entry = entries.find(e => e.id === r.id)
      const doc = byId.get(r.id)
      if (!entry || !doc) return null
      return { ...rewindListItem(entry, rewindSnippet(entry.text, terms)), via: r.via }
    }).filter(Boolean),
  }
})

ipcMain.handle('semantic:stats', () => ({ ...semanticIndex.stats(), total: getRewind().length }))

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
    // Queue the page for background embedding. No-op when Ollama is absent.
    const saved = store.find(e => e.url === entry.url)
    if (saved) semanticIndex.index({ id: saved.id, title: saved.title, url: saved.url, text: saved.text, ts: saved.ts })
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
ipcMain.handle('rewind:clear', () => {
  _rewind = []; writeJson(REWIND_FILE, [])
  semanticIndex.prune(new Set())
  return { ok: true }
})

// ── Bible marks — highlights, saved verses, notes, reading position ────────
interface BibleMarks {
  highlights: Record<string, string>
  saved: { ref: string; ts: number }[]
  notes: Record<string, string>
  lastRead: { book: string; chapter: number } | null
}
const BIBLE_MARKS_FILE = join(APP_DIR, 'bible-marks.json')

// A reader's highlights, notes and saved verses are the one thing in this app
// they cannot recreate, so this store is deliberately more careful than the
// others. Three things could destroy it before:
//   1. writeJson truncates in place — a crash mid-write left corrupt JSON;
//   2. a corrupt file parsed as "empty", and the next save wrote that emptiness
//      back over the only copy;
//   3. a failed load looked identical to "nothing saved yet" to the renderer.
// Writes are now atomic with a rotating backup, and an empty write over
// existing data is refused unless the caller says it means it.
const BIBLE_MARKS_BAK = `${BIBLE_MARKS_FILE}.bak`

const EMPTY_BIBLE_MARKS = (): BibleMarks => ({ highlights: {}, saved: [], notes: {}, lastRead: null })

function normaliseMarks(stored: any): BibleMarks | null {
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return null
  return {
    highlights: stored.highlights ?? {},
    saved:      Array.isArray(stored.saved) ? stored.saved : [],
    notes:      stored.notes ?? {},
    lastRead:   stored.lastRead ?? null,
  }
}

function marksHaveContent(m: BibleMarks): boolean {
  return Object.keys(m.highlights).length > 0 || m.saved.length > 0 || Object.keys(m.notes).length > 0
}

// `status` lets the renderer tell "nothing saved yet" (safe to write) apart
// from "couldn't read your data" (never write, or we'd erase it).

// Read the marks the way bible:getMarks does, including the backup fallback —
// an import must never merge onto a "blank" reading of a file that is merely
// unreadable this second, or it would look like nothing existed here.
function readBibleMarksForBackup(): BibleMarks {
  const readFile = (f: string): BibleMarks | null => {
    try { return normaliseMarks(JSON.parse(fs.readFileSync(f, 'utf-8'))) } catch { return null }
  }
  return (fs.existsSync(BIBLE_MARKS_FILE) ? readFile(BIBLE_MARKS_FILE) : null)
    || (fs.existsSync(BIBLE_MARKS_BAK) ? readFile(BIBLE_MARKS_BAK) : null)
    || EMPTY_BIBLE_MARKS()
}

// The same atomic write bible:setMarks uses: previous good copy kept as the
// backup, temp file renamed into place.
function writeBibleMarks(next: BibleMarks): void {
  ensureDir()
  if (fs.existsSync(BIBLE_MARKS_FILE)) {
    try { fs.copyFileSync(BIBLE_MARKS_FILE, BIBLE_MARKS_BAK) } catch {}
  }
  const tmp = `${BIBLE_MARKS_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2))
  fs.renameSync(tmp, BIBLE_MARKS_FILE)
}

ipcMain.handle('bible:getMarks', (): BibleMarks & { status: 'ok' | 'empty' | 'unreadable' } => {
  const readFile = (f: string): BibleMarks | null => {
    try { return normaliseMarks(JSON.parse(fs.readFileSync(f, 'utf-8'))) } catch { return null }
  }
  const primaryExists = fs.existsSync(BIBLE_MARKS_FILE)
  if (!primaryExists && !fs.existsSync(BIBLE_MARKS_BAK)) {
    return { ...EMPTY_BIBLE_MARKS(), status: 'empty' }   // first run
  }
  const primary = primaryExists ? readFile(BIBLE_MARKS_FILE) : null
  if (primary) return { ...primary, status: 'ok' }

  // Primary is missing or corrupt but something was there — fall back to the
  // last known-good copy and put it back as the primary.
  const backup = readFile(BIBLE_MARKS_BAK)
  if (backup) {
    try { fs.copyFileSync(BIBLE_MARKS_BAK, BIBLE_MARKS_FILE) } catch {}
    console.warn('[aihub] bible marks recovered from backup')
    return { ...backup, status: 'ok' }
  }
  console.warn('[aihub] bible marks unreadable and no usable backup')
  return { ...EMPTY_BIBLE_MARKS(), status: 'unreadable' }
})

// TEMP debug — removed before release.
ipcMain.handle('debug:write', (_e, name: string, data: string) => {
  try { fs.writeFileSync(join(APP_DIR, `debug-${name}.txt`), String(data)) } catch {}
})

// ── Bible study progress ──────────────────────────────────────────────────
// Deliberately its own file, not another key inside bible-marks.json. The two
// have different blast radii: losing a drill queue is an annoyance, losing a
// year of highlights and notes is unrecoverable. Keeping them apart means a
// corrupt study file cannot take the marks down with it, and clearing the
// reader's marks does not wipe out what they have memorised.
const BIBLE_STUDY_FILE = join(APP_DIR, 'bible-study.json')
const BIBLE_STUDY_BAK  = `${BIBLE_STUDY_FILE}.bak`

function normaliseStudy(stored: any): BibleStudyData | null {
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return null
  const streak = stored.streak && typeof stored.streak === 'object' ? stored.streak : {}
  return {
    verses:  stored.verses  && typeof stored.verses  === 'object' ? stored.verses  : {},
    lessons: stored.lessons && typeof stored.lessons === 'object' ? stored.lessons : {},
    streak: {
      days: Array.isArray(streak.days) ? streak.days.filter((d: any) => typeof d === 'string') : [],
      best: Number(streak.best) || 0,
    },
    badges: Array.isArray(stored.badges) ? stored.badges.filter((b: any) => typeof b === 'string') : [],
    plans:  stored.plans && typeof stored.plans === 'object' ? stored.plans : {},
  }
}

function readBibleStudy(): BibleStudyData {
  const readFile = (f: string): BibleStudyData | null => {
    try { return normaliseStudy(JSON.parse(fs.readFileSync(f, 'utf-8'))) } catch { return null }
  }
  return (fs.existsSync(BIBLE_STUDY_FILE) ? readFile(BIBLE_STUDY_FILE) : null)
    || (fs.existsSync(BIBLE_STUDY_BAK) ? readFile(BIBLE_STUDY_BAK) : null)
    || EMPTY_BIBLE_STUDY()
}

function writeBibleStudy(next: BibleStudyData): void {
  ensureDir()
  if (fs.existsSync(BIBLE_STUDY_FILE)) {
    try { fs.copyFileSync(BIBLE_STUDY_FILE, BIBLE_STUDY_BAK) } catch {}
  }
  const tmp = `${BIBLE_STUDY_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2))
  fs.renameSync(tmp, BIBLE_STUDY_FILE)
}

// -- Gospel room: YouTube search without a key --------------------------------
// The renderer cannot fetch youtube.com itself, so the fetch happens here and
// only the parsed list crosses the boundary. Nothing about the user goes with
// it: no cookies, no referrer, no account -- it is the request a signed-out
// visitor would make.
//
// Results are cached for a while. Paging or shuffling re-queries otherwise,
// and hammering search from a desktop app is both rude and a fast way to be
// rate-limited into an empty room.
const gospelCache = new Map<string, { at: number; videos: YouTubeVideo[] }>()
const GOSPEL_TTL_MS = 15 * 60 * 1000

ipcMain.handle('gospel:search', async (_e, query?: string) => {
  const q = (typeof query === 'string' && query.trim())
    ? query.trim()
    : GOSPEL_QUERIES[Math.floor(Math.random() * GOSPEL_QUERIES.length)]

  const cached = gospelCache.get(q)
  if (cached && Date.now() - cached.at < GOSPEL_TTL_MS) {
    return { ok: true, query: q, videos: cached.videos, cached: true }
  }

  try {
    const { status, body } = await withNetRetry(() => httpGet(searchUrl(q), 12000), 2, 600)
    if (status !== 200) return { ok: false, query: q, videos: [], error: `HTTP ${status}` }
    const videos = parseSearchResults(body, 40)
    // An empty parse on a 200 means the page shape changed, which is a very
    // different problem from being offline and worth reporting differently.
    if (!videos.length) return { ok: false, query: q, videos: [], error: 'no-results' }
    gospelCache.set(q, { at: Date.now(), videos })
    return { ok: true, query: q, videos, cached: false }
  } catch (e: any) {
    return { ok: false, query: q, videos: [], error: e?.message || 'network' }
  }
})

ipcMain.handle('bible:getStudy', (): BibleStudyData & { status: 'ok' | 'empty' | 'unreadable' } => {
  const readFile = (f: string): BibleStudyData | null => {
    try { return normaliseStudy(JSON.parse(fs.readFileSync(f, 'utf-8'))) } catch { return null }
  }
  const primaryExists = fs.existsSync(BIBLE_STUDY_FILE)
  if (!primaryExists && !fs.existsSync(BIBLE_STUDY_BAK)) {
    return { ...EMPTY_BIBLE_STUDY(), status: 'empty' }
  }
  const primary = primaryExists ? readFile(BIBLE_STUDY_FILE) : null
  if (primary) return { ...primary, status: 'ok' }

  const backup = readFile(BIBLE_STUDY_BAK)
  if (backup) {
    try { fs.copyFileSync(BIBLE_STUDY_BAK, BIBLE_STUDY_FILE) } catch {}
    console.warn('[aihub] bible study progress recovered from backup')
    return { ...backup, status: 'ok' }
  }
  console.warn('[aihub] bible study progress unreadable and no usable backup')
  return { ...EMPTY_BIBLE_STUDY(), status: 'unreadable' }
})

ipcMain.handle('bible:setStudy', (_e, study: BibleStudyData, opts?: { allowEmpty?: boolean }) => {
  const next = normaliseStudy(study)
  if (!next) return { ok: false, error: 'bad-shape' }

  // Same guard as the marks file: never let a renderer that started from a
  // blank slate persist that blankness over real progress.
  if (!opts?.allowEmpty && !studyHasContent(next)) {
    const current = (() => {
      try { return normaliseStudy(JSON.parse(fs.readFileSync(BIBLE_STUDY_FILE, 'utf-8'))) } catch { return null }
    })()
    if (current && studyHasContent(current)) {
      console.warn('[aihub] refused an empty bible-study write over existing progress')
      return { ok: false, error: 'refused-empty' }
    }
  }

  try {
    writeBibleStudy(next)
  } catch (e: any) {
    return { ok: false, error: e?.message || 'write-failed' }
  }
  return { ok: true }
})

ipcMain.handle('bible:setMarks', (_e, marks: BibleMarks, opts?: { allowEmpty?: boolean }) => {
  const next = normaliseMarks(marks)
  if (!next) return { ok: false, error: 'bad-shape' }

  // Refuse to erase real data unless this is a deliberate "clear all". Guards
  // against a renderer that started from a blank slate after a failed load and
  // would otherwise persist that blankness over the only copy.
  if (!opts?.allowEmpty && !marksHaveContent(next)) {
    const current = (() => {
      try { return normaliseMarks(JSON.parse(fs.readFileSync(BIBLE_MARKS_FILE, 'utf-8'))) } catch { return null }
    })()
    if (current && marksHaveContent(current)) {
      console.warn('[aihub] refused an empty bible-marks write over existing data')
      return { ok: false, error: 'refused-empty' }
    }
  }

  try {
    ensureDir()
    // Keep the previous good file as the backup, then write atomically: a
    // crash can now only lose the temp file, never the real one.
    if (fs.existsSync(BIBLE_MARKS_FILE)) {
      try { fs.copyFileSync(BIBLE_MARKS_FILE, BIBLE_MARKS_BAK) } catch {}
    }
    const tmp = `${BIBLE_MARKS_FILE}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2))
    fs.renameSync(tmp, BIBLE_MARKS_FILE)
  } catch (e: any) {
    return { ok: false, error: e?.message || 'write-failed' }
  }
  return { ok: true }
})

// Opens a URL in the user's real, out-of-app browser (or mail client for
// mailto:) via shell.openExternal — never a BrowserWindow/WebView, so it
// can't be used to navigate the app shell itself. Scheme-checked so a
// malformed or injected value (e.g. a verse containing stray characters)
// can never reach shell.openExternal with something other than a web link
// or a mailto: compose.
ipcMain.handle('shell:openExternal', (_e, url: string) => {
  if (typeof url !== 'string') return
  // Parse with the WHATWG URL constructor rather than a hand-rolled regex —
  // it rejects UNC paths and tolerates the leading/embedded whitespace the
  // spec strips before parsing, so we don't have to. One thing it does NOT
  // reject on its own: for "special" schemes (http/https) it silently
  // rewrites a schemeless-slash input like "https:evil" into
  // "https://evil/", so a bare protocol-allowlist check would let it back
  // in. Guard against that by requiring "//" to already be present right
  // after the scheme in the (whitespace-normalized) input. mailto: has no
  // authority component, so it's the one scheme allowed without "//".
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return
  }
  if (parsed.protocol === 'mailto:') {
    shell.openExternal(url)
    return
  }
  if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
    const normalized = url.replace(/[\t\n\r]/g, '').trim().toLowerCase()
    if (normalized.startsWith(`${parsed.protocol}//`)) shell.openExternal(url)
  }
})

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
  /** Text as of the last check, so a change can be described, not just flagged. */
  lastText?: string
  triggered?: boolean // currently in a fired state (until re-armed by the user)
}
// Enough of the page to diff against next time without bloating watches.json.
const WATCH_TEXT_KEEP = 20000
const WATCHES_FILE = join(APP_DIR, 'watches.json')
let _watches: Watch[] | null = null
function getWatches(): Watch[] { if (!_watches) _watches = (readJson(WATCHES_FILE, []) as Watch[]) || []; return _watches! }
function saveWatches() { writeJson(WATCHES_FILE, getWatches()); safelySend('watch:changed', null) }

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
  if (w) await checkWatch(w)
  return { ok: true }
})

async function checkWatch(w: Watch) {
  try {
    const { status, body } = await fetchHtml(w.url, 12000)
    if (status >= 400) { w.lastChecked = Date.now(); saveWatches(); return }
    const text = htmlToText(body)
    w.lastChecked = Date.now()
    if (w.mode === 'contains') {
      const hit = containsKeyword(text, w.keyword || '')
      if (hit && !w.triggered) { w.triggered = true; w.lastChanged = Date.now(); notifyWatch(w, `“${w.keyword}” appeared on the page`) }
    } else {
      // Compare NORMALISED text: hashing the raw page made every clock tick,
      // view counter and rotating token look like a change, which is what
      // turns a page watcher into something you mute. See watchDiff.
      const hash = contentHash(text)
      if (w.lastHash === undefined) {
        w.lastHash = hash
        w.lastText = text.slice(0, WATCH_TEXT_KEEP)
      } else if (hash !== w.lastHash) {
        const previousText = w.lastText || ''
        w.lastHash = hash
        w.lastText = text.slice(0, WATCH_TEXT_KEEP)
        w.lastChanged = Date.now()
        if (!w.triggered) {
          w.triggered = true
          // Say WHAT appeared, not just that something did.
          notifyWatch(w, describeChange(previousText, text))
        }
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

  // Try OpenRouter — but only if the user actually wants a cloud fallback.
  // This is a one-word classification with a URL heuristic behind it, so
  // "fallback off" has to mean off here too, not just in chat.
  const routing = getRoutingSettings()
  if (orKey && routing.fallbackEnabled && routing.fallbackProvider === 'openrouter') {
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
  // Verified against the live catalog 2026-08-06. Five of the previous eight
  // had been retired — including the default — which is how requests fell
  // through to the unsorted tail and picked a hidden-reasoning model that
  // truncated its own JSON. Instruct/code models first.
  'google/gemma-4-31b-it:free',
  'cohere/north-mini-code:free',
  'openai/gpt-oss-20b:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'inclusionai/ling-3.0-flash:free',
  'poolside/laguna-s-2.1:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
]

// ── Live OpenRouter model catalog ───────────────────────────────────────────
// The hardcoded list above is exactly the problem it warns about in its own
// comment: OpenRouter retires free-tier slugs without notice, so any fixed
// list drifts stale and starts eating 404s ("unavailable for free") that cost
// a full round-trip per dead model before falling through. Pull the live
// catalog (GET /models, no auth needed) and use it to drop retired slugs
// before we ever request them, and to pick up new free models automatically.
// Cached for 15 minutes — long enough to stay off the hot path of every chat
// request, short enough that a model added today is selectable today; Settings
// has an explicit Refresh for when that isn't soon enough. A failed/slow fetch
// degrades to the last good cache, then to the curated list — offline
// shouldn't mean "no AI", it means "can't verify, so just try" (§33).
let orModelsCache: { models: CatalogModel[]; ts: number } | null = null
const OR_MODELS_TTL = 15 * 60_000

/** Whatever is cached right now, without ever touching the network. */
function cachedOpenRouterCatalog(): CatalogModel[] {
  return orModelsCache?.models ?? []
}

/** Refresh the cache in the background if it's stale. Never awaited by a chat. */
function warmOpenRouterCatalog(orBase: string): void {
  if (orModelsCache && Date.now() - orModelsCache.ts < OR_MODELS_TTL) return
  void getOpenRouterCatalog(orBase).catch(() => {})
}

async function getOpenRouterCatalog(orBase: string, force = false): Promise<CatalogModel[]> {
  if (!force && orModelsCache && Date.now() - orModelsCache.ts < OR_MODELS_TTL) return orModelsCache.models
  try {
    const { status, body } = await httpGet(`${orBase}/models`, 6000)
    if (status !== 200) return orModelsCache?.models ?? []
    const models = normalizeModels(JSON.parse(body))
    if (models.length) orModelsCache = { models, ts: Date.now() }
    return models.length ? models : (orModelsCache?.models ?? [])
  } catch {
    return orModelsCache?.models ?? []
  }
}

async function getLiveFreeModelIds(orBase: string): Promise<string[]> {
  return (await getOpenRouterCatalog(orBase))
    .filter(m => m.free && !m.deprecated)
    .map(m => m.id)
}

// Build the ordered candidate chain for a chat request: the user's configured
// model first (if it's actually still alive), then the hand-tuned fallbacks
// filtered against the live catalog (retired ones silently drop out), then
// any other live free models as a last resort. If the catalog fetch failed
// entirely (empty, no cache), fall back to the old static behavior rather
// than refusing to try anything.
async function buildOrCandidates(orBase: string, orMdl: string, structured = false): Promise<string[]> {
  const live = await getLiveFreeModelIds(orBase)
  // Ordering lives in modelRouting so it can be tested: the tail used to be
  // the raw live list, which is how a hidden-reasoning model got picked for
  // JSON generation and truncated its own answer mid-object.
  return orderFreeModels(live, orMdl, OR_FREE_FALLBACKS, { structured })
}

// Strip reasoning tags and chat-template control tokens before returning
// content. Local models leak these constantly (<think> from DeepSeek/Qwen,
// <|channel|>/<|message|> from gpt-oss, <end_of_turn> from Gemma) and every
// one of them is plumbing the user must never see. The renderer sanitises
// again at display time — this is the first line, not the only one.
function stripThinkTags(s: string): string {
  return s
    .replace(/<(think|thinking|thought|reasoning|scratchpad)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\|[^|>]*\|>/g, ' ')
    .replace(/<\/?(?:end|start)_of_turn>|<\/?s>|<\/?(?:eos|bos|pad)>/gi, ' ')
    .replace(/(?<=\S) {2,}/g, ' ')
    .trim()
}

// Why the last candidate chain gave up, so a total failure can be explained
// precisely ("account has no credits") instead of "all models unavailable".
// Reset by ai:chat before each run.
// Counted, not flagged. A chain of ten free models can come back as a mix —
// measured on a real account: eight 429s, one 404, one 402 — and with plain
// booleans a single 402 anywhere made the whole run report "your account has
// no credits" when what actually blocked it was the daily free-model quota.
// Those need opposite actions from the user, so the majority cause wins.
// The details are kept PER KIND. A single shared slot took whichever refusal
// happened to come back first, so a run headlined "rate-limited" could quote a
// 402's "this account never purchased credits" — a quote that contradicts its
// own headline is worse than no quote at all.
const orSkip = {
  credits: 0, rateLimited: 0, restricted: 0,
  creditsDetail: '', rateDetail: '', restrictedDetail: '',
}

/** Pull `error.message` out of an OpenRouter error body, if it has one. */
function orErrorDetail(body: string): string {
  try {
    const m = JSON.parse(body)?.error?.message
    return typeof m === 'string' ? m.slice(0, 240) : ''
  } catch { return '' }
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
    // Per-model refusals (retired, no credits, rate-limited, gated to
    // approved apps) say nothing about the next candidate, so they skip to it.
    // Only an account-wide or server failure stops the chain. The mapping is
    // in openRouterCatalog so it can be tested without a socket.
    const attempt = classifyOpenRouterStatus(status)
    if (attempt.kind === 'skip') {
      switch (attempt.reason) {
        case 'credits':      orSkip.credits++;     orSkip.creditsDetail    ||= orErrorDetail(body); break
        case 'rate_limited': orSkip.rateLimited++; orSkip.rateDetail       ||= orErrorDetail(body); break
        case 'restricted':   orSkip.restricted++;  orSkip.restrictedDetail ||= orErrorDetail(body); break
        case 'missing':      break
      }
      return null
    }
    // 401 = bad key, 5xx = server error — stop chain immediately
    throw new Error(`HTTP ${status}: ${body.slice(0, 200)}`)
  } catch (e: any) {
    // withNetRetry can surface the status as a thrown Error instead; the same
    // per-model statuses have to skip here too, or the chain dies anyway.
    if (/^HTTP (402|403|404|429)/.test(e.message || '')) return null
    throw e
  }
}

// ── IPC: AI chat ──────────────────────────────────────────────────────────
// The single entry point every agent and AI feature goes through (§37) —
// nothing else in the app talks to a provider directly. WHICH provider serves
// a turn is decided in ./aiRouting against the user's settings; everything
// below is the adapter that gives that decision real sockets.
//
// Models that have already failed to produce a first token in time on this
// machine. Measured, not guessed: a model that cannot start answering here
// must never be auto-selected again this session.
const slowModels = new Set<string>()

async function runAiRequest(
  messages: any[],
  preferredModel?: string,
  opts?: { preferCloud?: boolean; needsTools?: boolean; maxTokens?: number; onDelta?: (text: string, reset?: boolean) => void },
) {
  const { olBase, orKey, orBase } = getAIConfig()
  const settings = getRoutingSettings(preferredModel)

  // preferCloud is a capability requirement from the caller, not a user
  // preference (§19): extension/theme generation needs strict JSON, which
  // small local models fumble. It flips the primary for this one request and
  // leaves the local model as the fallback, so a user with no key still gets
  // an answer rather than an error.
  if (opts?.preferCloud && orKey) {
    settings.primaryProvider  = 'openrouter'
    settings.fallbackProvider = 'ollama'
  }

  // Cache-only. Awaiting the catalog here put a network round-trip — up to 6s
  // on a cold cache — in front of every single chat message, including the
  // ones Ollama was about to answer locally in under a second. The refresh
  // runs alongside the request instead; a cold cache just means the retired-
  // model check has nothing to say yet, which costs at most one wasted
  // OpenRouter attempt and only on the fallback path.
  if (orKey) warmOpenRouterCatalog(orBase)
  const catalog = orKey ? cachedOpenRouterCatalog() : []

  let probe: { running: boolean; models: string[]; info?: OllamaModelInfo[] } = { running: false, models: [] }

  const result = await routeGenerate(settings, {
    log: line => console.log(`[aihub] ${line}`),

    ollama: {
      async health() {
        try {
          probe = await checkOllamaRunning()
          return { available: probe.running, models: probe.models }
        } catch (e: any) {
          return { available: false, models: [], error: e?.message || String(e) }
        }
      },
      async generate(model: string) {
        const configured = settings.ollamaModel
        // A turn that has to drive tools gets routed to a model that actually
        // can. Plain chat keeps whatever the user chose — no reason to make
        // "what's 2+2" wait on a 14B model.
        let chosen = model
        // A picture in the conversation overrides everything else about model
        // choice: a text-only model handed base64 does not fail loudly, it
        // confidently describes something that is not there.
        const carriesImages = hasImages(messages)
        if (carriesImages) {
          const vision = pickVisionModel(probe.models || [], configured || model)
          if (vision && vision !== chosen) {
            console.log(`[aihub] image turn: routing ${chosen || '(unset)'} → ${vision}`)
            chosen = vision
          }
        }
        if (!carriesImages && opts?.needsTools && probe.info?.length) {
          // Models this machine has already proven it cannot serve in time are
          // out of the running — on a CPU-only box a 7B upgrade turns a slow
          // answer into no answer at all.
          const usable = probe.info.filter(m => !slowModels.has(m.name))
          const agent = pickAgentModel(usable, configured)
          if (agent && agent !== chosen) {
            console.log(`[aihub] agent turn: routing ${chosen || '(unset)'} → ${agent}`)
            chosen = agent
          }
        }
        // The routed model gets one chance: if this machine can't produce a
        // first token for it in time, remember that, drop back to the model
        // the user actually configured, and answer with that instead of
        // failing the turn.
        const attempts = chosen === model ? [chosen] : [chosen, model]
        let lastError = ''
        for (const attempt of attempts) {
          // An upgrade the user did not ask for gets a shorter leash still:
          // fall back to the configured model while there is patience left,
          // rather than burning the full budget twice.
          const isRoutedUpgrade = attempts.length > 1 && attempt !== model
          try {
            // Wipe anything the previous attempt streamed before this one
            // starts, or a timed-out model's half-answer would sit spliced in
            // front of the real one.
            opts?.onDelta?.('', true)
            // Converted per attempt, because whether the pictures survive
            // depends on which model this attempt is using.
            const payload = !carriesImages ? messages
              : looksVisionCapable(attempt) ? forOllama(messages)
              : withoutImages(messages)
            const raw = await ollamaChatStream(
              olBase, attempt, payload, 120000, isRoutedUpgrade ? 60000 : 120000, opts?.onDelta,
            )
            const content = stripThinkTags(raw)
            if (content) return { ok: true as const, value: content }
            lastError = `Ollama returned an empty response (model: ${attempt})`
          } catch (e: any) {
            const msg = e?.message || String(e)
            lastError = `${msg} (model: ${attempt})`
            // A timeout is a measurement, not a mystery: this machine cannot
            // serve a model that size at this prompt length. Name the model
            // the user should switch to, or say plainly that no installed
            // model is small enough — either is actionable, "unavailable" is
            // not.
            if (/timeout/i.test(msg)) {
              const faster = suggestFasterModel(probe.info || [], attempt)
              lastError += faster
                ? `\n\n${faster} is installed and smaller — switch to it in Settings → AI.`
                : '\n\nNo smaller model is installed. Pull a lighter one (ollama pull llama3.2:3b) or use a shorter prompt.'
            }
            if (/timeout/i.test(msg) && attempt !== model) {
              slowModels.add(attempt)
              console.warn(`[aihub] ${attempt} timed out on this machine — falling back to ${model} and not routing to it again`)
              continue
            }
          }
          break
        }
        return { ok: false as const, error: lastError || 'Ollama produced no answer' }
      },
    },

    openRouter: {
      isConfigured: () => !!orKey,
      modelExists: (id: string) => catalogHasModel(catalog, id),
      async generate(model: string) {
        orSkip.credits = 0
        orSkip.rateLimited = 0
        orSkip.restricted = 0
        orSkip.creditsDetail = ''
        orSkip.rateDetail = ''
        orSkip.restrictedDetail = ''
        // The chosen model leads, then the live-verified free chain behind it.
        // A single 429 on a shared free model shouldn't end the request when
        // another free model would answer (§32).
        const candidates = [model, ...(await buildOrCandidates(orBase, model, !!opts?.preferCloud))]
        // The OpenAI parts shape, once, up front: every candidate in the chain
        // speaks it, and a model that cannot see rejects the request rather
        // than answering about an image it never received.
        const payload = hasImages(messages) ? forOpenRouter(messages) : messages
        let hardError = ''
        for (const candidate of [...new Set(candidates)]) {
          try {
            // 8192 tokens: long structured replies (extension generation emits
            // 5-10 objects with code) blow through the old 2048 default and get
            // truncated mid-JSON — same failure the Ollama path fixed via num_ctx.
            const content = await openRouterChat(orBase, orKey, candidate, payload, opts?.maxTokens ?? 8192)
            if (content) return { ok: true as const, content, model: candidate }
            // null = 402/404/429 on this model — try the next candidate.
          } catch (e: any) {
            hardError = e?.message || String(e) // 401/5xx — stop the chain
            break
          }
        }
        // Whichever refusal blocked the most candidates is the one the user
        // has to act on. Ties go to rate limiting: it is the transient cause,
        // and telling someone to buy credits they may already have is worse
        // than telling them to wait.
        const failure: OpenRouterFailure = hardError
          ? { kind: 'error', message: hardError }
          : summarizeOpenRouterSkips(orSkip)
        return { ok: false as const, failure }
      },
    },
  })

  // The renderer sees the same shape it always did, plus honest routing
  // metadata (§24) — a fallback answer is never passed off as the primary's.
  if (result.ok) {
    return {
      content: result.content,
      model: result.model,
      provider: result.provider,
      fallbackUsed: result.fallbackUsed,
      ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
      ...(result.notice ? { notice: result.notice } : {}),
    }
  }
  return {
    content: result.content,
    model: 'none',
    provider: 'none',
    fallbackUsed: result.fallbackUsed,
    ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
  }
}

// Tokens are batched before they cross the IPC boundary. A local model emits
// them faster than the renderer can usefully re-render, and one message per
// token turns a fluent stream into thousands of round-trips that make the UI
// slower, not faster. ~60ms is below the threshold where text stops looking
// live and well above per-token cost.
const STREAM_FLUSH_MS = 60

ipcMain.handle('ai:chat', async (
  e, messages: any[], preferredModel?: string,
  opts?: { preferCloud?: boolean; needsTools?: boolean; streamId?: string },
) => {
  const streamId = opts?.streamId
  if (!streamId) return runAiRequest(messages, preferredModel, opts)

  const sender = e.sender
  let pending = ''
  let timer: NodeJS.Timeout | null = null
  const flush = () => {
    timer = null
    if (!pending) return
    const delta = pending
    pending = ''
    try { if (!sender.isDestroyed()) sender.send('ai:chunk', { streamId, delta }) } catch {}
  }
  const onDelta = (text: string, reset?: boolean) => {
    if (reset) {
      pending = ''
      if (timer) { clearTimeout(timer); timer = null }
      try { if (!sender.isDestroyed()) sender.send('ai:chunk', { streamId, reset: true }) } catch {}
      return
    }
    pending += text
    if (!timer) timer = setTimeout(flush, STREAM_FLUSH_MS)
  }

  try {
    return await runAiRequest(messages, preferredModel, { ...opts, onDelta })
  } finally {
    if (timer) clearTimeout(timer)
    flush()
    try { if (!sender.isDestroyed()) sender.send('ai:chunk', { streamId, done: true }) } catch {}
  }
})

// ── IPC: AI summarize ─────────────────────────────────────────────────────
ipcMain.handle('ai:summarizePage', async (_e, pageText: string, url: string) => {
  // Build prompt — use real extracted page text if available, else URL-based summary
  const userContent = pageText && pageText.length > 100
    ? `Summarize the following web page content in 3-5 concise bullet points. Focus on key takeaways, what the page is about, and who it's for.\n\nURL: ${url}\n\nPAGE CONTENT:\n${pageText.slice(0, 6000)}`
    : `Summarize the website at ${url} in 3-5 concise bullet points. Focus on what it does and who it's for.`

  // Same router as every other AI feature (§37) — summarizing used to carry
  // its own copy of the Ollama-then-cloud logic, which meant turning fallback
  // off in Settings silently didn't apply here.
  const r = await runAiRequest([{ role: 'user', content: userContent }], undefined, { maxTokens: 800 })
  return r.provider === 'none'
    ? { summary: `Unable to summarize.\n\n${r.content}` }
    : { summary: r.content, provider: r.provider, model: r.model, fallbackUsed: r.fallbackUsed }
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

// ── PDF text extraction ────────────────────────────────────────────────────
// Resumes, cover letters and forms arrive as PDFs, so the assistant has to be
// able to read one. Done by hand for the same reason the .docx reader is: no
// dependency, and the file never leaves the machine.
//
// Handles what real documents actually use: objects packed into compressed
// object streams, per-font ToUnicode CMaps (Identity-H subsets decode to glyph
// ids without them), and layout derived from the text matrix — Word writes one
// BT/ET per styled run, so breaking lines on ET shatters every sentence.
interface PdfObj { dict: string; stream: Buffer | null }
interface PdfFont { cmap: Map<number, string> | null; twoByte: boolean }

function inflateAny(buf: Buffer): Buffer | null {
  try { return zlib.inflateSync(buf) } catch {}
  try { return zlib.inflateRawSync(buf) } catch {}
  return null
}

function pdfParseObjects(buf: Buffer): Map<number, PdfObj> {
  const objs = new Map<number, PdfObj>()
  const src = buf.toString('latin1')
  const re = /(\d+)\s+(\d+)\s+obj\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const id = parseInt(m[1], 10)
    const start = m.index + m[0].length
    const end = src.indexOf('endobj', start)
    if (end === -1) continue
    const body = src.slice(start, end)
    const sIdx = body.indexOf('stream')
    let stream: Buffer | null = null
    if (sIdx !== -1) {
      let d = start + sIdx + 6
      if (buf[d] === 0x0d) d++
      if (buf[d] === 0x0a) d++
      const e = src.indexOf('endstream', d)
      if (e !== -1) {
        const raw = buf.subarray(d, e)
        stream = /FlateDecode/.test(body.slice(0, sIdx)) ? inflateAny(raw) : raw
      }
    }
    objs.set(id, { dict: sIdx === -1 ? body : body.slice(0, sIdx), stream })
  }

  for (const [, o] of [...objs]) {
    if (!o.stream || !/\/Type\s*\/ObjStm/.test(o.dict)) continue
    const n = parseInt((o.dict.match(/\/N\s+(\d+)/) || [])[1] || '0', 10)
    const first = parseInt((o.dict.match(/\/First\s+(\d+)/) || [])[1] || '0', 10)
    const body = o.stream.toString('latin1')
    const header = body.slice(0, first).trim().split(/\s+/).map(Number)
    for (let i = 0; i < n; i++) {
      const id = header[i * 2]
      const off = header[i * 2 + 1]
      if (!Number.isFinite(id) || !Number.isFinite(off)) continue
      const nextOff = i + 1 < n ? header[(i + 1) * 2 + 1] : null
      const end = nextOff !== null ? first + nextOff : body.length
      if (!objs.has(id)) objs.set(id, { dict: body.slice(first + off, end), stream: null })
    }
  }
  return objs
}

function pdfParseCMap(text: string): Map<number, string> {
  const map = new Map<number, string>()
  const hex = (h: string) => parseInt(h, 16)
  const toStr = (h: string) => {
    let s = ''
    for (let i = 0; i + 3 < h.length + 1; i += 4) s += String.fromCharCode(parseInt(h.slice(i, i + 4), 16))
    return s || String.fromCharCode(hex(h))
  }
  let m: RegExpExecArray | null
  const charRe = /beginbfchar([\s\S]*?)endbfchar/g
  while ((m = charRe.exec(text))) {
    const pairRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g
    let p: RegExpExecArray | null
    while ((p = pairRe.exec(m[1]))) map.set(hex(p[1]), toStr(p[2]))
  }
  const rangeRe = /beginbfrange([\s\S]*?)endbfrange/g
  while ((m = rangeRe.exec(text))) {
    const body = m[1]
    let r: RegExpExecArray | null
    const simple = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g
    while ((r = simple.exec(body))) {
      const lo = hex(r[1]), hi = hex(r[2]), base = hex(r[3])
      for (let c = lo; c <= hi && c - lo < 65535; c++) map.set(c, String.fromCharCode(base + (c - lo)))
    }
    const arrayed = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([\s\S]*?)\]/g
    while ((r = arrayed.exec(body))) {
      const lo = hex(r[1])
      const items = r[3].match(/<([0-9a-fA-F]+)>/g) || []
      items.forEach((it, i) => map.set(lo + i, toStr(it.slice(1, -1))))
    }
  }
  return map
}

function pdfBuildFonts(objs: Map<number, PdfObj>): Map<string, PdfFont> {
  const byObjId = new Map<number, PdfFont>()
  for (const [id, o] of objs) {
    if (!/\/Type\s*\/Font/.test(o.dict)) continue
    const tu = o.dict.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/)
    const twoByte = /\/Encoding\s*\/Identity-[HV]/.test(o.dict) || /\/Subtype\s*\/Type0/.test(o.dict)
    let cmap: Map<number, string> | null = null
    if (tu) {
      const cm = objs.get(parseInt(tu[1], 10))
      if (cm && cm.stream) cmap = pdfParseCMap(cm.stream.toString('latin1'))
    }
    byObjId.set(id, { cmap, twoByte })
  }

  const resolveFontDict = (src: string): string | null => {
    const inline = src.match(/\/Font\s*<<([\s\S]*?)>>/)
    if (inline) return inline[1]
    const ref = src.match(/\/Font\s+(\d+)\s+\d+\s+R/)
    if (ref) { const o = objs.get(parseInt(ref[1], 10)); if (o) return o.dict }
    return null
  }

  const byName = new Map<string, PdfFont>()
  for (const [, o] of objs) {
    const fontDict = resolveFontDict(o.dict)
    if (!fontDict) continue
    const entryRe = /\/([^\s/<>]+)\s+(\d+)\s+\d+\s+R/g
    let e: RegExpExecArray | null
    while ((e = entryRe.exec(fontDict))) {
      const f = byObjId.get(parseInt(e[2], 10))
      if (f) byName.set('/' + e[1], f)
    }
  }
  if (!byName.size) {
    const withMaps = [...byObjId.values()].filter(f => f.cmap && f.cmap.size)
    if (withMaps.length) byName.set('*', withMaps[0])
  }
  return byName
}

const PDF_ESC: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }
function pdfBytesFromLiteral(s: string): number[] {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c !== '\\') { out.push(c.charCodeAt(0) & 0xff); continue }
    const n = s[++i]
    if (n === undefined) break
    if (PDF_ESC[n] !== undefined) { out.push(PDF_ESC[n].charCodeAt(0)); continue }
    if (n >= '0' && n <= '7') {
      let oct = n
      while (oct.length < 3 && s[i + 1] >= '0' && s[i + 1] <= '7') oct += s[++i]
      out.push(parseInt(oct, 8) & 0xff)
      continue
    }
    if (n === '\n') continue
    out.push(n.charCodeAt(0) & 0xff)
  }
  return out
}
function pdfBytesFromHex(h: string): number[] {
  const clean = h.replace(/[^0-9a-fA-F]/g, '')
  const out: number[] = []
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16))
  if (clean.length % 2) out.push(parseInt(clean[clean.length - 1] + '0', 16))
  return out
}

function pdfDecode(bytes: number[], font: PdfFont | null): string {
  const cmap = font && font.cmap
  if (cmap && cmap.size) {
    let out = ''
    if (font!.twoByte) {
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        const c = cmap.get((bytes[i] << 8) | bytes[i + 1])
        out += c === undefined ? '' : c
      }
    } else {
      for (const b of bytes) {
        const c = cmap.get(b)
        out += c === undefined ? String.fromCharCode(b) : c
      }
    }
    return out
  }
  if (font && font.twoByte) {
    let out = ''
    for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1])
    return out
  }
  return bytes.map(b => String.fromCharCode(b)).join('')
}

const PDF_TOKEN = /\((?:\\.|[^\\()])*\)|<[0-9a-fA-F\s]*>|\[|\]|\/[^\s/[\]<>()]+|-?\d*\.?\d+|[A-Za-z'"*]+/g

function pdfTextFromContent(content: string, fonts: Map<string, PdfFont>): string {
  let out = ''
  let stack: any[] = []
  let inArray = false
  let array: any[] = []
  let font: PdfFont | null = null
  let y: number | null = null
  let m: RegExpExecArray | null
  while ((m = PDF_TOKEN.exec(content))) {
    const t = m[0]
    if (t === '[') { inArray = true; array = []; continue }
    if (t === ']') { inArray = false; stack.push({ arr: array }); continue }
    if (t[0] === '(') { const v = { bytes: pdfBytesFromLiteral(t.slice(1, -1)) }; inArray ? array.push(v) : stack.push(v); continue }
    if (t[0] === '<') { const v = { bytes: pdfBytesFromHex(t.slice(1, -1)) }; inArray ? array.push(v) : stack.push(v); continue }
    if (/^-?\d*\.?\d+$/.test(t)) { const v = { num: parseFloat(t) }; inArray ? array.push(v) : stack.push(v); continue }
    if (t[0] === '/') { stack.push({ name: t }); continue }

    const nums = stack.filter(x => x.num !== undefined).map(x => x.num)
    switch (t) {
      case 'Tf': {
        const n = [...stack].reverse().find(x => x.name)
        if (n) font = fonts.get(n.name) || fonts.get('*') || null
        break
      }
      case 'Tj': case "'": case '"': {
        const s = [...stack].reverse().find(x => x.bytes)
        if (t !== 'Tj') out += '\n'
        if (s) out += pdfDecode(s.bytes, font)
        break
      }
      case 'TJ': {
        const a = [...stack].reverse().find(x => x.arr)
        if (a) {
          for (const el of a.arr) {
            if (el.bytes) out += pdfDecode(el.bytes, font)
            else if (el.num !== undefined && el.num < -120) out += ' '
          }
        }
        break
      }
      case 'Tm': {
        const ny = nums[nums.length - 1]
        if (ny !== undefined) { if (y !== null && Math.abs(ny - y) > 1) out += '\n'; y = ny }
        break
      }
      case 'Td': case 'TD': {
        const ty = nums[nums.length - 1]
        if (ty !== undefined) { if (Math.abs(ty) > 1) out += '\n'; if (y !== null) y += ty }
        break
      }
      case 'T*': out += '\n'; break
    }
    stack = []
  }
  return out
}

function pdfToText(buf: Buffer): string {
  const objs = pdfParseObjects(buf)
  const fonts = pdfBuildFonts(objs)
  let text = ''
  for (const [, o] of objs) {
    if (!o.stream) continue
    const c = o.stream.toString('latin1')
    if (!/\bBT\b/.test(c)) continue
    text += pdfTextFromContent(c, fonts) + '\n'
  }
  return text
    .replace(/ /g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Scanned/image-only PDFs and exotic font encodings yield glyph soup. Say so
// rather than handing the model garbage it will confidently misread.
function pdfLooksReadable(t: string): boolean {
  if (!t || t.length < 40) return false
  const letters = (t.match(/[A-Za-z]/g) || []).length
  const words = (t.match(/\b[A-Za-z]{3,}\b/g) || []).length
  return letters / t.length > 0.45 && words > 20
}

// Folders that are noise in a file search: caches, package trees, and the
// Windows app-data mountain. Skipping them keeps a home-wide search fast.
const FIND_SKIP = new Set([
  'node_modules', '.git', '.cache', 'AppData', 'Application Data', 'OneDriveTemp',
  '$RECYCLE.BIN', 'System Volume Information', '.gradle', '.m2', 'venv', '.venv',
  '__pycache__', 'Library', '.npm', '.nuget', 'go', 'AndroidStudioProjects',
])

// Search the user's folders by name. Breadth-first with hard caps on time,
// results and depth so "find my resume" answers in a moment instead of
// walking a 200 GB drive.
ipcMain.handle('agentfs:findFiles', (_e, opts: { query: string; root?: string; ext?: string; limit?: number }) => {
  const query = String(opts?.query || '').trim().toLowerCase()
  if (!query) return { error: 'query is required' }
  const rootRes = resolveAgentPath(opts?.root || os.homedir())
  if ('error' in rootRes) return rootRes

  const limit = Math.min(Math.max(parseInt(String(opts?.limit ?? 40), 10) || 40, 1), 100)
  const wantExt = opts?.ext ? String(opts.ext).toLowerCase().replace(/^\.?/, '.') : ''
  const deadline = Date.now() + 6000
  const results: { path: string; name: string; size: number; modified: number }[] = []
  const queue: { dir: string; depth: number }[] = [{ dir: rootRes.path, depth: 0 }]

  while (queue.length && results.length < limit && Date.now() < deadline) {
    const { dir, depth } = queue.shift()!
    if (depth > 6) continue
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const d of entries) {
      if (results.length >= limit || Date.now() >= deadline) break
      if (d.name.startsWith('$') || FIND_SKIP.has(d.name)) continue
      const full = join(dir, d.name)
      if (d.isDirectory()) { queue.push({ dir: full, depth: depth + 1 }); continue }
      const lower = d.name.toLowerCase()
      if (!lower.includes(query)) continue
      if (wantExt && !lower.endsWith(wantExt)) continue
      try {
        const s = fs.statSync(full)
        results.push({ path: full, name: d.name, size: s.size, modified: s.mtimeMs })
      } catch {}
    }
  }
  // Most recently touched first — "my resume" almost always means the latest one.
  results.sort((a, b) => b.modified - a.modified)
  return { query, root: rootRes.path, results, truncated: results.length >= limit }
})

// Move or rename a file — the primitive behind "organise my downloads".
ipcMain.handle('agentfs:moveFile', (_e, from: string, to: string, overwrite?: boolean) => {
  const a = resolveAgentPath(from)
  if ('error' in a) return a
  const b = resolveAgentPath(to)
  if ('error' in b) return b
  try {
    if (!fs.existsSync(a.path)) return { error: 'source file not found' }
    // A bare folder as the destination means "put it in here under its own name".
    let dest = b.path
    try { if (fs.statSync(dest).isDirectory()) dest = join(dest, basename(a.path)) } catch {}
    if (fs.existsSync(dest) && !overwrite) return { error: 'a file already exists at the destination — pass overwrite:true to replace it' }
    fs.mkdirSync(dirname(dest), { recursive: true })
    fs.renameSync(a.path, dest)
    return { ok: true, from: a.path, to: dest }
  } catch (e: any) {
    return { error: e?.message || String(e) }
  }
})

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
    if (ext === '.pdf') {
      const text = pdfToText(fs.readFileSync(r.path))
      if (!pdfLooksReadable(text)) {
        return { error: 'this PDF has no extractable text — it looks like a scan or an image-only export. Ask the user for the .docx version, or for the text pasted into chat.' }
      }
      return { path: r.path, text: text.slice(0, 60000) }
    }
    if (ext === '.doc') {
      return { error: 'cannot read legacy .doc — ask the user for a .docx or .pdf version of the document' }
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
// app.getVersion() returns the Electron binary's version when running
// unpackaged, so the baked-in package version is the honest answer in dev and
// the packaged value is used when there is one.
const APP_VERSION = app.isPackaged ? app.getVersion() : (process.env.AIHUB_VERSION || app.getVersion())

ipcMain.handle('app:info', () => ({
  version: APP_VERSION,
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
