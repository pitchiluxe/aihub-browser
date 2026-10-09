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
