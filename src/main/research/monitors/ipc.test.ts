import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const handlers = new Map<string, (...args: any[]) => any>()
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: any) => handlers.set(channel, handler) } }))
import { registerMonitorIpc } from './ipc'

const roots: string[] = []
function register(resolver: (event: any) => any) {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-monitor-ipc-'))
  roots.push(appDir)
  const getProject = vi.fn()
  return { service: registerMonitorIpc({ appDir, resolveWindow: resolver, getProject, getNormalProject: vi.fn(), saveProject: vi.fn(), capture: vi.fn(), changed: vi.fn(), notify: vi.fn() }), getProject }
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  handlers.clear()
})

describe('research monitor IPC ownership', () => {
  it('rejects unknown senders and malformed IDs at the main-process boundary', async () => {
    const { service } = register(() => undefined)
    const event = { sender: { id: 90 } }
    expect((await handlers.get('research:monitors-list')!(event, { projectId: 'p' })).ok).toBe(false)
    service.dispose()
  })
  it('returns no persistent monitor state or performs source reads in private windows', async () => {
    const owner = { id: 4, incognito: true, views: new Map() }
    const { service, getProject } = register(event => event.sender.id === 4 ? owner : undefined)
    const event = { sender: { id: 4 } }
    expect(await handlers.get('research:monitors-list')!(event, { projectId: 'private-project' })).toEqual({ ok: true, value: [] })
    const preview = await handlers.get('research:monitors-preview')!(event, { projectId: 'p', sourceId: 's', expectedUpdatedAt: '2026-10-08T12:00:00Z' })
    expect(preview.ok).toBe(false)
    expect(getProject).not.toHaveBeenCalled()
    service.dispose()
  })
})
