/**
 * Where the community lives, and the key that opens the door.
 *
 * Sealed with `safeStorage` and written beside the identity file, for the same
 * reason the identity is: an anon key sitting in plaintext on disk is an anon
 * key in every backup, every sync folder and every support screenshot. The
 * `insecure` flag is reported rather than swallowed — on a Linux box with no
 * keyring the encryption is a no-op, and the user is entitled to know that
 * before they paste a credential.
 *
 * Validation lives here, away from the client, so a mistyped URL produces a
 * sentence beside the field instead of a connection that hangs for thirty
 * seconds and dies with a stack trace in a console nobody has open.
 */

export interface RTCIceServerConfig {
  urls: string | string[]
  username?: string
  credential?: string
}

/**
 * A LiveKit project, for voice, video and screen share.
 *
 * `apiSecret` never leaves the main process. It signs a short-lived join token
 * that the renderer receives instead — the same split the QuickBooks app makes
 * between its `/api/breakroom/livekit/token` route and its client, except the
 * "server" here is the Electron main process, which is already the boundary
 * holding the identity private key.
 */
export interface LiveKitConfig {
  url: string
  apiKey: string
  apiSecret: string
}

export interface BackendConfig {
  url: string
  anonKey: string
  /**
   * Empty is correct on a LAN — host candidates find each other directly and a
   * STUN round trip only adds latency to a connection that did not need it. It
   * stops being correct the moment one device is somewhere else, which is why
   * this is configuration rather than a constant.
   *
   * Only consulted by the peer-to-peer fallback. With LiveKit configured this
   * is dead weight: an SFU terminates the media itself and does its own
   * traversal, which is the entire reason to use one.
   */
  iceServers: RTCIceServerConfig[]
  /** Absent means fall back to the direct peer-to-peer mesh between windows. */
  livekit: LiveKitConfig | null
}

export type ConfigResult =
  | { ok: true; config: BackendConfig }
  | { ok: false; error: string }

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(sealed: Buffer): string
}

export function validateBackendConfig(input: unknown): ConfigResult {
  const raw = (input ?? {}) as Partial<BackendConfig>

  // A trailing slash is the single most common paste error and it produces
  // double-slashed request paths that Supabase answers with a 404 — cheaper to
  // fix here than to explain later.
  const url = String(raw.url ?? '').trim().replace(/\/+$/, '')
  if (!url) return { ok: false, error: 'The project URL is required.' }
  if (!url.startsWith('https://')) {
    return { ok: false, error: 'The project URL must start with https://.' }
  }

  const anonKey = String(raw.anonKey ?? '').trim()
  if (!anonKey) return { ok: false, error: 'The anon key is required.' }

  const iceServers: RTCIceServerConfig[] = []
  for (const entry of Array.isArray(raw.iceServers) ? raw.iceServers : []) {
    const candidate = (entry ?? {}) as RTCIceServerConfig
    const urls = Array.isArray(candidate.urls)
      ? candidate.urls.map(u => String(u).trim()).filter(Boolean)
      : String(candidate.urls ?? '').trim()

    if (!urls.length) return { ok: false, error: 'Every ICE server needs a urls value.' }

    const server: RTCIceServerConfig = { urls }
    if (candidate.username) server.username = String(candidate.username)
    if (candidate.credential) server.credential = String(candidate.credential)
    iceServers.push(server)
  }

  const livekit = validateLiveKit(raw.livekit)
  if ('error' in livekit) return { ok: false, error: livekit.error }

  return { ok: true, config: { url, anonKey, iceServers, livekit: livekit.value } }
}

/**
 * All three LiveKit fields or none.
 *
 * A partially filled project is the worst outcome available: it looks
 * configured, so the UI stops offering the peer-to-peer fallback, and then
 * every join fails at token minting. Refusing here means the panel says which
 * field is missing while the user is still looking at it.
 */
function validateLiveKit(
  input: unknown,
): { value: LiveKitConfig | null } | { error: string } {
  const raw = (input ?? null) as Partial<LiveKitConfig> | null
  if (!raw) return { value: null }

  const url = String(raw.url ?? '').trim().replace(/\/+$/, '')
  const apiKey = String(raw.apiKey ?? '').trim()
  const apiSecret = String(raw.apiSecret ?? '').trim()

  if (!url && !apiKey && !apiSecret) return { value: null }

  if (!url) return { error: 'The LiveKit URL is required to use LiveKit.' }
  if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
    return { error: 'The LiveKit URL must start with wss://.' }
  }
  if (!apiKey) return { error: 'The LiveKit API key is required.' }
  if (!apiSecret) return { error: 'The LiveKit API secret is required.' }

  return { value: { url, apiKey, apiSecret } }
}

export function sealBackendConfig(
  safeStorage: SafeStorageLike, config: BackendConfig,
): { value: string; insecure: boolean } {
  const plain = JSON.stringify(config)
  if (!safeStorage.isEncryptionAvailable()) {
    // Marked rather than refused. Refusing would make the whole feature
    // unavailable on a machine with no keyring, which is a worse trade than
    // storing it readable and saying so.
    return { value: `plain:${plain}`, insecure: true }
  }
  return { value: safeStorage.encryptString(plain).toString('base64'), insecure: false }
}

export function loadBackendConfig(
  safeStorage: SafeStorageLike, raw: string | null,
): BackendConfig | null {
  if (!raw) return null
  try {
    const plain = raw.startsWith('plain:')
      ? raw.slice('plain:'.length)
      : safeStorage.decryptString(Buffer.from(raw, 'base64'))
    const parsed = validateBackendConfig(JSON.parse(plain))
    return parsed.ok ? parsed.config : null
  } catch {
    // A blob the OS can no longer decrypt — keychain reset, profile copied to
    // another machine — is gone. Returning null drops the app back to local
    // mode, which is a working state. Throwing here would take the entire
    // Community tab down over a credential the user can simply paste again.
    return null
  }
}
