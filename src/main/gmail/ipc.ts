import { ipcMain, app } from 'electron'
import fs from 'fs'
import path, { join } from 'path'
import { beginConnect, disconnect, currentEmail } from './oauth'
import { listThreads, getThread, getAttachmentData, sendMessage } from './client'
import { loadTokens, saveTokens, isEncryptionAvailable } from './store'

type Ok<T> = { ok: true } & T
const ok = <T extends object>(data: T): Ok<T> => ({ ok: true, ...data })
const fail = (error: string) => ({ ok: false, error })

export function registerGmailIpc(safelySend: (channel: string, ...args: any[]) => void): void {
  ipcMain.handle('gmail:status', () => ok({ connected: !!currentEmail(), email: currentEmail() }))

  ipcMain.handle('gmail:setCredentials', (_e, clientId: string, clientSecret: string) => {
    if (!isEncryptionAvailable()) return fail('OS secure storage unavailable')
    const existing = loadTokens()
    const sameClient = existing?.clientId === clientId
    saveTokens({
      email: sameClient ? (existing?.email || '') : '',
      refreshToken: sameClient ? (existing?.refreshToken || '') : '',
      clientId, clientSecret,
    })
    return ok({})
  })

  ipcMain.handle('gmail:connect', async () => {
    const r = await beginConnect()
    if (r.ok) safelySend('gmail:connected', { email: r.email })
    return r
  })

  ipcMain.handle('gmail:disconnect', async () => { await disconnect(); return ok({}) })

  ipcMain.handle('gmail:listThreads', async (_e, args: { q?: string; pageToken?: string }) => {
    try { return ok(await listThreads(args?.q || '', args?.pageToken)) }
    catch (e: any) { return fail(e.message) }
  })

  ipcMain.handle('gmail:getThread', async (_e, args: { id: string }) => {
    try { return ok({ messages: await getThread(args.id) }) }
    catch (e: any) { return fail(e.message) }
  })

  ipcMain.handle('gmail:getAttachment', async (_e, args: { messageId: string; attachmentId: string; filename: string }) => {
    try {
      const buf = await getAttachmentData(args.messageId, args.attachmentId)
      const dir = app.getPath('downloads')
      // args.filename is attacker-controlled (comes from the email's own MIME
      // headers via the Gmail API) — strip any path components before joining
      // so a crafted "../../.." name can't escape the Downloads folder.
      const safeName = path.basename(args.filename).replace(/[\\/\x00]/g, '_') || 'attachment'
      let dest = join(dir, safeName)
      let n = 1
      while (fs.existsSync(dest)) { const dot = safeName.lastIndexOf('.'); const base = dot > 0 ? safeName.slice(0, dot) : safeName; const ext = dot > 0 ? safeName.slice(dot) : ''; dest = join(dir, `${base} (${n++})${ext}`) }
      fs.writeFileSync(dest, buf)
      return ok({ savedPath: dest })
    } catch (e: any) { return fail(e.message) }
  })

  ipcMain.handle('gmail:send', async (_e, opts: { to: string; subject: string; body: string; inReplyTo?: string; references?: string; threadId?: string }) => {
    try {
      const from = currentEmail()
      if (!from) return fail('not-connected')
      await sendMessage({ from, ...opts })
      return ok({})
    } catch (e: any) { return fail(e.message) }
  })
}
