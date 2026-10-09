import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createMonitorStore } from './store'
import type { ResearchMonitor } from '../../../shared/research/monitorTypes'

const roots: string[] = []
async function tempStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aihub-research-monitors-'))
  roots.push(root)
  return createMonitorStore(root)
}
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
const when = '2026-10-08T12:00:00.000Z'
const obs = { id: 'obs', requestedUrl: 'https://example.com/', finalUrl: 'https://example.com/', checkedAt: when, text: 'Public fact', truncated: false, kind: 'public-html' as const }
const monitor: ResearchMonitor = { id: 'm', projectId: 'p', sourceId: 's', intervalHours: 24, notifications: false, status: 'active', failures: 0, nextDueAt: when, baseline: obs, latest: obs, changes: [] }
describe('research monitor storage', () => {
  it('preserves records and rejects invalid histories before replacing them', async () => {
    const store = await tempStore()
    store.replace([monitor])
    expect(store.list()).toEqual([monitor])
    expect(() => store.replace([{ ...monitor, changes: Array(11).fill({}) }])).toThrow(/invalid|history/i)
    expect(store.list()).toEqual([monitor])
  })
  it('rejects a store update beyond ten megabytes without replacing the previous data', async () => {
    const store = await tempStore()
    store.replace([monitor])
    const impacts = Array.from({ length: 50 }, (_, i) => ({ claimId: `claim-${i}`, quote: 'q'.repeat(4000), status: 'missing' as const }))
    const changes = Array.from({ length: 10 }, (_, i) => ({ id: `change-${i}`, observedAt: when, version: `version-${i}`, passages: [], impacts, truncated: false, acknowledged: false }))
    const oversized = Array.from({ length: 20 }, (_, i) => ({ ...monitor, id: `m-${i}`, projectId: `p-${Math.floor(i / 10)}`, sourceId: `s-${i}`, changes }))
    expect(() => store.replace(oversized)).toThrow(/full/i)
    expect(store.list()).toEqual([monitor])
  })
})
