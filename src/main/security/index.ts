import { ipcMain, dialog, shell, type BrowserWindow, type WebContents } from 'electron'
import { join, extname } from 'path'
import { fileURLToPath } from 'url'
import { createManagedJsonStore } from '../jsonStore'
import { createSecurityService, type SecurityOwner } from './service'
import { PAGE_EVIDENCE_SCRIPT } from './checks'
import type { SecurityEvent, SecurityFinding } from '../../shared/security'

interface Owner extends SecurityOwner { win: BrowserWindow; views: Map<string, { webContents: WebContents }> }
export function registerSecurityIpc(options: {
  appDir: string
  resolveWindow(event: Electron.IpcMainInvokeEvent): Owner | undefined
  aiConfig(): { base: string; model: string }
}) {
  const service = createSecurityService({ store: createManagedJsonStore<SecurityEvent[]>(join(options.appDir, 'security-events.json'), () => []), aiConfig: options.aiConfig })
  const handle = (channel: string, fn: (owner: Owner, arg: unknown) => unknown) => ipcMain.handle(channel, async (event, arg) => {
    try {
      const owner = options.resolveWindow(event)
      if (!owner || event.senderFrame !== event.sender.mainFrame || owner.win.isDestroyed()) throw Error('Security controls are available only in the AIHub app window.')
      return { ok: true, value: await fn(owner, arg) }
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Security request failed.' } }
  })
  handle('security:snapshot', owner => service.snapshot(owner))
  handle('security:scan', async (owner, kind) => {
    if (!['file', 'folder', 'quick', 'full'].includes(String(kind))) throw Error('Choose a supported scan type.')
    if (kind === 'file' || kind === 'folder') {
      const selection = await dialog.showOpenDialog(owner.win, { title: `Choose a ${kind} for Defender to scan`, properties: [kind === 'file' ? 'openFile' : 'openDirectory'] })
      if (selection.canceled || !selection.filePaths[0]) return { cancelled: true }
      return service.scan(owner, kind, selection.filePaths[0])
    }
    return service.scan(owner, kind as 'quick' | 'full')
  })
  handle('security:analyze', (owner, question) => service.analyze(owner, question as string))
  handle('security:openWindows', async () => {
    if (process.platform !== 'win32') throw Error('Windows Security is available on Windows only.')
    await shell.openExternal('windowsdefender:')
  })
  const showWarning = async (owner: Owner, title: string, detail: string) => {
    const result = await dialog.showMessageBox(owner.win, { type: 'warning', title, message: title, detail, buttons: ['Cancel', 'Open anyway'], defaultId: 0, cancelId: 0, noLink: true })
    return result.response === 1
  }
  return {
    service,
    async allowHtml(owner: Owner, url: string) {
      if (!/^file:/i.test(url)) return true
      let path: string
      try { path = fileURLToPath(new URL(url)) } catch { return false }
      if (!/^\.html?$/i.test(extname(path))) return true
      try {
        const findings = await service.html(owner, path)
        if (!findings.length) return true
        return showWarning(owner, 'Review this local HTML file', findings.map(f => `${f.title}: ${f.detail}`).join('\n\n') + '\n\nThese are static indicators, not an antivirus verdict.')
      } catch (e) {
        return showWarning(owner, 'This HTML file could not be inspected', e instanceof Error ? e.message : 'The file is unverified.')
      }
    },
    async checkPage(owner: Owner, wc: WebContents): Promise<SecurityFinding[]> {
      if (wc.isDestroyed()) return []
      const url = wc.getURL()
      const immediate = service.page(owner, { url })
      if (!/^https?:\/\//i.test(url)) return immediate
      try {
        const raw = await Promise.race([wc.executeJavaScript(PAGE_EVIDENCE_SCRIPT), new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(Error('Page check timed out')), 3000); timer.unref() })])
        if (wc.isDestroyed() || wc.getURL() !== url || typeof raw !== 'string' || raw.length > 50_000) return immediate
        const data = JSON.parse(raw)
        const forms = Array.isArray(data.passwordForms) ? data.passwordForms.filter((x: unknown) => typeof x === 'string').slice(0, 20) : []
        return service.page(owner, { url, passwordForms: forms })
      } catch { return immediate }
    },
    async allowDownload(owner: Owner, path: string) {
      const result = await service.scanFile(owner, path)
      if (result.state === 'detected' || result.state === 'blocked') {
        await dialog.showMessageBox(owner.win, { type: 'error', title: 'Download blocked', message: result.message || 'Defender blocked this file.', detail: 'Review Windows Security and scan again. AIHub will not open this file.', buttons: ['Close'] })
        return false
      }
      if (result.state === 'no-threats-found') return true
      return showWarning(owner, 'This download is unverified', `${result.message}\n\nOpening an unverified file can put your device at risk.`)
    },
  }
}
