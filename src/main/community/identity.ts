import crypto from 'crypto'

/**
 * AIHub Community — the device identity.
 *
 * Anonymous, but enforceable. There is no email, no password and no social
 * login; a member is an Ed25519 public key, and every write is signed by the
 * matching private key.
 *
 * The reason it is a keypair rather than the machine id the product first
 * described: an id the client generates is a *claim*, not a credential. The
 * user's machine controls it, so it can be forged or rotated at will, which
 * makes a ban worth nothing and a spam wave free. A key the server has seen
 * and bound to a member row is something the holder can present and cannot
 * mint. Same reason a JWT is signed by the issuer.
 *
 * The private key never leaves the main process. The renderer composes
 * untrusted web content, so a key reachable from there is a key reachable by a
 * page bug; the renderer asks main to sign and gets back a signature.
 */

/** Ed25519 rather than RSA: 32-byte keys, fast signatures, no parameter
 *  choices to get wrong, and supported by Node's built-in crypto since 12. */
const KEY_TYPE = 'ed25519'

export interface KeyPairPem {
  publicKey: string
  privateKey: string
}

export interface StoredIdentity {
  /** PEM, encrypted at rest when the OS provides a keychain. */
  privateKey: string
  publicKey: string
  /** Server-issued member id. Null between key generation and registration —
   *  a network failure mid-signup must not cost the user their key. */
  memberId: string | null
  handle: string
  createdAt: number
  /**
   * True when the private key is sitting on disk unencrypted because the OS
   * had no keychain to offer (a real case on Linux without libsecret).
   * Surfaced in the UI: failing silently is not acceptable, and refusing to
   * run over it is worse than telling the user the truth.
   */
  insecureStorage: boolean
}

/** The subset of Electron's safeStorage this module needs, so tests can supply
 *  their own without an Electron runtime. */
export interface SecretBox {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(cipher: Buffer): string
}

export function generateKeyPair(): KeyPairPem {
  const { publicKey, privateKey } = crypto.generateKeyPairSync(KEY_TYPE, {
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return { publicKey, privateKey }
}

/**
 * Canonical JSON: object keys sorted, no incidental whitespace.
 *
 * Both sides of a signature must serialize the payload identically or every
 * verification fails, and the failure looks like a wrong key rather than a
 * wrong string. Property order in JS objects is insertion order, so the naive
 * `JSON.stringify` makes the signature depend on the order the client happened
 * to build the object in — a bug that survives every local test and appears
 * the first time the server constructs the same payload its own way.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

/** Sign a payload with the device key. Returns base64. */
export function signPayload(privateKeyPem: string, payload: unknown): string {
  const key = crypto.createPrivateKey(privateKeyPem)
  // Ed25519 signs the message directly — no separate digest, and passing an
  // algorithm name here is an error rather than a hardening step.
  return crypto.sign(null, Buffer.from(canonicalJson(payload), 'utf8'), key).toString('base64')
}

/** Verify a signature. The server does this; it lives here so the round trip
 *  is testable without one. */
export function verifyPayload(publicKeyPem: string, payload: unknown, signatureB64: string): boolean {
  try {
    const key = crypto.createPublicKey(publicKeyPem)
    return crypto.verify(
      null,
      Buffer.from(canonicalJson(payload), 'utf8'),
      key,
      Buffer.from(signatureB64, 'base64'),
    )
  } catch {
    // A malformed key or signature is a failed verification, not a crash —
    // this runs on attacker-supplied input.
    return false
  }
}

/**
 * A request envelope: the payload plus what the server needs to reject a
 * replay of it.
 *
 * `timestamp` bounds how long a captured request stays useful and `nonce`
 * makes each one single-use. Neither is sufficient alone — a timestamp lets a
 * captured request be replayed for its whole window, and a nonce without a
 * timestamp means the server must remember every nonce forever.
 */
export interface SignedEnvelope<T> {
  payload: T
  timestamp: number
  nonce: string
  signature: string
}

export function signEnvelope<T>(privateKeyPem: string, payload: T, now = Date.now()): SignedEnvelope<T> {
  const timestamp = Math.floor(now / 1000)
  const nonce = crypto.randomBytes(16).toString('base64')
  // The signature covers the timestamp and nonce too, or an attacker could
  // replay the payload with a fresh pair and pass every check.
  const signature = signPayload(privateKeyPem, { payload, timestamp, nonce })
  return { payload, timestamp, nonce, signature }
}

export const MAX_CLOCK_SKEW_SECONDS = 120

export type EnvelopeCheck =
  | { ok: true }
  | { ok: false; reason: 'bad_signature' | 'clock_skew'; skewSeconds?: number }

/**
 * Server-side envelope check. Nonce reuse is not checked here — that needs
 * storage, and the caller owns it.
 */
export function checkEnvelope<T>(
  publicKeyPem: string,
  envelope: SignedEnvelope<T>,
  now = Date.now(),
): EnvelopeCheck {
  const skew = Math.abs(Math.floor(now / 1000) - envelope.timestamp)
  if (skew > MAX_CLOCK_SKEW_SECONDS) return { ok: false, reason: 'clock_skew', skewSeconds: skew }

  const ok = verifyPayload(publicKeyPem, {
    payload: envelope.payload, timestamp: envelope.timestamp, nonce: envelope.nonce,
  }, envelope.signature)
  return ok ? { ok: true } : { ok: false, reason: 'bad_signature' }
}

// ── Encryption at rest ─────────────────────────────────────────────────────

const CIPHER_PREFIX = 'enc:v1:'

/**
 * Wrap the private key for disk.
 *
 * The marker matters: without it there is no way to tell an encrypted blob
 * from a PEM, so a machine that gains a keychain between runs would try to
 * decrypt plaintext, and one that loses it would hand ciphertext to the PEM
 * parser. The prefix makes the on-disk form self-describing.
 */
export function sealPrivateKey(box: SecretBox, pem: string): { value: string; insecure: boolean } {
  if (!box.isEncryptionAvailable()) return { value: pem, insecure: true }
  return { value: CIPHER_PREFIX + box.encryptString(pem).toString('base64'), insecure: false }
}

export function openPrivateKey(box: SecretBox, stored: string): string {
  if (!stored.startsWith(CIPHER_PREFIX)) return stored
  return box.decryptString(Buffer.from(stored.slice(CIPHER_PREFIX.length), 'base64'))
}
