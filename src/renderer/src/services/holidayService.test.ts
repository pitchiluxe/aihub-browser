import { describe, it, expect } from 'vitest'
import { getHoliday } from './holidayService'

const on = (y: number, m: number, d: number) => getHoliday(new Date(y, m - 1, d))

describe('getHoliday — fixed dates', () => {
  it('finds New Year, Valentine, St Patrick, July 4th, Halloween', () => {
    expect(on(2026, 1, 1)?.id).toBe('new-year')
    expect(on(2026, 2, 14)?.id).toBe('valentines')
    expect(on(2026, 3, 17)?.id).toBe('st-patricks')
    expect(on(2026, 7, 4)?.id).toBe('independence')
    expect(on(2026, 10, 31)?.id).toBe('halloween')
    expect(on(2026, 12, 31)?.id).toBe('new-year-eve')
  })

  it('covers the Christmas window and names the specific days', () => {
    expect(on(2026, 12, 24)?.name).toBe('Christmas Eve')
    expect(on(2026, 12, 25)?.name).toBe('Christmas Day')
    expect(on(2026, 12, 21)?.name).toBe('Christmas season')
    // just outside the window
    expect(on(2026, 12, 19)?.id).not.toBe('christmas')
    expect(on(2026, 12, 27)?.id).not.toBe('christmas')
  })

  it('returns null on an ordinary day', () => {
    expect(on(2026, 7, 20)).toBeNull()
    expect(on(2026, 5, 6)).toBeNull()
  })
})

describe('getHoliday — computed dates', () => {
  // Easter Sundays, verified against the Gregorian calendar
  it.each([
    [2024, 3, 31],
    [2025, 4, 20],
    [2026, 4, 5],
    [2027, 3, 28],
    [2030, 4, 21],
  ])('Easter %i falls on %i/%i', (y, m, d) => {
    const h = on(y, m, d)
    expect(h?.id).toBe('easter')
    expect(h?.name).toBe('Easter Sunday')
  })

  it('includes the two days before Easter', () => {
    // Good Friday 2026 = April 3
    expect(on(2026, 4, 3)?.id).toBe('easter')
    expect(on(2026, 4, 3)?.name).toBe('Easter weekend')
    // Wednesday before is not part of the window
    expect(on(2026, 4, 1)?.id).not.toBe('easter')
  })

  // US Thanksgiving — 4th Thursday of November
  it.each([
    [2024, 11, 28],
    [2025, 11, 27],
    [2026, 11, 26],
    [2027, 11, 25],
  ])('Thanksgiving %i falls on %i/%i', (y, m, d) => {
    expect(on(y, m, d)?.id).toBe('thanksgiving')
  })

  it("finds Mother's Day (2nd Sun May) and Father's Day (3rd Sun June)", () => {
    expect(on(2026, 5, 10)?.id).toBe('mothers-day')
    expect(on(2026, 6, 21)?.id).toBe('fathers-day')
    expect(on(2025, 5, 11)?.id).toBe('mothers-day')
    expect(on(2025, 6, 15)?.id).toBe('fathers-day')
  })
})

describe('holiday payloads', () => {
  it('always supplies colours and particles the UI can render', () => {
    const samples = [
      on(2026, 1, 1), on(2026, 2, 14), on(2026, 12, 25),
      on(2026, 10, 31), on(2026, 11, 26), on(2026, 4, 5),
    ]
    for (const h of samples) {
      expect(h).not.toBeNull()
      expect(h!.colors).toHaveLength(2)
      expect(h!.colors[0]).toMatch(/^#[0-9a-f]{6}$/i)
      expect(h!.colors[1]).toMatch(/^#[0-9a-f]{6}$/i)
      expect(h!.particles.length).toBeGreaterThan(0)
      expect(h!.name.length).toBeGreaterThan(0)
    }
  })
})
