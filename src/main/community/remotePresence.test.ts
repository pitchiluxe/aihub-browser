import { describe, it, expect } from 'vitest'
import { mergePresence, mergeVoiceOccupancy, rankOf } from './remotePresence'
import type { Presence } from '../../shared/community'

describe('rankOf', () => {
  it('orders dnd above online above idle above offline', () => {
    expect(rankOf('dnd')).toBeGreaterThan(rankOf('online'))
    expect(rankOf('online')).toBeGreaterThan(rankOf('idle'))
    expect(rankOf('idle')).toBeGreaterThan(rankOf('offline'))
  })
})

describe('mergePresence', () => {
  it('shows a member online when only a remote device reports them', () => {
    expect(mergePresence({}, [{ memberId: 'm1', status: 'online' }])).toEqual({ m1: 'online' })
  })

  it('is the fix for ONLINE — 1: five devices become five entries', () => {
    const remote = [
      { memberId: 'b', status: 'online' as const },
      { memberId: 'c', status: 'online' as const },
      { memberId: 'd', status: 'idle' as const },
      { memberId: 'e', status: 'dnd' as const },
    ]
    const local: Presence[] = [{ memberId: 'a', status: 'online', updatedAt: 0 }]
    expect(Object.keys(mergePresence(local, remote))).toHaveLength(5)
  })

  it('keeps the strongest status when one member is signed in twice', () => {
    expect(mergePresence({ m1: 'idle' }, [{ memberId: 'm1', status: 'online' }]).m1).toBe('online')
  })

  it('lets do-not-disturb win over online, because it was chosen deliberately', () => {
    expect(mergePresence({ m1: 'online' }, [{ memberId: 'm1', status: 'dnd' }]).m1).toBe('dnd')
  })

  it('does not let a remote idle downgrade a local online', () => {
    expect(mergePresence({ m1: 'online' }, [{ memberId: 'm1', status: 'idle' }]).m1).toBe('online')
  })

  it('drops nobody from the local snapshot when the remote list is empty', () => {
    expect(mergePresence({ m1: 'online' }, [])).toEqual({ m1: 'online' })
  })

  it('accepts the Presence[] shape that presence.ts snapshot() returns', () => {
    const local: Presence[] = [{ memberId: 'm1', status: 'dnd', updatedAt: 1 }]
    expect(mergePresence(local, [{ memberId: 'm2', status: 'online' }]))
      .toEqual({ m1: 'dnd', m2: 'online' })
  })
})

describe('mergeVoiceOccupancy', () => {
  it('puts a remote participant into the right room', () => {
    const out = mergeVoiceOccupancy({}, [{ memberId: 'm2', voiceChannel: 'lounge' }])
    expect(out).toEqual({ lounge: ['m2'] })
  })

  it('joins local and remote occupants of the same room', () => {
    const out = mergeVoiceOccupancy({ lounge: ['m1'] }, [{ memberId: 'm2', voiceChannel: 'lounge' }])
    expect(out.lounge).toEqual(['m1', 'm2'])
  })

  it('never lists the same member twice in one room', () => {
    const out = mergeVoiceOccupancy({ lounge: ['m1'] }, [{ memberId: 'm1', voiceChannel: 'lounge' }])
    expect(out.lounge).toEqual(['m1'])
  })

  it('ignores a remote entry that is not in any voice room', () => {
    expect(mergeVoiceOccupancy({}, [{ memberId: 'm2' }])).toEqual({})
  })

  it('does not mutate the local map it was given', () => {
    const local = { lounge: ['m1'] }
    mergeVoiceOccupancy(local, [{ memberId: 'm2', voiceChannel: 'lounge' }])
    expect(local.lounge).toEqual(['m1'])
  })
})
