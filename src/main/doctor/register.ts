import { app, ipcMain, type WebContents, type IpcMainInvokeEvent } from 'electron'
import { monitorEventLoopDelay } from 'perf_hooks'
import { createDoctorModel, type ProcessSample } from '../../shared/doctor'

/**
 * AIHub Browser — Agent Doctor, the Electron side.
 *
 * Sensors, cheap enough to leave on permanently:
 *  - main-process event-loop delay (perf_hooks histogram, 20 ms resolution)
 *  - app.getAppMetrics() every 10 s: CPU and memory per Chromium process,
 *    mapped back to the tabs each renderer hosts
 *  - per-tab 'unresponsive' / 'responsive' / 'render-process-gone'
 *
 * The aihub://doctor page polls 'doctor:snapshot' while it is open; nothing
 * is pushed, so a closed page costs nothing beyond the 10 s sample.
 */

export interface DoctorWindow {
  id: number
  incognito: boolean
  activeId: string | null
  splitId: string | null
  views: Map<string, { webContents: WebContents }>
}

export interface DoctorDeps {
  windows: () => Iterable<DoctorWindow>
  /** True when the IPC sender is one of the app's own windows (never a tab). */
  isAppSender: (e: IpcMainInvokeEvent) => boolean
  intervalMs?: number
}

const PRIVATE_TITLE = 'Private tab'

function titleOf(wc: WebContents, incognito: boolean): string {
  if (incognito) return PRIVATE_TITLE
  try { return wc.getTitle() || wc.getURL() || 'Untitled' } catch { return 'Untitled' }
}

export function startDoctor({ windows, isAppSender, intervalMs = 10_000 }: DoctorDeps) {
  const model = createDoctorModel()
  const lag = monitorEventLoopDelay({ resolution: 20 })
  lag.enable()

  // Liveness pings. Chromium's 'unresponsive' event only arms when input is
  // sent to a visible page, and in testing it never fired for a page whose
  // main thread was blocked — so each awake tab also gets a no-op script per
  // sample. A reply still missing at the next sample means the page's main
  // thread has been blocked at least one full interval. WebFrameMain is used
  // because webContents.executeJavaScript waits for loading to finish, which
  // would make every slow page look hung.
  const pings = new Map<number, { sentAt: number; token: number }>()
  // Tabs the user asked to restart: their renderer exit is not a crash.
  const restarting = new Set<number>()
  let nextToken = 0
  const ping = (wc: WebContents, win: DoctorWindow, tabId: string, now: number) => {
    const pending = pings.get(wc.id)
    if (pending) {
      model.tabUnresponsive(win.id, tabId, titleOf(wc, win.incognito), pending.sentAt)
      return
    }
    const token = ++nextToken
    pings.set(wc.id, { sentAt: now, token })
    const settle = () => { if (pings.get(wc.id)?.token === token) pings.delete(wc.id) }
    try {
      wc.mainFrame.executeJavaScript('0').then(() => {
        if (pings.get(wc.id)?.token !== token) return
        settle()
        model.tabResponsive(win.id, tabId, Date.now())
      }, settle)
    } catch { settle() }
  }

  const collect = () => {
    const now = Date.now()
    // pid → the tabs it renders. Same-site tabs can share one renderer, so
    // its CPU and memory are reported once, against all of them.
    const byPid = new Map<number, { win: DoctorWindow; tabId: string; wc: WebContents }[]>()
    for (const win of windows()) {
      for (const [tabId, view] of win.views) {
        const wc = view.webContents
        if (wc.isDestroyed()) continue
        ping(wc, win, tabId, now)
        const pid = wc.getOSProcessId()
        if (!pid) continue
        const list = byPid.get(pid) ?? []
        list.push({ win, tabId, wc })
        byPid.set(pid, list)
      }
    }

    const processes: ProcessSample[] = app.getAppMetrics().map(m => {
      const p: ProcessSample = {
        pid: m.pid,
        type: m.type,
        cpu: m.cpu.percentCPUUsage,
        memMb: (m.memory.workingSetSize ?? 0) / 1024,
      }
      const tabs = byPid.get(m.pid)
      if (tabs?.length) {
        const first = tabs[0]
        const title = titleOf(first.wc, first.win.incognito)
        p.type = 'Tab'
        p.tab = {
          id: first.tabId,
          windowId: first.win.id,
          title: tabs.length > 1 ? `${title} (+${tabs.length - 1} more)` : title,
          active: tabs.some(t => t.win.activeId === t.tabId || t.win.splitId === t.tabId),
        }
      }
      return p
    })

    model.addSample({
      at: now,
      loopP99Ms: lag.percentile(99) / 1e6,
      loopMaxMs: lag.max / 1e6,
      processes,
    })
    lag.reset()
  }

  // Prime CPU accounting: percentCPUUsage is measured since the previous call.
  app.getAppMetrics()
  const timer = setInterval(collect, intervalMs)
  timer.unref()

  ipcMain.handle('doctor:snapshot', e => (isAppSender(e) ? model.snapshot(Date.now()) : null))

  // Restart a hung tab's page. Crashing the renderer hands the tab to the
  // existing render-process-gone handler, which reloads it (or shows the
  // crash page with a reload button if it already crashed moments ago).
  ipcMain.handle('doctor:restartTab', (e, windowId: unknown, tabId: unknown) => {
    if (!isAppSender(e) || typeof windowId !== 'number' || typeof tabId !== 'string') return false
    for (const win of windows()) {
      if (win.id !== windowId) continue
      const wc = win.views.get(tabId)?.webContents
      if (!wc || wc.isDestroyed()) return false
      restarting.add(wc.id)
      try { wc.forcefullyCrashRenderer(); return true } catch { restarting.delete(wc.id); return false }
    }
    return false
  })

  return {
    /** Hook one tab's lifecycle events. Call once per tab webContents. */
    attachTab(wc: WebContents, win: { id: number; incognito: boolean }, tabId: string) {
      wc.on('unresponsive', () => model.tabUnresponsive(win.id, tabId, titleOf(wc, win.incognito), Date.now()))
      wc.on('responsive', () => model.tabResponsive(win.id, tabId, Date.now()))
      wc.on('render-process-gone', (_e, details) => {
        pings.delete(wc.id)
        if (restarting.delete(wc.id)) { model.tabClosed(win.id, tabId, Date.now()); return }
        if (details.reason === 'clean-exit') return
        model.tabCrashed(win.id, tabId, titleOf(wc, win.incognito), details.reason, Date.now())
      })
      // A navigation can replace the frame a ping was sent to; its promise may
      // then never settle. Forget it rather than report a false hang.
      wc.on('did-navigate', () => pings.delete(wc.id))
      wc.once('destroyed', () => {
        pings.delete(wc.id)
        model.tabClosed(win.id, tabId, Date.now())
      })
    },
    stop() {
      clearInterval(timer)
      lag.disable()
    },
  }
}
