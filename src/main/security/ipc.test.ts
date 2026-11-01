import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  scanFile: vi.fn(), html: vi.fn(), snapshot: vi.fn(), scan: vi.fn(), analyze: vi.fn(),
  showMessageBox: vi.fn(), showOpenDialog: vi.fn(),
}))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, fn: any) => mocks.handlers.set(name, fn) }, dialog: { showMessageBox: mocks.showMessageBox, showOpenDialog: mocks.showOpenDialog }, shell: { openExternal: vi.fn() } }))
vi.mock('../jsonStore', () => ({ createManagedJsonStore: () => ({ get: () => [], set() {} }) }))
vi.mock('./service', () => ({ createSecurityService: () => ({ scanFile: mocks.scanFile, html: mocks.html, snapshot: mocks.snapshot, scan: mocks.scan, analyze: mocks.analyze }) }))
import { registerSecurityIpc } from './index'

describe('security IPC and protection gates', () => {
  const frame = {}
  const owner = { id: 1, incognito: false, win: { isDestroyed: () => false }, views: new Map() } as any
  beforeEach(() => { vi.clearAllMocks(); mocks.handlers.clear() })
  const setup = (resolveWindow: () => any = () => owner) => registerSecurityIpc({ appDir: '/test', resolveWindow, aiConfig: () => ({ base: 'http://localhost:11434', model: 'local' }) })
  it('denies page senders and subframes access to security controls', async () => {
    setup(() => undefined)
    expect((await mocks.handlers.get('security:snapshot')!({ sender: { mainFrame: frame }, senderFrame: frame })).ok).toBe(false)
    setup()
    expect((await mocks.handlers.get('security:scan')!({ sender: { mainFrame: frame }, senderFrame: {} }, 'quick')).ok).toBe(false)
    expect(mocks.scan).not.toHaveBeenCalled()
  })
  it('never accepts a renderer-provided file path or arbitrary operation', async () => {
    setup()
    const event = { sender: { mainFrame: frame }, senderFrame: frame }
    expect((await mocks.handlers.get('security:scan')!(event, 'disable-antivirus')).ok).toBe(false)
    expect((await mocks.handlers.get('security:scan')!(event, { kind: 'file', path: 'C:\\secret' })).ok).toBe(false)
    expect(mocks.scan).not.toHaveBeenCalled()
  })
  it.each(['detected', 'blocked'])('blocks %s results regardless of dialog responses', async state => {
    const controller = setup()
    mocks.scanFile.mockResolvedValue({ state })
    mocks.showMessageBox.mockResolvedValue({ response: 1 })
    expect(await controller.allowDownload(owner, 'C:\\download.exe')).toBe(false)
    expect(mocks.showMessageBox.mock.calls[0][1].buttons).toEqual(['Close'])
  })
  it('requires explicit confirmation to open an unverified download', async () => {
    const controller = setup()
    mocks.scanFile.mockResolvedValue({ state: 'unavailable', message: 'Unavailable' })
    mocks.showMessageBox.mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 1 })
    expect(await controller.allowDownload(owner, 'C:\\download.exe')).toBe(false)
    expect(await controller.allowDownload(owner, 'C:\\download.exe')).toBe(true)
    expect(mocks.showMessageBox.mock.calls[0][1].defaultId).toBe(0)
  })
  it('inspects HTML before allowing it and respects cancellation', async () => {
    const controller = setup()
    mocks.html.mockResolvedValue([{ title: 'Remote script', detail: 'Review' }])
    mocks.showMessageBox.mockResolvedValue({ response: 0 })
    expect(await controller.allowHtml(owner, 'file:///C:/page.html')).toBe(false)
    expect(mocks.html).toHaveBeenCalled()
  })
})
