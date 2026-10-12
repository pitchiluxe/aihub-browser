// src/shared/fares/watch.test.ts
import { describe, it, expect } from 'vitest'
import { fareWatchVerdict } from './watch'

describe('fareWatchVerdict', () => {
  it('notifies when the price first drops to or below target', () => {
    expect(fareWatchVerdict(180, 155, 160)).toEqual({ notify: true, message: 'Now $155 — at or below your $160 target (was $180).' })
  })
  it('stays quiet while it remains below target', () => {
    expect(fareWatchVerdict(155, 150, 160).notify).toBe(false)
  })
  it('stays quiet when no price could be read', () => {
    expect(fareWatchVerdict(180, null, 160).notify).toBe(false)
  })
  it('notifies on first check if already below target', () => {
    expect(fareWatchVerdict(undefined, 140, 160).notify).toBe(true)
  })
})
