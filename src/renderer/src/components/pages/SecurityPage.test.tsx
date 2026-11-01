// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SecurityPage from './SecurityPage'

describe('Security Center', () => {
  beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true })
  it('shows unavailable protection honestly and disables scan controls', async () => {
    ;(window as any).electronAPI = { security: { snapshot: vi.fn().mockResolvedValue({ ok: true, value: { defender: { available: false, active: false, realTime: false, mode: 'Unavailable', message: 'Windows only' }, events: [], busy: false, model: '' } }) } }
    const host = document.createElement('div'), root = createRoot(host)
    await act(async () => root.render(<SecurityPage />))
    expect(host.textContent).toContain('Defender unavailable')
    expect(host.textContent).not.toContain('Defender protection active')
    const scans = [...host.querySelectorAll<HTMLButtonElement>('button')].filter(b => /^(Quick|Full|File|Folder) scan$/.test(b.textContent || ''))
    expect(scans).toHaveLength(4)
    expect(scans.every(b => b.disabled)).toBe(true)
    act(() => root.unmount())
  })
  it('reports local analyst failure without inventing an AI report', async () => {
    ;(window as any).electronAPI = { security: {
      snapshot: vi.fn().mockResolvedValue({ ok: true, value: { defender: { available: true, active: true, realTime: true, mode: 'Normal' }, events: [], busy: false, model: 'local' } }),
      analyze: vi.fn().mockResolvedValue({ ok: false, error: 'Ollama is offline' }),
    } }
    const host = document.createElement('div'), root = createRoot(host)
    await act(async () => root.render(<SecurityPage />))
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Ollama is offline')
    expect(host.textContent).not.toContain('AI interpretation')
    act(() => root.unmount())
  })
})
