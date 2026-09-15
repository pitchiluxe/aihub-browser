import type { SupabaseClient } from '@supabase/supabase-js'
import type { Presence, PresenceStatus } from '../../shared/community'
import { RANK, TYPING_TTL_MS } from './presence'

/**
 * Presence that reaches past this machine.
 *
 * `presence.ts` answers "which of my windows is alive", and answers it well.
 * This answers "who else is here" — which is the question the member list was
 * asking all along, and getting a one-person answer to. Five devices signed in
 * under five names all read ONLINE — 1, because each was counting only its own
 * windows.
 *
 * ── Realtime Presence, not a table ────────────────────────────────────────
 *
 * Presence is worthless the moment it is stale, and a row that outlives the
 * process it described is worse than no row: it is a person listed as online
 * who shut their laptop an hour ago. Supabase drops a device's presence when
 * its socket goes, which is exactly the semantics wanted and exactly what a
 * table cannot provide without a reaper job.
 *
 * ── Typing is a broadcast, not presence ───────────────────────────────────
 *
 * Typing is a pulse, not a state. Putting it in the presence object would
 * rewrite — and re-fan-out — every device's presence on every keystroke.
 */

export interface RemotePresenceEntry {
  memberId: string
  status: PresenceStatus
  voiceChannel?: string
  deviceId: string
  updatedAt: number
}

export function rankOf(status: PresenceStatus): number {
  return RANK[status] ?? 0
}

/**
 * Merge this machine's view with every other machine's.
 *
 * The strongest status wins, by the same ordering `presence.ts` already uses
 * for one person's several windows — do-not-disturb above online because it was
 * chosen deliberately, online above idle because someone typing on their phone
 * is at a keyboard whatever the laptop thinks. Reusing that ordering rather
 * than restating it is the point: two ranking rules that disagree would show a
 * different status locally than remotely for the same person.
 */
export function mergePresence(
  local: Record<string, PresenceStatus> | Presence[],
  remote: { memberId: string; status: PresenceStatus; voiceChannel?: string }[],
): Record<string, PresenceStatus> {
  const out: Record<string, PresenceStatus> = {}

  const localEntries = Array.isArray(local)
    ? local.map(p => [p.memberId, p.status] as const)
    : Object.entries(local) as [string, PresenceStatus][]

  for (const [memberId, status] of localEntries) out[memberId] = status

  for (const entry of remote) {
    const existing = out[entry.memberId]
    if (!existing || rankOf(entry.status) > rankOf(existing)) out[entry.memberId] = entry.status
  }

  return out
}

/** Voice rooms with someone in them, across every device. */
export function mergeVoiceOccupancy(
  local: Record<string, string[]>,
  remote: { memberId: string; voiceChannel?: string }[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [channel, members] of Object.entries(local)) out[channel] = [...members]
  for (const entry of remote) {
    if (!entry.voiceChannel) continue
    const list = out[entry.voiceChannel] ??= []
    if (!list.includes(entry.memberId)) list.push(entry.memberId)
  }
  return out
}

export interface RemotePresenceDeps {
  client: SupabaseClient
  deviceId: string
  /** Fired whenever the roster or the typing set changes. */
  onChange: () => void
  now?: () => number
}

export function createRemotePresence(deps: RemotePresenceDeps) {
  const { client, deviceId, onChange } = deps
  const now = deps.now ?? Date.now

  /** `${memberId} ${channel}` -> when they last typed, from any device. */
  const typing = new Map<string, number>()
  let entries: RemotePresenceEntry[] = []
  let mine: { memberId: string; status: PresenceStatus; voiceChannel?: string } | null = null

  const channel = client.channel('community:presence', {
    config: { presence: { key: deviceId } },
  })

  const readRoster = (): void => {
    const raw = channel.presenceState() as Record<string, RemotePresenceEntry[]>
    const flat: RemotePresenceEntry[] = []
    for (const list of Object.values(raw)) {
      for (const entry of list) {
        if (entry?.memberId) flat.push(entry)
      }
    }
    // Own device excluded: presence.ts already counts these windows, and
    // counting them twice would make a member look online after their last
    // window closed but before the socket noticed.
    entries = flat.filter(e => e.deviceId !== deviceId)
    onChange()
  }

  channel
    .on('presence', { event: 'sync' }, readRoster)
    .on('presence', { event: 'join' }, readRoster)
    .on('presence', { event: 'leave' }, readRoster)
    .on('broadcast', { event: 'typing' }, ({ payload }: { payload: unknown }) => {
      const note = payload as { memberId?: string; channel?: string; on?: boolean }
      if (!note?.memberId || !note.channel) return
      const key = `${note.memberId} ${note.channel}`
      if (note.on) typing.set(key, now())
      else typing.delete(key)
      onChange()
    })

  let subscribed: Promise<void> | null = null

  const ensure = (): Promise<void> => {
    subscribed ??= new Promise<void>(resolve => {
      channel.subscribe(status => { if (status === 'SUBSCRIBED') resolve() })
    })
    return subscribed
  }

  return {
    async track(memberId: string, status: PresenceStatus, voiceChannel?: string): Promise<void> {
      mine = { memberId, status, ...(voiceChannel ? { voiceChannel } : {}) }
      await ensure()
      await channel.track({ ...mine, deviceId, updatedAt: now() })
    },

    async untrack(): Promise<void> {
      mine = null
      await channel.untrack()
    },

    async typing(memberId: string, inChannel: string, on: boolean): Promise<void> {
      await ensure()
      await channel.send({
        type: 'broadcast', event: 'typing',
        payload: { memberId, channel: inChannel, on },
      })
    },

    /** Everyone this device can see anywhere, excluding its own windows. */
    remoteEntries: () => entries,

    /** Who is typing here, from any machine. Expired pulses are dropped on
     *  read rather than on a timer — nothing else needs waking up for it. */
    typingIn(inChannel: string, exceptMemberId?: string): string[] {
      const cutoff = now() - TYPING_TTL_MS
      const out: string[] = []
      for (const [key, at] of typing) {
        if (at < cutoff) { typing.delete(key); continue }
        const gap = key.indexOf(' ')
        const memberId = key.slice(0, gap)
        if (key.slice(gap + 1) !== inChannel) continue
        if (memberId === exceptMemberId) continue
        out.push(memberId)
      }
      return out
    },

    async stop(): Promise<void> {
      try { if (mine) await channel.untrack() } catch { /* socket already gone */ }
      try { await channel.unsubscribe() } catch { /* already gone */ }
      entries = []
      typing.clear()
    },
  }
}

export type RemotePresence = ReturnType<typeof createRemotePresence>
