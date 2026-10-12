import { describe, it, expect, vi } from 'vitest'

const ses = vi.hoisted(() => ({
  getUserAgent: () => 'Chrome/152.0.0.0',
  setPermissionRequestHandler: vi.fn(),
  setPermissionCheckHandler: vi.fn(),
  on: vi.fn(),
}))
const windows = vi.hoisted(() => [] as any[])
vi.mock('electron', () => ({
  session: { fromPartition: () => ses },
  BrowserWindow: class {
    webContents = { setUserAgent: vi.fn(), setWindowOpenHandler: vi.fn(), executeJavaScript: vi.fn() }
    constructor(public opts: any) { windows.push(this) }
    loadURL() { return Promise.resolve() }
    isDestroyed() { return false }
    destroy() {}
  },
}))
import { createSemaphore, chromeUserAgent, createElectronDriver } from './hiddenPage'

describe('createElectronDriver security', () => {
  it('denies every permission request on the fares session, installed once', async () => {
    const driver = createElectronDriver()
    const page = await driver.open('https://www.kayak.com/x')
    page.close()
    await (await driver.open('https://www.kayak.com/y')).close()
    expect(ses.setPermissionRequestHandler).toHaveBeenCalledTimes(1)
    const handler = ses.setPermissionRequestHandler.mock.calls[0][0]
    const cb = vi.fn()
    handler({}, 'geolocation', cb)
    expect(cb).toHaveBeenCalledWith(false)
    expect(ses.setPermissionCheckHandler.mock.calls[0][0]({}, 'notifications')).toBe(false)
    expect(ses.on.mock.calls.filter(c => c[0] === 'will-download')).toHaveLength(1)
  })

  it('the visible verify window gets the same popup guard as hidden pages', () => {
    windows.length = 0
    createElectronDriver().openVisible('https://www.kayak.com/x')
    const win = windows[0]
    expect(win.opts.webPreferences.sandbox).toBe(true)
    expect(win.webContents.setWindowOpenHandler).toHaveBeenCalled()
    expect(win.webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' })
  })
})

describe('createSemaphore', () => {
  it('never lets more than max holders run at once', async () => {
    const sem = createSemaphore(2)
    let running = 0, peak = 0
    await Promise.all([1, 2, 3, 4, 5].map(async () => {
      const release = await sem.acquire()
      running++; peak = Math.max(peak, running)
      await new Promise(r => setTimeout(r, 5))
      running--; release()
    }))
    expect(peak).toBe(2)
  })

  it('a release called twice frees only one slot', async () => {
    const sem = createSemaphore(1)
    const r1 = await sem.acquire()
    r1(); r1()
    const r2 = await sem.acquire()
    let third = false
    void sem.acquire().then(() => { third = true })
    await new Promise(r => setTimeout(r, 5))
    expect(third).toBe(false)
    r2()
  })
})

describe('chromeUserAgent', () => {
  it('drops the Electron and app tokens so sites see plain Chrome', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) aihub-browser/1.75.2 Chrome/152.0.0.0 Electron/44.0.0 Safari/537.36'
    expect(chromeUserAgent(ua)).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36')
  })
})
