import { describe, it, expect } from 'vitest'
import { severityOf, groupReasons, oldestReportAt } from './ModerationPanel'

describe('severityOf', () => {
  it('escalates with the report count', () => {
    expect(severityOf(1)).toBe('low')
    expect(severityOf(2)).toBe('low')
    // Three is the store's auto-hide threshold, so the queue should look
    // different at exactly that point.
    expect(severityOf(3)).toBe('mid')
    expect(severityOf(4)).toBe('mid')
    expect(severityOf(5)).toBe('high')
    expect(severityOf(40)).toBe('high')
  })
})

describe('groupReasons', () => {
  it('collapses identical complaints and counts them', () => {
    expect(groupReasons([
      { reason: 'spam' }, { reason: 'Spam' }, { reason: '  spam ' },
      { reason: 'abuse' },
    ])).toEqual([
      { reason: 'spam', count: 3 },
      { reason: 'abuse', count: 1 },
    ])
  })

  it('puts the most-repeated complaint first', () => {
    const out = groupReasons([{ reason: 'a' }, { reason: 'b' }, { reason: 'b' }])
    expect(out[0]).toEqual({ reason: 'b', count: 2 })
  })

  it('keeps the first spelling it saw, not the last', () => {
    expect(groupReasons([{ reason: 'Harassment' }, { reason: 'harassment' }]))
      .toEqual([{ reason: 'Harassment', count: 2 }])
  })

  it('drops empty reasons rather than rendering a blank chip', () => {
    expect(groupReasons([{ reason: '' }, { reason: '   ' }])).toEqual([])
  })

  it('survives junk input', () => {
    expect(groupReasons([])).toEqual([])
    expect(groupReasons(undefined as any)).toEqual([])
    expect(groupReasons([{ reason: null as any }])).toEqual([])
  })
})

describe('oldestReportAt', () => {
  const row = (times: number[]) => ({
    message: {} as any, count: times.length, hidden: false,
    reports: times.map((createdAt, i) => ({ id: `r${i}`, reason: 'x', createdAt })),
  })

  it('finds the earliest report across every case', () => {
    expect(oldestReportAt([row([500, 900]), row([200, 700])] as any)).toBe(200)
  })

  it('is null when nothing is waiting', () => {
    expect(oldestReportAt([])).toBeNull()
    expect(oldestReportAt([row([])] as any)).toBeNull()
  })

  it('ignores rows whose timestamps are missing', () => {
    const broken = { message: {} as any, count: 1, hidden: false, reports: [{ id: 'r', reason: 'x' }] }
    expect(oldestReportAt([broken, row([400])] as any)).toBe(400)
  })
})
