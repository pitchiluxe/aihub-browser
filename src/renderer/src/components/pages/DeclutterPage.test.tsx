// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DeclutterPage from './DeclutterPage'

const state = vi.hoisted((): { tabs: any[]; tabWcIds: Record<string, number> } => ({
  tabs: [
    { id: 'one', url: 'https://example.com/a', pageType: 'browser', isHome: false, asleep: false },
    { id: 'two', url: 'https://other.example.com/', pageType: 'browser', isHome: false, asleep: false },
    { id: 'sleep', url: 'https://example.com/', pageType: 'browser', isHome: false, asleep: true },
  ],
  tabWcIds: { one: 11, two: 22, sleep: 33 },
}))
const execScript = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }))
vi.mock('../../store/browserStore', () => ({ useBrowserStore: Object.assign((selector: (value: any) => unknown) => selector(state), { getState: () => state }) }))
vi.mock('../../extensions/declutterRules', async () => await vi.importActual('../../extensions/declutterRules'))

describe('DeclutterPage', () => {
  beforeEach(() => {
    localStorage.clear(); execScript.mockClear()
    ;(window as any).electronAPI = { webview: { execScript } }
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  })

  it('requires a live matching website tab to preview', () => {
    state.tabWcIds = {}
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    act(() => root.render(<DeclutterPage />))
    expect(host.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true)
    act(() => root.unmount()); host.remove()
    state.tabWcIds = { one: 11, two: 22, sleep: 33 }
  })

  it('rejects invalid selectors and applies a valid preview only to exact-origin live tabs', async () => {
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    await act(async () => root.render(<DeclutterPage />))
    const input = host.querySelector('textarea')!
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'div:not('); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Invalid CSS selector')
    expect(execScript).not.toHaveBeenCalled()
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '.sidebar'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
    expect(execScript).toHaveBeenCalledTimes(1)
    expect(execScript).toHaveBeenCalledWith(11, expect.stringContaining('.sidebar'))
    act(() => root.unmount()); host.remove()
  })

  it('pauses and deletes a saved rule, clearing styles from matching open tabs', async () => {
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    await act(async () => root.render(<DeclutterPage />))
    const input = host.querySelector('textarea')!
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '.sidebar'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
    execScript.mockClear()
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label^="Pause"]')!.click())
    expect(JSON.parse(localStorage.getItem('aihub-site-declutter-v1') || '[]')[0].enabled).toBe(false)
    expect(execScript).toHaveBeenCalledWith(11, expect.not.stringContaining('.sidebar'))
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label^="Delete"]')!.click())
    expect(JSON.parse(localStorage.getItem('aihub-site-declutter-v1') || '[]')).toEqual([])
    act(() => root.unmount()); host.remove()
  })
})
