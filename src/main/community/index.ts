import crypto from 'crypto'
import { join } from 'path'
import { readFile } from 'fs/promises'
import { app, ipcMain, safeStorage, BrowserWindow, desktopCapturer, Notification, dialog } from 'electron'
import { createManagedJsonStore } from '../jsonStore'
import { validateHandle, handleKey } from '../../shared/communityHandle'
import {
  type Member, type Message, type NotifLevel, type Permission,
  type Presence, type PresenceStatus,
} from '../../shared/community'
import { migrateState } from '../../shared/communityMigrate'
import { hasPermission, isOwner, resolvePermissions } from '../../shared/communityPermissions'
import { status as googleStatus, connect as googleConnect } from '../google/auth'
import {
  activeChannels, claimOwnership, releaseOwnership,
  createChannel, updateChannel, deleteChannel, restoreChannel, purgeChannel, reorderChannels,
  createCategory, updateCategory, deleteCategory,
  createRole, updateRole, deleteRole, assignRole, revokeRole,
  timeoutMember, openDirectMessage, directMessagesFor,
  type ChannelOrder, type ChannelEdit, type NewChannel,
} from './admin'
import {
  emptyState, postMessage, visibleMessages, forViewer, toggleReaction,
  setBlocked, reportMessage, cooldownFor, isEstablished, isHandleTaken, suggestHandles,
  canModerate, openReports, resolveReports, setBanned, deleteMessage, eraseMember,
  editMessage, threadReplies,
  type ModerationAction,
  type CommunityState, type PostInput,
} from './store'
import { searchCommunity, type SearchOptions } from './search'
import { saveAttachment } from './attachments'
import { createPresenceTracker } from './presence'
import { createSignalingHub } from './signaling'
import { linkPreview } from './linkPreview'
import {
  generateKeyPair, sealPrivateKey, openPrivateKey, signEnvelope,
  type StoredIdentity,
} from './identity'
import {
  loadBackendConfig, sealBackendConfig, validateBackendConfig,
  type BackendConfig, type LiveKitConfig,
} from './backendConfig'
import { connectRemote } from './remote'
import { mintVoiceToken } from './livekit'
import { backendFromEnv, refusedKeysIn } from './envImport'
import { createReplication, type Replication } from './replication'
import { createRemotePresence, mergePresence, type RemotePresence } from './remotePresence'
import {
  createRemoteSignaling, compositePeerId, windowOf, isLocalPeer,
  type RemoteSignaling,
} from './remoteSignaling'

/**
 * AIHub Community — main-process wiring.
 *
 * This module owns the two things the renderer must never touch: the device
 * private key, and the rules in ./store. The renderer gets messages, members
 * and errors; it never gets key material and its opinion about who may post is
 * not consulted.
 *
 * ── On the backend ────────────────────────────────────────────────────────
 * The room is local until a Supabase project is configured, and genuinely
 * shared once one is. That prediction — "the transport is the only piece that
 * changes" — held: the rules in ./store, the permission checks and every one of
 * the handlers below are unchanged. What was added is a replica layer
 * (./replication) that pushes local writes up and folds remote writes down
 * through the same broadcast() the renderer already listens to.
 *
 * `status()` reports network as local, connecting, remote or error, and the UI
 * says which. Letting someone believe they are talking to a community that
 * cannot hear them is the worst possible version of this feature, and was
 * exactly the bug: five machines, five private rooms, one member each.
 */

const IDENTITY_FILE = 'community-identity.json'
const DATA_FILE = 'community-data.json'
const BACKEND_FILE = 'community-backend.json'

/**
 * What this device remembers about the backend.
 *
 * `sealed` is the encrypted BackendConfig; see backendConfig.ts. `deviceId` is
 * minted once and lives here rather than in the identity file because it
 * describes the *machine*, not the member — exporting and importing an identity
 * key onto a second computer must not carry the first computer's peer ids with
 * it, or the two would collide in exactly the way composite peer ids exist to
 * prevent.
 */
interface BackendRecord {
  sealed: string | null
  deviceId: string
  insecure: boolean
}

