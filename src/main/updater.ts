import { app, ipcMain, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

// Auto-update against GitHub Releases (provider configured in package.json
// build.publish). Flow: the app checks the repo's latest published release on
// startup + every few hours; if a newer version exists we notify the renderer,
// let the user choose to download, show progress, then install on quit /
// "Restart now". Nothing is downloaded or installed without the user opting in.
//
// Platform notes:
//  • Windows (NSIS) and Linux (AppImage) auto-update out of the box.
//  • macOS requires a SIGNED + notarized app (Squirrel.Mac won't update an
//    unsigned build) — current mac builds are unsigned, so on mac we simply
//    surface "a new version is available, download from the website" instead
//    of failing loudly. See docs.
//  • Disabled entirely in dev (app.isPackaged === false).

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // every 6 hours

type Send = (channel: string, ...args: any[]) => void

let started = false
let ipcRegistered = false

export function initAutoUpdater(getWindow: () => BrowserWindow | null, safelySend: Send): void {
  // IPC is always registered so the renderer can call these safely; in dev they
  // resolve to a no-op "disabled" state.
  registerIpc(safelySend)

  if (!app.isPackaged) return
  if (started) return
  started = true

  // We drive download/install manually so the user is always in control.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false

  autoUpdater.on('checking-for-update', () => safelySend('updater:event', { type: 'checking' }))
  autoUpdater.on('update-available', info =>
    safelySend('updater:event', { type: 'available', version: info.version, notes: normalizeNotes(info.releaseNotes), date: info.releaseDate })
  )
  autoUpdater.on('update-not-available', () => safelySend('updater:event', { type: 'not-available' }))
  autoUpdater.on('download-progress', p =>
    safelySend('updater:event', { type: 'progress', percent: Math.round(p.percent), bytesPerSecond: p.bytesPerSecond, transferred: p.transferred, total: p.total })
  )
  autoUpdater.on('update-downloaded', info =>
    safelySend('updater:event', { type: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', err =>
    safelySend('updater:event', { type: 'error', message: cleanError(err) })
  )

  // First check shortly after launch (let the window settle), then periodically.
  setTimeout(() => { void safeCheck() }, 15_000)
  setInterval(() => { void safeCheck() }, CHECK_INTERVAL_MS)

  void getWindow // reserved for future modal-dialog use; kept for a stable signature
}

async function safeCheck(): Promise<void> {
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    /* network offline / rate-limited / unsigned-mac — surfaced via 'error' event */
  }
}

function registerIpc(safelySend: Send): void {
  if (ipcRegistered) return // createWindow can run again on macOS 'activate'
  ipcRegistered = true

  // Manual "Check for updates" (e.g. from Settings). Returns a simple result so
  // the caller can show "you're up to date" without waiting on events.
  ipcMain.handle('updater:check', async () => {
    if (!app.isPackaged) return { ok: false, disabled: true, reason: 'dev' }
    try {
      const r = await autoUpdater.checkForUpdates()
      const current = app.getVersion()
      const latest = r?.updateInfo?.version
      return { ok: true, current, latest, updateAvailable: !!latest && latest !== current }
    } catch (e: any) {
      return { ok: false, error: cleanError(e) }
    }
  })

  // Begin downloading the available update; progress arrives via 'updater:event'.
  ipcMain.handle('updater:download', async () => {
    if (!app.isPackaged) return { ok: false, disabled: true }
    try {
      await autoUpdater.downloadUpdate()
      return { ok: true }
    } catch (e: any) {
      safelySend('updater:event', { type: 'error', message: cleanError(e) })
      return { ok: false, error: cleanError(e) }
    }
  })

  // Quit and install the downloaded update now.
  ipcMain.handle('updater:install', () => {
    if (!app.isPackaged) return { ok: false, disabled: true }
    // isSilent=false (show installer UI), forceRunAfter=true (relaunch app).
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
    return { ok: true }
  })

  ipcMain.handle('updater:getVersion', () => app.getVersion())
}

function normalizeNotes(notes: string | { note: string | null }[] | null | undefined): string {
  if (!notes) return ''
  if (typeof notes === 'string') return notes
  return notes.map(n => (typeof n === 'string' ? n : n?.note || '')).filter(Boolean).join('\n\n')
}

function cleanError(err: unknown): string {
  const msg = (err as any)?.message || String(err)
  // Common, expected cases → friendlier text.
  if (/code signature|not signed|SquirrelMac/i.test(msg)) return 'Auto-update needs a signed build on macOS — please update from the website.'
  if (/net::|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|getaddrinfo/i.test(msg)) return 'Could not reach the update server (check your connection).'
  if (/404|No published versions|latest\.yml/i.test(msg)) return 'No published release found yet.'
  return msg
}
