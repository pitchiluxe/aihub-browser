// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { it, expect, vi } from 'vitest'
import CapsulePreview from './CapsulePreview'
it('requires explicit export and blocks unsafe edited links', async () => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  const onExport = vi.fn(), when = new Date().toISOString(), host = document.createElement('div'), root = createRoot(host)
  document.body.append(host)
  const project = { schemaVersion: 1 as const, id: 'p', title: 'Study', question: '', createdAt: when, updatedAt: when, mode: 'summary' as const, sources: [{ id: 's', title: 'Source', url: 'https://example.org', capturedAt: when, text: 'Evidence.', captureType: 'page' as const, provenance: 'captured' as const, truncated: false }], claims: [{ id: 'c', text: 'Finding', citations: [{ sourceId: 's', quote: 'Evidence.' }], reviewed: false, kind: 'finding' as const }], notes: [] }
  await act(async () => root.render(<CapsulePreview project={project} onClose={() => {}} onExport={onExport} />))
  expect(onExport).not.toHaveBeenCalled()
  const url = host.querySelector<HTMLInputElement>('input[aria-label="Shared URL for Source"]')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(url, 'javascript:alert(1)'); url.dispatchEvent(new Event('input', { bubbles: true })) })
  expect(host.querySelector<HTMLButtonElement>('button[data-export]')!.disabled).toBe(true)
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(url, ''); url.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => host.querySelector<HTMLButtonElement>('button[data-export]')!.click())
  expect(onExport).toHaveBeenCalledOnce(); expect(onExport.mock.calls[0][0].sources[0].url).toBeUndefined()
  act(() => root.unmount()); host.remove()
})