let identityStore: ReturnType<typeof createManagedJsonStore<StoredIdentity | null>>
let dataStore: ReturnType<typeof createManagedJsonStore<CommunityState>>
let backendStore: ReturnType<typeof createManagedJsonStore<BackendRecord>>

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
    const raw = createManagedJsonStore<CommunityState>(
      join(app.getPath('userData'), DATA_FILE), emptyState)

    /**
     * One hook, and the reason there is not a `replication.push()` in twenty
     * handlers.
     *
     * Every mutating path in this file — and in admin.ts, and in store.ts —
     * already ends with `dataStore.update()` to mark the state dirty for the
     * disk writer. Marking it dirty for the *network* writer in the same place
     * means a handler cannot be written that persists locally and silently
     * fails to replicate. The diff in reconcile() works out what changed.
     */
    dataStore = {
      ...raw,
      set(next: CommunityState) { raw.set(next); replicateSoon() },
      update(fn: (current: CommunityState) => CommunityState | void) {
        raw.update(fn)
        replicateSoon()
      },
    }
    // Bring a file written by an older build forward before anything reads it.
    // Done here rather than at each call site because the store loads lazily,
    // and a single unmigrated read is enough to crash on a missing collection.
    dataStore.update(state => { migrateState(state) })
  }
  if (!backendStore) {
    backendStore = createManagedJsonStore<BackendRecord>(
      join(app.getPath('userData'), BACKEND_FILE),
      () => ({ sealed: null, deviceId: crypto.randomUUID(), insecure: false }),
      { pretty: true },
    )
    // A record written before deviceId existed, or hand-edited, must still get
    // one — every voice peer id on this machine is built from it.
    if (!backendStore.get().deviceId) {
      backendStore.update(record => { record.deviceId = crypto.randomUUID() })
    }
  }
  return { identityStore, dataStore, backendStore }
}

/** This machine's id. Stable across restarts, distinct from the member id. */
function deviceId(): string {
  return stores().backendStore.get().deviceId
}

/** Broadcast to every window, so a second window updates without polling and
 *  the same code path works unchanged once a server is pushing events. */
function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/**
 * Deliver to exactly one window of this process.
 *
 * Peer ids are `${deviceId}:${webContentsId}` now, so the window half is
 * extracted rather than compared whole. A bare id with no colon still matches,
 * which keeps the in-process hub's own tests meaningful.
 */
function sendToPeer(peerId: string, channel: string, payload: unknown) {
  const local = windowOf(peerId)
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    if (String(win.webContents.id) !== local) continue
    win.webContents.send(channel, payload)
    return
  }
}

/**
 * Presence and the signaling relay, both runtime-only.
 *
 * Neither touches disk. Presence that survives a restart is a lie, and a voice
 * roster that survives one is worse — it would list people in a call that
 * stopped existing when the process did.
 */
const presence = createPresenceTracker()
const signaling = createSignalingHub(sendToPeer)

// ── The backend ────────────────────────────────────────────────────────────

/**
 * Everything that makes this community bigger than this computer.
 *
 * All four are null until a backend is configured, and every call site uses
 * `?.` — which is the whole offline story. With no Supabase project the app
 * behaves exactly as it did before this file learned the word "remote": local
 * rules, local state, local windows. Nothing becomes a dead button.
 */
let replication: Replication | null = null
let remotePresence: RemotePresence | null = null
let remoteSignaling: RemoteSignaling | null = null
let network: 'local' | 'connecting' | 'remote' | 'error' = 'local'
let networkError: string | null = null

/** Read the sealed credentials, if this device has any. */
function backendConfig(): BackendConfig | null {
  return loadBackendConfig(safeStorage, stores().backendStore.get().sealed)
}

/**
 * Replicate whatever just changed.
 *
 * Called from one place — a wrapper around the data store — rather than from
 * each of the twenty-odd mutating handlers. See replication.reconcile() for why
 * the per-handler version was rejected: it is correct only until somebody adds
 * a handler and forgets, and forgetting is silent.
 *
 * Debounced to a microtask so a handler that calls update() three times costs
 * one diff.
 */
let reconcileQueued = false
function replicateSoon(): void {
  if (!replication || reconcileQueued) return
  reconcileQueued = true
  queueMicrotask(() => {
    reconcileQueued = false
    try { replication?.reconcile() } catch { /* the queue retries on its own */ }
  })
}

/** Local windows and every other device, as one roster. */
function mergedPresence(): Presence[] {
  const local = presence.snapshot()
  const remote = remotePresence?.remoteEntries() ?? []
  if (!remote.length) return local

  const merged = mergePresence(local, remote)
  const voiceOf = new Map<string, string | undefined>()
  for (const entry of local) voiceOf.set(entry.memberId, entry.voiceChannel)
  for (const entry of remote) if (entry.voiceChannel) voiceOf.set(entry.memberId, entry.voiceChannel)

  return Object.entries(merged).map(([memberId, status]) => ({
    memberId,
    status,
    updatedAt: Date.now(),
    ...(voiceOf.get(memberId) ? { voiceChannel: voiceOf.get(memberId)! } : {}),
  }))
}

