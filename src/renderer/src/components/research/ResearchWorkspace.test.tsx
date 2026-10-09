// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { it, expect, beforeEach, afterEach, vi } from 'vitest'
import ResearchWorkspace from './ResearchWorkspace'
vi.mock('../../store/browserStore', () => ({ useBrowserStore: (select: any) => select({ tabs: [{ id: 'tab', title: 'Evidence page', url: 'https://example.org', pageType: 'browser', isHome: false, isLoading: false }] }) }))
vi.mock('../../services/incognitoMode', () => ({ IS_INCOGNITO: false }))
let host: HTMLDivElement, root: Root
const capture = vi.fn(), save = vi.fn()
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)!
beforeEach(async () => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear(); capture.mockReset(); save.mockReset()
  const date = new Date().toISOString()
  capture.mockResolvedValue({ ok: true, value: { id: 'source', title: 'Evidence page', url: 'https://example.org', capturedAt: date, text: 'Actual page evidence.', truncated: false, captureType: 'page', provenance: 'captured' } })
  save.mockImplementation(async value => ({ ok: true, value }))
  ;(window as any).electronAPI = { research: { list: async () => ({ ok: true, value: [] }), save, capture, remove: async () => ({ ok: true, value: null }) }, settings: { getAIConfig: async () => ({ primaryProvider: 'ollama' }) }, ai: { chat: async () => ({ content: JSON.stringify({ claims: [{ text: 'Actual finding', citations: [{ sourceId: 'source', quote: 'Actual page evidence.' }] }, { text: 'Unproven finding', citations: [{ sourceId: 'source', quote: 'Invented' }] }] }) }) } }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<ResearchWorkspace />))
  await act(async () => button('New project').click())
})
afterEach(() => { act(() => root.unmount()); host.remove(); delete (window as any).electronAPI })
it('starts with no selected tabs and captures only a selected source after consent', async () => {
  expect(host.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false)
  expect(button('Capture selected').disabled).toBe(true)
  act(() => host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
  await act(async () => button('Capture selected').click())
  expect(capture).not.toHaveBeenCalled()
  await act(async () => button('Allow capture').click())
  expect(capture).toHaveBeenCalledWith('tab')
})
it('inspects matched and unmatched evidence and clears review after editing', async () => {
  act(() => host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
  await act(async () => button('Capture selected').click())
  await act(async () => button('Allow capture').click())
  await act(async () => button('Generate report').click())
  expect(host.textContent).toContain('Actual finding'); expect(host.textContent).toContain('Unmatched quote')
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent?.includes('View evidence'))!.click())
  expect(host.querySelector('mark')?.textContent).toBe('Actual page evidence.')
  act(() => button('Close evidence').click())
  await act(async () => button('Mark reviewed').click())
  expect(save.mock.calls.at(-1)![0].claims[0].reviewed).toBe(true)
  const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Finding 1"]')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Edited finding'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(save.mock.calls.at(-1)![0].claims[0].reviewed).toBe(false)
})
it('ignores a late AI response after switching to a different project', async () => {
  act(() => host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
  await act(async () => button('Capture selected').click())
  await act(async () => button('Allow capture').click())
  let finish!: (value: any) => void
  ;(window as any).electronAPI.ai.chat = () => new Promise(resolve => { finish = resolve })
  act(() => button('Generate report').click())
  await act(async () => button('New project').click())
  await act(async () => finish({ content: JSON.stringify({ claims: [{ text: 'Stale result', citations: [] }] }) }))
  expect(host.textContent).not.toContain('Stale result')
  expect(save.mock.calls.at(-1)![0].claims).toEqual([])
})
it('removes an individual finding and persists its removal after reopening', async () => {
  act(() => host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
  await act(async () => button('Capture selected').click())
  await act(async () => button('Allow capture').click())
  await act(async () => button('Generate report').click())
  const remove = host.querySelector<HTMLButtonElement>('button[aria-label="Remove finding 1"]')
  expect(remove).not.toBeNull(); if (!remove) return
  await act(async () => remove.click())
  const stored = save.mock.calls.at(-1)![0]
  expect(stored.claims).toHaveLength(1); expect(stored.claims[0].text).toBe('Unproven finding')
  ;(window as any).electronAPI.research.list = async () => ({ ok: true, value: [stored] })
  act(() => root.unmount()); root = createRoot(host)
  await act(async () => root.render(<ResearchWorkspace />))
  expect(host.textContent).not.toContain('Actual finding'); expect(host.textContent).toContain('Unproven finding')
})
it('keeps overflow and long previous notes accessible after migration and reopening', async () => {
  const old = [...Array.from({ length: 101 }, (_, i) => ({ id: `old-${i}`, text: `Legacy note ${i}`, addedAt: Date.now() })), { id: 'long', text: 'LONG ORIGINAL ' + 'x'.repeat(4001), addedAt: Date.now() }]
  localStorage.setItem('aihub-research-notes-v1', JSON.stringify(old))
  act(() => root.unmount()); root = createRoot(host)
  await act(async () => root.render(<ResearchWorkspace />))
  expect(button('Previous notepad')).toBeDefined()
  await act(async () => button('Previous notepad').click())
  while (!host.textContent?.includes('Legacy note 100')) { const next = button('Next notes'); expect(next).toBeDefined(); if (!next) break; act(() => next.click()) }
  expect(host.textContent).toContain('Legacy note 100'); expect(host.textContent).toContain('LONG ORIGINAL')
  act(() => button('Close previous notes').click())
  act(() => root.unmount()); root = createRoot(host)
  await act(async () => root.render(<ResearchWorkspace />))
  expect(button('Previous notepad')).toBeDefined(); expect(localStorage.getItem('aihub-research-notes-v1')).toBe(JSON.stringify(old))
})
it('exports the complete unsaved draft after a revision conflict, including notes', async () => {
  const saveText = vi.fn().mockResolvedValue({ success: true })
  ;(window as any).electronAPI.file = { saveText, saveMd: vi.fn().mockResolvedValue({ success: true }) }
  save.mockResolvedValueOnce({ ok: false, error: 'This project changed in another window. Reload before editing.' })
  const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="New note"]')!
  act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Unsaved idea'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => button('Add note').click())
  await act(async () => button('Export unsaved draft').click())
  expect(saveText).toHaveBeenCalledOnce()
  expect(JSON.parse(saveText.mock.calls[0][0].content).notes[0].text).toBe('Unsaved idea')
})
