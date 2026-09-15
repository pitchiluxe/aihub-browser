import { describe, it, expect } from 'vitest'
import {
  buildModerationPrompt, parseVerdict, shouldFile, reportReason,
  FLAG_THRESHOLD, CONCERNS,
} from './aiModerator'

const input = { channelName: 'Bible Study', authorHandle: 'grace', body: 'be kind to each other' }

describe('the moderation prompt', () => {
  it('carries the message, the author and the channel', () => {
    const p = buildModerationPrompt(input)
    expect(p).toContain('Bible Study')
    expect(p).toContain('grace')
    expect(p).toContain('be kind to each other')
  })

  it('lists every concern it can return, so the report can name one', () => {
    const p = buildModerationPrompt(input)
    for (const c of CONCERNS) expect(p).toContain(c)
  })

  // Without this a small model flags every argument, and the queue becomes
  // noise nobody opens — which looks like moderation while being none.
  it('tells the model that disagreement is not a reason to flag', () => {
    const p = buildModerationPrompt(input)
    expect(p).toMatch(/NOT reasons to flag/i)
    expect(p).toMatch(/religious conviction/i)
  })

  it('caps a huge message rather than sending it whole', () => {
    const p = buildModerationPrompt({ ...input, body: 'x'.repeat(5000) })
    expect(p.length).toBeLessThan(3000)
  })
})

describe('reading the verdict', () => {
  const flag = '{"flagged": true, "concern": "harassment", "confidence": 0.9, "reason": "Targets a member by name."}'

  it('reads a clean flag', () => {
    const v = parseVerdict(flag)
    expect(v).toMatchObject({ flagged: true, concern: 'harassment', confidence: 0.9 })
    expect(v.reason).toBe('Targets a member by name.')
  })

  it('digs the JSON out of the prose models wrap it in', () => {
    expect(parseVerdict('Sure! Here is my analysis:\n```json\n' + flag + '\n```\nHope that helps!').flagged)
      .toBe(true)
  })

  it('reads a clean pass', () => {
    expect(parseVerdict('{"flagged": false, "concern": null, "confidence": 0.1, "reason": ""}').flagged)
      .toBe(false)
  })

  // The safe default matters more here than the clever one. A person can
  // always report by hand; an innocent member dragged into the queue by a
  // parse error is a harm the system inflicted by itself.
  it('treats anything it cannot read as not flagged', () => {
    for (const junk of ['', '   ', 'no', 'I think this is fine', '{ broken json', '{}', 'null']) {
      expect(parseVerdict(junk).flagged, junk).toBe(false)
    }
  })

  it('refuses a flag it cannot name or explain', () => {
    expect(parseVerdict('{"flagged": true, "concern": "vibes", "confidence": 0.99, "reason": "bad"}').flagged)
      .toBe(false)
    expect(parseVerdict('{"flagged": true, "concern": "spam", "confidence": 0.99, "reason": ""}').flagged)
      .toBe(false)
  })

  it('clamps a confidence the model made up', () => {
    expect(parseVerdict(flag.replace('0.9', '7')).confidence).toBe(1)
    expect(parseVerdict(flag.replace('0.9', '-3')).confidence).toBe(0)
    expect(parseVerdict(flag.replace('0.9', '"high"')).confidence).toBe(0)
  })
})

describe('filing', () => {
  const at = (confidence: number) => ({
    flagged: true, concern: 'spam' as const, confidence, reason: 'Repeated link drops.',
  })

  it('files only above the threshold', () => {
    expect(shouldFile(at(FLAG_THRESHOLD))).toBe(true)
    expect(shouldFile(at(FLAG_THRESHOLD - 0.01))).toBe(false)
    expect(shouldFile({ flagged: false, concern: null, confidence: 1, reason: '' })).toBe(false)
  })

  // The moderator has to see who decided and on what grounds, or the flag is
  // just an accusation with no author.
  it('says the AI decided, and why', () => {
    const text = reportReason(at(0.9))
    expect(text).toMatch(/AI guide/i)
    expect(text).toContain('spam')
    expect(text).toContain('Repeated link drops.')
  })
})
