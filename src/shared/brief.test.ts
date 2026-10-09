import { describe, it, expect } from 'vitest'
import { buildBrief, greeting, formatEventTime, ago, senderName, summarise, DAY_MS } from './brief'

const NOW = new Date('2026-08-31T08:00:00').getTime()

describe('greeting', () => {
  it('matches the hour rather than assuming morning', () => {
    expect(greeting(new Date('2026-08-31T09:00:00').getTime())).toBe('Good morning')
    expect(greeting(new Date('2026-08-31T14:00:00').getTime())).toBe('Good afternoon')
    expect(greeting(new Date('2026-08-31T21:00:00').getTime())).toBe('Good evening')
    expect(greeting(new Date('2026-08-31T02:00:00').getTime())).toBe('Still up')
  })
})

describe('formatEventTime', () => {
  it('gives a bare clock time for today', () => {
    expect(formatEventTime(new Date('2026-08-31T15:30:00').getTime(), NOW)).toMatch(/3:30/)
  })
  it('says tomorrow when it is tomorrow', () => {
    expect(formatEventTime(new Date('2026-09-01T09:00:00').getTime(), NOW)).toMatch(/^tomorrow /)
  })
  it('names the weekday further out', () => {
    const out = formatEventTime(new Date('2026-09-04T09:00:00').getTime(), NOW)
    expect(out).not.toMatch(/tomorrow/)
    expect(out).toMatch(/^[A-Z][a-z]{2} /)
  })
})

describe('ago', () => {
  it('scales the unit', () => {
    expect(ago(NOW - 5 * 60_000, NOW)).toBe('5m ago')
    expect(ago(NOW - 3 * 3_600_000, NOW)).toBe('3h ago')
    expect(ago(NOW - 2 * DAY_MS, NOW)).toBe('2d ago')
  })
  it('is empty when there is no timestamp', () => {
    expect(ago(undefined, NOW)).toBe('')
  })
})

describe('senderName', () => {
  it('prefers the display name', () => {
    expect(senderName('"Ada Lovelace" <ada@example.com>')).toBe('Ada Lovelace')
  })
  it('falls back to the local part', () => {
    expect(senderName('ada@example.com')).toBe('ada')
  })
})

describe('buildBrief', () => {
  it('drops every empty section rather than padding the page', () => {
    expect(buildBrief({ now: NOW })).toEqual([])
  })

  it('puts the calendar first, because it is the only part with a deadline', () => {
    const sections = buildBrief({
      now: NOW,
      events: [{ summary: 'Standup', start: NOW + 30 * 60_000 }],
      watches: [{ title: 'Docs page', url: 'https://x.test', triggered: true, lastChanged: NOW - 3_600_000 }],
    })
    expect(sections.map(s => s.key)).toEqual(['calendar', 'watches'])
  })

  it('marks only the imminent event as urgent', () => {
    const sections = buildBrief({
      now: NOW,
      events: [
        { summary: 'Soon', start: NOW + 20 * 60_000 },
        { summary: 'Later', start: NOW + 8 * 3_600_000 },
      ],
    })
    expect(sections[0].items.map(i => i.urgent)).toEqual([true, false])
  })

  it('ignores events outside the next day, and ones long finished', () => {
    const sections = buildBrief({
      now: NOW,
      events: [
        { summary: 'Last week', start: NOW - 7 * DAY_MS },
        { summary: 'Next week', start: NOW + 7 * DAY_MS },
      ],
    })
    expect(sections).toEqual([])
  })

  it('lists only watches that actually fired', () => {
    const sections = buildBrief({
      now: NOW,
      watches: [
        { title: 'Changed', url: 'https://a.test', triggered: true },
        { title: 'Quiet', url: 'https://b.test', triggered: false },
      ],
    })
    expect(sections[0].items.map(i => i.text)).toEqual(['Changed'])
  })

  it('counts recall as one line rather than one line per item', () => {
    const sections = buildBrief({ now: NOW, recallDue: 12 })
    expect(sections[0].items).toHaveLength(1)
    expect(sections[0].items[0].text).toBe('12 things to review')
    expect(sections[0].items[0].page).toBe('recall')
  })

  it('says "thing" for one', () => {
    expect(buildBrief({ now: NOW, recallDue: 1 })[0].items[0].text).toBe('1 thing to review')
  })

  it('shows only downloads from the last day that actually finished', () => {
    const sections = buildBrief({
      now: NOW,
      downloads: [
        { filename: 'fresh.pdf', state: 'completed', completedAt: NOW - 3_600_000 },
        { filename: 'ancient.pdf', state: 'completed', completedAt: NOW - 5 * DAY_MS },
        { filename: 'failed.pdf', state: 'interrupted', completedAt: NOW - 3_600_000 },
      ],
    })
    expect(sections[0].items.map(i => i.text)).toEqual(['fresh.pdf'])
  })
})

describe('summarise', () => {
  it('says plainly when there is nothing', () => {
    expect(summarise([])).toBe('Nothing needs you right now.')
  })
  it('counts each section', () => {
    const sections = buildBrief({ now: NOW, recallDue: 3, events: [{ summary: 'A', start: NOW + 60_000 }] })
    expect(summarise(sections)).toBe('1 next 24 hours · 1 recall')
  })
})
