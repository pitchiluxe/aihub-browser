import { join } from 'node:path'
import { createManagedJsonStore } from '../../jsonStore'
import { MONITOR_LIMITS, type ResearchMonitor } from '../../../shared/research/monitorTypes'

const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 100
function validObservation(raw: any): boolean {
  return !!raw && id(raw.id) && typeof raw.requestedUrl === 'string' && typeof raw.finalUrl === 'string'
    && Number.isFinite(Date.parse(raw.checkedAt)) && typeof raw.text === 'string' && raw.text.length <= MONITOR_LIMITS.chars
    && typeof raw.truncated === 'boolean' && ['public-html', 'loaded-page'].includes(raw.kind)
}
function validateRecords(records: unknown): asserts records is ResearchMonitor[] {
  if (!Array.isArray(records)) throw Error('Research monitor storage is invalid.')
  const seen = new Set<string>(), perProject = new Map<string, number>()
  let active = 0
  for (const raw of records) {
    if (!raw || typeof raw !== 'object' || !id(raw.id) || !id(raw.projectId) || !id(raw.sourceId)
      || ![1, 6, 24].includes(raw.intervalHours) || typeof raw.notifications !== 'boolean'
      || !['active', 'paused'].includes(raw.status) || !Number.isInteger(raw.failures) || raw.failures < 0 || raw.failures > 3
      || !Number.isFinite(Date.parse(raw.nextDueAt)) || (raw.lastAttemptAt !== undefined && !Number.isFinite(Date.parse(raw.lastAttemptAt)))
      || (raw.error !== undefined && (typeof raw.error !== 'string' || raw.error.length > 1000))
      || !validObservation(raw.baseline) || !validObservation(raw.latest) || !Array.isArray(raw.changes) || raw.changes.length > MONITOR_LIMITS.history) throw Error('Research monitor storage is invalid.')
    const key = `${raw.projectId}\0${raw.sourceId}`
    if (seen.has(key)) throw Error('Research monitor storage contains duplicate sources.')
    seen.add(key)
    const count = (perProject.get(raw.projectId) || 0) + 1
    if (count > MONITOR_LIMITS.perProject) throw Error('Research monitor storage exceeds its per-project limit.')
    perProject.set(raw.projectId, count)
    if (raw.status === 'active' && ++active > MONITOR_LIMITS.active) throw Error('Research monitor storage exceeds its active limit.')
    for (const change of raw.changes) {
      if (!change || !id(change.id) || !Number.isFinite(Date.parse(change.observedAt)) || typeof change.version !== 'string' || change.version.length > 64
        || !Array.isArray(change.passages) || change.passages.length > MONITOR_LIMITS.passages
        || change.passages.some((p: any) => !p || typeof p.before !== 'string' || p.before.length > MONITOR_LIMITS.passageChars || typeof p.after !== 'string' || p.after.length > MONITOR_LIMITS.passageChars)
        || !Array.isArray(change.impacts) || change.impacts.length > 50
        || change.impacts.some((i: any) => !i || !id(i.claimId) || typeof i.quote !== 'string' || i.quote.length > 4000 || !['present', 'missing', 'already-unmatched'].includes(i.status))
        || typeof change.truncated !== 'boolean' || typeof change.acknowledged !== 'boolean') throw Error('Research monitor storage contains an invalid update record.')
    }
  }
}

export function createMonitorStore(appDir: string) {
  const data = createManagedJsonStore<{ schemaVersion: 1; monitors: ResearchMonitor[] }>(join(appDir, 'research-monitors.json'), () => ({ schemaVersion: 1, monitors: [] }))
  return {
    list(): ResearchMonitor[] {
      const value = data.get()
      if (value.schemaVersion !== 1) throw Error('Research monitor storage is invalid.')
      validateRecords(value.monitors)
      return value.monitors.map(m => JSON.parse(JSON.stringify(m)))
    },
    replace(monitors: ResearchMonitor[]): void {
      validateRecords(monitors)
      const value = { schemaVersion: 1 as const, monitors }
      if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MONITOR_LIMITS.storeBytes) throw Error('Research monitoring storage is full. Remove an old monitor before saving more history.')
      data.set(JSON.parse(JSON.stringify(value)))
    },
  }
}
