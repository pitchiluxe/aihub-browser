import crypto from 'crypto'
import { join } from 'path'
import { app, ipcMain, safeStorage, BrowserWindow } from 'electron'
import { createManagedJsonStore } from '../jsonStore'
import { validateHandle, handleKey } from '../../shared/communityHandle'
import { type Member, type Permission } from '../../shared/community'
import { migrateState } from '../../shared/communityMigrate'
import { hasPermission, isOwner, resolvePermissions } from '../../shared/communityPermissions'
import { status as googleStatus, connect as googleConnect } from '../google/auth'
import {
  activeChannels, claimOwnership, releaseOwnership,
  createChannel, updateChannel, deleteChannel, restoreChannel, purgeChannel, reorderChannels,
  createCategory, updateCategory, deleteCategory,
  createRole, updateRole, deleteRole, assignRole, revokeRole,
  timeoutMember,
  type ChannelOrder, type ChannelEdit, type NewChannel,
} from './admin'
import {
  emptyState, postMessage, visibleMessages, forViewer, toggleReaction,
  setBlocked, reportMessage, cooldownFor, isEstablished, isHandleTaken, suggestHandles,
  canModerate, openReports, resolveReports, setBanned, deleteMessage, eraseMember,
  type ModerationAction,
  type CommunityState, type PostInput,
} from './store'
import {
  generateKeyPair, sealPrivateKey, openPrivateKey, signEnvelope,
  type StoredIdentity,
} from './identity'

/**
 * AIHub Community — main-process wiring.
 *
 * This module owns the two things the renderer must never touch: the device
 * private key, and the rules in ./store. The renderer gets messages, members
 * and errors; it never gets key material and its opinion about who may post is
 * not consulted.
 *
 * ── On the backend ────────────────────────────────────────────────────────
 * The room is currently LOCAL. Messages are stored on this machine and seen
 * only on this machine — there is no server yet, so no two users can see each
 * other. Everything above this line is written the way it will be written
 * against Supabase: identity is a real signed keypair, the posting rules are
 * the ones that become row-level security policies, and the transport is the
 * only piece that changes.
 *
 * `status()` reports `network: 'local'` and the UI says so plainly. Letting
 * someone believe they are talking to a community that cannot hear them would
 * be the worst possible version of this feature.
 */

const IDENTITY_FILE = 'community-identity.json'
const DATA_FILE = 'community-data.json'

let identityStore: ReturnType<typeof createManagedJsonStore<StoredIdentity | null>>
let dataStore: ReturnType<typeof createManagedJsonStore<CommunityState>>

const newId = () => crypto.randomUUID()

/**
 * Write identity and membership to disk NOW rather than on the usual debounce.
 *
 * jsonStore batches writes on a 1.5s timer, which is right for message traffic
 * and wrong for an identity. The identity file is written a handful of times in
 * a member's whole life, so the debounce saves nothing — and if the app is
 * closed or crashes inside that window the user loses their signing key, which
 * is their account. They would come back as a stranger with no way to recover.
 * Found by the IPC test, which "restarted" the app faster than the timer.
 */
function persistNow() {
  identityStore.flush()
  dataStore.flush()
}

/**
 * MANAGED stores, not plain ones.
 *
 * Only managed stores join the registry that `app.on('before-quit')` flushes
 * (see flushAllJsonStores). A plain createJsonStore here would mean every
 * normal close silently discarded whatever was still inside the 1.5s write
 * debounce — the last message of a conversation, every time someone finished
 * typing and immediately quit.
 */
function stores() {
  if (!identityStore) {
    identityStore = createManagedJsonStore<StoredIdentity | null>(
      join(app.getPath('userData'), IDENTITY_FILE), () => null, { pretty: true })
  }
  if (!dataStore) {
    dataStore = createManagedJsonStore<CommunityState>(
      join(app.getPath('userData'), DATA_FILE), emptyState)
    // Bring a file written by an older build forward before anything reads it.
    // Done here rather than at each call site because the store loads lazily,
    // and a single unmigrated read is enough to crash on a missing collection.
    dataStore.update(state => { migrateState(state) })
  }
  return { identityStore, dataStore }
}

/** Broadcast to every window, so a second window updates without polling and
 *  the same code path works unchanged once a server is pushing events. */
