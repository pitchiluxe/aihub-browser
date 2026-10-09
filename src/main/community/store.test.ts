import { describe, it, expect } from 'vitest'
import {
  emptyState, postMessage, visibleMessages, forViewer, toggleReaction,
  setBlocked, reportMessage, isEstablished, cooldownFor,
  isHandleTaken, memberByHandle, suggestHandles,
  canModerate, openReports, resolveReports, setBanned, deleteMessage, eraseMember,
  ESTABLISHED_AFTER_MS, ESTABLISHED_AFTER_MESSAGES, AUTO_HIDE_REPORTS,
  type CommunityState,
} from './store'
import { MEMBER_COOLDOWN_MS, NEW_MEMBER_COOLDOWN_MS, type Member } from '../../shared/community'
import { handleKey } from '../../shared/communityHandle'

const NOW = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000

let counter = 0
const newId = () => `id-${++counter}`

function member(id: string, over: Partial<Member> = {}): Member {
  const handle = over.handle ?? `user-${id}`
  return {
    id, handle, handleKey: handleKey(handle), avatarSeed: id,
    createdAt: NOW - 2 * DAY, ...over,
  }
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
    // One page, not the whole history. The cap dropped from 200 to 50 when
    // paging arrived: 200 was "as much as the UI could survive rendering at
    // once", and 50 is a page you scroll back through.
    const out = visibleMessages(s, 'sports', 'a')
    expect(out).toHaveLength(50)
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
    // Hidden, not deleted: the threshold is an accusation, not a verdict, and
    // a moderator has to be able to put it back.
    expect(s.messages[0].hiddenAt).toBeTruthy()
    expect(s.messages[0].deletedAt).toBeUndefined()
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

describe('handle uniqueness', () => {
  it('finds the member holding a name and reports it taken', () => {
    const s = stateWith(member('a', { handle: 'Grace' }))
    expect(memberByHandle(s, handleKey('Grace'))?.id).toBe('a')
    expect(isHandleTaken(s, handleKey('Grace'))).toBe(true)
    expect(isHandleTaken(s, handleKey('Gracie'))).toBe(false)
  })

  it('matches regardless of case or width', () => {
    const s = stateWith(member('a', { handle: 'Grace' }))
    expect(isHandleTaken(s, handleKey('grace'))).toBe(true)
    expect(isHandleTaken(s, handleKey('GRACE'))).toBe(true)
    expect(isHandleTaken(s, handleKey('Ｇｒａｃｅ'))).toBe(true)
  })

  // Otherwise a member could not re-save their own profile, or change their
  // own name's capitalisation, without colliding with themselves.
  it('does not count a member as blocking their own name', () => {
    const s = stateWith(member('a', { handle: 'Grace' }))
    expect(isHandleTaken(s, handleKey('grace'), 'a')).toBe(false)
    expect(isHandleTaken(s, handleKey('grace'), 'someone-else')).toBe(true)
  })

  it('suggests free alternatives when a name is gone', () => {
    const s = stateWith(member('a', { handle: 'Grace' }))
    const out = suggestHandles(s, 'Grace')
    expect(out).toEqual(['Grace2', 'Grace3', 'Grace4'])
  })

  it('skips suggestions that are themselves taken', () => {
    const s = stateWith(
      member('a', { handle: 'Grace' }),
      member('b', { handle: 'Grace2' }),
      member('c', { handle: 'Grace3' }),
    )
    expect(suggestHandles(s, 'Grace', 2)).toEqual(['Grace4', 'Grace5'])
  })
})


describe('moderation', () => {
  /** A room with one moderator, one ordinary member, and one posted message. */
  function room() {
    const s = stateWith(
      member('mod', { isAdmin: true }),
      member('a'),
      member('b'),
      member('c'),
    )
    // Ownership is claimed here on purpose. Without it the founder rule would
    // hand moderation to the earliest member, which is correct behaviour but
    // not what these tests are about — they are about an ordinary member in an
    // established room being unable to act on other people's messages.
    s.ownership = { memberId: 'mod', email: 'mod@example.test', verifiedAt: NOW }
    postMessage(s, { memberId: 'a', channel: 'sports', kind: 'text', body: 'contested' }, NOW, newId)
    return { s, messageId: s.messages[0].id }
  }

  function reportBy(s: CommunityState, messageId: string, who: string[]) {
    for (const id of who) reportMessage(s, messageId, id, 'abuse', NOW, newId)
  }

  it('only lets admins moderate', () => {
    const { s } = room()
    expect(canModerate(s, 'mod')).toBe(true)
    expect(canModerate(s, 'a')).toBe(false)
    expect(canModerate(s, 'nobody')).toBe(false)
  })

  // The regression this replaced: canModerate read `member.isAdmin` and
  // nothing else, and nothing in the app ever sets that flag. On an install
  // where ownership had never been claimed, the person whose machine it was
  // could not see their own report queue or the AI guide switch, because the
  // rail hides both behind exactly this answer.
  describe('who may moderate', () => {
    it('lets the only person in an unclaimed community moderate it', () => {
      const s = stateWith(member('solo'))
      expect(canModerate(s, 'solo')).toBe(true)
    })

    it('does not count the guide bot as the founder', () => {
      const s = stateWith(
        member('bot', { isBot: true, createdAt: NOW - 10 * DAY }),
        member('solo', { createdAt: NOW - DAY }),
      )
      expect(canModerate(s, 'solo')).toBe(true)
    })

    // The bug in the first version of this rule: it asked whether the member
    // was the ONLY person here, so the owner of the room lost their own report
    // queue the moment somebody else joined.
    it('keeps the founder moderating after other people join', () => {
      const s = stateWith(
        member('founder', { createdAt: NOW - 30 * DAY }),
        member('newcomer', { createdAt: NOW - DAY }),
        member('later', { createdAt: NOW }),
      )
      expect(canModerate(s, 'founder')).toBe(true)
      expect(canModerate(s, 'newcomer')).toBe(false)
      expect(canModerate(s, 'later')).toBe(false)
    })

    it('breaks a tie on id, so replicas cannot disagree', () => {
      const s = stateWith(
        member('bbb', { createdAt: NOW }),
        member('aaa', { createdAt: NOW }),
      )
      expect(canModerate(s, 'aaa')).toBe(true)
      expect(canModerate(s, 'bbb')).toBe(false)
    })

    it('passes the room on when the founder is banned', () => {
      const s = stateWith(
        member('founder', { createdAt: NOW - 30 * DAY, bannedAt: NOW }),
        member('next', { createdAt: NOW - DAY }),
      )
      expect(canModerate(s, 'founder')).toBe(false)
      expect(canModerate(s, 'next')).toBe(true)
    })

    it('stops granting it once ownership is claimed', () => {
      const s = stateWith(member('solo'))
      s.ownership = { memberId: 'someone-else', email: 'o@e.test', verifiedAt: NOW }
      expect(canModerate(s, 'solo')).toBe(false)
    })

    it('lets the owner moderate', () => {
      const s = stateWith(member('owner'), member('other'))
      s.ownership = { memberId: 'owner', email: 'o@e.test', verifiedAt: NOW }
      expect(canModerate(s, 'owner')).toBe(true)
      expect(canModerate(s, 'other')).toBe(false)
    })

    it('lets a role with manage_messages moderate', () => {
      const s = stateWith(member('owner'), member('helper'))
      s.ownership = { memberId: 'owner', email: 'o@e.test', verifiedAt: NOW }
      s.memberRoles.helper = ['moderator']
      expect(canModerate(s, 'helper')).toBe(true)
    })

    it('refuses a banned member whatever else they hold', () => {
      const s = stateWith(member('solo', { bannedAt: NOW }))
      expect(canModerate(s, 'solo')).toBe(false)
    })

    it('still honours the legacy isAdmin flag', () => {
      const s = stateWith(member('a', { isAdmin: true }), member('b'))
      expect(canModerate(s, 'a')).toBe(true)
    })
  })

  // The bug this replaced: auto-hide wrote deletedAt, so a pile-on and a
  // moderator's verdict were indistinguishable and neither was reversible.
  it('hides on the report threshold without deleting', () => {
    const { s, messageId } = room()
    reportBy(s, messageId, ['b', 'c', 'mod'])
    const message = s.messages[0]
    expect(message.hiddenAt).toBeTruthy()
    expect(message.deletedAt).toBeUndefined()
    expect(visibleMessages(s, 'sports', 'b')).toHaveLength(0)
  })

  it('puts a wrongly-reported message back with keep', () => {
    const { s, messageId } = room()
    reportBy(s, messageId, ['b', 'c', 'mod'])
    expect(resolveReports(s, messageId, 'keep', 'mod', NOW).ok).toBe(true)

    expect(s.messages[0].hiddenAt).toBeUndefined()
    expect(s.messages[0].deletedAt).toBeUndefined()
    expect(visibleMessages(s, 'sports', 'b')).toHaveLength(1)
    expect(openReports(s)).toHaveLength(0)
  })

  it('removes a message without banning its author', () => {
    const { s, messageId } = room()
    reportBy(s, messageId, ['b'])
    expect(resolveReports(s, messageId, 'remove', 'mod', NOW).ok).toBe(true)

    expect(s.messages[0].deletedAt).toBeTruthy()
    expect(s.messages[0].deletedBy).toBe('mod')
    expect(s.members['a'].bannedAt).toBeUndefined()
  })

  it('bans the author and quotes the reason', () => {
    const { s, messageId } = room()
    reportBy(s, messageId, ['b'])
    resolveReports(s, messageId, 'ban', 'mod', NOW, 'harassment')

    expect(s.members['a'].bannedAt).toBe(NOW)
    expect(s.members['a'].banReason).toBe('harassment')
    const blocked = postMessage(s, { memberId: 'a', channel: 'sports', kind: 'text', body: 'again' },
      NOW + 60_000, newId)
    expect(blocked.ok).toBe(false)
  })

  it('refuses to act for a non-moderator', () => {
    const { s, messageId } = room()
    reportBy(s, messageId, ['b'])
    expect(resolveReports(s, messageId, 'remove', 'b', NOW).ok).toBe(false)
    expect(setBanned(s, 'b', 'a', true, 'because', NOW).ok).toBe(false)
    expect(s.messages[0].deletedAt).toBeUndefined()
    expect(s.members['a'].bannedAt).toBeUndefined()
  })

  it('will not let a moderator ban themselves out of the room', () => {
    const { s } = room()
    expect(setBanned(s, 'mod', 'mod', true, 'oops', NOW).ok).toBe(false)
    expect(s.members['mod'].bannedAt).toBeUndefined()
  })

  it('resolves the reports so a decision is not re-litigated', () => {
    const { s, messageId } = room()
    reportBy(s, messageId, ['b', 'c'])
    expect(openReports(s)).toHaveLength(1)
    resolveReports(s, messageId, 'keep', 'mod', NOW)
    expect(openReports(s)).toHaveLength(0)
    expect(s.reports.every(r => r.resolvedAt && r.resolution === 'keep')).toBe(true)
  })

  it('unbans', () => {
    const { s } = room()
    setBanned(s, 'mod', 'a', true, 'spam', NOW)
    expect(s.members['a'].bannedAt).toBeTruthy()
    setBanned(s, 'mod', 'a', false, '', NOW)
    expect(s.members['a'].bannedAt).toBeUndefined()
    expect(s.members['a'].banReason).toBeUndefined()
  })

  it('queues the most-reported message first', () => {
    const { s } = room()
    postMessage(s, { memberId: 'b', channel: 'sports', kind: 'text', body: 'second' }, NOW + 1, newId)
    const [first, second] = s.messages
    reportMessage(s, first.id, 'c', 'x', NOW, newId)
    reportBy(s, second.id, ['a', 'c', 'mod'])

    const queue = openReports(s)
    expect(queue[0].message.id).toBe(second.id)
    expect(queue[0].count).toBe(3)
    expect(queue[1].count).toBe(1)
  })
})

describe('deleting', () => {
  it('lets an author remove their own message', () => {
    const s = stateWith(member('a'))
    postMessage(s, { memberId: 'a', channel: 'sports', kind: 'text', body: 'mine' }, NOW, newId)
    expect(deleteMessage(s, s.messages[0].id, 'a', NOW).ok).toBe(true)
    expect(s.messages[0].deletedAt).toBeTruthy()
    // No deletedBy: this was the author, not a moderator acting on them.
    expect(s.messages[0].deletedBy).toBeUndefined()
  })

  it('refuses to let one member delete another', () => {
    const s = stateWith(member('a'), member('b'))
    postMessage(s, { memberId: 'a', channel: 'sports', kind: 'text', body: 'mine' }, NOW, newId)
    expect(deleteMessage(s, s.messages[0].id, 'b', NOW).ok).toBe(false)
    expect(s.messages[0].deletedAt).toBeUndefined()
  })
})

describe('erasing a member (delete my data)', () => {
  function populated() {
    const s = stateWith(member('a'), member('b', { isAdmin: true }))
    postMessage(s, { memberId: 'a', channel: 'sports', kind: 'text', body: 'mine one' }, NOW, newId)
    postMessage(s, { memberId: 'b', channel: 'sports', kind: 'text', body: 'theirs' }, NOW, newId)
    postMessage(s, { memberId: 'a', channel: 'sports', kind: 'text', body: 'mine two' },
      NOW + NEW_MEMBER_COOLDOWN_MS + 1, newId)
    const theirs = s.messages.find(m => m.authorId === 'b')!
    toggleReaction(s, theirs.id, 'a', 'pray')
    reportMessage(s, theirs.id, 'a', 'rude', NOW, newId)
    setBlocked(s, 'b', 'a', true)
    return s
  }

  it('removes the member, their messages, their reactions and their reports', () => {
    const s = populated()
    const removed = eraseMember(s, 'a')

    expect(removed.messages).toBe(2)
    expect(removed.reactions).toBe(1)
    expect(removed.reports).toBe(1)
    expect(s.members['a']).toBeUndefined()
    expect(s.messages.some(m => m.authorId === 'a')).toBe(false)
    expect(s.reports.some(r => r.reporterId === 'a')).toBe(false)
  })

  it('leaves everyone else intact', () => {
    const s = populated()
    eraseMember(s, 'a')
    expect(s.members['b']).toBeDefined()
    expect(s.messages).toHaveLength(1)
    expect(s.messages[0].authorId).toBe('b')
  })

  it('clears them out of other people block lists', () => {
    const s = populated()
    eraseMember(s, 'a')
    expect(s.blocks['b'] || []).not.toContain('a')
  })

  // Reports pointing at messages that no longer exist would render as empty
  // rows in the moderator's queue forever.
  it('leaves no orphaned reports behind', () => {
    const s = stateWith(member('a'), member('b'))
    postMessage(s, { memberId: 'a', channel: 'sports', kind: 'text', body: 'gone soon' }, NOW, newId)
    reportMessage(s, s.messages[0].id, 'b', 'x', NOW, newId)
    eraseMember(s, 'a')
    expect(s.reports).toHaveLength(0)
    expect(openReports(s)).toHaveLength(0)
  })
})
