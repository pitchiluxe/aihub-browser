import { describe, it, expect } from 'vitest'
import {
  emptyState, postMessage, visibleMessages, forViewer, toggleReaction,
  setBlocked, reportMessage, isEstablished, cooldownFor,
  ESTABLISHED_AFTER_MS, ESTABLISHED_AFTER_MESSAGES, AUTO_HIDE_REPORTS,
  type CommunityState,
} from './store'
import { MEMBER_COOLDOWN_MS, NEW_MEMBER_COOLDOWN_MS, type Member } from '../../shared/community'

const NOW = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000

let counter = 0
const newId = () => `id-${++counter}`

function member(id: string, over: Partial<Member> = {}): Member {
  return { id, handle: `user-${id}`, avatarSeed: id, createdAt: NOW - 2 * DAY, ...over }
}

function stateWith(...members: Member[]): CommunityState {
  const s = emptyState()
  for (const m of members) s.members[m.id] = m
  return s
}

/** Give a member enough history that the trust rules treat them as settled. */
function establish(s: CommunityState, id: string, at = NOW - DAY) {
  for (let i = 0; i < ESTABLISHED_AFTER_MESSAGES; i++) {
    s.messages.push({
      id: newId(), channel: 'bible-study', authorId: id,
      authorHandle: 'x', authorSeed: 'x', kind: 'text', body: 'x', createdAt: at,
    })
  }
}

describe('posting rules', () => {
  it('accepts an ordinary message', () => {
    const s = stateWith(member('a'))
    const out = postMessage(s, { memberId: 'a', channel: 'bible-study', kind: 'text', body: 'Hello' }, NOW, newId)
    expect(out.ok).toBe(true)
    expect(s.messages).toHaveLength(1)
  })

  it('refuses someone who has not joined', () => {
    const s = emptyState()
    const out = postMessage(s, { memberId: 'ghost', channel: 'bible-study', kind: 'text', body: 'hi' }, NOW, newId)
    expect(out.ok).toBe(false)
    expect(s.messages).toHaveLength(0)
  })

  it('refuses a banned member and quotes the reason', () => {
    const s = stateWith(member('a', { bannedAt: NOW - 1000, banReason: 'spam' }))
    const out = postMessage(s, { memberId: 'a', channel: 'bible-study', kind: 'text', body: 'hi' }, NOW, newId)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain('spam')
  })

  it('refuses an unknown channel', () => {
    const s = stateWith(member('a'))
    expect(postMessage(s, { memberId: 'a', channel: 'nope', kind: 'text', body: 'hi' }, NOW, newId).ok).toBe(false)
  })

  // The composer decides which buttons to show, but the composer is renderer
  // code. The rule has to hold when the request does not come from it.
  it('refuses a message kind the channel does not accept', () => {
    const s = stateWith(member('a'))
    const out = postMessage(s, { memberId: 'a', channel: 'sports', kind: 'prayer', body: 'pray for me' }, NOW, newId)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toMatch(/does not accept/)
  })

  it('accepts a verse in Bible Study', () => {
    const s = stateWith(member('a'))
    const out = postMessage(s, {
      memberId: 'a', channel: 'bible-study', kind: 'verse', body: 'For God so loved the world',
      verse: { book: 'John', chapter: 3, verse: 16, translation: 'kjv' },
    }, NOW, newId)
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.message.verse?.chapter).toBe(3)
  })

  it('rejects empty and oversized bodies', () => {
    const s = stateWith(member('a'))
    expect(postMessage(s, { memberId: 'a', channel: 'sports', kind: 'text', body: '   ' }, NOW, newId).ok).toBe(false)
    expect(postMessage(s, { memberId: 'a', channel: 'sports', kind: 'text', body: 'x'.repeat(4001) }, NOW, newId).ok).toBe(false)
  })

  it('denormalizes the author so a later handle change cannot rewrite history', () => {
    const s = stateWith(member('a', { handle: 'Grace' }))
    postMessage(s, { memberId: 'a', channel: 'sports', kind: 'text', body: 'hi' }, NOW, newId)
    s.members['a'].handle = 'Something Else'
    expect(s.messages[0].authorHandle).toBe('Grace')
  })
})

