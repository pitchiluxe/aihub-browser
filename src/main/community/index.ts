import crypto from 'crypto'
import { join } from 'path'
import { app, ipcMain, safeStorage, BrowserWindow } from 'electron'
import { createManagedJsonStore } from '../jsonStore'
import { validateHandle } from '../../shared/communityHandle'
import { CHANNELS, type Member } from '../../shared/community'
import {
  emptyState, postMessage, visibleMessages, forViewer, toggleReaction,
  setBlocked, reportMessage, cooldownFor, isEstablished,
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

  ipcMain.handle('community:channels', async () => CHANNELS)

  ipcMain.handle('community:join', async (_e, rawHandle: string) => {
    const { identityStore, dataStore } = stores()

    const handle = validateHandle(String(rawHandle ?? ''))
    if (!handle.ok) return { ok: false, error: handle.error }

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
      // Seeded from the id, so the avatar is stable for the life of the
      // member and identical on every machine that renders it.
      avatarSeed: memberId,
      createdAt: Date.now(),
    }
    member.handle = handle.value

    dataStore.update(s => { s.members[memberId] = member })
    identityStore.update(i => { if (i) { i.memberId = memberId; i.handle = handle.value } })

    // Proves the key works end to end before the UI claims success — a key
    // that cannot sign is a broken identity, and better found now than at the
    // first post.
    const key = privateKey()
    if (!key) return { ok: false, error: 'This device could not unlock its identity key.' }
    signEnvelope(key, { action: 'join', memberId })

    persistNow()
    broadcast('community:status', currentStatus())
    return { ok: true, status: currentStatus() }
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
    const key = privateKey()
    if (key) signEnvelope(key, { action: 'post', messageId: result.message.id })

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
    const key = privateKey()
    const identity = stores().identityStore.get()
    if (!key || !identity) return { ok: false, error: 'No identity on this device yet.' }
    return {
      ok: true,
      value: Buffer.from(JSON.stringify({
        v: 1, privateKey: key, publicKey: identity.publicKey,
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
}
