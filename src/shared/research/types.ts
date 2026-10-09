export const RESEARCH_LIMITS = { sources: 10, sourceChars: 12_000, claims: 50, projects: 20, importBytes: 5 * 1024 * 1024, titleChars: 200, questionChars: 2_000, claimChars: 2_000, quoteChars: 4_000, notes: 100, noteChars: 4_000 } as const
export type ResearchMode = 'summary' | 'compare' | 'bibliography'
export interface CapturedSource { id: string; title: string; url?: string; capturedAt: string; text: string; truncated: boolean; captureType: 'page' | 'transcript' | 'excerpts'; provenance: 'captured' | 'imported'; excerpts?: string[] }
export interface Citation { sourceId: string; quote: string }
export interface ResearchClaim { id: string; text: string; citations: Citation[]; reviewed: boolean; kind: 'finding' | 'suggested-disagreement' }
export interface ResearchNote { id: string; text: string; createdAt: string }
export interface ResearchProject { schemaVersion: 1; id: string; title: string; question: string; createdAt: string; updatedAt: string; mode: ResearchMode; sources: CapturedSource[]; claims: ResearchClaim[]; notes: ResearchNote[] }
export interface EvidenceMatch { sourceId: string; quote: string; start: number; end: number }
export interface CapsuleSource { id: string; title: string; url?: string; capturedAt: string; excerpts: string[]; truncated: boolean }
export interface ResearchCapsule { schemaVersion: 1; kind: 'aihub-research-capsule'; title: string; question: string; mode: ResearchMode; exportedAt: string; sources: CapsuleSource[]; claims: ResearchClaim[] }
export type ResearchResult<T> = { ok: true; value: T } | { ok: false; error: string }
export interface ResearchBridge { list(): Promise<ResearchResult<ResearchProject[]>>; save(project: ResearchProject, expectedUpdatedAt?: string | null): Promise<ResearchResult<ResearchProject>>; remove(projectId: string): Promise<ResearchResult<null>>; capture(tabId: string): Promise<ResearchResult<CapturedSource>>; monitors: import('./monitorTypes').ResearchMonitorBridge }
