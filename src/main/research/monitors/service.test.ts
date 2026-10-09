import { describe, expect, it, vi } from 'vitest'
import { createMonitorService } from './service'
import type { ResearchMonitor } from '../../../shared/research/monitorTypes'

const owner = { id: 8, incognito: true, views: new Map() }
const now = () => new Date('2026-10-08T12:00:00Z')
const source = { id: 'source', title: 'Prices', url: 'https://example.com/', capturedAt: now().toISOString(), text: 'Price $120 on 2026-10-08', truncated: false, captureType: 'page' as const, provenance: 'captured' as const }
const project = { schemaVersion: 1 as const, id: 'project', title: 'Trip', question: '', createdAt: now().toISOString(), updatedAt: now().toISOString(), mode: 'summary' as const, sources: [source], claims: [{ id: 'claim', text: 'It costs 120', citations: [{ sourceId: source.id, quote: source.text }], reviewed: true, kind: 'finding' as const }], notes: [] }
const observation = (text: string) => ({ id: crypto.randomUUID(), requestedUrl: source.url, finalUrl: source.url, checkedAt: now().toISOString(), text, truncated: false, kind: 'public-html' as const })
function setup(monitors: ResearchMonitor[] = [], fetcher = vi.fn(), privateOwner = owner) {
  const store = { list: vi.fn(() => monitors.map(m => structuredClone(m))), replace: vi.fn((next: ResearchMonitor[]) => { monitors = structuredClone(next) }) }
  const service = createMonitorService({ store, getProject: () => privateOwner.incognito ? undefined : project, getNormalProject: () => project, saveProject: vi.fn((_owner, value) => ({ ok: true as const, value })), fetcher, now, changed: vi.fn(), notify: vi.fn() })
  return { service, store, getMonitors: () => monitors }
}

