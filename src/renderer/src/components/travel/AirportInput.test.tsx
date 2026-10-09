// @vitest-environment jsdom
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi } from 'vitest'
import AirportInput from './AirportInput'
import ResearchBrief from './ResearchBrief'
function Fixture() { const [value, setValue] = useState(''); return <AirportInput label="From" value={value} onChange={setValue} /> }
describe('airport selection and formatted research', () => {
  it('offers the correct airport for an ICAO code and selects it with the keyboard', () => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    act(() => root.render(<Fixture />))
    const input = host.querySelector('input')!
    act(() => {
      input.focus()
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'KJFK')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(host.querySelector('[role="option"]')?.textContent).toContain('John F. Kennedy')
    expect(host.querySelector('[role="option"]')?.textContent).toContain('KJFK')
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(input.value).toMatch(/^JFK · /)
    expect(input.getAttribute('aria-expanded')).toBe('false')
    act(() => root.unmount()); host.remove()
  })
  it('renders headings, lists and tables while disabling unverified links and images', () => {
    const host = document.createElement('div'); const root = createRoot(host); const navigate = vi.fn()
    act(() => root.render(<ResearchBrief research={{ text: '## Best options\n\n- Compare baggage\n- Check dates\n\n| Option | Cost check |\n| --- | --- |\n| Airline | Bags |\n\n[Verified](https://example.com) [Unverified](https://fake.test) ![Tracking](https://fake.test/a.png)', sources: [{ title: 'Source', url: 'https://example.com', snippet: '' }], at: '', provider: 'AI' }} onNavigate={navigate} />))
    expect(host.querySelector('h2')?.textContent).toBe('Best options')
    expect(host.querySelectorAll('li')).toHaveLength(2)
    expect(host.querySelectorAll('table')).toHaveLength(1)
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelectorAll('button')).toHaveLength(1)
    act(() => host.querySelector('button')!.click())
    expect(navigate).toHaveBeenCalledWith('https://example.com')
    act(() => root.unmount())
  })
})
