// src/main/fares/hiddenPage.ts
// Off-screen pages for reading fare sites. Isolated on their own partition so
// booking-site cookies and trackers never touch the user's browsing profile,
// sandboxed with no preload so a hostile page cannot reach the app, capped so
// a search can never pile windows into RAM (the freeze class fixed in the
// 2026-10-12 audit), and watched so a hung page cannot outlive its search.
import { BrowserWindow, session } from 'electron'

export const FARES_PARTITION = 'persist:fares'

export interface PageHandle { evaluate<T>(script: string): Promise<T>; close(): void }
export interface PageDriver { open(url: string): Promise<PageHandle>; openVisible(url: string): void; alive(): number }

export function createSemaphore(max: number) {
  let active = 0
  const waiters: (() => void)[] = []
  return {
    acquire(): Promise<() => void> {
      return new Promise(resolve => {
        const grant = () => {
          active++
          let released = false
          resolve(() => {
            if (released) return
            released = true
            active--
            waiters.shift()?.()
          })
        }
        if (active < max) grant()
        else waiters.push(grant)
      })
    },
  }
}

export function chromeUserAgent(ua: string): string {
  return ua.replace(/\s?Electron\/\S+/, '').replace(/\s?aihub-browser\/\S+/i, '').replace(/\s{2,}/g, ' ').trim()
}

export function createElectronDriver(opts: { max?: number; watchdogMs?: number } = {}): PageDriver {
  const sem = createSemaphore(opts.max ?? 3)
  const live = new Set<BrowserWindow>()
  const webPreferences = { partition: FARES_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  const ua = () => chromeUserAgent(session.fromPartition(FARES_PARTITION).getUserAgent())

  // Session-wide, installed once. Electron GRANTS permission requests by
  // default, so without these a booking site could ask for geolocation,
  // notifications or the camera and get them. Downloads are refused for the
  // same reason: nothing a fare page offers should land on disk.
  let sessionGuarded = false
  const guardSession = () => {
    if (sessionGuarded) return
    sessionGuarded = true
    const ses = session.fromPartition(FARES_PARTITION)
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
    ses.on('will-download', e => e.preventDefault())
  }
  const guardWindow = (win: BrowserWindow) => {
    win.webContents.setUserAgent(ua())
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  }

  return {
    alive: () => live.size,
    async open(url) {
      const release = await sem.acquire()
      guardSession()
      const win = new BrowserWindow({ show: false, width: 1366, height: 900, webPreferences })
      live.add(win)
      guardWindow(win)
      let closed = false
      const close = () => {
        if (closed) return
        closed = true
        clearTimeout(watchdog)
        live.delete(win)
        if (!win.isDestroyed()) win.destroy()
        release()
      }
      const watchdog = setTimeout(close, opts.watchdogMs ?? 60_000)
      // Single-page apps reject loadURL on their own redirects; the poll decides.
      win.loadURL(url).catch(() => {})
      return {
        evaluate: <T>(script: string) => win.isDestroyed()
          ? Promise.reject(new Error('page closed'))
          : (win.webContents.executeJavaScript(script, false) as Promise<T>),
        close,
      }
    },
    openVisible(url) {
      // For a human check (CAPTCHA): same partition, so solving it once
      // unblocks later hidden searches.
      guardSession()
      const win = new BrowserWindow({ show: true, width: 1200, height: 860, title: 'Verify — AIHub fares', webPreferences })
      guardWindow(win)
      win.loadURL(url).catch(() => {})
    },
  }
}
