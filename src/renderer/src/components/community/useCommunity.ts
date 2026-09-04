import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Category, Channel, Member, Message, NotifLevel, Permission, PresenceStatus, Role,
} from '../../../../shared/community'

/**
 * The renderer's view of the community, and the only place that talks to IPC.
 *
 * Everything below reads state and asks the main process to change it. It never
 * decides whether a change is allowed — `can()` exists to choose what to draw,
 * and the main process answers the same question again for real. When the two
 * disagree the main process wins and the UI shows its sentence rather than one
 * invented here.
 */

export interface CommunityMember extends Member {
  presence: PresenceStatus
}

export interface Snapshot {
  memberId: string
  channels: Channel[]
  categories: Category[]
  roles: Role[]
  memberRoles: Record<string, string[]>
  ownership: { memberId: string; email: string; verifiedAt: number } | null
  isOwner: boolean
  permissions: Permission[]
  members: CommunityMember[]
  voice: Record<string, Array<{ peerId: string; memberId: string; muted: boolean; camera: boolean; sharing: boolean }>>
  conversations: Channel[]
  reads: Record<string, number>
  notifPrefs: Record<string, NotifLevel>
}

const EMPTY: Snapshot = {
  memberId: '', channels: [], categories: [], roles: [], memberRoles: {},
  ownership: null, isOwner: false, permissions: [], members: [],
  voice: {}, reads: {}, notifPrefs: {}, conversations: [],
}

const IDLE_AFTER_MS = 5 * 60_000
const HEARTBEAT_MS = 20_000