/** Who is typing in a channel, on this machine or any other. */
function typingHere(channel: string): string[] {
  const local = presence.typingIn(channel)
  const remote = remotePresence?.typingIn(channel) ?? []
  return [...new Set([...local, ...remote])]
}

function announcePresence(): void {
  broadcast('community:event', { type: 'presence', presence: mergedPresence() })
}

function announceVoice(): void {
  const local = signaling.occupancy()
  const occupancy = remoteSignaling ? remoteSignaling.occupancy() : local
  broadcast('community:event', { type: 'voice.occupancy', occupancy })
}

function backendStatus(): { network: typeof network; error: string | null } {
  // The push queue can fail while the socket is fine. Either counts as degraded
  // — a message sitting in a retry queue has not reached anybody.
  if (replication && replication.status() === 'error') {
    return { network: 'error', error: replication.lastError() ?? networkError }
  }
  return { network, error: networkError }
}

/** The two network fields every status carries, in one place so they cannot
 *  drift between the registered and unregistered branches. */
function backendStatusFields(): { network: CommunityNetwork; networkError: string | null } {
  const current = backendStatus()
  return { network: current.network, networkError: current.error }
}

function announceBackend(): void {
  broadcast('community:backend', backendStatus())
  broadcast('community:status', currentStatus())
}

/**
 * Bring the community online, or say why it could not.
 *
 * Idempotent: calling it while already connected tears the old connection down
 * first, which is what "Save" in the settings panel does after the URL changes.
 */
async function connectBackend(): Promise<{ ok: true } | { ok: false; error: string }> {
  await disconnectBackend()

  const config = backendConfig()
  if (!config) { network = 'local'; networkError = null; announceBackend(); return { ok: true } }

  network = 'connecting'
  networkError = null
  announceBackend()

  const connected = await connectRemote(config)
  if ('error' in connected) {
    network = 'error'
    networkError = connected.error
    announceBackend()
    return { ok: false, error: connected.error }
  }

  const { client, authUid } = connected
  const { dataStore: data } = stores()

  replication = createReplication({
    client,
    readState: () => data.get(),
    updateState: mutate => { data.update(state => { mutate(state) }) },
    broadcast,
    persist: () => data.flush(),
  })

  try {
    await replication.start()
  } catch (failure) {
    replication = null
    network = 'error'
    networkError = failure instanceof Error ? failure.message : String(failure)
    announceBackend()
    return { ok: false, error: networkError }
  }

  // Bind this member row to the session that will be writing it, or every
  // policy comparing auth_uid to auth.uid() refuses this device's own updates.
  const me = identityStore.get()?.memberId
  if (me) {
    data.update(state => {
      const member = state.members[me]
      if (member) (member as Member & { authUid?: string }).authUid = authUid
    })
  }

  // Whatever this machine had locally goes up. On the first device that seeds
  // the room; on the fifth it is a no-op, because the backfill already put
  // those exact rows into the baseline.
  replication.reconcile()

  remotePresence = createRemotePresence({
    client, deviceId: deviceId(), onChange: announcePresence,
  })
  remoteSignaling = createRemoteSignaling({
    client, deviceId: deviceId(), deliver: sendToPeer, onRoster: announceVoice,
  })

  network = 'remote'
  networkError = null
  announceBackend()
  return { ok: true }
}

async function disconnectBackend(): Promise<void> {
  await remotePresence?.stop().catch(() => {})
  await remoteSignaling?.stop().catch(() => {})
  await replication?.stop().catch(() => {})
  replication = null
  remotePresence = null
  remoteSignaling = null
  network = 'local'
  networkError = null
}

/** Flush anything still queued. Called from the app's before-quit path. */
export async function shutdownCommunityBackend(): Promise<void> {
  await replication?.flush().catch(() => {})
  await disconnectBackend()
}

/**
 * Raise a desktop notification for a message, if this member asked for one.
 *
 * Three gates, in the order that costs least. Never for your own message.
 * Never while a window of the app is focused — you are already looking at it,
 * and a notification for something on screen is noise that teaches people to
 * ignore the next one. And then the member's own preference for that channel:
 * everything, only when named, or nothing at all.
 *
 * Direct messages count as a mention. Someone writing to you personally is the
 * clearest case there is of "this was meant for you".
 */
