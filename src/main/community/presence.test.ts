import { describe, it, expect, beforeEach } from 'vitest'
import { createPresenceTracker, PRESENCE_TTL_MS, TYPING_TTL_MS } from './presence'

let clock = 1_700_000_000_000
const now = () => clock
let tracker: ReturnType<typeof createPresenceTracker>

beforeEach(() => {
  clock = 1_700_000_000_000
  tracker = createPresenceTracker(now)
})

describe('presence', () => {
  it('reports a member online after a heartbeat', () => {
    tracker.heartbeat('win-1', 'grace', 'online')

    expect(tracker.statusOf('grace')).toBe('online')
  })

  it('reports offline for someone who never checked in', () => {
    expect(tracker.statusOf('nobody')).toBe('offline')
  })

  it('lets a member be idle or do-not-disturb', () => {
    tracker.heartbeat('win-1', 'grace', 'dnd')
    expect(tracker.statusOf('grace')).toBe('dnd')
  })

  it('goes offline once the heartbeat stops', () => {
    tracker.heartbeat('win-1', 'grace', 'online')

    clock += PRESENCE_TTL_MS + 1

    // Not persisted and not trusted past its lifetime: a status that outlives
    // its heartbeat is the app reporting what was true when the lid closed.
    expect(tracker.statusOf('grace')).toBe('offline')
  })

  it('stays online while heartbeats keep arriving', () => {
    tracker.heartbeat('win-1', 'grace', 'online')
    clock += PRESENCE_TTL_MS - 1_000
    tracker.heartbeat('win-1', 'grace', 'online')
    clock += PRESENCE_TTL_MS - 1_000

    expect(tracker.statusOf('grace')).toBe('online')
  })

  it('keeps a member online while any of their windows is', () => {
    tracker.heartbeat('win-1', 'grace', 'online')
    tracker.heartbeat('win-2', 'grace', 'online')

    tracker.dropWindow('win-1')

    expect(tracker.statusOf('grace')).toBe('online')
  })

  it('takes a member offline when their last window goes', () => {
    tracker.heartbeat('win-1', 'grace', 'online')
    tracker.dropWindow('win-1')

    expect(tracker.statusOf('grace')).toBe('offline')
  })

  it('prefers the most present of two windows', () => {
    // One window idle and one active means the person is at the keyboard.
    tracker.heartbeat('win-1', 'grace', 'idle')
    tracker.heartbeat('win-2', 'grace', 'online')

    expect(tracker.statusOf('grace')).toBe('online')
  })

  it('lets do-not-disturb win over online, because it was chosen', () => {
    tracker.heartbeat('win-1', 'grace', 'online')
    tracker.heartbeat('win-2', 'grace', 'dnd')

    expect(tracker.statusOf('grace')).toBe('dnd')
  })

  it('lists everyone currently present', () => {
    tracker.heartbeat('win-1', 'grace', 'online')
    tracker.heartbeat('win-2', 'sam', 'idle')

    const snapshot = tracker.snapshot()

    expect(snapshot.map(p => p.memberId).sort()).toEqual(['grace', 'sam'])
  })

  it('leaves expired members out of the snapshot', () => {
    tracker.heartbeat('win-1', 'grace', 'online')
    clock += PRESENCE_TTL_MS + 1

    expect(tracker.snapshot()).toEqual([])
  })
})

describe('typing', () => {
  it('reports who is typing in a channel', () => {
    tracker.startTyping('grace', 'general')

    expect(tracker.typingIn('general')).toEqual(['grace'])
  })

  it('does not leak typing across channels', () => {
    tracker.startTyping('grace', 'general')
    expect(tracker.typingIn('random')).toEqual([])
  })

  it('forgets a typist who stopped', () => {
    tracker.startTyping('grace', 'general')
    clock += TYPING_TTL_MS + 1

    // The indicator has to expire on its own. Relying on a "stopped typing"
    // message means a closed window leaves someone typing forever.
    expect(tracker.typingIn('general')).toEqual([])
  })

  it('clears immediately when they send the message', () => {
    tracker.startTyping('grace', 'general')
    tracker.stopTyping('grace', 'general')

    expect(tracker.typingIn('general')).toEqual([])
  })

  it('never reports the viewer back to themselves', () => {
    tracker.startTyping('grace', 'general')
    tracker.startTyping('sam', 'general')

    expect(tracker.typingIn('general', 'grace')).toEqual(['sam'])
  })
})

describe('voice participants', () => {
  it('tracks who is in which voice channel', () => {
    tracker.joinVoice('win-1', 'grace', 'voice-lounge')

    expect(tracker.voiceParticipants('voice-lounge')).toEqual(['grace'])
  })

  it('moves a member when they join another voice channel', () => {
    tracker.joinVoice('win-1', 'grace', 'voice-lounge')
    tracker.joinVoice('win-1', 'grace', 'voice-workshop')

    expect(tracker.voiceParticipants('voice-lounge')).toEqual([])
    expect(tracker.voiceParticipants('voice-workshop')).toEqual(['grace'])
  })

  it('removes them when they leave', () => {
    tracker.joinVoice('win-1', 'grace', 'voice-lounge')
    tracker.leaveVoice('win-1')

    expect(tracker.voiceParticipants('voice-lounge')).toEqual([])
  })

  it('removes them when their window disappears', () => {
    // A closed window is the common case, not the exception: nobody clicks
    // Disconnect before quitting.
    tracker.joinVoice('win-1', 'grace', 'voice-lounge')
    tracker.dropWindow('win-1')

    expect(tracker.voiceParticipants('voice-lounge')).toEqual([])
  })
})
