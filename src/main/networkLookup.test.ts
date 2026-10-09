import { describe, expect, it, vi } from 'vitest'
import { invokeLookupCallback } from './networkLookup'

describe('invokeLookupCallback', () => {
  const records = [{ address: '192.0.2.1', family: 4 }]

  it('returns the address list when Node requests all results', () => {
    const callback = vi.fn()
    invokeLookupCallback(callback, true, null, records)
    expect(callback).toHaveBeenCalledWith(null, records)
  })

  it('returns a single address and family for the standard overload', () => {
    const callback = vi.fn()
    invokeLookupCallback(callback, false, null, records)
    expect(callback).toHaveBeenCalledWith(null, '192.0.2.1', 4)
  })

  it('preserves the requested overload when reporting lookup failure', () => {
    const callback = vi.fn()
    const error = Object.assign(new Error('lookup failed'), { code: 'ENOTFOUND' })
    invokeLookupCallback(callback, true, error, [])
    expect(callback).toHaveBeenCalledWith(error, [])
  })
})