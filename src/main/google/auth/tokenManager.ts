import { httpJson, formEncode } from '../http'
import { OAUTH_ENDPOINTS } from './config'
import { loadSession, clearSession } from './secureStore'

// In-memory access-token cache. Access tokens are short-lived and never
// persisted; only the refresh token is stored (encrypted). On demand we return
// a cached token if still valid, otherwise silently mint a new one from the
// refresh token.
let accessToken = ''
let accessExpiry = 0 // epoch ms

// Thrown so callers/UI can distinguish "user must re-consent" from transient
// errors. Google returns invalid_grant when a refresh token is revoked, expired
// (unused 6 months / test-mode 7 days), or the account password changed.
export class NeedsReauthError extends Error {
  constructor(msg = 'needs-reconnect') {
    super(msg)
    this.name = 'NeedsReauthError'
  }
}

export function cacheAccessToken(token: string, expiresInSec: number): void {
  accessToken = token
  accessExpiry = Date.now() + (expiresInSec || 3600) * 1000
}

export function resetAccessCache(): void {
  accessToken = ''
  accessExpiry = 0
}

// Return a valid access token, refreshing transparently when needed. Throws
// NeedsReauthError when the refresh token is no longer usable.
export async function getAccessToken(): Promise<string> {
  const session = loadSession()
  if (!session || !session.refreshToken) throw new NeedsReauthError('not-connected')

  // 60s skew guard so a token doesn't expire mid-request.
  if (accessToken && Date.now() < accessExpiry - 60_000) return accessToken

  const res = await httpJson('POST', OAUTH_ENDPOINTS.token, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formEncode({
      client_id: session.clientId,
      ...(session.clientSecret ? { client_secret: session.clientSecret } : {}),
      refresh_token: session.refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  let tok: any
  try {
    tok = JSON.parse(res.body)
  } catch {
    throw new Error(`token endpoint returned HTTP ${res.status} (non-JSON body)`)
  }

  if (!tok.access_token) {
    if (tok.error === 'invalid_grant') {
      // Refresh token is dead — wipe the session so the UI prompts a reconnect.
      clearSession()
      resetAccessCache()
      throw new NeedsReauthError()
    }
    throw new Error(tok.error_description || tok.error || 'token refresh failed')
  }

  cacheAccessToken(tok.access_token, tok.expires_in)
  return accessToken
}

// Best-effort revoke of the refresh token at Google, then forget it locally.
export async function revokeAndClear(): Promise<void> {
  const session = loadSession()
  if (session?.refreshToken) {
    try {
      await httpJson('POST', OAUTH_ENDPOINTS.revoke, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formEncode({ token: session.refreshToken }),
      })
    } catch { /* revoke is best-effort; still clear locally */ }
  }
  clearSession()
  resetAccessCache()
}
