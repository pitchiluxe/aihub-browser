import { randomUUID, createHash } from 'node:crypto'
import type { ResearchOwner } from '../store'
import type { CapturedSource, ResearchProject, ResearchResult } from '../../../shared/research/types'
import { MONITOR_LIMITS as L, type IntervalHours, type Observation, type ResearchMonitor, type MonitorPreview, type MonitorComparison, type MonitorChange } from '../../../shared/research/monitorTypes'
import { compareObservation, } from '../../../shared/research/monitorDiff'
import { fetchPublicObservation } from './publicFetch'

type Store = { list(): ResearchMonitor[]; replace(records: ResearchMonitor[]): void }
type Owner = ResearchOwner & { views?: Map<string, { webContents: { isDestroyed(): boolean; getURL(): string; getTitle(): string; executeJavaScript<T>(code: string, userGesture?: boolean): Promise<T> } }> }
type Deps = {
  store: Store
  getProject(owner: Owner, projectId: string): ResearchProject | undefined
  getNormalProject(projectId: string): ResearchProject | undefined
  fetcher?(url: string, signal: AbortSignal): Promise<Observation>
  capture?(owner: Owner, tabId: string): Promise<CapturedSource>
  now(): Date
  changed(projectId: string): void
  notify(projectId: string): void
}
type PreviewRecord = { ownerId: number; projectId: string; sourceId: string; revision: string; expires: number; observation: Observation; missing: string[] }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const errorText = (e: unknown) => e instanceof Error ? e.message : 'The public page could not be checked.'

