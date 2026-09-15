import { describe, it, expect } from 'vitest'
import {
  shouldHost, hostBlocker, activityFor, mayPost,
  buildStarterPrompt, cleanStarter,
} from './aiHost'
import {
  BOT_MEMBER_ID, BOT_MIN_INTERVAL_MS, BOT_QUIET_BEFORE_MS, BOT_MAX_CHARS,
} from '../../shared/communityBot'
import type { CommunityState, Message } from '../../shared/community'

const NOW = 1_700_000_000_000
const HOUR = 60 * 60 * 1000

const ready = {
  memberId: 'me', isAdmin: true, ollamaReady: true, hasModel: true, enabled: true,
}

const msg = (over: Partial<Message>): Message => ({
  id: 'm', channel: 'general', authorId: 'a', authorHandle: 'ada',
  authorSeed: 'a', kind: 'text', body: 'hi', createdAt: NOW, ...over,
})

const stateWith = (...messages: Message[]): CommunityState =>
  ({ members: {}, messages, blocks: {}, reports: [] } as unknown as CommunityState)

describe('who may speak for the community', () => {
  // The whole point: Ollama is per-machine, so without this every member's
  // install would post its own copy of every article.
  it('runs only on an owner machine with Ollama and the switch on', () => {
    expect(shouldHost(ready)).toBe(true)
    expect(shouldHost({ ...ready, isAdmin: false })).toBe(false)
    expect(shouldHost({ ...ready, ollamaReady: false })).toBe(false)
    expect(shouldHost({ ...ready, enabled: false })).toBe(false)
    expect(shouldHost({ ...ready, memberId: null })).toBe(false)
  })

  // A switch that is off without saying why is a support ticket.
  it('names the reason it is not running', () => {
    expect(hostBlocker(ready)).toBeNull()
    expect(hostBlocker({ ...ready, enabled: false })).toMatch(/switched off/i)
    expect(hostBlocker({ ...ready, memberId: null })).toMatch(/join/i)
    expect(hostBlocker({ ...ready, isAdmin: false })).toMatch(/owner/i)
    expect(hostBlocker({ ...ready, ollamaReady: false })).toMatch(/ollama/i)
  })

  it('reports the switch before the things behind it', () => {
    // Off is off. Telling somebody to install Ollama when they simply have the
    // feature disabled sends them to fix the wrong thing.
    expect(hostBlocker({
      memberId: null, isAdmin: false, ollamaReady: false, hasModel: false, enabled: false,
    })).toMatch(/switched off/i)
  })

  // Ollama can be running with six models pulled and the guide pointed at
  // none of them. Every request then returns null, so a panel that says
  // "Listening" is describing something that cannot write a word.
  it('does not run with no model chosen, and says so', () => {
    expect(shouldHost({ ...ready, hasModel: false })).toBe(false)
    expect(hostBlocker({ ...ready, hasModel: false })).toMatch(/choose a model/i)
  })
})

describe('when the guide may post', () => {
  it('reads a channel’s activity, ignoring other rooms and deletions', () => {
    const state = stateWith(
      msg({ id: '1', channel: 'general', createdAt: NOW - 3 * HOUR }),
      msg({ id: '2', channel: 'other',   createdAt: NOW }),
      msg({ id: '3', channel: 'general', createdAt: NOW, deletedAt: NOW }),
      msg({ id: '4', channel: 'general', authorId: BOT_MEMBER_ID, createdAt: NOW - 20 * HOUR }),
    )
    const a = activityFor(state, 'general')
    expect(a.total).toBe(2)
    expect(a.lastMessageAt).toBe(NOW - 3 * HOUR)
    expect(a.lastBotAt).toBe(NOW - 20 * HOUR)
  })

  it('speaks into an empty room', () => {
    expect(mayPost({ lastMessageAt: null, lastBotAt: null, total: 0 }, NOW)).toBe(true)
  })

  // The guide exists to break silence. Posting into a live conversation is
  // how a room starts feeling automated instead of inhabited.
  it('stays quiet while people are actually talking', () => {
    expect(mayPost({ lastMessageAt: NOW - HOUR, lastBotAt: null, total: 5 }, NOW)).toBe(false)
    expect(mayPost(
      { lastMessageAt: NOW - BOT_QUIET_BEFORE_MS - 1, lastBotAt: null, total: 5 }, NOW,
    )).toBe(true)
  })

  it('does not post twice inside its own interval', () => {
    const justSpoke = { lastMessageAt: null, lastBotAt: NOW - HOUR, total: 1 }
    expect(mayPost(justSpoke, NOW)).toBe(false)
    expect(mayPost({ ...justSpoke, lastBotAt: NOW - BOT_MIN_INTERVAL_MS - 1 }, NOW)).toBe(true)
  })
})

