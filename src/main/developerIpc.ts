import { app, ipcMain, type BrowserWindow, type WebContents } from 'electron'
import { join } from 'node:path'
import { createApiSandbox } from './apiSandbox'
import { runDeveloperJob, stopDeveloperJobs } from './developerJobs'
import { createManagedJsonStore } from './jsonStore'
import { httpUrl, isLoopback, localDevelopmentHeaders, sanitizeRequest, validatePorts, validateReplay, type ApiRequest } from '../shared/developer'

interface Owner { win: BrowserWindow; views: Map<string, { webContents: WebContents }>; incognito: boolean }
export const developmentOrigins = new Set<string>()
export function developmentHeaders(target: string, referrer: string, original: Record<string, string[]>): Record<string, string[]> | null {
  return localDevelopmentHeaders(target, referrer, original, developmentOrigins)
}
export function registerDeveloperIpc(options: {
  appDir: string
  owner(event: Electron.IpcMainInvokeEvent): Owner | undefined
  prepareLocal(url: string): Promise<void>
}) {
  const sandbox = createApiSandbox()
  const templates = createManagedJsonStore<ApiRequest[]>(join(options.appDir, 'api-templates.json'), () => [])
  const handle = (name: string, action: (owner: Owner, input: any) => unknown) => ipcMain.handle(`developer:${name}`, async (event, input) => {
    try {
      const owner = options.owner(event)
      if (!owner || event.senderFrame !== owner.win.webContents.mainFrame) throw Error('Developer tools are available only in the browser interface.')
      if (owner.incognito) throw Error('Developer capture and saved templates are disabled in Incognito.')
      return { ok: true, value: await action(owner, input) }
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Developer action failed.' } }
  })
  const target = (owner: Owner, tabId: unknown) => {
    const wc = typeof tabId === 'string' ? owner.views.get(tabId)?.webContents : undefined
    if (!wc || wc.isDestroyed()) throw Error('Choose an open web tab.')
    httpUrl(wc.getURL())
    return wc
  }
  handle('snapshot', (owner, tabId) => sandbox.snapshot(target(owner, tabId)))
  handle('start', (owner, input) => sandbox.start(target(owner, input?.tabId), input?.intercept === true))
  handle('stop', (owner, tabId) => sandbox.stop(target(owner, tabId)))
  handle('resolve', (owner, input) => sandbox.resolve(target(owner, input?.tabId), String(input?.id || ''), input?.request, input?.abort === true))
  handle('devtools', (owner, tabId) => { target(owner, tabId).openDevTools({ mode: 'detach' }) })
  handle('replay', (_owner, input) => runDeveloperJob('replay', validateReplay(input)))
  handle('probe', (_owner, input) => runDeveloperJob('probe', validatePorts(input)))
  handle('openLocal', async (_owner, input) => {
    const url = httpUrl(input)
    if (!isLoopback(url.href)) throw Error('Development sessions accept only loopback services.')
    await options.prepareLocal(url.href)
    developmentOrigins.add(url.origin)
    return { url: url.href, containerId: 'development' }
  })
  handle('templates', () => templates.get())
  handle('save', (_owner, input) => {
    const clean = sanitizeRequest(input)
    clean.id = `api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    templates.update(rows => [clean, ...rows].slice(0, 50))
    return clean
  })
  handle('delete', (_owner, id) => templates.update(rows => rows.filter(row => row.id !== id)))
  app.on('before-quit', () => { stopDeveloperJobs(); void sandbox.shutdown() })
}
