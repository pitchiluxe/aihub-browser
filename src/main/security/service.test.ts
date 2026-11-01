import { describe, expect, it, vi } from 'vitest'
import { createSecurityService } from './service'
import type { SecurityEvent } from '../../shared/security'

function setup() {
  let events: SecurityEvent[] = []
  const scan = vi.fn().mockResolvedValue({ detected: false })
  const fingerprint = vi.fn().mockResolvedValue('hash1')
  const service = createSecurityService({
    store: { get: () => events, set: value => { events = value } },
    defender: { status: vi.fn().mockResolvedValue({ available: true, active: true, realTime: true, mode: 'Normal' }), scan },
    fingerprint,
    aiConfig: () => ({ base: 'http://127.0.0.1:11434', model: 'qwen3:8b' }),
  })
  return { service, scan, fingerprint, events: () => events }
}
describe('security scan enforcement', () => {
  it('rescans a changed file and never reuses a clean result for new contents', async () => {
    const { service, scan, fingerprint } = setup()
    const owner = { id: 1, incognito: false }
    expect((await service.scanFile(owner, '/page.html')).state).toBe('no-threats-found')
    expect((await service.scanFile(owner, '/page.html')).state).toBe('no-threats-found')
    expect(scan).toHaveBeenCalledTimes(1)
    fingerprint.mockResolvedValue('hash2'); scan.mockResolvedValue({ detected: true })
    expect((await service.scanFile(owner, '/page.html')).state).toBe('detected')
    expect(scan).toHaveBeenCalledTimes(2)
  })
  it('rejects a file modified during scanning', async () => {
    const { service, fingerprint } = setup()
    fingerprint.mockResolvedValueOnce('before').mockResolvedValueOnce('after')
    expect((await service.scanFile({ id: 1, incognito: false }, '/page.html')).state).toBe('failed')
  })
  it('preserves a confirmed detection even when Defender quarantines the file', async () => {
    const { service, scan, fingerprint } = setup()
    scan.mockResolvedValue({ detected: true })
    fingerprint.mockResolvedValueOnce('before').mockRejectedValue(new Error('File removed by Defender'))
    expect((await service.scanFile({ id: 1, incognito: false }, '/page.html')).state).toBe('detected')
  })
  it('keeps private findings out of persisted events and other windows', async () => {
    const { service, events } = setup()
    await service.scanFile({ id: 2, incognito: true }, '/private.html')
    expect(events()).toEqual([])
    expect((await service.snapshot({ id: 1, incognito: false })).events).toEqual([])
    expect((await service.snapshot({ id: 2, incognito: true })).events).toHaveLength(1)
    service.release(2)
    expect((await service.snapshot({ id: 2, incognito: true })).events).toEqual([])
  })
  it('keeps command failures unverified', async () => {
    const { service, scan } = setup()
    scan.mockRejectedValue(new Error('Access denied'))
    expect((await service.scanFile({ id: 1, incognito: false }, '/page.html')).state).toBe('failed')
  })
  it('does not downgrade a detection when timeline storage fails', async () => {
    const service = createSecurityService({ store: { get: () => [], set: () => { throw Error('Disk unavailable') } }, defender: { status: vi.fn(), scan: vi.fn().mockResolvedValue({ detected: true }) }, fingerprint: vi.fn().mockResolvedValue('hash'), aiConfig: () => ({ base: 'http://localhost:11434', model: 'local' }) })
    expect((await service.scanFile({ id: 1, incognito: false }, '/a.exe')).state).toBe('detected')
  })
})
