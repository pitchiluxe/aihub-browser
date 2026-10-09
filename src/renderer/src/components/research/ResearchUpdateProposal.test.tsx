// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ResearchUpdateProposal from './ResearchUpdateProposal'
import type { ResearchProject } from '../../../../shared/research/types'
let host: HTMLDivElement, root: Root
const project = (id: string, title: string): ResearchProject => ({ schemaVersion: 1, id, title, question: 'What changed?', createdAt: '2026-10-08T12:00:00.000Z', updatedAt: '2026-10-08T12:00:00.000Z', mode: 'summary', sources: [{ id: 'source', title: 'Page', url: 'https://example.com', capturedAt: '2026-10-08T12:00:00.000Z', text: 'Current page excerpt', truncated: false, captureType: 'excerpts', provenance: 'imported', excerpts: ['Current page excerpt'] }], claims: [], notes: [] })
beforeEach(() => { ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
describe('updated report proposal', () => {
  it('discloses provider use and waits for explicit generation before calling AI', async () => {
    const ai = { chat: vi.fn().mockResolvedValue({ content: JSON.stringify({ claims: [{ text: 'A new finding', citations: [{ sourceId: 'source', quote: 'Current page excerpt' }], kind: 'finding' }] }) }) }
    const bridge = { acceptProposal: vi.fn() } as any, original = project('original', 'Trip'), proposed = project('proposal', 'Updated Trip')
    await act(async () => root.render(<ResearchUpdateProposal original={original} proposal={{ token: 'token', project: proposed, monitorVersions: {} }} provider="OpenRouter cloud" bridge={bridge} ai={ai} onClose={() => {}} onAccepted={() => {}} />))
    expect(host.textContent).toContain('Generating sends the proposal\'s source passages and your saved notes to OpenRouter cloud')
    expect(ai.chat).not.toHaveBeenCalled()
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Generate proposal')!.click())
    expect(ai.chat).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('A new finding')
  })
  it('saves the accepted result separately from the original', async () => {
    const ai = { chat: vi.fn().mockResolvedValue({ content: JSON.stringify({ claims: [{ text: 'A new finding', citations: [{ sourceId: 'source', quote: 'Current page excerpt' }], kind: 'finding' }] }) }) }
    const saved = project('proposal', 'Updated Trip'), bridge = { acceptProposal: vi.fn().mockResolvedValue({ ok: true, value: saved }) }, accepted = vi.fn()
    await act(async () => root.render(<ResearchUpdateProposal original={project('original', 'Trip')} proposal={{ token: 'token', project: saved, monitorVersions: {} }} provider="Ollama" bridge={bridge as any} ai={ai} onClose={() => {}} onAccepted={accepted} />))
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Generate proposal')!.click())
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Accept as new project')!.click())
    expect(bridge.acceptProposal).toHaveBeenCalledWith(expect.objectContaining({ token: 'token', expectedUpdatedAt: '2026-10-08T12:00:00.000Z' }))
    expect(accepted).toHaveBeenCalledWith(saved)
  })
  it('disables finding edits while a regenerated draft is pending', async () => {
    let resolve!: (value: { content: string }) => void, calls = 0
    const fresh = { content: JSON.stringify({ claims: [{ text: 'Fresh', citations: [{ sourceId: 'source', quote: 'Current page excerpt' }], kind: 'finding' }] }) }
    const ai = { chat: vi.fn(() => ++calls === 1 ? Promise.resolve(fresh) : new Promise<{ content: string }>(done => { resolve = done })) }
    const proposed = project('proposal', 'Updated Trip'), original = project('original', 'Trip')
    proposed.claims = [{ id: 'old', text: 'Existing proposal', citations: [{ sourceId: 'source', quote: 'Current page excerpt' }], reviewed: false, kind: 'finding' }]
    await act(async () => root.render(<ResearchUpdateProposal original={original} proposal={{ token: 'token', project: proposed, monitorVersions: {} }} provider="Ollama" bridge={{ acceptProposal: vi.fn() } as any} ai={ai} onClose={() => {}} onAccepted={() => {}} />))
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Generate proposal')!.click())
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Regenerate proposal')!.click())
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Finding 1"]')!.disabled).toBe(true)
    expect([...host.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === 'Remove finding 1')!.disabled).toBe(true)
    await act(async () => resolve({ content: JSON.stringify({ claims: [{ text: 'Newest', citations: [{ sourceId: 'source', quote: 'Current page excerpt' }], kind: 'finding' }] }) }))
    expect(host.textContent).toContain('Newest')
  })
})