function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export type CommunityStatus =
  | { state: 'unregistered'; network: 'local'; insecureKeyStorage: boolean }
  | {
      state: 'ready' | 'banned'
      network: 'local'
      member: Member
      insecureKeyStorage: boolean
      established: boolean
      cooldownMs: number
    }

function currentStatus(): CommunityStatus {
  const { identityStore, dataStore } = stores()
  const identity = identityStore.get()
  const insecure = !!identity?.insecureStorage

  if (!identity?.memberId) {
    return { state: 'unregistered', network: 'local', insecureKeyStorage: insecure }
  }
  const state = dataStore.get()
  const member = state.members[identity.memberId]
  if (!member) {
    // The key outlived its member row — treat it as not yet registered rather
    // than crashing on a missing lookup.
    return { state: 'unregistered', network: 'local', insecureKeyStorage: insecure }
  }
  const now = Date.now()
  return {
    state: member.bannedAt ? 'banned' : 'ready',
    network: 'local',
    member,
    insecureKeyStorage: insecure,
    established: isEstablished(state, member.id, now),
    cooldownMs: cooldownFor(state, member.id, now),
  }
}

/** The signing key, decrypted. Never returned across IPC. */
function privateKey(): string | null {
  const identity = stores().identityStore.get()
  if (!identity) return null
  try {
    return openPrivateKey(safeStorage, identity.privateKey)
  } catch {
    // A key the OS can no longer decrypt (keychain reset, profile copied to
    // another machine) is gone. Say so rather than pretending to sign.
    return null
  }
}

function requireMember(): { id: string } | { error: string } {
  const status = currentStatus()
  if (status.state === 'unregistered') return { error: 'Join the community first.' }
  if (status.state === 'banned') return { error: 'You cannot post in this community.' }
  return { id: status.member.id }
}