function notifyFor(message: Message): void {
  const { identityStore, dataStore } = stores()
  const me = identityStore.get()?.memberId
  if (!me || message.authorId === me) return
  if (BrowserWindow.getAllWindows().some(w => !w.isDestroyed() && w.isFocused())) return
  if (!Notification.isSupported()) return

  const state = dataStore.get()
  const channel = state.channels[message.channel]
  if (!channel) return

  const level: NotifLevel = state.notifPrefs[me]?.[message.channel]
    ?? (channel.type === 'announcement' ? 'all' : 'mentions')
  if (level === 'none') return

  const named = message.mentions?.includes(me)
    || message.mentionsEveryone
    || channel.type === 'dm'
  if (level === 'mentions' && !named) return

  const where = channel.type === 'dm' ? message.authorHandle : `#${channel.name}`
  const notification = new Notification({
    title: channel.type === 'dm' ? `${message.authorHandle}` : `${message.authorHandle} in ${where}`,
    body: (message.body || 'Sent an attachment').slice(0, 200),
    silent: level !== 'all' ? false : true,
  })
  notification.on('click', () => {
    const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
    win.webContents.send('community:event', { type: 'navigate', channel: message.channel })
  })
  notification.show()
}

/**
 * `network` stopped being the constant 'local'.
 *
 * It said 'local' unconditionally, and the UI dutifully reported that the room
 * was on this computer only — which was true, and is now a question with four
 * answers. A banner that keeps saying "local" while five people are talking is
 * as wrong as the one that said "connected" when nobody could hear you.
 */
export type CommunityNetwork = 'local' | 'connecting' | 'remote' | 'error'

