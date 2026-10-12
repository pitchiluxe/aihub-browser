// src/main/fares/hiddenPage.test.ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('electron', () => ({ BrowserWindow: class {}, session: { fromPartition: () => ({ getUserAgent: () => '' }) } }))
import { createSemaphore, chromeUserAgent } from './hiddenPage'

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