export function registerCommunityIpc(): void {
  stores()

  ipcMain.handle('community:status', async () => currentStatus())

  // Channels come from state now. The constant is a seed the migration applied
  // once; after that this is whatever the owner has shaped.
  ipcMain.handle('community:channels', async () => activeChannels(stores().dataStore.get()))

  ipcMain.handle('community:categories', async () =>
    Object.values(stores().dataStore.get().categories).sort((a, b) => a.position - b.position))

  ipcMain.handle('community:join', async (_e, rawHandle: string) => {
    const { identityStore, dataStore } = stores()

    const handle = validateHandle(String(rawHandle ?? ''))
    if (!handle.ok) return { ok: false, error: handle.error }

    // Handles are unique. Checked before any key is generated, so a rejected
    // name leaves nothing behind — and `exceptId` lets an existing member
    // re-join under a different capitalisation of the name they already hold.
    const key = handleKey(handle.value)
    const mine = identityStore.get()?.memberId || undefined
    if (isHandleTaken(dataStore.get(), key, mine)) {
      return {
        ok: false,
        error: 'That name is taken.',
        suggestions: suggestHandles(dataStore.get(), handle.value),
      }
    }

    // Reuse an existing key if there is one: a failed registration must not
    // cost the user their identity, and a second attempt must be the same
    // member rather than a new one.
    let identity = identityStore.get()
    if (!identity) {
      const pair = generateKeyPair()
      const sealed = sealPrivateKey(safeStorage, pair.privateKey)
      identity = {
        privateKey: sealed.value,
        publicKey: pair.publicKey,
        memberId: null,
        handle: handle.value,
        createdAt: Date.now(),
        insecureStorage: sealed.insecure,
      }
      identityStore.set(identity)
    }

    const memberId = identity.memberId || newId()
    const member: Member = dataStore.get().members[memberId] || {
      id: memberId,
      handle: handle.value,
      handleKey: key,
      // Seeded from the id, so the avatar is stable for the life of the
      // member and identical on every machine that renders it.
      avatarSeed: memberId,
      createdAt: Date.now(),
    }
    member.handle = handle.value
    member.handleKey = key

    // Who moderates a local-only community?
    //
    // While there is no server, this file IS the community: every install
    // holds its own private copy, so the person sitting here is the only one
    // who could review anything in it. The first member on an install
    // therefore owns it. Without this the Reports queue exists but nobody can
    // ever open it, and the Report button goes nowhere — which is worse than
    // having no report button, because it promises moderation that cannot
    // happen.
    //
    // Once the server exists, isAdmin arrives from it and this block goes: a
    // real community's moderators are not decided by who installed first.
    if (!Object.values(dataStore.get().members).some(m => m.isAdmin)) {
      member.isAdmin = true
    }

    dataStore.update(s => { s.members[memberId] = member })
    identityStore.update(i => { if (i) { i.memberId = memberId; i.handle = handle.value } })

    // Proves the key works end to end before the UI claims success — a key
    // that cannot sign is a broken identity, and better found now than at the
    // first post.
    const signingKey = privateKey()
    if (!signingKey) return { ok: false, error: 'This device could not unlock its identity key.' }
    signEnvelope(signingKey, { action: 'join', memberId })

    persistNow()
    broadcast('community:status', currentStatus())
    return { ok: true, status: currentStatus() }
  })

  /**
   * Is this name free? Asked while the user types, so "taken" appears next to
   * the field instead of after they commit to a name and press Join.
   */
  ipcMain.handle('community:handleAvailable', async (_e, rawHandle: string) => {
    const { identityStore, dataStore } = stores()
    const handle = validateHandle(String(rawHandle ?? ''))
    if (!handle.ok) return { ok: false, available: false, error: handle.error }

    const key = handleKey(handle.value)
    const mine = identityStore.get()?.memberId || undefined
    const taken = isHandleTaken(dataStore.get(), key, mine)
    return {
      ok: true,
      available: !taken,
      ...(taken ? { suggestions: suggestHandles(dataStore.get(), handle.value) } : {}),
    }
  })

  ipcMain.handle('community:messages', async (_e, channel: string) => {
    const who = requireMember()
    // Reading is allowed while banned; only posting is not.
    const viewerId = 'error' in who ? '' : who.id
    const state = stores().dataStore.get()
    return visibleMessages(state, String(channel), viewerId).map(m => forViewer(m, viewerId))
  })

  ipcMain.handle('community:post', async (_e, input: Omit<PostInput, 'memberId'>) => {
    const who = requireMember()
    if ('error' in who) return { ok: false, error: who.error }

    const { dataStore } = stores()
    const state = dataStore.get()
    const result = postMessage(state, { ...input, memberId: who.id }, Date.now(), newId)
    if (!result.ok) return result

    // Signed even locally: the signature is what the server will verify, and a
    // path that only gets exercised once the backend lands is a path that
    // breaks when it does.
    const signingKey = privateKey()
    if (signingKey) signEnvelope(signingKey, { action: 'post', messageId: result.message.id })

    dataStore.update(() => {})   // mark dirty; state was mutated in place
    broadcast('community:message', { channel: input.channel, message: forViewer(result.message, '') })
    return { ok: true, message: forViewer(result.message, who.id) }
  })

  ipcMain.handle('community:react', async (_e, messageId: string, reaction: string) => {
    const who = requireMember()
    if ('error' in who) return { ok: false, error: who.error }
    const { dataStore } = stores()
    const message = toggleReaction(dataStore.get(), String(messageId), who.id, String(reaction || 'pray'))
    if (!message) return { ok: false, error: 'That message is gone.' }
    dataStore.update(() => {})
    broadcast('community:message', { channel: message.channel, message: forViewer(message, '') })
    return { ok: true, message }
  })

  ipcMain.handle('community:block', async (_e, memberId: string, blocked: boolean) => {
    const who = requireMember()
    if ('error' in who) return { ok: false, error: who.error }
    const { dataStore } = stores()
    setBlocked(dataStore.get(), who.id, String(memberId), !!blocked)
    dataStore.update(() => {})
    return { ok: true }
  })

  ipcMain.handle('community:report', async (_e, messageId: string, reason: string) => {
    const who = requireMember()
    if ('error' in who) return { ok: false, error: who.error }
    const { dataStore } = stores()
    const out = reportMessage(dataStore.get(), String(messageId), who.id, String(reason || ''), Date.now(), newId)
    dataStore.update(() => {})
    if (out.hidden) broadcast('community:refresh', { reason: 'moderation' })
    return out
  })

  /**
   * Forget this device's identity.
   *
   * Local-only for now, and the UI must say so: this deletes the key and the
   * membership on this machine. Once there is a server, erasing the member row
   * there is a separate operation, and claiming otherwise would be a promise
   * the app cannot keep.
   */
  // -- Moderation ------------------------------------------------------------
  //
  // Every handler below re-reads who the caller is from the identity store and
  // asks the store whether that member may moderate. The renderer's opinion is
  // never consulted: it decides which buttons to draw, not who may press them.

  /** Who am I, and may I moderate? Drives whether the panel appears at all. */
  ipcMain.handle('community:moderatorStatus', async () => {
    const { identityStore, dataStore } = stores()
    const memberId = identityStore.get()?.memberId
    if (!memberId) return { ok: true, isModerator: false }
    return { ok: true, isModerator: canModerate(dataStore.get(), memberId) }
  })

  ipcMain.handle('community:reports', async () => {
    const { identityStore, dataStore } = stores()
    const memberId = identityStore.get()?.memberId
    if (!memberId || !canModerate(dataStore.get(), memberId)) {
      return { ok: false, error: 'Not a moderator.', queue: [] }
    }
    return { ok: true, queue: openReports(dataStore.get()) }
  })

  ipcMain.handle('community:resolveReport', async (
    _e, args: { messageId: string; action: ModerationAction; reason?: string },
  ) => {
    const { identityStore, dataStore } = stores()
    const memberId = identityStore.get()?.memberId
    if (!memberId) return { ok: false, error: 'No identity on this device yet.' }

    let result: { ok: boolean; error?: string } = { ok: false, error: 'Unknown action.' }
    dataStore.update(state => {
      result = resolveReports(
        state, String(args?.messageId || ''), args?.action as ModerationAction,
        memberId, Date.now(), String(args?.reason || ''))
    })
    if (result.ok) broadcast('community:refresh', null)
    return result
  })

  ipcMain.handle('community:setBanned', async (
    _e, args: { memberId: string; banned: boolean; reason?: string },
  ) => {
    const { identityStore, dataStore } = stores()
    const me = identityStore.get()?.memberId
    if (!me) return { ok: false, error: 'No identity on this device yet.' }

    let result: { ok: boolean; error?: string } = { ok: false, error: 'Unknown member.' }
    dataStore.update(state => {
      result = setBanned(
        state, me, String(args?.memberId || ''), !!args?.banned,
        String(args?.reason || ''), Date.now())
    })
    if (result.ok) broadcast('community:refresh', null)
    return result
  })

  ipcMain.handle('community:deleteMessage', async (_e, messageId: string) => {
    const { identityStore, dataStore } = stores()
    const me = identityStore.get()?.memberId
    if (!me) return { ok: false, error: 'No identity on this device yet.' }

    let result: { ok: boolean; error?: string } = { ok: false, error: 'Unknown message.' }
    dataStore.update(state => {
      result = deleteMessage(state, String(messageId || ''), me, Date.now())
    })
    if (result.ok) broadcast('community:refresh', null)
    return result
  })

  /**
   * Delete my data. Erases the member and everything they wrote, then drops
   * the device key so the next visit starts from onboarding.
   *
   * Reports the counts back rather than a bare success: a screen that claims
   * deletion without saying how much invites the question it should answer.
   */
  ipcMain.handle('community:deleteMyData', async () => {
    const { identityStore, dataStore } = stores()
    const memberId = identityStore.get()?.memberId
    if (!memberId) return { ok: false, error: 'Nothing to delete on this device.' }

    let removed = { messages: 0, reactions: 0, reports: 0 }
    dataStore.update(state => { removed = eraseMember(state, memberId) })
    identityStore.set(null)
    broadcast('community:refresh', null)
    return { ok: true, removed }
  })

  ipcMain.handle('community:resetIdentity', async () => {
    const { identityStore } = stores()
    identityStore.set(null)
    persistNow()
    broadcast('community:status', currentStatus())
    return { ok: true }
  })

  /** Export the key so an identity survives a reinstall or moves machines.
   *  User-initiated only, and never broadcast. */
  ipcMain.handle('community:exportKey', async () => {
    const signingKey = privateKey()
    const identity = stores().identityStore.get()
    if (!signingKey || !identity) return { ok: false, error: 'No identity on this device yet.' }
    return {
      ok: true,
      value: Buffer.from(JSON.stringify({
        v: 1, privateKey: signingKey, publicKey: identity.publicKey,
        memberId: identity.memberId, handle: identity.handle,
      }), 'utf8').toString('base64'),
    }
  })

  ipcMain.handle('community:importKey', async (_e, encoded: string) => {
    const { identityStore, dataStore } = stores()
    try {
      const parsed = JSON.parse(Buffer.from(String(encoded).trim(), 'base64').toString('utf8'))
      if (!parsed?.privateKey || !parsed?.publicKey) throw new Error('missing key material')

      const sealed = sealPrivateKey(safeStorage, String(parsed.privateKey))
      identityStore.set({
        privateKey: sealed.value,
        publicKey: String(parsed.publicKey),
        memberId: parsed.memberId ? String(parsed.memberId) : null,
        handle: String(parsed.handle || ''),
        createdAt: Date.now(),
        insecureStorage: sealed.insecure,
      })
      // Recreate the local member row so the imported identity has a room to
      // stand in; the server is the authority once there is one.
      if (parsed.memberId) {
        dataStore.update(s => {
          s.members[parsed.memberId] ||= {
            id: String(parsed.memberId),
            handle: String(parsed.handle || 'Member'),
            handleKey: handleKey(String(parsed.handle || 'Member')),
            avatarSeed: String(parsed.memberId),
            createdAt: Date.now(),
          }
        })
      }
      persistNow()
      broadcast('community:status', currentStatus())
      return { ok: true, status: currentStatus() }
    } catch {
      return { ok: false, error: 'That is not a valid AIHub identity key.' }
    }
  })

  // -- Ownership and administration -----------------------------------------
  //
  // Everything below is an authorization boundary. The renderer decides which
  // buttons to draw; these handlers decide what may happen, and they ask the
  // permission engine themselves rather than trusting anything that arrived
  // over IPC. Calling one of these straight from DevTools reaches exactly this
  // code with exactly these checks, which is the whole design.

  /**
   * Run one administrative mutation, persist it and tell every window.
   *
   * A single wrapper so no handler can be added later that forgets to identify
   * its caller — the member id comes from the identity store on this device,
   * never from an argument.
   */
  const admin = async (
    run: (state: CommunityState, memberId: string) => { ok: boolean; error?: string },
  ): Promise<{ ok: boolean; error?: string }> => {
    const { identityStore, dataStore } = stores()
    const memberId = identityStore.get()?.memberId
    if (!memberId) return { ok: false, error: 'Join the community first.' }

    let result: { ok: boolean; error?: string } = { ok: false, error: 'Nothing happened.' }
    dataStore.update(state => { result = run(state, memberId) })
    if (result.ok) {
      persistNow()
      broadcast('community:refresh', { reason: 'admin' })
    }
    return result
  }

  /** Am I the owner, and if someone is, who? */
  ipcMain.handle('community:ownership', async () => {
    const { identityStore, dataStore } = stores()
    const memberId = identityStore.get()?.memberId || ''
    const state = dataStore.get()
    return {
      ok: true,
      claimed: !!state.ownership,
      isOwner: !!memberId && isOwner(state, memberId),
      // Shown only to say whose ownership this is. It is the owner's own
      // address on the owner's own machine, not another member's data.
      email: state.ownership?.email ?? null,
      googleConnected: googleStatus().connected,
    }
  })

  /**
   * Claim community ownership by proving the owner's email to Google.
   *
   * Takes no arguments, deliberately. The address is read from the OAuth token
   * exchange; there is no code path here that accepts one from the caller,
   * because an address a caller can supply proves nothing about who they are.
   */
  ipcMain.handle('community:claimOwnership', async () => {
    const who = requireMember()
    if ('error' in who) return { ok: false, error: who.error }

    let email = googleStatus().connected ? googleStatus().email : null
    if (!email) {
      // Base scopes only — openid, email and profile. Claiming ownership must
      // not quietly ask for a mailbox.
      const connected = await googleConnect([])
      if (!connected.ok) return { ok: false, error: connected.error }
      email = connected.email
    }
    if (!email) return { ok: false, error: 'Google did not return an email address.' }

    const verified = email
    const result = await admin((state, memberId) =>
      claimOwnership(state, memberId, verified, Date.now(), newId))
    if (result.ok) broadcast('community:status', currentStatus())
    return result
  })

  ipcMain.handle('community:releaseOwnership', async () =>
    admin((state, memberId) => releaseOwnership(state, memberId, Date.now(), newId)))

  /** What may I do, here and in this channel? Drives the UI, never the rules. */
  ipcMain.handle('community:permissions', async (_e, channel?: string) => {
    const { identityStore, dataStore } = stores()
    const memberId = identityStore.get()?.memberId
    if (!memberId) return { ok: true, permissions: [] as Permission[] }
    return {
      ok: true,
      permissions: [...resolvePermissions(dataStore.get(), memberId, channel ? String(channel) : undefined)],
    }
  })

  // -- Channels --------------------------------------------------------------

  ipcMain.handle('community:createChannel', async (_e, input: NewChannel) =>
    admin((state, memberId) => createChannel(state, memberId, input ?? ({} as NewChannel), Date.now(), newId)))

  ipcMain.handle('community:updateChannel', async (_e, slug: string, edit: ChannelEdit) =>
    admin((state, memberId) => updateChannel(state, memberId, String(slug), edit ?? {}, Date.now(), newId)))

  ipcMain.handle('community:deleteChannel', async (_e, slug: string) =>
    admin((state, memberId) => deleteChannel(state, memberId, String(slug), Date.now(), newId)))

  ipcMain.handle('community:restoreChannel', async (_e, slug: string) =>
    admin((state, memberId) => restoreChannel(state, memberId, String(slug), Date.now(), newId)))

  ipcMain.handle('community:purgeChannel', async (_e, slug: string, confirmSlug: string) =>
    admin((state, memberId) =>
      purgeChannel(state, memberId, String(slug), String(confirmSlug ?? ''), Date.now(), newId)))

  ipcMain.handle('community:reorderChannels', async (_e, order: ChannelOrder[]) =>
    admin((state, memberId) =>
      reorderChannels(state, memberId, Array.isArray(order) ? order : [], Date.now(), newId)))

  // -- Categories ------------------------------------------------------------

  ipcMain.handle('community:createCategory', async (_e, name: string) =>
    admin((state, memberId) => createCategory(state, memberId, String(name ?? ''), Date.now(), newId)))

  ipcMain.handle('community:updateCategory', async (_e, id: string, name: string) =>
    admin((state, memberId) => updateCategory(state, memberId, String(id), String(name ?? ''), Date.now(), newId)))

  ipcMain.handle('community:deleteCategory', async (_e, id: string) =>
    admin((state, memberId) => deleteCategory(state, memberId, String(id), Date.now(), newId)))

  // -- Roles -----------------------------------------------------------------

  ipcMain.handle('community:roles', async () =>
    Object.values(stores().dataStore.get().roles).sort((a, b) => b.position - a.position))

  ipcMain.handle('community:createRole', async (_e, input: { name: string; color?: string; permissions: Permission[] }) =>
    admin((state, memberId) => createRole(state, memberId, input ?? { name: '', permissions: [] }, Date.now(), newId)))

  ipcMain.handle('community:updateRole', async (_e, id: string, edit: any) =>
    admin((state, memberId) => updateRole(state, memberId, String(id), edit ?? {}, Date.now(), newId)))

  ipcMain.handle('community:deleteRole', async (_e, id: string) =>
    admin((state, memberId) => deleteRole(state, memberId, String(id), Date.now(), newId)))

  ipcMain.handle('community:assignRole', async (_e, targetId: string, roleId: string) =>
    admin((state, memberId) => assignRole(state, memberId, String(targetId), String(roleId), Date.now(), newId)))

  ipcMain.handle('community:revokeRole', async (_e, targetId: string, roleId: string) =>
    admin((state, memberId) => revokeRole(state, memberId, String(targetId), String(roleId), Date.now(), newId)))

  // -- Member sanctions ------------------------------------------------------

  ipcMain.handle('community:timeoutMember', async (
    _e, args: { memberId: string; durationMs: number; reason?: string },
  ) => admin((state, memberId) => timeoutMember(
    state, memberId, String(args?.memberId ?? ''), Number(args?.durationMs ?? 0),
    String(args?.reason ?? ''), Date.now(), newId)))

  // -- Audit -----------------------------------------------------------------

  /**
   * The record of who did what.
   *
   * Gated on view_audit_log rather than shown to everyone: it names moderators
   * and the members they acted on, which is exactly the sort of list that turns
   * moderation into a target.
   */
  ipcMain.handle('community:auditLog', async (_e, limit?: number) => {
    const { identityStore, dataStore } = stores()
    const memberId = identityStore.get()?.memberId
    const state = dataStore.get()
    if (!memberId || !hasPermission(state, memberId, 'view_audit_log')) {
      return { ok: false, error: 'You cannot view the audit log.', entries: [] }
    }
    const take = Math.min(Math.max(1, Number(limit) || 200), 1000)
    return { ok: true, entries: state.auditLog.slice(-take).reverse() }
  })
}
