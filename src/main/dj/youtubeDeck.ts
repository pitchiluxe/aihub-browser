/**
 * AIHub DJ — YouTube decks that sound and look like local ones.
 *
 * An embed inside the DJ page keeps its audio locked in YouTube's
 * cross-origin frame, out of reach of Web Audio. Here each YouTube deck gets
 * its own hidden window instead: a blank wrapper page that frames the
 * ordinary embed player. The DJ page captures that window like a tab
 * (`getMediaSourceId` → getUserMedia), so the song's audio runs through the
 * deck's EQ, effects, stems, meters and waveform, and its picture can be
 * shown on the console's video monitor.
 *
 * The player window itself is muted once the capture is live, so nothing is
 * heard twice. Commands and state go straight to the embed's own <video>
 * element and player API — exact position, any tempo, key lock — instead of
 * the coarse postMessage protocol an iframe embed allows.
 *
 * Every player belongs to the webContents that asked for it and is closed
 * with it. Only an 11-character YouTube video id ever reaches the window.
 */
import { BrowserWindow, ipcMain, type WebContents, type WebFrameMain } from 'electron'

/**
 * A deck's player, or its scan player: a second, silent copy of the same
 * video run at 4× so the DJ page can draw the whole waveform ahead of time.
 */
export type YtDeckId = 'A' | 'B' | 'A-scan' | 'B-scan'

export interface YtDeckState {
  ready: boolean
  t: number
  d: number
  paused: boolean
  ended: boolean
  /** YouTube player state: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued. */
  state: number
  ad: boolean
  error: string | null
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const READY_TIMEOUT_MS = 20000
const ALLOWED_FRAME_HOSTS = /(^|\.)(youtube\.com|youtube-nocookie\.com|google\.com|googlevideo\.com|ytimg\.com)$/

const WRAPPER = '<!doctype html><html><head><meta charset="utf-8"><title>AIHub DJ deck</title></head>' +
  '<body style="margin:0;background:#000;overflow:hidden">' +
  '<iframe id="f" allow="autoplay; encrypted-media" style="border:0;width:100vw;height:100vh"></iframe>' +
  '</body></html>'

interface Player {
  win: BrowserWindow
  videoId: string | null
  /** Bumped per load so a slow ready-wait for an old video gives up. */
  gen: number
}

const players = new Map<string, Player>()
const keyOf = (owner: WebContents, deck: YtDeckId) => `${owner.id}:${deck}`

function validDeck(d: unknown): d is YtDeckId {
  return d === 'A' || d === 'B' || d === 'A-scan' || d === 'B-scan'
}

/** A scan player only feeds the waveform reader: smallest picture, so YouTube streams the lightest video. */
const isScan = (d: YtDeckId) => d.endsWith('-scan')

function frameOf(p: Player): WebFrameMain | null {
  if (p.win.isDestroyed()) return null
  return p.win.webContents.mainFrame.frames[0] ?? null
}

async function inFrame<T>(p: Player, code: string): Promise<T | null> {
  const f = frameOf(p)
  if (!f) return null
  try { return (await f.executeJavaScript(code)) as T } catch { return null }
}

async function ensurePlayer(owner: WebContents, deck: YtDeckId): Promise<Player> {
  const key = keyOf(owner, deck)
  const existing = players.get(key)
  if (existing && !existing.win.isDestroyed()) return existing

  const win = new BrowserWindow({
    show: false,
    width: isScan(deck) ? 256 : 640,
    height: isScan(deck) ? 144 : 360,
    skipTaskbar: true,
    focusable: false,
    title: `AIHub DJ deck ${deck}`,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // The deck starts on the DJ's command, not on a click inside the window.
      autoplayPolicy: 'no-user-gesture-required',
      // A hidden window must keep full-rate timers and media while it plays.
      backgroundThrottling: false,
    },
  })
  const wc = win.webContents
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', e => e.preventDefault())
  wc.on('will-frame-navigate', e => {
    if (e.isMainFrame) { e.preventDefault(); return }
    try {
      if (!ALLOWED_FRAME_HOSTS.test(new URL(e.url).hostname)) e.preventDefault()
    } catch { e.preventDefault() }
  })
  // Silent until the DJ page reports a working capture (or asks for sound as a fallback).
  wc.setAudioMuted(true)
  await win.loadURL(`data:text/html;base64,${Buffer.from(WRAPPER).toString('base64')}`)

