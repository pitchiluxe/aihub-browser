import { describe, it, expect } from 'vitest'
import { normalizeEmail, isOwnerEmail, COMMUNITY_OWNER_EMAIL } from './communityOwner'

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Erick.Omari@Example.COM ')).toBe('erick.omari@example.com')
  })

  it('strips dots from a gmail local part', () => {
    // Google treats these as the same mailbox, so treating them as different
    // accounts would lock the owner out for typing their own address the way
    // they usually do.
    expect(normalizeEmail('erick.omari243@gmail.com')).toBe('erickomari243@gmail.com')
  })

  it('strips a +tag from a gmail local part', () => {
    expect(normalizeEmail('erickomari243+community@gmail.com')).toBe('erickomari243@gmail.com')
  })

  it('treats googlemail.com as gmail.com', () => {
    expect(normalizeEmail('erick.omari243@googlemail.com')).toBe('erickomari243@gmail.com')
  })

  it('leaves dots alone outside gmail', () => {
    // Everywhere else a dot is a real character and folding it would merge two
    // genuinely different people.
    expect(normalizeEmail('erick.omari@outlook.com')).toBe('erick.omari@outlook.com')
  })

  it('leaves a +tag alone outside gmail', () => {
    expect(normalizeEmail('erick+aihub@outlook.com')).toBe('erick+aihub@outlook.com')
  })

  it('returns an empty string for anything that is not an address', () => {
    expect(normalizeEmail('')).toBe('')
    expect(normalizeEmail('not-an-email')).toBe('')
    expect(normalizeEmail('two@at@signs.com')).toBe('')
    expect(normalizeEmail('@nolocalpart.com')).toBe('')
    expect(normalizeEmail('nodomain@')).toBe('')
    expect(normalizeEmail(null as any)).toBe('')
    expect(normalizeEmail(undefined as any)).toBe('')
  })
})

describe('isOwnerEmail', () => {
  it('recognises the owner address exactly', () => {
    expect(isOwnerEmail(COMMUNITY_OWNER_EMAIL)).toBe(true)
  })

  it('recognises the owner address written differently', () => {
    expect(isOwnerEmail('Erick.Omari243@Gmail.com')).toBe(true)
    expect(isOwnerEmail('erickomari243+test@googlemail.com')).toBe(true)
    expect(isOwnerEmail('  ERICKOMARI243@GMAIL.COM  ')).toBe(true)
  })

  it('rejects a lookalike address', () => {
    expect(isOwnerEmail('erickomari24@gmail.com')).toBe(false)
    expect(isOwnerEmail('erickomari243@gmai1.com')).toBe(false)
    expect(isOwnerEmail('erickomari243@notgmail.com')).toBe(false)
    expect(isOwnerEmail('erickomari243@gmail.com.evil.com')).toBe(false)
  })

  it('rejects an address that merely contains the owner address', () => {
    // The failure mode of a naive `includes` check.
    expect(isOwnerEmail('x-erickomari243@gmail.com')).toBe(false)
    expect(isOwnerEmail('erickomari243@gmail.commercial.net')).toBe(false)
  })

  it('rejects empty and malformed input', () => {
    expect(isOwnerEmail('')).toBe(false)
    expect(isOwnerEmail('erickomari243')).toBe(false)
    expect(isOwnerEmail(null as any)).toBe(false)
  })
})