export type CommunityStatus =
  | {
      state: 'unregistered'
      network: CommunityNetwork
      networkError: string | null
      insecureKeyStorage: boolean
    }
  | {
      state: 'ready' | 'banned'
      network: CommunityNetwork
      networkError: string | null
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
    return { state: 'unregistered', ...backendStatusFields(), insecureKeyStorage: insecure }
  }
  const state = dataStore.get()
  const member = state.members[identity.memberId]
  if (!member) {
    // The key outlived its member row — treat it as not yet registered rather
    // than crashing on a missing lookup.
    return { state: 'unregistered', ...backendStatusFields(), insecureKeyStorage: insecure }
  }
  const now = Date.now()
  return {
    state: member.bannedAt ? 'banned' : 'ready',
    ...backendStatusFields(),
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

  // Connect on launch if this device has been set up. Deliberately not awaited:
  // a slow or unreachable project must not hold the Community tab hostage, and
  // every handler below works against local state while it is still connecting.
  void connectBackend()

  ipcMain.handle('community:status', async () => currentStatus())

  // -- The backend -----------------------------------------------------------

  /**
   * What is configured, and how it is going.
   *
   * The anon key is deliberately NOT returned. The panel shows "configured" and
   * offers a replace field, the same as every other credential in this app —
   * a settings screen that hands a secret back to the renderer has widened the
   * blast radius of any bug in the renderer for no benefit at all.
   */
  ipcMain.handle('community:backend:get', async () => {
    const record = stores().backendStore.get()
    const config = backendConfig()
    return {
      configured: !!config,
      url: config?.url ?? '',
      iceServers: config?.iceServers ?? [],
      insecureStorage: record.insecure,
      // URL and key are shown so the panel can confirm which project is in
      // use. The secret is not returned at any point — see livekit.ts.
      livekit: config?.livekit
        ? { configured: true, url: config.livekit.url, apiKey: config.livekit.apiKey }
        : { configured: false, url: '', apiKey: '' },
      ...backendStatus(),
    }
  })

  ipcMain.handle('community:backend:set', async (_e, input: unknown) => {
    const incoming = (input ?? {}) as Partial<BackendConfig>
    const existing = backendConfig()

    // An empty key on a configured device means "keep the one you have", so
    // editing the ICE servers does not force the user to paste the key again.
    const incomingLive = (incoming.livekit ?? null) as Partial<LiveKitConfig> | null
    const liveUrl = incomingLive?.url ?? existing?.livekit?.url ?? ''
    const liveKeyId = incomingLive?.apiKey ?? existing?.livekit?.apiKey ?? ''
    // Same rule as the anon key: blank means "keep the one you have", so
    // changing the LiveKit URL does not force the secret to be pasted again.
    const liveSecret = String(incomingLive?.apiSecret ?? '').trim()
      || existing?.livekit?.apiSecret || ''

    const merged = {
      url: incoming.url ?? existing?.url ?? '',
      anonKey: String(incoming.anonKey ?? '').trim() || existing?.anonKey || '',
      iceServers: incoming.iceServers ?? existing?.iceServers ?? [],
      livekit: (liveUrl || liveKeyId || liveSecret)
        ? { url: liveUrl, apiKey: liveKeyId, apiSecret: liveSecret }
        : null,
    }

    const validated = validateBackendConfig(merged)
    if (!validated.ok) return { ok: false, error: validated.error }

    const sealed = sealBackendConfig(safeStorage, validated.config)
    stores().backendStore.update(record => {
      record.sealed = sealed.value
      record.insecure = sealed.insecure
    })
    stores().backendStore.flush()

    const connected = await connectBackend()
    if (!connected.ok) return connected

    // First device in wins the seeding. On every later device this is a no-op:
    // the backfill has already put those exact rows into the diff baseline.
    replication?.reconcile()
    return { ok: true, insecureStorage: sealed.insecure }
  })

  ipcMain.handle('community:backend:clear', async () => {
    await disconnectBackend()
    stores().backendStore.update(record => { record.sealed = null; record.insecure = false })
    stores().backendStore.flush()
    announceBackend()
    return { ok: true }
  })

  /** Retry after a failure, without making the user re-enter anything. */
  ipcMain.handle('community:backend:reconnect', async () => connectBackend())

  /**
   * Import credentials from a .env file the user picks.
   *
   * Five devices times five fields is twenty-five hand-copied values, two of
   * them a JWT and a signing secret. Those fail in the least helpful way when a
   * character is dropped — the app connects, reads succeed, and writes are
   * silently refused — so removing the transcription removes a whole class of
   * support question.
   *
   * The values are read here, sealed, and never returned. What goes back to the
   * renderer is the list of variable *names* that were used, which is enough to
   * confirm the right file was picked and discloses nothing.
   */
  ipcMain.handle('community:backend:importEnv', async () => {
    const window = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
    const picked = await dialog.showOpenDialog(window!, {
      title: 'Choose a .env file',
      properties: ['openFile'],
      filters: [
        { name: 'Environment files', extensions: ['env', 'local', 'txt'] },
        { name: 'All files', extensions: ['*'] },
      ],
    })
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, cancelled: true }

    let text: string
    try {
      text = await readFile(picked.filePaths[0], 'utf8')
    } catch (failure) {
      return { ok: false, error: `That file could not be read: ${failure instanceof Error ? failure.message : String(failure)}` }
    }

    const imported = backendFromEnv(text)
    const refused = refusedKeysIn(text)

    if (!imported.config.url || !imported.config.anonKey) {
      return {
        ok: false,
        error: `No Supabase project found in that file. Looked for ${imported.missing.join(', ')}.`,
        missing: imported.missing,
        refused,
      }
    }

    const existing = backendConfig()
    const validated = validateBackendConfig({
      ...imported.config,
      iceServers: existing?.iceServers ?? [],
    })
    if (!validated.ok) return { ok: false, error: validated.error, refused }

    const sealed = sealBackendConfig(safeStorage, validated.config)
    stores().backendStore.update(record => {
      record.sealed = sealed.value
      record.insecure = sealed.insecure
    })
    stores().backendStore.flush()

    const connected = await connectBackend()
    if (!connected.ok) return { ...connected, found: imported.found, refused }

    replication?.reconcile()
    return {
      ok: true,
      // Names only. Never the values, not even truncated.
      found: imported.found,
      missing: imported.missing,
      refused,
      insecureStorage: sealed.insecure,
    }
  })

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

    // Sending is the clearest possible signal that you have stopped typing.
    // Waiting for the TTL leaves your name under the composer after the
    // message it was describing is already on screen.
    presence.stopTyping(who.id, input.channel)

    const published = forViewer(result.message, '')
    broadcast('community:message', { channel: input.channel, message: published })
    broadcast('community:event', { type: 'message.new', channel: input.channel, message: published })
    notifyFor(result.message)
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
    broadcast('community:event', {
      type: 'reaction', channel: message.channel, message: forViewer(message, ''),
    })
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

  // -- Reading the room ------------------------------------------------------

  /**
   * Everything the shell needs to draw itself, in one call.
   *
   * The alternative was six round trips on every channel switch, each one a
   * separate chance for the sidebar, the header and the member list to be
   * showing three different moments.
   */
  ipcMain.handle('community:snapshot', async () => {
    const { identityStore, dataStore } = stores()
    const memberId = identityStore.get()?.memberId || ''
    const state = dataStore.get()

    return {
      ok: true,
      memberId,
      channels: activeChannels(state),
      categories: Object.values(state.categories).sort((a, b) => a.position - b.position),
      roles: Object.values(state.roles).sort((a, b) => b.position - a.position),
      memberRoles: state.memberRoles,
      ownership: state.ownership,
      isOwner: !!memberId && isOwner(state, memberId),
      permissions: memberId ? [...resolvePermissions(state, memberId)] : [],
      members: Object.values(state.members).map(m => ({
        ...m,
        // Presence is runtime state, so it is joined on the way out rather
        // than stored next to the member it describes.
        presence: presence.statusOf(m.id),
      })),
      voice: signaling.occupancy(),
      reads: state.reads[memberId] ?? {},
      notifPrefs: state.notifPrefs[memberId] ?? {},
    }
  })

  ipcMain.handle('community:thread', async (_e, rootId: string) => {
    const who = requireMember()
    const viewerId = 'error' in who ? '' : who.id
    const state = stores().dataStore.get()
    const root = state.messages.find(m => m.id === String(rootId) && !m.deletedAt)
    if (!root) return { ok: false, error: 'That conversation is gone.' }
    return {
      ok: true,
      root: forViewer(root, viewerId),
      replies: threadReplies(state, String(rootId), viewerId).map(m => forViewer(m, viewerId)),
    }
  })

  ipcMain.handle('community:editMessage', async (_e, messageId: string, body: string) => {
    const who = requireMember()
    if ('error' in who) return { ok: false, error: who.error }

    const { dataStore } = stores()
    let result: { ok: boolean; error?: string } = { ok: false, error: 'Unknown message.' }
    dataStore.update(state => { result = editMessage(state, String(messageId), who.id, String(body ?? ''), Date.now()) })
    if (result.ok) {
      const message = dataStore.get().messages.find(m => m.id === String(messageId))
      if (message) broadcast('community:event', { type: 'message.edit', channel: message.channel, message })
    }
    return result
  })

  ipcMain.handle('community:search', async (_e, query: string, options?: SearchOptions) => {
    const who = requireMember()
    const viewerId = 'error' in who ? '' : who.id
    return { ok: true, ...searchCommunity(stores().dataStore.get(), viewerId, String(query ?? ''), options ?? {}) }
  })

  /** Older messages, one page at a time. `before` is a message id rather than
   *  an offset — an offset shifts the moment anyone posts while you scroll. */
  ipcMain.handle('community:history', async (_e, channel: string, before?: string) => {
    const who = requireMember()
    const viewerId = 'error' in who ? '' : who.id
    const state = stores().dataStore.get()
    const page = visibleMessages(state, String(channel), viewerId, 50, before ? String(before) : undefined)
    return {
      ok: true,
      messages: page.map(m => forViewer(m, viewerId)),
      // Told explicitly rather than inferred from a short page, so the scroller
      // stops asking instead of retrying the same empty query forever.
      exhausted: page.length < 50,
    }
  })

  // -- Unread state and notification preferences -----------------------------

  ipcMain.handle('community:markRead', async (_e, channel: string, at?: number) => {
    const who = requireMember()
    if ('error' in who) return { ok: false }
    const { dataStore } = stores()
    dataStore.update(state => {
      const mine = state.reads[who.id] ??= {}
      const stamp = Number(at) || Date.now()
      // Never move the marker backwards: switching to an old channel and back
      // must not un-read what has already been seen.
      mine[String(channel)] = Math.max(mine[String(channel)] ?? 0, stamp)
    })
    return { ok: true }
  })

  ipcMain.handle('community:unread', async () => {
    const who = requireMember()
    if ('error' in who) return { ok: true, unread: {}, mentions: {} }
    const state = stores().dataStore.get()
    const reads = state.reads[who.id] ?? {}
    const unread: Record<string, number> = {}
    const mentions: Record<string, number> = {}

    for (const message of state.messages) {
      if (message.deletedAt || message.hiddenAt) continue
      if (message.authorId === who.id) continue
      if (message.createdAt <= (reads[message.channel] ?? 0)) continue
      unread[message.channel] = (unread[message.channel] ?? 0) + 1
      if (message.mentions?.includes(who.id) || message.mentionsEveryone) {
        mentions[message.channel] = (mentions[message.channel] ?? 0) + 1
      }
    }
    return { ok: true, unread, mentions }
  })

  ipcMain.handle('community:setNotifPref', async (_e, channel: string, level: NotifLevel) => {
    const who = requireMember()
    if ('error' in who) return { ok: false }
    const allowed: NotifLevel[] = ['all', 'mentions', 'none']
    if (!allowed.includes(level)) return { ok: false, error: 'Unknown notification level.' }

    const { dataStore } = stores()
    dataStore.update(state => { (state.notifPrefs[who.id] ??= {})[String(channel)] = level })
    return { ok: true }
  })

  // -- Direct messages -------------------------------------------------------

  ipcMain.handle('community:openDm', async (_e, otherId: string) => {
    const who = requireMember()
    if ('error' in who) return { ok: false, error: who.error }

    const { dataStore } = stores()
    let result: any = { ok: false, error: 'Could not open that conversation.' }
    dataStore.update(state => {
      result = openDirectMessage(state, who.id, String(otherId), Date.now(), newId)
    })
    if (result.ok) { persistNow(); broadcast('community:refresh', { reason: 'dm' }) }
    return result
  })

  ipcMain.handle('community:directMessages', async () => {
    const who = requireMember()
    if ('error' in who) return { ok: true, conversations: [] }
    return { ok: true, conversations: directMessagesFor(stores().dataStore.get(), who.id) }
  })

  // -- Link previews ---------------------------------------------------------

  /**
   * Fetch a link's card.
   *
   * Asked for by the renderer per URL, not fetched eagerly when a message
   * arrives: requesting a preview tells that site someone is looking at a
   * conversation containing its address, and the smallest number of those
   * requests is the right number.
   */
  ipcMain.handle('community:linkPreview', async (_e, url: string) => {
    const who = requireMember()
    if ('error' in who) return null
    return linkPreview(String(url ?? ''))
  })

  // -- Presence and typing ---------------------------------------------------

  ipcMain.handle('community:heartbeat', async (e, status: PresenceStatus) => {
    const who = requireMember()
    if ('error' in who) return { ok: true }
    presence.heartbeat(String(e.sender.id), who.id, status ?? 'online')
    // Announce to the other devices before telling this one who is here, so
    // the roster it renders already includes this heartbeat.
    await remotePresence?.track(who.id, status ?? 'online').catch(() => {})
    announcePresence()
    return { ok: true }
  })

  ipcMain.handle('community:typing', async (_e, channel: string, typing: boolean) => {
    const who = requireMember()
    if ('error' in who) return { ok: true }
    if (typing) presence.startTyping(who.id, String(channel))
    else presence.stopTyping(who.id, String(channel))
    await remotePresence?.typing(who.id, String(channel), !!typing).catch(() => {})
    broadcast('community:event', {
      type: 'typing', channel: String(channel), members: typingHere(String(channel)),
    })
    return { ok: true }
  })

  // -- Attachments -----------------------------------------------------------

  /**
   * Take bytes from the renderer, decide what they are, and store them.
   *
   * The renderer sends contents, never a path. It cannot name the file, cannot
   * choose the directory, and does not learn where the result landed — it gets
   * a record back and puts that on a message.
   */
  ipcMain.handle('community:uploadAttachment', async (_e, name: string, bytes: Uint8Array) => {
    const who = requireMember()
    if ('error' in who) return { ok: false, error: who.error }
    if (!hasPermission(stores().dataStore.get(), who.id, 'attach_files')) {
      return { ok: false, error: 'You cannot attach files here.' }
    }
    return saveAttachment(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []), String(name ?? 'file'))
  })

  // -- Voice, video and screen share ----------------------------------------

  ipcMain.handle('community:voice:join', async (e, channel: string) => {
    const who = requireMember()
    if ('error' in who) return { ok: false, error: who.error }

    const state = stores().dataStore.get()
    const room = state.channels[String(channel)]
    if (!room || room.type !== 'voice') return { ok: false, error: 'That is not a voice channel.' }
    if (!hasPermission(state, who.id, 'use_voice', String(channel))) {
      return { ok: false, error: 'You cannot join voice here.' }
    }

    // Composite, not the bare webContents id: every Electron process numbers
    // its first window 1, so five machines would produce five peers called "1"
    // and each would answer the others' offers as if they were its own.
    const peerId = compositePeerId(deviceId(), e.sender.id)
    const localPeers = signaling.join(peerId, who.id, String(channel))
    presence.joinVoice(String(e.sender.id), who.id, String(channel))
    await remotePresence?.track(who.id, 'online', String(channel)).catch(() => {})

    const remotePeers = await remoteSignaling?.join(peerId, who.id, String(channel)) ?? []
    announceVoice()
    // The arriving peer offers to everyone already present — on this machine
    // and on every other one. If both sides offered on sight, every pair would
    // negotiate twice and glare.
    return { ok: true, peerId, peers: [...localPeers, ...remotePeers] }
  })

  /**
   * A LiveKit join token, if this device has a LiveKit project configured.
   *
   * Returns `{ ok: true, livekit: null }` when it does not, and the renderer
   * falls back to the direct peer mesh between windows. That is the difference
   * between "no voice" and "voice that does not leave this machine", and the
   * caller has to be able to tell them apart.
   *
   * Permission is checked here and not only in the renderer: a token is a
   * capability, and minting one for somebody who may not speak in a room would
   * hand them the room regardless of what the UI shows them.
   */
  ipcMain.handle('community:voice:token', async (_e, channel: string) => {
    const who = requireMember()
    if ('error' in who) return { ok: false, error: who.error }

    const state = stores().dataStore.get()
    const slug = String(channel ?? '')
    const room = state.channels[slug]
    if (!room || room.type !== 'voice') return { ok: false, error: 'That is not a voice channel.' }
    if (!hasPermission(state, who.id, 'use_voice', slug)) {
      return { ok: false, error: 'You cannot join voice here.' }
    }

    const config = backendConfig()
    if (!config?.livekit) return { ok: true, livekit: null }

    try {
      const minted = await mintVoiceToken(config.livekit, {
        memberId: who.id,
        handle: state.members[who.id]?.handle ?? 'Member',
        channelSlug: slug,
      })
      return { ok: true, livekit: minted }
    } catch (failure) {
      return {
        ok: false,
        error: `Could not mint a LiveKit token: ${failure instanceof Error ? failure.message : String(failure)}`,
      }
    }
  })

  ipcMain.handle('community:voice:leave', async (e) => {
    const peerId = compositePeerId(deviceId(), e.sender.id)
    signaling.leave(peerId)
    presence.leaveVoice(String(e.sender.id))
    await remoteSignaling?.leave(peerId).catch(() => {})
    const me = requireMember()
    if (!('error' in me)) await remotePresence?.track(me.id, 'online').catch(() => {})
    announceVoice()
    return { ok: true }
  })

  ipcMain.handle('community:voice:signal', async (e, toPeerId: string, payload: unknown) => {
    // `from` is the sender's own id, taken here and never read from payload —
    // otherwise a peer can put someone else's id on an offer.
    const from = compositePeerId(deviceId(), e.sender.id)
    const to = String(toPeerId)

    // A window on this machine is reachable directly. Sending its offer to
    // Frankfurt and back to reach the window beside it would add a round trip
    // to every negotiation for nothing.
    const delivered = isLocalPeer(to, deviceId())
      ? signaling.signal(from, to, payload)
      : await remoteSignaling?.signal(from, to, payload) ?? false

    return { ok: delivered }
  })

  ipcMain.handle('community:voice:state', async (e, patch: Record<string, boolean>) => {
    const peerId = compositePeerId(deviceId(), e.sender.id)
    signaling.setState(peerId, patch ?? {})
    // Mirrored to the other devices too. Without this a camera turning on here
    // never opens a tile there, which is a large part of why screen share
    // looked broken rather than merely unshared.
    await remoteSignaling?.setState(peerId, patch ?? {}).catch(() => {})
    announceVoice()
    return { ok: true }
  })

  /**
   * The screens and windows available to share.
   *
   * Electron has no native picker — Chrome's is not available to an embedder —
   * so the app builds its own from this list. Thumbnails are small on purpose:
   * this is a chooser, not a preview.
   */
  ipcMain.handle('community:screenSources', async () => {
    const who = requireMember()
    if ('error' in who) return { ok: false, error: who.error, sources: [] }
    if (!hasPermission(stores().dataStore.get(), who.id, 'screen_share')) {
      return { ok: false, error: 'You cannot share your screen here.', sources: [] }
    }
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
    })
    return {
      ok: true,
      sources: sources.map(s => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
        isScreen: s.id.startsWith('screen:'),
      })),
    }
  })
}

/**
 * Forget a window's presence and drop it out of any call.
 *
 * Called from the window's own 'closed' handler. Without it a closed window
 * stays "online" until its heartbeat expires and, worse, stays in the voice
 * roster with a peer connection nobody is on the other end of.
 */
export function releaseCommunityWindow(windowId: number): void {
  const peerId = compositePeerId(deviceId(), windowId)
  presence.dropWindow(String(windowId))
  signaling.dropPeer(peerId)
  // Tell the other machines too. Without this a closed window stays in their
  // roster holding a peer connection nobody is on the other end of, showing a
  // frozen last frame until the socket eventually times out.
  void remoteSignaling?.leave(peerId).catch(() => {})
  announceVoice()
}
