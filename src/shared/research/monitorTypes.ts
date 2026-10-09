import type { ResearchClaim, ResearchProject, ResearchResult } from './types'
export const MONITOR_LIMITS = { active: 20, perProject: 10, bodyBytes: 1024 * 1024, storeBytes: 10 * 1024 * 1024, chars: 12000, history: 10, passages: 20, passageChars: 1000, deadlineMs: 15000 } as const
export type IntervalHours = 1 | 6 | 24
export interface Observation { id: string; requestedUrl: string; finalUrl: string; checkedAt: string; text: string; truncated: boolean; kind: 'public-html' | 'loaded-page' }
export interface Impact { claimId: string; quote: string; status: 'present' | 'missing' | 'already-unmatched' }
export interface PassageChange { before: string; after: string }
export interface MonitorChange { id: string; observedAt: string; version: string; passages: PassageChange[]; impacts: Impact[]; truncated: boolean; acknowledged: boolean }
export interface ResearchMonitor { id: string; projectId: string; sourceId: string; intervalHours: IntervalHours; notifications: boolean; status: 'active' | 'paused'; failures: number; lastAttemptAt?: string; nextDueAt: string; error?: string; baseline: Observation; latest: Observation; changes: MonitorChange[] }
export interface MonitorInput { projectId: string; sourceId: string; expectedUpdatedAt: string }
export interface MonitorAction { projectId: string; monitorId: string }
export interface MonitorPreview { token: string; observation: Observation; missingQuotes: string[]; expiresAt: string }
export interface MonitorComparison { observation: Observation; impacts: Impact[]; passages: PassageChange[]; truncated: boolean }
export interface MonitorProposal { token: string; project: ResearchProject; monitorVersions: Record<string, string> }
export interface ResearchMonitorBridge {
  list(projectId: string): Promise<ResearchResult<ResearchMonitor[]>>
  preview(input: MonitorInput): Promise<ResearchResult<MonitorPreview>>
  confirm(input: MonitorInput & { token: string; intervalHours: IntervalHours; notifications: boolean; acceptMismatch: boolean }): Promise<ResearchResult<ResearchMonitor>>
  check(input: MonitorAction): Promise<ResearchResult<ResearchMonitor>>
  setPaused(input: MonitorAction & { paused: boolean }): Promise<ResearchResult<ResearchMonitor>>
  remove(input: MonitorAction): Promise<ResearchResult<null>>
  acknowledge(input: MonitorAction & { changeId: string }): Promise<ResearchResult<null>>
  compareLoaded(input: MonitorInput & { tabId: string }): Promise<ResearchResult<MonitorComparison>>
  prepareProposal(input: { projectId: string; expectedUpdatedAt: string }): Promise<ResearchResult<MonitorProposal>>
  acceptProposal(input: { token: string; expectedUpdatedAt: string; claims: ResearchClaim[] }): Promise<ResearchResult<ResearchProject>>
  onChanged(listener: (event: { projectId: string }) => void): () => void
  onOpenProject(listener: (projectId: string) => void): () => void
}