describe('research monitor privacy and lifecycle', () => {
  it('does not read the persistent monitor store when a private window checks a monitor', async () => {
    const { service, store } = setup()
    const result = await service.check(owner, 'project', 'monitor')
    expect(result.ok).toBe(false)
    expect(store.list).not.toHaveBeenCalled()
  })

  it('keeps a mismatch preview available until the user confirms it', async () => {
    const normalOwner = { id: 2, incognito: false, views: new Map() }
    const fetcher = vi.fn().mockResolvedValue(observation('A different public version'))
    const { service, store } = setup([], fetcher, normalOwner)
    const preview = await service.preview(normalOwner, project.id, source.id, project.updatedAt)
    expect(preview.ok && preview.value.missingQuotes).toEqual([source.text])
    if (!preview.ok) return
    expect(service.confirm(normalOwner, preview.value.token, 24, false, false).ok).toBe(false)
    expect(store.replace).not.toHaveBeenCalled()
    expect(service.confirm(normalOwner, preview.value.token, 24, false, true).ok).toBe(true)
  })

  it('records distinct changed evidence once while leaving the saved finding untouched', async () => {
    const normalOwner = { id: 2, incognito: false, views: new Map() }
    const initial: ResearchMonitor = { id: 'monitor', projectId: project.id, sourceId: source.id, intervalHours: 24, notifications: true, status: 'active', failures: 0, nextDueAt: now().toISOString(), baseline: observation(source.text), latest: observation(source.text), changes: [] }
    const fetcher = vi.fn().mockResolvedValue(observation('Price $150 on 2026-10-09'))
    const { service, store, getMonitors } = setup([initial], fetcher, normalOwner)
    const first = await service.check(normalOwner, project.id, initial.id)
    const second = await service.check(normalOwner, project.id, initial.id)
    expect(first.ok && first.value.changes).toHaveLength(1)
    expect(first.ok && first.value.changes[0].impacts[0].status).toBe('missing')
    expect(second.ok && second.value.changes).toHaveLength(1)
    expect(getMonitors()[0].baseline.text).toBe(source.text)
    expect(project.claims[0].reviewed).toBe(true)
    expect(store.replace).toHaveBeenCalledTimes(2)
  })

  it('deduplicates a check and cannot recreate a monitor after deletion', async () => {
    const normalOwner = { id: 2, incognito: false, views: new Map() }
    const initial: ResearchMonitor = { id: 'monitor', projectId: project.id, sourceId: source.id, intervalHours: 24, notifications: true, status: 'active', failures: 0, nextDueAt: now().toISOString(), baseline: observation(source.text), latest: observation(source.text), changes: [] }
    let resolveFetch!: (value: ReturnType<typeof observation>) => void
    const fetcher = vi.fn(() => new Promise<ReturnType<typeof observation>>(resolve => { resolveFetch = resolve }))
    const { service, store } = setup([initial], fetcher, normalOwner)
    const first = service.check(normalOwner, project.id, initial.id)
    const duplicate = service.check(normalOwner, project.id, initial.id)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(service.remove(normalOwner, project.id, initial.id).ok).toBe(true)
    resolveFetch(observation('Late response'))
    expect((await first).ok).toBe(false)
    expect((await duplicate).ok).toBe(false)
    expect(store.list()).toEqual([])
  })

  it('cancels a window-owned manual check when that window closes', async () => {
    const normalOwner = { id: 2, incognito: false, views: new Map() }
    const initial: ResearchMonitor = { id: 'monitor', projectId: project.id, sourceId: source.id, intervalHours: 24, notifications: true, status: 'active', failures: 0, nextDueAt: now().toISOString(), baseline: observation(source.text), latest: observation(source.text), changes: [] }
    let resolveFetch!: (value: ReturnType<typeof observation>) => void
    const fetcher = vi.fn(() => new Promise<ReturnType<typeof observation>>(resolve => { resolveFetch = resolve }))
    const { service, store } = setup([initial], fetcher, normalOwner)
    const pending = service.check(normalOwner, project.id, initial.id)
    service.release(normalOwner.id)
    resolveFetch(observation('Late update'))
    expect((await pending).ok).toBe(false)
    expect(store.replace).not.toHaveBeenCalled()
  })

  it('keeps the last successful observation on errors and pauses after three failures', async () => {
    const normalOwner = { id: 2, incognito: false, views: new Map() }
    const initial: ResearchMonitor = { id: 'monitor', projectId: project.id, sourceId: source.id, intervalHours: 6, notifications: true, status: 'active', failures: 0, nextDueAt: now().toISOString(), baseline: observation(source.text), latest: observation(source.text), changes: [] }
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'))
    const { service, getMonitors } = setup([initial], fetcher, normalOwner)
    await service.check(normalOwner, project.id, initial.id)
    await service.check(normalOwner, project.id, initial.id)
    const last = await service.check(normalOwner, project.id, initial.id)
    expect(last.ok).toBe(false)
    expect(getMonitors()[0].latest.text).toBe(source.text)
    expect(getMonitors()[0].baseline.text).toBe(source.text)
    expect(getMonitors()[0].failures).toBe(3)
    expect(getMonitors()[0].status).toBe('paused')
  })

  it('starts only one overdue scheduled check while a fetch is active', async () => {
    const first: ResearchMonitor = { id: 'm1', projectId: project.id, sourceId: source.id, intervalHours: 24, notifications: false, status: 'active', failures: 0, nextDueAt: now().toISOString(), baseline: observation(source.text), latest: observation(source.text), changes: [] }
    const second = { ...first, id: 'm2', sourceId: 'another-source' }
    let resolveFetch!: (value: ReturnType<typeof observation>) => void
    const fetcher = vi.fn(() => new Promise<ReturnType<typeof observation>>(resolve => { resolveFetch = resolve }))
    const { service } = setup([first, second], fetcher, { id: 2, incognito: false, views: new Map() })
    const due = service.tick()
    await service.tick()
    expect(fetcher).toHaveBeenCalledTimes(1)
    resolveFetch(observation(source.text))
    await due
  })

  it('prepares public observations as imported evidence and accepts the report as a separate project', async () => {
    const normalOwner = { id: 2, incognito: false, views: new Map() }
    const initial: ResearchMonitor = { id: 'monitor', projectId: project.id, sourceId: source.id, intervalHours: 24, notifications: false, status: 'active', failures: 0, nextDueAt: now().toISOString(), baseline: observation(source.text), latest: observation('Price $150 on 2026-10-09'), changes: [{ id: 'change', observedAt: now().toISOString(), version: 'version', passages: [], impacts: [], truncated: false, acknowledged: false }] }
    const { service } = setup([initial], vi.fn(), normalOwner)
    const instance = service as typeof service & { prepareProposal(owner: typeof normalOwner, projectId: string, revision: string): Promise<any>; acceptProposal(owner: typeof normalOwner, token: string, revision: string, claims: any[]): Promise<any> }
    const prepared = await instance.prepareProposal(normalOwner, project.id, project.updatedAt)
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    const updatedSource = prepared.value.project.sources[0]
    expect(updatedSource.provenance).toBe('imported')
    expect(updatedSource.title).toContain('Public HTML observation:')
    expect(updatedSource.text).toContain('$150')
    const accepted = await instance.acceptProposal(normalOwner, prepared.value.token, project.updatedAt, [{ id: 'new-finding', text: 'Current price is 150', citations: [{ sourceId: updatedSource.id, quote: 'Price $150 on 2026-10-09' }], reviewed: false, kind: 'finding' }])
    expect(accepted.ok).toBe(true)
    expect(project.claims[0].text).toBe('It costs 120')
    expect(accepted.ok && accepted.value.id).not.toBe(project.id)
    expect(accepted.ok && accepted.value.claims[0].citations[0].sourceId).toBe(updatedSource.id)
  })

  it('rejects an open page whose query identifies a different document', async () => {
    const normalOwner = { id: 2, incognito: false, views: new Map() }
    const capture = vi.fn().mockResolvedValue({ ...source, url: 'https://example.com/?record=other' })
    const service = createMonitorService({ store: { list: () => [], replace: () => {} }, getProject: () => project, getNormalProject: () => project, capture, now, changed: vi.fn(), notify: vi.fn() })
    const result = await service.compareLoaded(normalOwner, project.id, source.id, project.updatedAt, 'tab')
    expect(result.ok).toBe(false)
  })

  it('prepares a full-size retained observation as a valid excerpt source', async () => {
    const normalOwner = { id: 2, incognito: false, views: new Map() }
    const long = 'x'.repeat(12_000)
    const initial: ResearchMonitor = { id: 'monitor', projectId: project.id, sourceId: source.id, intervalHours: 24, notifications: false, status: 'active', failures: 0, nextDueAt: now().toISOString(), baseline: observation(source.text), latest: observation(long), changes: [] }
    const { service } = setup([initial], vi.fn(), normalOwner)
    const prepared = await service.prepareProposal(normalOwner, project.id, project.updatedAt)
    expect(prepared.ok).toBe(true)
    expect(prepared.ok && prepared.value.project.sources[0].text).toHaveLength(12_000)
  })
})
