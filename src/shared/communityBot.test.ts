import { describe, it, expect } from 'vitest'
import { BOT_MEMBER_ID, BOT_HANDLE, isBot, BOT_MAX_CHARS } from './communityBot'

describe('the guide’s identity', () => {
  // The bug this exists for: the id spelled a word using letters that are not
  // hex digits. Postgres rejected every row referencing it, and because the
  // push queue retries forever and drains in table order, one unparseable id
  // stopped that machine replicating anything at all, in either direction.
  it('is a syntactically valid UUID', () => {
    expect(BOT_MEMBER_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('contains only hex digits in its groups', () => {
    for (const group of BOT_MEMBER_ID.split('-')) {
      expect(group, `"${group}" is not hex`).toMatch(/^[0-9a-f]+$/)
    }
  })

  // Fixed rather than minted per device: the guide's messages replicate like
  // anyone else's, so a per-install id would fill the room with duplicates.
  it('recognises itself and nothing else', () => {
    expect(isBot(BOT_MEMBER_ID)).toBe(true)
    expect(isBot('00000000-0000-4000-8000-000000000b08')).toBe(false)
    expect(isBot(undefined)).toBe(false)
    expect(isBot(null)).toBe(false)
    expect(isBot('')).toBe(false)
  })

  it('has a name and a sane length cap', () => {
    expect(BOT_HANDLE.trim().length).toBeGreaterThan(0)
    expect(BOT_MAX_CHARS).toBeGreaterThan(200)
    expect(BOT_MAX_CHARS).toBeLessThan(4000)
  })
})
