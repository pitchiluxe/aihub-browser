// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ResearchUpdates from './ResearchUpdates'
import type { ResearchMonitor, ResearchMonitorBridge } from '../../../../shared/research/monitorTypes'
import type { ResearchProject } from '../../../../shared/research/types'

let host: HTMLDivElement, root: Root
const now = '2026-10-08T12:00:00.000Z'
const quote = 'Price is $120'
const project: ResearchProject = { schemaVersion: 1, id: 'p', title: 'Trip', question: '', createdAt: now, updatedAt: now, mode: 'summary', sources: [{ id: 's', title: 'Fare source', url: 'https://example.com/', capturedAt: now, text: quote, truncated: false, captureType: 'page', provenance: 'captured' }], claims: [{ id: 'c', text: 'Fare finding', citations: [{ sourceId: 's', quote }], reviewed: true, kind: 'finding' }], notes: [] }
const monitor: ResearchMonitor = { id: 'm', projectId: 'p', sourceId: 's', intervalHours: 24, notifications: false, status: 'active', failures: 0, nextDueAt: now, baseline: { id: 'b', requestedUrl: 'https://example.com/', finalUrl: 'https://example.com/', checkedAt: now, text: quote, truncated: false, kind: 'public-html' }, latest: { id: 'l', requestedUrl: 'https://example.com/', finalUrl: 'https://example.com/', checkedAt: now, text: 'Price is $150', truncated: false, kind: 'public-html' }, changes: [{ id: 'change', observedAt: now, version: 'v', passages: [{ before: quote, after: 'Price is $150' }], impacts: [{ claimId: 'c', quote, status: 'missing' }], truncated: false, acknowledged: false }] }
beforeEach(() => { ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('research updates', () => {
  it('explains a missing citation and dismissing an alert never marks the finding reviewed', async () => {
    const acknowledge = vi.fn().mockResolvedValue({ ok: true, value: null })
    const bridge = { acknowledge } as unknown as ResearchMonitorBridge
    await act(async () => root.render(<ResearchUpdates project={project} monitors={[monitor]} bridge={bridge} loading={false} error="" onClose={vi.fn()} onRefresh={async () => {}} onPrepareProposal={vi.fn()} />))
    expect(host.textContent).toContain('Quoted passage missing from latest observation')
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Dismiss update')!.click())
    expect(acknowledge).toHaveBeenCalledWith({ projectId: 'p', monitorId: 'm', changeId: 'change' })
    expect(project.claims[0].reviewed).toBe(true)
  })
})