describe('trust and rate limiting', () => {
  it('treats a brand new member as untrusted', () => {
    const s = stateWith(member('a', { createdAt: NOW }))
    expect(isEstablished(s, 'a', NOW)).toBe(false)
    expect(cooldownFor(s, 'a', NOW)).toBe(NEW_MEMBER_COOLDOWN_MS)
  })

  // Time alone is beaten by registering early and waiting; count alone is
  // beaten by posting ten times in ten seconds. Both are required.
  it('requires both age and history before trusting a member', () => {
    const onlyOld = stateWith(member('a', { createdAt: NOW - 2 * DAY }))
    expect(isEstablished(onlyOld, 'a', NOW)).toBe(false)

    const onlyBusy = stateWith(member('b', { createdAt: NOW - 1000 }))
    establish(onlyBusy, 'b', NOW - 900)
    expect(isEstablished(onlyBusy, 'b', NOW)).toBe(false)

    const both = stateWith(member('c', { createdAt: NOW - ESTABLISHED_AFTER_MS - 1000 }))
    establish(both, 'c')
    expect(isEstablished(both, 'c', NOW)).toBe(true)
    expect(cooldownFor(both, 'c', NOW)).toBe(MEMBER_COOLDOWN_MS)
  })

  it('holds a new member to the slow cooldown and says when they can retry', () => {
    const s = stateWith(member('a', { createdAt: NOW }))
    expect(postMessage(s, { memberId: 'a', channel: 'sports', kind: 'text', body: 'one' }, NOW, newId).ok).toBe(true)
    const second = postMessage(s, { memberId: 'a', channel: 'sports', kind: 'text', body: 'two' }, NOW + 1000, newId)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.retryAfterMs).toBeGreaterThan(0)

    const later = postMessage(s, { memberId: 'a', channel: 'sports', kind: 'text', body: 'two' },
      NOW + NEW_MEMBER_COOLDOWN_MS + 1, newId)
    expect(later.ok).toBe(true)
  })

  // Links are the payload of nearly all drive-by spam, and a fresh identity is
  // free. Denying the combination is what makes ban evasion pointless.
  it('does not let a new member post links, but lets an established one', () => {
    const fresh = stateWith(member('a', { createdAt: NOW }))
    expect(postMessage(fresh, { memberId: 'a', channel: 'sports', kind: 'text', body: 'see https://spam.example' }, NOW, newId).ok)
      .toBe(false)

    const settled = stateWith(member('b', { createdAt: NOW - ESTABLISHED_AFTER_MS - 1000 }))
    establish(settled, 'b')
    expect(postMessage(settled, { memberId: 'b', channel: 'sports', kind: 'text', body: 'see https://example.com' },
      NOW + MEMBER_COOLDOWN_MS * 2, newId).ok).toBe(true)
  })
})

describe('reading', () => {
  it('returns only the requested channel, oldest first', () => {
    const s = stateWith(member('a', { createdAt: NOW - 2 * DAY }))
    establish(s, 'a')
    postMessage(s, { memberId: 'a', channel: 'sports', kind: 'text', body: 'sport' }, NOW, newId)
    const out = visibleMessages(s, 'sports', 'a')
    expect(out).toHaveLength(1)
    expect(out[0].body).toBe('sport')
  })

  it('hides deleted messages', () => {
    const s = stateWith(member('a'))
    postMessage(s, { memberId: 'a', channel: 'sports', kind: 'text', body: 'gone' }, NOW, newId)
    s.messages[0].deletedAt = NOW
    expect(visibleMessages(s, 'sports', 'a')).toHaveLength(0)
  })

  // Blocking applied on read, not on post: it must hide history too, and it
  // must be reversible without having destroyed anything.
  it('hides a blocked author, including what they already said', () => {
    const s = stateWith(member('a'), member('b'))
    postMessage(s, { memberId: 'b', channel: 'sports', kind: 'text', body: 'noise' }, NOW, newId)
    expect(visibleMessages(s, 'sports', 'a')).toHaveLength(1)

    setBlocked(s, 'a', 'b', true)
    expect(visibleMessages(s, 'sports', 'a')).toHaveLength(0)
    // Only for the blocker — everyone else's room is unchanged.
    expect(visibleMessages(s, 'sports', 'b')).toHaveLength(1)

    setBlocked(s, 'a', 'b', false)
    expect(visibleMessages(s, 'sports', 'a')).toHaveLength(1)
  })

  it('refuses to let someone block themselves into an empty room', () => {
    const s = stateWith(member('a'))
    setBlocked(s, 'a', 'a', true)
    expect(s.blocks['a'] || []).toHaveLength(0)
  })

  it('caps how much history one read returns', () => {
    const s = stateWith(member('a', { createdAt: NOW - 2 * DAY }))
    for (let i = 0; i < 250; i++) {
      s.messages.push({
        id: newId(), channel: 'sports', authorId: 'a', authorHandle: 'a', authorSeed: 'a',
        kind: 'text', body: `m${i}`, createdAt: NOW + i,
      })
    }
    const out = visibleMessages(s, 'sports', 'a')
    expect(out).toHaveLength(200)
    // The most recent conversation, not the oldest.
    expect(out[out.length - 1].body).toBe('m249')
  })
})

