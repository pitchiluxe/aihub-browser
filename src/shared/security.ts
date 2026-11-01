export interface SecurityFinding { code: string; severity: 'info' | 'warning' | 'high'; title: string; detail: string }
export type ScanState = 'pending' | 'scanning' | 'no-threats-found' | 'detected' | 'blocked' | 'failed' | 'unavailable'
export interface FileScan { state: ScanState; checkedAt: number; message: string; fingerprint?: string }
export interface DefenderStatus {
  available: boolean; active: boolean; realTime: boolean; mode: string
  signaturesUpdated?: string; lastQuickScan?: string; message?: string
}
export interface SecurityEvent {
  id: string; at: number; kind: 'download' | 'html' | 'phishing' | 'scan' | 'agent'
  title: string; detail: string; severity: 'info' | 'warning' | 'high'; findings?: SecurityFinding[]
}
export interface AgentReport { summary: string; recommendations: string[] }
export interface SecuritySnapshot { defender: DefenderStatus; events: SecurityEvent[]; busy: boolean; model: string }
export type SecurityResult<T> = { ok: true; value: T } | { ok: false; error: string }