  const player: Player = { win, videoId: null, gen: 0 }
  players.set(key, player)
  win.on('closed', () => { if (players.get(key) === player) players.delete(key) })
  return player
}

function closeOwner(ownerId: number): void {
  for (const [k, p] of players) {
    if (!k.startsWith(`${ownerId}:`)) continue
    players.delete(k)
    if (!p.win.isDestroyed()) p.win.destroy()
  }
}

const STATE_JS = `(() => {
  const p = document.getElementById('movie_player')
  const v = document.querySelector('video')
  const err = document.querySelector('.ytp-error')
  const errShown = !!(err && err.offsetParent !== null)
  const ready = !!(p && typeof p.getPlayerState === 'function' && v)
  let d = 0
  try { d = (p && p.getDuration && p.getDuration()) || 0 } catch {}
  if (!d && v && isFinite(v.duration)) d = v.duration
  return {
    ready,
    t: v ? v.currentTime : 0,
    d,
    paused: v ? v.paused : true,
    ended: v ? v.ended : false,
    state: ready ? p.getPlayerState() : -1,
    ad: !!(p && p.classList && p.classList.contains('ad-showing')),
    error: errShown ? ((err.innerText || 'This YouTube video could not be played').split('\\n').filter(Boolean)[0] || '').slice(0, 160) : null,
  }
})()`

/**
 * Keep the DJ's tempo and key-lock on the <video>: YouTube's player resets
 * playbackRate on its own events (ads, quality switches), so a listener puts
 * the DJ's value back whenever it drifts.
 */
const INSTALL_JS = `(() => {
  const v = document.querySelector('video')
  if (!v) return false
  if (!document.getElementById('aihub-dj-clean')) {
    // The picture goes to the DJ's video monitor: keep YouTube's own overlays
    // (title bar, pause screen, "more videos", end cards) out of it.
    const css = document.createElement('style')
    css.id = 'aihub-dj-clean'
    css.textContent = '.ytp-chrome-top,.ytp-chrome-bottom,.ytp-gradient-top,.ytp-gradient-bottom,.ytp-pause-overlay,' +
      '.ytp-large-play-button,.ytp-bezel,.ytp-bezel-text-wrapper,.ytp-watermark,.ytp-ce-element,.html5-endscreen,' +
      '.ytp-cards-teaser,.ytp-paid-content-overlay,.ytp-impression-link,.iv-branding,.annotation{display:none!important}'
    document.head.appendChild(css)
  }
  if (!window.__aihubDj) {
    window.__aihubDj = { rate: 1, keyLock: false }
    v.addEventListener('ratechange', () => {
      const want = window.__aihubDj.rate
      if (Math.abs(v.playbackRate - want) > 0.0005) v.playbackRate = want
    })
  }
  v.preservesPitch = window.__aihubDj.keyLock
  return true
})()`

async function waitReady(p: Player, gen: number): Promise<YtDeckState | null> {
  const until = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < until && p.gen === gen && !p.win.isDestroyed()) {
    const s = await inFrame<YtDeckState>(p, STATE_JS)
    if (s?.error) return s
    if (s?.ready) {
      await inFrame(p, INSTALL_JS)
      return s
    }
    await new Promise(r => setTimeout(r, 200))
  }
  return null
}

type Command = 'play' | 'pause' | 'seek' | 'rate' | 'keyLock' | 'volume' | 'audible'

