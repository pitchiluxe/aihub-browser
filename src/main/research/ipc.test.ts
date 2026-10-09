import { it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import { join } from 'path'
const handlers = new Map<string, (...args: any[]) => any>()
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: any) => handlers.set(channel, handler) } }))
import { registerResearchIpc } from './index'
it('fails closed for unknown senders and tabs belonging to another window', async () => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'research-ipc-'))
  const owner = { id: 1, incognito: true, views: new Map() }
  registerResearchIpc({ appDir: dir, resolveWindow: event => event.sender.id === 1 ? owner : undefined })
  expect((await handlers.get('research:list')!({ sender: { id: 2 } })).ok).toBe(false)
  expect((await handlers.get('research:capture')!({ sender: { id: 1 } }, 'other-window-tab')).ok).toBe(false)
  expect(await handlers.get('research:list')!({ sender: { id: 1 } })).toEqual({ ok: true, value: [] })
  fs.rmSync(dir, { recursive: true, force: true })
})
