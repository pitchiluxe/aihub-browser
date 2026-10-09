import { describe, expect, it } from 'vitest'
import { createTripEstimate, summarizeTripEstimate, validateTripEstimate } from './tripCosts'

describe('trip cost estimates', () => {
  it('starts with explicit unknown fees and a dated currency', () => {
    const estimate = createTripEstimate('USD', new Date('2026-10-09T12:00:00.000Z'))
    const summary = summarizeTripEstimate(estimate)
    expect(summary.knownTotalCents).toBe(0)
    expect(summary.unknownCount).toBe(7)
    expect(estimate.updatedAt).toBe('2026-10-09T12:00:00.000Z')
  })

  it('sums entered decimal costs in cents and leaves the remaining categories unknown', () => {
    const estimate = createTripEstimate('EUR')
    estimate.lines[0].amount = '120.45'
    estimate.lines[1].amount = '9.5'
    const summary = summarizeTripEstimate(estimate)
    expect(summary.knownTotalCents).toBe(12995)
    expect(summary.unknownCount).toBe(5)
  })

  it('rejects negative, malformed, oversized and unsupported estimates', () => {
    const estimate = createTripEstimate('USD')
    expect(validateTripEstimate({ ...estimate, lines: [{ ...estimate.lines[0], amount: '-1' }] })).not.toBeNull()
    expect(validateTripEstimate({ ...estimate, currency: 'XYZ' })).not.toBeNull()
    expect(validateTripEstimate({ ...estimate, lines: [{ ...estimate.lines[0], amount: '1e6' }] })).not.toBeNull()
    expect(validateTripEstimate({ ...estimate, lines: Array.from({ length: 8 }, (_, i) => ({ ...estimate.lines[0], id: String(i) })) })).not.toBeNull()
  })
})
