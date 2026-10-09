import { ipcMain } from 'electron'
import { createMonitorService } from './service'
import { createMonitorStore } from './store'
import { monitorId, monitorObject, validateMonitorInput } from '../../../shared/research/monitorValidation'
import type { ResearchWindow } from '../index'
import type { IntervalHours } from '../../../shared/research/monitorTypes'

export function registerMonitorIpc(options: {
  appDir: string
  resolveWindow(event: Electron.IpcMainInvokeEvent): ResearchWindow | undefined
  getProject(owner: ResearchWindow, id: string): import('../../../shared/research/types').ResearchProject | undefined
  getNormalProject(id: string): import('../../../shared/research/types').ResearchProject | undefined
  saveProject(owner: ResearchWindow, project: import('../../../shared/research/types').ResearchProject): import('../../../shared/research/types').ResearchResult<import('../../../shared/research/types').ResearchProject>
  capture(owner: ResearchWindow, tabId: string): Promise<import('../../../shared/research/types').CapturedSource>
  changed(projectId: string): void
  notify(projectId: string, updateCount: number): void
}) {
  const service = createMonitorService({
    store: createMonitorStore(options.appDir),
    getProject: options.getProject,
    getNormalProject: options.getNormalProject,
    saveProject: options.saveProject,
    capture: options.capture,
    now: () => new Date(),
    changed: options.changed,
    notify: options.notify,
  })
  const handle = (channel: string, work: (owner: ResearchWindow, value: Record<string, unknown>) => unknown) => {
    ipcMain.handle(channel, async (event, raw) => {
      try {
        const owner = options.resolveWindow(event)
        if (!owner) throw Error('Research window unavailable.')
        return await work(owner, monitorObject(raw))
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Research monitor request failed.' } }
    })
  }
  const input = (value: Record<string, unknown>) => {
    const checked = validateMonitorInput(value)
    if (!checked.ok) throw Error(checked.error)
    return checked.value
  }
  const action = (value: Record<string, unknown>) => ({ projectId: monitorId(value.projectId), monitorId: monitorId(value.monitorId) })

  handle('research:monitors-list', (owner, raw) => service.list(owner, monitorId(raw.projectId)))
  handle('research:monitors-preview', (owner, raw) => { const v = input(raw); return service.preview(owner, v.projectId, v.sourceId, v.expectedUpdatedAt) })
  handle('research:monitors-confirm', (owner, raw) => {
    const token = monitorId(raw.token), interval = raw.intervalHours
    if (![1, 6, 24].includes(interval as number) || typeof raw.notifications !== 'boolean' || typeof raw.acceptMismatch !== 'boolean') throw Error('Invalid public monitor settings.')
    return service.confirm(owner, token, interval as IntervalHours, raw.notifications, raw.acceptMismatch)
  })
  handle('research:monitors-check', (owner, raw) => { const a = action(raw); return service.check(owner, a.projectId, a.monitorId) })
  handle('research:monitors-pause', (owner, raw) => { const a = action(raw); if (typeof raw.paused !== 'boolean') throw Error('Invalid monitor state.'); return service.setPaused(owner, a.projectId, a.monitorId, raw.paused) })
  handle('research:monitors-remove', (owner, raw) => { const a = action(raw); return service.remove(owner, a.projectId, a.monitorId) })
  handle('research:monitors-acknowledge', (owner, raw) => { const a = action(raw); return service.acknowledge(owner, a.projectId, a.monitorId, monitorId(raw.changeId)) })
  handle('research:monitors-compare-loaded', (owner, raw) => {
    const v = input(raw), tabId = monitorId(raw.tabId)
    return service.compareLoaded(owner, v.projectId, v.sourceId, v.expectedUpdatedAt, tabId)
  })
  handle('research:monitors-proposal-prepare', (owner, raw) => {
    const projectId = monitorId(raw.projectId), revision = monitorId(raw.expectedUpdatedAt)
    if (!/^\d{4}-\d\d-\d\dT/.test(revision) || !Number.isFinite(Date.parse(revision))) throw Error('Invalid project revision.')
    return service.prepareProposal(owner, projectId, revision)
  })
  handle('research:monitors-proposal-accept', (owner, raw) => {
    const token = monitorId(raw.token), revision = monitorId(raw.expectedUpdatedAt)
    if (!/^\d{4}-\d\d-\d\dT/.test(revision) || !Number.isFinite(Date.parse(revision)) || !Array.isArray(raw.claims) || raw.claims.length > 50) throw Error('Invalid updated report proposal.')
    return service.acceptProposal(owner, token, revision, raw.claims as import('../../../shared/research/types').ResearchClaim[])
  })
  service.start()
  return service
}
