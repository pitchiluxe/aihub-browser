import crypto from 'crypto'

/**
 * AIHub Browser — end-to-end encryption and merging for cloud sync.
 *
 * Sync uploads to the user's own Google Drive, but Drive is still someone
 * else's disk: the bookmark list and settings are encrypted here, with a key
 * derived from a passphrase the user knows and this machine holds. What lands
 * in Drive is ciphertext plus the parameters needed to decrypt it with that
 * passphrase — no key material, no plaintext, nothing usable by anyone who
 * gets the file.
 *
 * AES-256-GCM with a random IV per encryption, and scrypt for key derivation
 * (memory-hard, so a stolen blob resists brute forcing). GCM's auth tag means
 * a tampered or truncated blob fails loudly instead of decrypting to garbage.
 */

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const IV_LENGTH = 12          // 96 bits, the size GCM is defined for
const SALT_LENGTH = 16
const SCRYPT_COST = 2 ** 15   // ~200ms on a laptop: painful to brute force, invisible to the user

export interface EncryptedBlob {
  v: 1
  salt: string
  iv: string
  tag: string
  data: string
}

export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(String(passphrase), salt, KEY_LENGTH, { N: SCRYPT_COST, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
}

export function encryptJson(value: unknown, passphrase: string): EncryptedBlob {
  if (!passphrase) throw new Error('A passphrase is required to encrypt sync data')
  const salt = crypto.randomBytes(SALT_LENGTH)
  const iv = crypto.randomBytes(IV_LENGTH)
  const key = deriveKey(passphrase, salt)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const plaintext = Buffer.from(JSON.stringify(value), 'utf-8')
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    v: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }
}

export function decryptJson<T = unknown>(blob: EncryptedBlob, passphrase: string): T {
  if (!blob || blob.v !== 1) throw new Error('Unrecognised sync file')
  const key = deriveKey(passphrase, Buffer.from(blob.salt, 'base64'))
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(blob.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(blob.data, 'base64')),
    decipher.final(),   // throws if the passphrase is wrong or the blob was altered
  ])
  return JSON.parse(plaintext.toString('utf-8')) as T
}

// ── Merging ────────────────────────────────────────────────────────────────

export interface SyncBookmark {
  id: string
  url: string
  title: string
  addedAt: number
  /** Set when the bookmark was deleted, so the deletion syncs too. */
  deletedAt?: number
  [key: string]: unknown
}

export interface SyncPayload {
  bookmarks: SyncBookmark[]
  settings: Record<string, unknown>
  updatedAt: number
}

/** Bookmarks are the same entry when they point at the same normalised URL. */
export function bookmarkKey(bookmark: { url: string }): string {
  const raw = String(bookmark?.url || '').trim().toLowerCase()
  try {
    const u = new URL(raw)
    const path = u.pathname.replace(/\/$/, '')
    return `${u.hostname.replace(/^www\./, '')}${path}${u.search}`
  } catch {
    return raw.replace(/\/$/, '')
  }
}

/**
 * Merge two devices' bookmark lists.
 *
 * Last write wins per bookmark, and a deletion is a write — otherwise a
 * bookmark deleted on the laptop reappears the next time the desktop syncs,
 * which is the classic way sync earns a user's distrust. Deletions are kept as
 * tombstones so they can out-rank an older copy on another device.
 */
export function mergeBookmarks(local: SyncBookmark[], remote: SyncBookmark[]): SyncBookmark[] {
  const byKey = new Map<string, SyncBookmark>()
  const stamp = (b: SyncBookmark) => Math.max(b.deletedAt || 0, b.addedAt || 0)

  for (const bookmark of [...(local || []), ...(remote || [])]) {
    if (!bookmark?.url) continue
    const key = bookmarkKey(bookmark)
    const existing = byKey.get(key)
    if (!existing || stamp(bookmark) > stamp(existing)) byKey.set(key, bookmark)
  }

  return [...byKey.values()]
    .filter(b => !b.deletedAt)
    .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
}

/** Settings the user has explicitly asked not to leave the machine. */
const NEVER_SYNC = new Set([
  'openrouterKey', 'openrouterBase', 'openrouterModel', 'ollamaUrl',
  'obsidianVault',       // a local filesystem path means nothing on another machine
  'containers',          // cookie jars are per-device by definition
])

export function syncableSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(settings || {})) {
    if (NEVER_SYNC.has(key)) continue
    out[key] = value
  }
  return out
}

/** Whole-payload merge: newest settings win, bookmarks merge entry by entry. */
export function mergePayloads(local: SyncPayload, remote: SyncPayload | null): SyncPayload {
  if (!remote) return local
  const newer = (remote.updatedAt || 0) > (local.updatedAt || 0) ? remote : local
  return {
    bookmarks: mergeBookmarks(local.bookmarks || [], remote.bookmarks || []),
    settings: { ...(local.settings || {}), ...(newer === remote ? remote.settings || {} : {}) },
    updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0),
  }
}