describe('the prompt', () => {
  const input = {
    channelName: 'Bible Study',
    channelDescription: 'verses, prayer and testimony',
    recent: [{ authorHandle: 'grace', body: 'Psalm 23 got me through this week' }],
  }

  it('carries the channel and the conversation', () => {
    const p = buildStarterPrompt(input)
    expect(p).toContain('Bible Study')
    expect(p).toContain('verses, prayer and testimony')
    expect(p).toContain('grace: Psalm 23 got me through this week')
  })

  it('says so plainly when nobody has posted', () => {
    expect(buildStarterPrompt({ ...input, recent: [] })).toContain('nobody has posted here yet')
  })

  // The guide has no internet. A model left to its own devices will happily
  // invent a headline and a statistic to go with it.
  it('forbids invented news and links', () => {
    const p = buildStarterPrompt(input)
    expect(p).toMatch(/no internet access/i)
    expect(p).toMatch(/do not invent/i)
  })

  it('collapses a rambling message into one line of context', () => {
    const p = buildStarterPrompt({
      ...input,
      recent: [{ authorHandle: 'sam', body: 'line one\n\nline two\n\nline three' }],
    })
    expect(p).toContain('sam: line one line two line three')
  })
})

describe('cleaning what the model returned', () => {
  const good = 'The most useful prompt I wrote this month was the shortest one. '
    + 'It turns out specifying the format mattered more than explaining the task. '
    + 'What is the smallest change that improved your results?'

  it('passes a good post through untouched', () => {
    expect(cleanStarter(good)).toBe(good)
  })

  it('strips the preamble small models insist on', () => {
    expect(cleanStarter(`Sure! Here's a discussion starter:\n${good}`)).toBe(good)
  })

  it('unwraps code fences and surrounding quotes', () => {
    expect(cleanStarter('```\n' + good + '\n```')).toBe(good)
    expect(cleanStarter(`"${good}"`)).toBe(good)
  })

  // Better a quiet room than a room full of model noise.
  it('drops refusals, empties and stubs', () => {
    expect(cleanStarter('As an AI language model, I cannot do that.')).toBeNull()
    expect(cleanStarter('')).toBeNull()
    expect(cleanStarter('   ')).toBeNull()
    expect(cleanStarter('Sure!')).toBeNull()
  })

  it('keeps a preamble that is the whole answer rather than beheading it', () => {
    // One line starting with "Here's" and nothing after it is not a preamble,
    // and stripping it would leave nothing at all.
    const single = 'Here is something worth arguing about: '
      + 'most automation saves less time than it costs to maintain. Where has that been true for you?'
    expect(cleanStarter(single)).toBe(single)
  })

  it('trims an over-long post at a sentence end', () => {
    const long = ('This is a complete sentence that says something. ').repeat(60)
    const out = cleanStarter(long)
    expect(out).not.toBeNull()
    expect(out!.length).toBeLessThanOrEqual(BOT_MAX_CHARS)
    expect(out!.endsWith('.')).toBe(true)
  })
})
