import { ipcMain, app } from 'electron'
import fs from 'fs'
import path, { join } from 'path'
import { connect, disconnect, status, setCredentials, isEncryptionAvailable, GoogleApiId } from './auth'
import { listThreads, getThread, getAttachmentData, sendMessage, markThreadRead } from './apis/gmail'
import { listFiles, getAbout } from './apis/drive'
import { pushHandoff, pullHandoff, clearHandoff, HandoffTab } from './apis/handoff'
import { listCalendars, listEvents } from './apis/calendar'
import os from 'os'

type Ok<T> = { ok: true } & T
const ok = <T extends object>(data: T): Ok<T> => ({ ok: true, ...data })
const fail = (error: string) => ({ ok: false, error })

// Register every Google-related IPC handler. `safelySend` pushes an event to
// the renderer when a connection completes (so any open view can refresh).
export function registerGoogleIpc(safelySend: (channel: string, ...args: any[]) => void): void {
  // ── Generic auth (multi-API) ──────────────────────────────────────────────
  ipcMain.handle('google:status', () => ok(status()))

  ipcMain.handle('google:connect', async (_e, apis: GoogleApiId[]) => {
    const r = await connect(Array.isArray(apis) && apis.length ? apis : ['gmail'])
    if (r.ok) safelySend('google:connected', { email: r.email, apis: r.apis })
    return r
  })

  ipcMain.handle('google:disconnect', async () => {
    await disconnect()
    return ok({})
  })

  ipcMain.handle('google:setCredentials', (_e, clientId: string, clientSecret: string) => {
    if (!isEncryptionAvailable()) return fail('OS secure storage unavailable')
    setCredentials(clientId, clientSecret)
    return ok({})
  })

  // ── Drive ─────────────────────────────────────────────────────────────────
  ipcMain.handle('drive:list', async (_e, args: { q?: string; pageToken?: string }) => {
    try { return ok(await listFiles(args?.q, args?.pageToken)) } catch (e: any) { return fail(e.message) }
  })
  ipcMain.handle('drive:about', async () => {
    try { return ok(await getAbout()) } catch (e: any) { return fail(e.message) }
  })

  // ── Cross-device handoff (via the user's own Drive appDataFolder) ──────────
  ipcMain.handle('handoff:push', async (_e, args: { tabs: HandoffTab[] }) => {
    try {
      const tabs = (args?.tabs || []).filter(t => t && /^https?:\/\//i.test(t.url))
      if (!tabs.length) return fail('no-tabs')
      await pushHandoff({ tabs, device: os.hostname() || 'This device', sentAt: Date.now() })
      return ok({ count: tabs.length })
    } catch (e: any) { return fail(e.message) }
  })
  ipcMain.handle('handoff:pull', async () => {
    try { return ok({ payload: await pullHandoff() }) } catch (e: any) { return fail(e.message) }
  })
  ipcMain.handle('handoff:clear', async () => {
    try { return ok(await clearHandoff()) } catch (e: any) { return fail(e.message) }
  })

  // ── Calendar ──────────────────────────────────────────────────────────────
  ipcMain.handle('calendar:list', async () => {
    try { return ok({ calendars: await listCalendars() }) } catch (e: any) { return fail(e.message) }
  })
  ipcMain.handle('calendar:events', async (_e, args: { calendarId?: string; timeMin?: string; timeMax?: string; maxResults?: number }) => {
    try { return ok({ events: await listEvents(args?.calendarId, args) }) } catch (e: any) { return fail(e.message) }
  })

  // ── Gmail (back-compat channels used by the existing Mail page) ────────────
  ipcMain.handle('gmail:status', () => {
    const s = status()
    return ok({ connected: s.connected && s.apis.includes('gmail'), email: s.email })
  })

  ipcMain.handle('gmail:setCredentials', (_e, clientId: string, clientSecret: string) => {
    if (!isEncryptionAvailable()) return fail('OS secure storage unavailable')
    setCredentials(clientId, clientSecret)
    return ok({})
  })

  ipcMain.handle('gmail:connect', async () => {
    const r = await connect(['gmail'])
    if (r.ok) safelySend('gmail:connected', { email: r.email })
    return r
  })

  ipcMain.handle('gmail:disconnect', async () => {
    await disconnect()
    return ok({})
  })

  ipcMain.handle('gmail:listThreads', async (_e, args: { q?: string; pageToken?: string }) => {
    try { return ok(await listThreads(args?.q || '', args?.pageToken)) } catch (e: any) { return fail(e.message) }
  })

  ipcMain.handle('gmail:getThread', async (_e, args: { id: string }) => {
    try { return ok({ messages: await getThread(args.id) }) } catch (e: any) { return fail(e.message) }
  })

  ipcMain.handle('gmail:markRead', async (_e, args: { id: string }) => {
    try { await markThreadRead(args.id); return ok({}) } catch (e: any) { return fail(e.message) }
  })

  ipcMain.handle('gmail:getAttachment', async (_e, args: { messageId: string; attachmentId: string; filename: string }) => {
    try {
      const buf = await getAttachmentData(args.messageId, args.attachmentId)
      const dir = app.getPath('downloads')
      // args.filename comes from attacker-controlled MIME headers — strip path
      // components so a crafted "../../.." name can't escape Downloads.
      const safeName = path.basename(args.filename).replace(/[\\/\x00]/g, '_') || 'attachment'
      let dest = join(dir, safeName)
      let n = 1
      while (fs.existsSync(dest)) {
        const dot = safeName.lastIndexOf('.')
        const stem = dot > 0 ? safeName.slice(0, dot) : safeName
        const ext = dot > 0 ? safeName.slice(dot) : ''
        dest = join(dir, `${stem} (${n++})${ext}`)
      }
      fs.writeFileSync(dest, buf)
      return ok({ savedPath: dest })
    } catch (e: any) { return fail(e.message) }
  })

  ipcMain.handle('gmail:send', async (_e, opts: { to: string; subject: string; body: string; inReplyTo?: string; references?: string; threadId?: string }) => {
    try {
      const from = status().email
      if (!from) return fail('not-connected')
      await sendMessage({ from, ...opts })
      return ok({})
    } catch (e: any) { return fail(e.message) }
  })
}