export function createMonitorService(deps: Deps) {
  const previews = new Map<string, PreviewRecord>()
  const releasedOwners = new Set<number>()
  const previewControllers = new Map<number, Set<AbortController>>()
  const inFlight = new Map<string, Promise<ResearchResult<ResearchMonitor>>>()
  const generations = new Map<string, number>()
  const controllers = new Map<string, AbortController>()
  let globalFetch = false
  let disposed = false
  let timer: ReturnType<typeof setInterval> | undefined
  const runFetch = async (url: string, signal: AbortSignal): Promise<Observation> => {
    if (globalFetch) throw Error('Another research source is being checked. Try again shortly.')
    globalFetch = true
    try { return await (deps.fetcher || fetchPublicObservation)(url, signal) }
    finally { globalFetch = false }
  }
  const get = (id: string) => deps.store.list().find(m => m.id === id)
  const saveAll = (records: ResearchMonitor[]) => deps.store.replace(records)
  const checkPublic = async (monitorId: string, owner?: Owner): Promise<ResearchResult<ResearchMonitor>> => {
    const repeated = inFlight.get(monitorId)
    if (repeated) return repeated
    if (globalFetch) return { ok: false, error: 'Another research source is being checked. Try again shortly.' }
    const monitor = get(monitorId)
    if (!monitor || monitor.status !== 'active') return { ok: false, error: 'This source monitor is no longer active.' }
    const project = owner ? deps.getProject(owner, monitor.projectId) : undefined
    if (owner && (!project || !project.sources.some(s => s.id === monitor.sourceId))) return { ok: false, error: 'This research source was removed.' }
    const sourceUrl = project?.sources.find(s => s.id === monitor.sourceId)?.url || monitor.baseline.requestedUrl
    const generation = (generations.get(monitorId) || 0) + 1
    generations.set(monitorId, generation)
    const controller = new AbortController()
    controllers.set(monitorId, controller)
    const operation = (async (): Promise<ResearchResult<ResearchMonitor>> => {
      try {
        const observation = await runFetch(sourceUrl, controller.signal)
        if (disposed || controller.signal.aborted || generations.get(monitorId) !== generation) return { ok: false, error: 'This source check was cancelled.' }
        const current = get(monitorId)
        const freshProject = owner ? deps.getProject(owner, monitor.projectId) : deps.getNormalProject(monitor.projectId)
        if (!current || current.status !== 'active' || !freshProject?.sources.some(s => s.id === monitor.sourceId)) return { ok: false, error: 'This source monitor is no longer active.' }
        const hash = createHash('sha256').update(observation.text.replace(/\r\n?/g, '\n').replace(/[\t\u00a0 ]+/g, ' ').replace(/ *\n */g, '\n').trim()).digest('hex')
        const priorHash = current.changes.at(-1)?.version || createHash('sha256').update(current.latest.text.replace(/\r\n?/g, '\n').replace(/[\t\u00a0 ]+/g, ' ').replace(/ *\n */g, '\n').trim()).digest('hex')
        const next = clone(current)
        next.lastAttemptAt = deps.now().toISOString()
        next.failures = 0
        next.error = undefined
        next.nextDueAt = new Date(deps.now().getTime() + next.intervalHours * 3_600_000).toISOString()
        if (hash !== priorHash) {
          const sourceProject = freshProject
          const compared = compareObservation(sourceProject, monitor.sourceId, current.latest, observation)
          const change: MonitorChange = { id: randomUUID(), observedAt: observation.checkedAt, version: hash, passages: compared.passages, impacts: compared.impacts, truncated: observation.truncated, acknowledged: false }
          next.latest = observation
          next.changes = [...next.changes, change].slice(-L.history)
        } else {
          next.latest = { ...observation, id: current.latest.id }
        }
        saveAll(deps.store.list().map(m => m.id === monitorId ? next : m))
        deps.changed(next.projectId)
        if (hash !== priorHash && next.notifications) deps.notify(next.projectId)
        return { ok: true, value: clone(next) }
      } catch (error) {
        if (controller.signal.aborted || generations.get(monitorId) !== generation) return { ok: false, error: 'This source check was cancelled.' }
        const current = get(monitorId)
        if (!current) return { ok: false, error: 'This source monitor was removed.' }
        const next = clone(current), attempted = deps.now()
        next.lastAttemptAt = attempted.toISOString()
        next.failures += 1
        next.error = errorText(error)
        next.nextDueAt = new Date(attempted.getTime() + next.intervalHours * 3_600_000).toISOString()
        if (next.failures >= 3) next.status = 'paused'
        try { saveAll(deps.store.list().map(m => m.id === monitorId ? next : m)); deps.changed(next.projectId) } catch {}
        return { ok: false, error: next.error }
      } finally {
        controllers.delete(monitorId)
        inFlight.delete(monitorId)
      }
    })()
    inFlight.set(monitorId, operation)
    return operation
  }

  const api = {
    list(owner: Owner, projectId: string): ResearchResult<ResearchMonitor[]> {
      if (owner.incognito) return { ok: true, value: [] }
      if (!deps.getProject(owner, projectId)) return { ok: false, error: 'Research project not found.' }
      return { ok: true, value: clone(deps.store.list().filter(m => m.projectId === projectId)) }
    },
    async preview(owner: Owner, projectId: string, sourceId: string, revision: string): Promise<ResearchResult<MonitorPreview>> {
      if (owner.incognito) return { ok: false, error: 'Public source monitoring is unavailable in private windows.' }
      if (releasedOwners.has(owner.id)) return { ok: false, error: 'This Research window has closed.' }
      const project = deps.getProject(owner, projectId), source = project?.sources.find(s => s.id === sourceId)
      if (!project || project.updatedAt !== revision || !source || source.provenance !== 'captured' || !source.url) return { ok: false, error: 'Reload this project and choose a locally captured source with a public URL.' }
      const records = deps.store.list()
      if (!records.some(m => m.projectId === projectId && m.sourceId === sourceId) && records.filter(m => m.status === 'active').length >= L.active) return { ok: false, error: 'Twenty active research monitors are already in use.' }
      if (!records.some(m => m.projectId === projectId && m.sourceId === sourceId) && records.filter(m => m.projectId === projectId).length >= L.perProject) return { ok: false, error: 'This project already has ten monitored sources.' }
      const controller = new AbortController(), owned = previewControllers.get(owner.id) || new Set<AbortController>()
      owned.add(controller); previewControllers.set(owner.id, owned)
      try {
        const observation = await runFetch(source.url, controller.signal)
        if (releasedOwners.has(owner.id) || controller.signal.aborted) return { ok: false, error: 'This Research window has closed.' }
        if (deps.getProject(owner, projectId)?.updatedAt !== revision) return { ok: false, error: 'This project changed during the public check. Reload before continuing.' }
        const missing = compareObservation(project, sourceId, { ...observation, text: source.text }, observation).impacts.filter(i => i.status === 'missing').map(i => i.quote)
        const token = randomUUID(), expires = deps.now().getTime() + 300_000
        previews.set(token, { ownerId: owner.id, projectId, sourceId, revision, expires, observation, missing })
        return { ok: true, value: { token, observation: clone(observation), missingQuotes: missing, expiresAt: new Date(expires).toISOString() } }
      } catch (e) { return { ok: false, error: errorText(e) } }
      finally { owned.delete(controller); if (!owned.size) previewControllers.delete(owner.id) }
    },
    confirm(owner: Owner, token: string, intervalHours: IntervalHours, notifications: boolean, acceptMismatch: boolean): ResearchResult<ResearchMonitor> {
      const preview = previews.get(token)
      if (owner.incognito || !preview || preview.ownerId !== owner.id || preview.expires <= deps.now().getTime()) return { ok: false, error: 'This public check has expired. Preview the source again.' }
      if (preview.missing.length && !acceptMismatch) return { ok: false, error: 'Confirm the missing public quotes before monitoring this version.' }
      const project = deps.getProject(owner, preview.projectId)
      if (!project || project.updatedAt !== preview.revision || !project.sources.some(s => s.id === preview.sourceId)) return { ok: false, error: 'This project changed. Reload it before starting a monitor.' }
      previews.delete(token)
      const records = deps.store.list(), existing = records.find(m => m.projectId === preview.projectId && m.sourceId === preview.sourceId)
      if ((!existing || existing.status === 'paused') && records.filter(m => m.status === 'active').length >= L.active) return { ok: false, error: 'Twenty active research monitors are already in use.' }
      if (!existing && records.filter(m => m.projectId === preview.projectId).length >= L.perProject) return { ok: false, error: 'This project already has ten monitored sources.' }
      const now = deps.now()
      const monitor: ResearchMonitor = { id: existing?.id || randomUUID(), projectId: preview.projectId, sourceId: preview.sourceId, intervalHours, notifications, status: 'active', failures: 0, nextDueAt: new Date(now.getTime() + intervalHours * 3_600_000).toISOString(), baseline: existing?.baseline || preview.observation, latest: preview.observation, changes: existing?.changes || [] }
      try { saveAll(existing ? records.map(m => m.id === existing.id ? monitor : m) : [monitor, ...records]) }
      catch (e) { return { ok: false, error: errorText(e) } }
      deps.changed(monitor.projectId)
      return { ok: true, value: clone(monitor) }
    },
    check(owner: Owner, projectId: string, monitorId: string) {
      if (owner.incognito) return Promise.resolve({ ok: false, error: 'Research monitor not found.' } as const)
      const m = get(monitorId)
      if (!m || m.projectId !== projectId) return Promise.resolve({ ok: false, error: 'Research monitor not found.' } as const)
      return checkPublic(monitorId, owner)
    },
    setPaused(owner: Owner, projectId: string, monitorId: string, paused: boolean): ResearchResult<ResearchMonitor> {
      if (owner.incognito) return { ok: false, error: 'Research monitor not found.' }
      const current = get(monitorId)
      if (!current || current.projectId !== projectId) return { ok: false, error: 'Research monitor not found.' }
      if (!paused && current.status === 'paused' && deps.store.list().filter(m => m.status === 'active').length >= L.active) return { ok: false, error: 'Twenty active research monitors are already in use.' }
      generations.set(monitorId, (generations.get(monitorId) || 0) + 1); controllers.get(monitorId)?.abort()
      const next = { ...current, status: paused ? 'paused' as const : 'active' as const, failures: paused ? current.failures : 0, error: paused ? current.error : undefined, nextDueAt: new Date(deps.now().getTime() + current.intervalHours * 3_600_000).toISOString() }
      saveAll(deps.store.list().map(m => m.id === monitorId ? next : m)); deps.changed(projectId)
      return { ok: true, value: clone(next) }
    },
    remove(owner: Owner, projectId: string, monitorId: string): ResearchResult<null> {
      if (owner.incognito) return { ok: false, error: 'Research monitor not found.' }
      const current = get(monitorId)
      if (!current || current.projectId !== projectId) return { ok: false, error: 'Research monitor not found.' }
      generations.set(monitorId, (generations.get(monitorId) || 0) + 1); controllers.get(monitorId)?.abort(); previews.forEach((p, id) => { if (p.projectId === projectId && p.sourceId === current.sourceId) previews.delete(id) })
      saveAll(deps.store.list().filter(m => m.id !== monitorId)); deps.changed(projectId)
      return { ok: true, value: null }
    },
    acknowledge(owner: Owner, projectId: string, monitorId: string, changeId: string): ResearchResult<null> {
      if (owner.incognito) return { ok: false, error: 'Research update not found.' }
      const current = get(monitorId)
      if (!current || current.projectId !== projectId || !current.changes.some(c => c.id === changeId)) return { ok: false, error: 'Research update not found.' }
      saveAll(deps.store.list().map(m => m.id === monitorId ? { ...m, changes: m.changes.map(c => c.id === changeId ? { ...c, acknowledged: true } : c) } : m)); deps.changed(projectId)
      return { ok: true, value: null }
    },
    async compareLoaded(owner: Owner, projectId: string, sourceId: string, revision: string, tabId: string): Promise<ResearchResult<MonitorComparison>> {
      const project = deps.getProject(owner, projectId), source = project?.sources.find(s => s.id === sourceId)
      if (!project || project.updatedAt !== revision || !source || !deps.capture) return { ok: false, error: 'Reload the project and choose a locally captured source.' }
      try {
        const captured = await deps.capture(owner, tabId)
        if (releasedOwners.has(owner.id)) return { ok: false, error: 'This Research window has closed.' }
        if (project.updatedAt !== deps.getProject(owner, projectId)?.updatedAt) return { ok: false, error: 'The project changed during capture. Reload before comparing.' }
        if (!source.url || !captured.url) return { ok: false, error: 'Open the selected source in this window before checking the loaded page.' }
        const actual = new URL(captured.url), expected = new URL(source.url)
        if (actual.origin !== expected.origin || actual.pathname.replace(/\/$/, '') !== expected.pathname.replace(/\/$/, '')) return { ok: false, error: 'Open the selected source in this window before checking the loaded page.' }
        const observation: Observation = { id: captured.id, requestedUrl: source.url, finalUrl: captured.url!, checkedAt: captured.capturedAt, text: captured.text, truncated: captured.truncated, kind: 'loaded-page' }
        const diff = compareObservation(project, sourceId, { ...observation, text: source.text }, observation)
        return { ok: true, value: { observation, impacts: diff.impacts, passages: diff.passages, truncated: diff.truncated } }
      } catch (e) { return { ok: false, error: errorText(e) } }
    },
    reconcile(projects: ResearchProject[]) {
      const available = new Map(projects.map(p => [p.id, new Set(p.sources.map(s => s.id))]))
      const all = deps.store.list()
      const kept = all.filter(m => available.get(m.projectId)?.has(m.sourceId))
      const deleted = all.filter(m => !available.get(m.projectId)?.has(m.sourceId))
      const removed = new Set(deleted.map(m => m.id))
      for (const id of removed) { generations.set(id, (generations.get(id) || 0) + 1); controllers.get(id)?.abort() }
      if (removed.size) { saveAll(kept); for (const projectId of new Set(deleted.map(m => m.projectId))) deps.changed(projectId) }
    },
    release(windowId: number) {
      releasedOwners.add(windowId)
      for (const controller of previewControllers.get(windowId) || []) controller.abort()
      previewControllers.delete(windowId)
      for (const [token, preview] of previews) if (preview.ownerId === windowId) previews.delete(token)
    },
    async tick() {
      if (disposed || globalFetch) return
      const now = deps.now().getTime(), due = deps.store.list().find(m => m.status === 'active' && Date.parse(m.nextDueAt) <= now)
      if (due) await checkPublic(due.id)
    },
    start() {
      if (timer) return
      void api.tick()
      timer = setInterval(() => { void api.tick() }, 60_000)
    },
    dispose() {
      disposed = true; if (timer) clearInterval(timer); timer = undefined
      for (const [id, controller] of controllers) { generations.set(id, (generations.get(id) || 0) + 1); controller.abort() }
    },
  }
  return api
}