describe('anonymous prayer requests', () => {
  it('hides the author from everyone but the author', () => {
    const s = stateWith(member('a', { handle: 'Grace' }))
    const out = postMessage(s, {
      memberId: 'a', channel: 'bible-study', kind: 'prayer', body: 'please pray', anonymous: true,
    }, NOW, newId)
    expect(out.ok).toBe(true)
    if (!out.ok) return

    expect(forViewer(out.message, 'someone-else').authorHandle).toBe('Anonymous')
    expect(forViewer(out.message, 'a').authorHandle).toBe('Grace')
  })

  it('does not let anonymity leak to other kinds of post', () => {
    const s = stateWith(member('a'))
    const out = postMessage(s, {
      memberId: 'a', channel: 'bible-study', kind: 'text', body: 'hi', anonymous: true,
    }, NOW, newId)
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.message.anonymous).toBeUndefined()
  })
})

describe('reactions', () => {
  it('adds and removes one member at a time', () => {
    const s = stateWith(member('a'), member('b'))
    postMessage(s, { memberId: 'a', channel: 'bible-study', kind: 'prayer', body: 'pray' }, NOW, newId)
    const id = s.messages[0].id

    toggleReaction(s, id, 'b', 'pray')
    expect(s.messages[0].reactions?.pray).toEqual(['b'])
    toggleReaction(s, id, 'b', 'pray')
    expect(s.messages[0].reactions?.pray).toEqual([])
  })

  it('ignores a reaction to a message that is gone', () => {
    const s = stateWith(member('a'))
    expect(toggleReaction(s, 'missing', 'a', 'pray')).toBeNull()
  })
})

describe('reports', () => {
  it('hides a message once enough distinct people report it', () => {
    const s = stateWith(member('a'))
    postMessage(s, { memberId: 'a', channel: 'sports', kind: 'text', body: 'abuse' }, NOW, newId)
    const id = s.messages[0].id

    for (let i = 1; i < AUTO_HIDE_REPORTS; i++) {
      expect(reportMessage(s, id, `reporter-${i}`, 'abuse', NOW, newId).hidden).toBe(false)
    }
    expect(reportMessage(s, id, `reporter-${AUTO_HIDE_REPORTS}`, 'abuse', NOW, newId).hidden).toBe(true)
    expect(s.messages[0].deletedAt).toBeTruthy()
  })

  // Otherwise one determined person can hide anything they dislike.
  it('counts one report per person, however many times they press it', () => {
    const s = stateWith(member('a'))
    postMessage(s, { memberId: 'a', channel: 'sports', kind: 'text', body: 'fine' }, NOW, newId)
    const id = s.messages[0].id

    for (let i = 0; i < 10; i++) reportMessage(s, id, 'one-angry-person', 'abuse', NOW, newId)
    expect(s.reports.filter(r => r.messageId === id)).toHaveLength(1)
    expect(s.messages[0].deletedAt).toBeFalsy()
  })

  it('reports nothing for a message that does not exist', () => {
    const s = stateWith(member('a'))
    expect(reportMessage(s, 'missing', 'a', 'x', NOW, newId).ok).toBe(false)
  })
})