function commandJs(cmd: Command, value: unknown): string | null {
  const n = Number(value)
  switch (cmd) {
    case 'play': return `document.getElementById('movie_player')?.playVideo()`
    case 'pause': return `document.getElementById('movie_player')?.pauseVideo()`
    case 'seek':
      if (!Number.isFinite(n) || n < 0) return null
      return `document.getElementById('movie_player')?.seekTo(${n}, true)`
    case 'rate': {
      if (!Number.isFinite(n)) return null
      const r = Math.min(4, Math.max(0.25, n))
      return `(() => { const v = document.querySelector('video'); if (window.__aihubDj) window.__aihubDj.rate = ${r}; if (v) v.playbackRate = ${r} })()`
    }
    case 'keyLock': {
      const on = value === true
      return `(() => { const v = document.querySelector('video'); if (window.__aihubDj) window.__aihubDj.keyLock = ${on}; if (v) v.preservesPitch = ${on} })()`
    }
    case 'volume': {
      if (!Number.isFinite(n)) return null
      const vol = Math.round(Math.min(1, Math.max(0, n)) * 100)
      return `(() => { const p = document.getElementById('movie_player'); if (p) { p.unMute(); p.setVolume(${vol}) } })()`
    }
    default: return null
  }
}

export function registerYouTubeDeckIpc(): void {
  const owned = new Set<number>()
  const own = (wc: WebContents) => {
    if (owned.has(wc.id)) return
    owned.add(wc.id)
    const id = wc.id
    wc.once('destroyed', () => { owned.delete(id); closeOwner(id) })
  }

  ipcMain.handle('dj:yt:load', async (e, deck: unknown, videoId: unknown) => {
    if (!validDeck(deck) || typeof videoId !== 'string' || !VIDEO_ID.test(videoId)) return { ok: false, error: 'Not a YouTube video' }
    own(e.sender)
    const p = await ensurePlayer(e.sender, deck)
    const gen = ++p.gen
    p.videoId = videoId
    const url = `https://www.youtube.com/embed/${videoId}?enablejsapi=1&controls=0&disablekb=1&rel=0&playsinline=1&iv_load_policy=3&fs=0`
    try {
      await p.win.webContents.executeJavaScript(`document.getElementById('f').src = ${JSON.stringify(url)}`)
    } catch {
      return { ok: false, error: 'The YouTube player could not start' }
    }
    // Let the old frame go before polling, or its state would answer for the new one.
    await new Promise(r => setTimeout(r, 300))
    const s = await waitReady(p, gen)
    if (gen !== p.gen) return { ok: false, error: 'superseded' }
    if (!s) return { ok: false, error: 'YouTube did not answer — check the connection' }
    if (s.error) return { ok: false, error: s.error, state: s }
    return { ok: true, state: s }
  })

  /** A capture id for this deck's window, usable once by the asking page with getUserMedia. */
  ipcMain.handle('dj:yt:streamId', async (e, deck: unknown) => {
    if (!validDeck(deck)) return null
    const p = players.get(keyOf(e.sender, deck))
    if (!p || p.win.isDestroyed()) return null
    try { return p.win.webContents.getMediaSourceId(e.sender) } catch { return null }
  })

  ipcMain.handle('dj:yt:state', async (e, deck: unknown) => {
    if (!validDeck(deck)) return null
    const p = players.get(keyOf(e.sender, deck))
    if (!p || !p.videoId) return null
    return inFrame<YtDeckState>(p, STATE_JS)
  })

  ipcMain.handle('dj:yt:cmd', async (e, deck: unknown, cmd: unknown, value: unknown) => {
    if (!validDeck(deck) || typeof cmd !== 'string') return false
    const p = players.get(keyOf(e.sender, deck))
    if (!p || p.win.isDestroyed()) return false
    if (cmd === 'audible') {
      // Fallback when the page could not capture the deck: let it play out directly.
      p.win.webContents.setAudioMuted(value !== true)
      return true
    }
    const js = commandJs(cmd as Command, value)
    if (!js) return false
    await inFrame(p, js)
    return true
  })

  ipcMain.handle('dj:yt:unload', async (e, deck: unknown) => {
    if (!validDeck(deck)) return false
    const p = players.get(keyOf(e.sender, deck))
    if (!p || p.win.isDestroyed()) return false
    p.gen++
    p.videoId = null
    try { await p.win.webContents.executeJavaScript(`document.getElementById('f').src = 'about:blank'`) } catch { /* closing */ }
    return true
  })

  ipcMain.handle('dj:yt:close', (e) => { closeOwner(e.sender.id); return true })
}
