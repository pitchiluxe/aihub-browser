import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const { handlers, writeText } = vi.hoisted(() => ({ handlers: new Map<string, (event: any, input: any) => Promise<any>>(), writeText: vi.fn(async () => {}) }))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: any) => handlers.set(name, handler) }, clipboard: { writeText } }))
import { registerGrammarIpc } from './grammar'
import type { WebContents } from 'electron'
beforeEach(() => { handlers.clear(); writeText.mockClear() })
function fixture() {
  const frame = {}
  const source = Object.assign(new EventEmitter(), {
    id: 1, isDestroyed: () => false, getURL: vi.fn(() => 'https://example.com/editor'),
    executeJavaScriptInIsolatedWorld: vi.fn(async (_world, scripts) => {
      const code = scripts[0].code as string
      const id = code.match(/\.capture\(("[^"]+")/)
      return id ? { id: JSON.parse(id[1]), original: 'I has a apple.', canReplace: true } : true
    }),
  })
  const generate = vi.fn(async () => 'I have an apple.')
  const service = registerGrammarIpc({ owner: () => ({ id: 99 } as WebContents), generate })
  const event = { sender: { id: 99, mainFrame: frame }, senderFrame: frame }
  const call = (name: string, input: unknown, from = event) => handlers.get(`grammar:${name}`)!(from, input)
  return { source, generate, service, event, call }
}
describe('grammar IPC privacy and lifecycle', () => {
  it('keeps capture local and deduplicates corrections until explicitly requested', async () => {
    const { source, generate, service, call } = fixture()
    const request = await service.capture(source as unknown as WebContents, true, '', true)
    expect(generate).not.toHaveBeenCalled()
    const results = await Promise.all([call('correct', { id: request!.id }), call('correct', { id: request!.id })])
    expect(results.every(result => result.ok && result.value === 'I have an apple.')).toBe(true)
    expect(generate).toHaveBeenCalledOnce()
    expect(generate).toHaveBeenCalledWith('I has a apple.')
  })
  it('rejects requests from another window or frame and stale navigation', async () => {
    const { source, service, event, call } = fixture()
    const request = await service.capture(source as unknown as WebContents, true, '', true)
    const wrongOwner = { ...event, sender: { ...event.sender, id: 100 } }
    expect((await call('correct', { id: request!.id }, wrongOwner)).ok).toBe(false)
    expect((await call('correct', { id: request!.id }, { ...event, senderFrame: {} })).ok).toBe(false)
    source.getURL.mockReturnValue('https://example.com/new-page')
    expect((await call('apply', { id: request!.id, text: 'Corrected' })).ok).toBe(false)
    expect((await call('copy', { id: request!.id, text: 'Corrected' })).ok).toBe(true)
    expect(writeText).toHaveBeenCalledWith('Corrected')
  })
  it('does not permit reuse after apply or closing the source', async () => {
    const { source, service, call } = fixture()
    let request = await service.capture(source as unknown as WebContents, true, '', true)
    expect((await call('apply', { id: request!.id, text: 'I have an apple.' })).ok).toBe(true)
    expect((await call('apply', { id: request!.id, text: 'Second write' })).ok).toBe(false)
    request = await service.capture(source as unknown as WebContents, true, '', true)
    source.emit('destroyed')
    expect((await call('correct', { id: request!.id })).ok).toBe(false)
  })
})
