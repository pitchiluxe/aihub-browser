import { describe, it, expect } from 'vitest'
import { WELCOME_MESSAGES, welcomeFor } from './communityWelcome'
import { seedChannels } from './communityChannels'

const channels = seedChannels()
const slugs = new Set(channels.map(c => c.slug))

describe('every room opens with something', () => {
  // The failure this prevents is silent: a welcome addressed to a channel that
  // does not exist is simply never posted, and the room stays empty — which is
  // the exact problem welcomes were added to solve.
  it('writes to channels that actually exist', () => {
    for (const w of WELCOME_MESSAGES) {
      expect(slugs.has(w.channel), `welcome for unknown channel "${w.channel}"`).toBe(true)
    }
  })

  // A newcomer opening a text room to nothing is the single most reliable way
  // to lose them, so a new channel without a welcome should fail the build.
  it('covers every text channel', () => {
    const missing = channels
      .filter(c => c.type !== 'voice')
      .map(c => c.slug)
      .filter(slug => !welcomeFor(slug))
    expect(missing, `text channels with no opening message: ${missing.join(', ')}`).toEqual([])
  })

  it('leaves voice rooms alone', () => {
    for (const c of channels.filter(c => c.type === 'voice')) {
      expect(welcomeFor(c.slug)).toBeUndefined()
    }
  })

  it('opens each room exactly once', () => {
    const seen = WELCOME_MESSAGES.map(w => w.channel)
    expect(new Set(seen).size).toBe(seen.length)
  })
})

describe('what the welcomes say', () => {
  it('says something substantial without being a wall of text', () => {
    for (const w of WELCOME_MESSAGES) {
      expect(w.body.length, w.channel).toBeGreaterThan(60)
      expect(w.body.length, w.channel).toBeLessThan(900)
    }
  })

  // A room opens better with a question somebody can answer than with a notice.
  it('ends the conversational rooms with a question', () => {
    const conversational = ['general', 'developers', 'ai', 'cloud', 'bible-study', 'sports', 'entertainment']
    for (const slug of conversational) {
      const w = welcomeFor(slug)
      expect(w, slug).toBeDefined()
      expect(w!.body.trimEnd().endsWith('?'), `${slug} should end on a question`).toBe(true)
    }
  })

  // The room most likely to carry something painful should read as an open
  // door, not as house rules.
  it('welcomes people in the Bible study room rather than instructing them', () => {
    const w = welcomeFor('bible-study')!
    expect(w.body).toMatch(/welcome/i)
    expect(w.body).toMatch(/anonymous/i)
  })

  it('warns where money is involved', () => {
    expect(welcomeFor('traders')!.body).toMatch(/not advice|no.{0,3}advice|licensed/i)
  })
})

describe('the rendering the room actually does', () => {
  // Chat bodies are rendered literally; there is no markdown pass. Emphasis
  // markers written here arrive in the room with their asterisks showing,
  // which is how the first version shipped.
  it('carries no markdown syntax', () => {
    for (const w of WELCOME_MESSAGES) {
      expect(w.body, `${w.channel} contains ** emphasis`).not.toMatch(/\*\*/)
      expect(w.body, `${w.channel} contains a markdown heading`).not.toMatch(/^#{1,6}\s/m)
      expect(w.body, `${w.channel} contains a markdown link`).not.toMatch(/\[[^\]]+\]\([^)]+\)/)
    }
  })
})