export function useCommunity(activeSlug: string) {
  const api = (window as any).electronAPI?.community

  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY)
  const [messages, setMessages] = useState<Message[]>([])
  const [exhausted, setExhausted] = useState(false)
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [mentions, setMentions] = useState<Record<string, number>>({})
  const [typing, setTyping] = useState<Record<string, string[]>>({})
  const [error, setError] = useState('')

  /** The channel the events are currently for. Read inside subscriptions so a
   *  stale closure cannot append a message to the wrong room. */
  const slugRef = useRef(activeSlug)
  slugRef.current = activeSlug

  const refresh = useCallback(async () => {
    if (!api) return
    try {
      const [snap, counts, dms] = await Promise.all([
        api.snapshot(), api.unread(), api.directMessages(),
      ])
      if (snap?.ok) setSnapshot({ ...snap, conversations: dms?.conversations ?? [] })
      if (counts?.ok) { setUnread(counts.unread ?? {}); setMentions(counts.mentions ?? {}) }
    } catch { /* keep whatever is on screen; an empty shell is worse */ }
  }, [api])

  const loadChannel = useCallback(async (slug: string) => {
    if (!api || !slug) return
    try {
      const page = await api.history(slug)
      if (!page?.ok) return
      setMessages(page.messages)
      setExhausted(page.exhausted)
      const newest = page.messages[page.messages.length - 1]
      if (newest) await api.markRead(slug, newest.createdAt)
    } catch {
      setError('Could not load this channel.')
    }
  }, [api])

  /** One page further back. Returns how many arrived so the scroller can stop. */
  const loadOlder = useCallback(async (): Promise<number> => {
    if (!api || exhausted || !messages.length) return 0
    try {
      const page = await api.history(slugRef.current, messages[0].id)
      if (!page?.ok) return 0
      setExhausted(page.exhausted)
      if (page.messages.length) setMessages(prev => [...page.messages, ...prev])
      return page.messages.length
    } catch { return 0 }
  }, [api, exhausted, messages])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { void loadChannel(activeSlug) }, [activeSlug, loadChannel])

  // ── Real-time ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!api?.onEvent) return
    return api.onEvent((event: any) => {
      switch (event?.type) {
        case 'message.new':
          if (event.channel === slugRef.current) {
            setMessages(prev => prev.some(m => m.id === event.message.id) ? prev : [...prev, event.message])
            void api.markRead(event.channel, event.message.createdAt)
          } else {
            setUnread(prev => ({ ...prev, [event.channel]: (prev[event.channel] ?? 0) + 1 }))
          }
          break
        case 'message.edit':
        case 'reaction':
          setMessages(prev => prev.map(m => m.id === event.message.id ? event.message : m))
          break
        case 'typing':
          setTyping(prev => ({ ...prev, [event.channel]: event.members }))
          break
        case 'presence':
          setSnapshot(prev => ({
            ...prev,
            members: prev.members.map(m => ({
              ...m,
              presence: event.presence.find((p: any) => p.memberId === m.id)?.status ?? 'offline',
            })),
          }))
          break
        case 'voice.occupancy':
          setSnapshot(prev => ({ ...prev, voice: event.occupancy }))
          break
      }
    })
  }, [api])

  /** The old broadcast channels, still forwarded for one version. A refresh is
   *  the safe response to anything the typed bus does not describe. */
  useEffect(() => {
    if (!api?.onRefresh) return
    return api.onRefresh(() => { void refresh(); void loadChannel(slugRef.current) })
  }, [api, refresh, loadChannel])

  // ── Presence ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!api?.heartbeat) return
    let lastInput = Date.now()
    const noteInput = () => { lastInput = Date.now() }
    for (const event of ['keydown', 'pointerdown', 'focus']) {
      window.addEventListener(event, noteInput, { passive: true })
    }

    const beat = () => {
      // Idle is measured from real input, not from the window being blurred:
      // reading a long thread without typing is still being present.
      const status: PresenceStatus = Date.now() - lastInput > IDLE_AFTER_MS ? 'idle' : 'online'
      void api.heartbeat(status)
    }
    beat()
    const timer = window.setInterval(beat, HEARTBEAT_MS)

    return () => {
      window.clearInterval(timer)
      for (const event of ['keydown', 'pointerdown', 'focus']) {
        window.removeEventListener(event, noteInput)
      }
    }
  }, [api])

  // ── Actions ──────────────────────────────────────────────────────────────

  const post = useCallback(async (input: Record<string, unknown>) => {
    setError('')
    const result = await api?.post({ channel: slugRef.current, kind: 'text', ...input })
    if (!result?.ok) setError(result?.error ?? 'That message could not be sent.')
    return result
  }, [api])

  const edit = useCallback(async (id: string, body: string) => {
    const result = await api?.editMessage(id, body)
    if (!result?.ok) setError(result?.error ?? 'That edit could not be saved.')
    return result
  }, [api])

  const react = useCallback(async (id: string, reaction: string) => {
    await api?.react(id, reaction)
  }, [api])

  const setTypingNow = useCallback((on: boolean) => {
    void api?.typing(slugRef.current, on)
  }, [api])

  // ── Derived ──────────────────────────────────────────────────────────────

  const permissions = useMemo(() => new Set(snapshot.permissions), [snapshot.permissions])

  /**
   * What to draw. Never what to allow.
   *
   * The channel argument matters: permissions are per-channel, so asking
   * without one answers a different question than the main process will.
   */
  const can = useCallback((permission: Permission) => {
    if (snapshot.isOwner) return true
    return permissions.has(permission)
  }, [permissions, snapshot.isOwner])

  const memberById = useMemo(() => {
    const map = new Map<string, CommunityMember>()
    for (const member of snapshot.members) map.set(member.id, member)
    return map
  }, [snapshot.members])

  const roleFor = useCallback((memberId: string): Role | undefined => {
    if (snapshot.ownership?.memberId === memberId) return snapshot.roles.find(r => r.id === 'owner')
    const held = snapshot.memberRoles[memberId] ?? []
    return snapshot.roles
      .filter(r => held.includes(r.id) || r.id === 'member')
      .sort((a, b) => b.position - a.position)[0]
  }, [snapshot])

  return {
    api, snapshot, messages, unread, mentions, exhausted, error, setError,
    typingHere: typing[activeSlug] ?? [],
    refresh, loadChannel, loadOlder,
    post, edit, react, setTyping: setTypingNow,
    can, memberById, roleFor,
  }
}
