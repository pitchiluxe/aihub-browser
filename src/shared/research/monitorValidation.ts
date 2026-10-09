import type { MonitorInput } from './monitorTypes'
import type { ResearchResult } from './types'
export function monitorId(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 100) throw Error('Invalid research identifier.')
  return raw
}
export function monitorRevision(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 32 || !Number.isFinite(Date.parse(raw))) throw Error('Invalid project revision.')
  return raw
}
export function monitorObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Invalid research monitoring request.')
  return raw as Record<string, unknown>
}
export function validateMonitorInput(raw: unknown): ResearchResult<MonitorInput> {
  try { const r = monitorObject(raw); return { ok: true, value: { projectId: monitorId(r.projectId), sourceId: monitorId(r.sourceId), expectedUpdatedAt: monitorRevision(r.expectedUpdatedAt) } } }
  catch (e) { return { ok: false, error: (e as Error).message } }
}
