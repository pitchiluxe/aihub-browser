// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ResearchMonitorSetup from './ResearchMonitorSetup'
import type { ResearchMonitorBridge } from '../../../../shared/research/monitorTypes'
import type { CapturedSource, ResearchProject } from '../../../../shared/research/types'

let host: HTMLDivElement, root: Root
const now = '2026-10-08T12:00:00.000Z'
const source: CapturedSource = { id: 's', title: 'Evidence', url: 'https://example.com/', capturedAt: now, text: 'Saved price is $120', truncated: false, captureType: 'page', provenance: 'captured' }
const project: ResearchProject = { schemaVersion: 1, id: 'p', title: 'Trip', question: '', createdAt: now, updatedAt: now, mode: 'summary', sources: [source], claims: [], notes: [] }
const observation = { id: 'o', requestedUrl: source.url!, finalUrl: source.url!, checkedAt: now, text: 'Public price is $150', truncated: false, kind: 'public-html' as const }
const click = (name: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.includes(name))!
beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('research monitor setup', () => {
  it('shows missing saved quotes and blocks confirmation until the user accepts the difference', async () => {
    const confirm = vi.fn().mockResolvedValue({ ok: true, value: {} })
    const bridge = { preview: vi.fn().mockResolvedValue({ ok: true, value: { token: 't', observation, missingQuotes: [source.text], expiresAt: now } }), confirm } as unknown as ResearchMonitorBridge
    const onCreated = vi.fn()
    await act(async () => root.render(<ResearchMonitorSetup project={project} source={source} bridge={bridge} onClose={vi.fn()} onCreated={onCreated} />))
    await act(async () => click('Preview public version').click())
    expect(host.textContent).toContain('Public version differs')
    expect(host.textContent).toContain(source.text)
    expect(click('Start monitoring').disabled).toBe(true)
    await act(async () => host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[1].click())
    await act(async () => click('Start monitoring').click())
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ intervalHours: 24, acceptMismatch: true }))
    expect(onCreated).toHaveBeenCalledOnce()
  })
})
