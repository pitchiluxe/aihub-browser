import { shell } from 'electron'
import crypto from 'crypto'
import http from 'http'
import { b64urlEncode } from './base64url'
import { httpJson } from './http'
import { saveTokens, loadTokens, clearTokens } from './store'
import {
  DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET, GMAIL_SCOPES,
  AUTH_ENDPOINT, TOKEN_ENDPOINT, REVOKE_ENDPOINT, GMAIL_API_BASE,
} from './config'

let accessToken = ''
let accessExpiry = 0 // epoch ms
let pendingServer: http.Server | null = null

function creds() {
  const stored = loadTokens()
  const clientId = stored?.clientId || DEFAULT_CLIENT_ID
  const clientSecret = stored?.clientSecret || DEFAULT_CLIENT_SECRET
  return { clientId, clientSecret }
}

function form(obj: Record<string, string>): string {
  return Object.entries(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
}

export function currentEmail(): string | null {
  return loadTokens()?.email ?? null
}

export async function beginConnect(): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  // Allow overriding via a user-provided client entered in Settings before connect;
  // Settings writes them into a temporary store entry consumed here. If none and no
  // bundled default, error clearly.
  const overrideId = loadTokens()?.clientId // pre-seeded override (email empty) if user set one
  const clientId = overrideId || DEFAULT_CLIENT_ID
  const clientSecret = loadTokens()?.clientSecret || DEFAULT_CLIENT_SECRET
  if (!clientId) return { ok: false, error: 'No Google client configured. Add your OAuth client_id in Settings → Gmail.' }

  const verifier = b64urlEncode(crypto.randomBytes(32))
  const challenge = b64urlEncode(crypto.createHash('sha256').update(verifier).digest())
  const state = b64urlEncode(crypto.randomBytes(16))

  return new Promise(resolve => {
    let settled = false
    const finish = (r: { ok: true; email: string } | { ok: false; error: string }) => {
      if (settled) return; settled = true
      try { pendingServer?.close() } catch {}; pendingServer = null
      clearTimeout(timer)
      resolve(r)
    }
    // cancel any prior pending flow
    try { pendingServer?.close() } catch {}
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '', 'http://127.0.0.1')
        const code = url.searchParams.get('code')
        const gotState = url.searchParams.get('state')
        const err = url.searchParams.get('error')
        res.setHeader('Content-Type', 'text/html')
        if (err || !code || gotState !== state) {
          res.end('<h2>Sign-in failed. You can close this tab.</h2>')
          finish({ ok: false, error: err || 'invalid callback' })
          return
        }
        res.end('<h2>Connected. You can close this tab and return to AIHub Browser.</h2>')
        const port = (server.address() as any).port
        // exchange code
        const tokenRes = await httpJson('POST', TOKEN_ENDPOINT, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form({
            code, client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}),
            redirect_uri: `http://127.0.0.1:${port}`, grant_type: 'authorization_code', code_verifier: verifier,
          }),
        })
        const tok = JSON.parse(tokenRes.body)
        if (!tok.access_token || !tok.refresh_token) { finish({ ok: false, error: tok.error_description || 'token exchange failed' }); return }
        accessToken = tok.access_token
        accessExpiry = Date.now() + (tok.expires_in ?? 3600) * 1000
        // fetch profile for the account email
        const prof = await httpJson('GET', `${GMAIL_API_BASE}/users/me/profile`, { headers: { Authorization: `Bearer ${accessToken}` } })
        const email = JSON.parse(prof.body).emailAddress || 'unknown'
        saveTokens({ email, refreshToken: tok.refresh_token, clientId, clientSecret })
        finish({ ok: true, email })
      } catch (e: any) {
        finish({ ok: false, error: e.message || 'callback error' })
      }
    })
    pendingServer = server
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as any).port
      const authUrl = `${AUTH_ENDPOINT}?` + form({
        client_id: clientId, redirect_uri: `http://127.0.0.1:${port}`, response_type: 'code',
        scope: GMAIL_SCOPES, access_type: 'offline', prompt: 'consent',
        code_challenge: challenge, code_challenge_method: 'S256', state,
      })
      shell.openExternal(authUrl)
    })
    const timer = setTimeout(() => finish({ ok: false, error: 'consent timed out' }), 5 * 60_000)
  })
}

export async function getAccessToken(): Promise<string> {
  const stored = loadTokens()
  if (!stored) throw new Error('not-connected')
  if (accessToken && Date.now() < accessExpiry - 60_000) return accessToken
  const { clientId, clientSecret } = creds()
  const res = await httpJson('POST', TOKEN_ENDPOINT, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({
      client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}),
      refresh_token: stored.refreshToken, grant_type: 'refresh_token',
    }),
  })
  const tok = JSON.parse(res.body)
  if (!tok.access_token) {
    if (tok.error === 'invalid_grant') { clearTokens(); accessToken = ''; throw new Error('needs-reconnect') }
    throw new Error(tok.error_description || 'token refresh failed')
  }
  accessToken = tok.access_token
  accessExpiry = Date.now() + (tok.expires_in ?? 3600) * 1000
  return accessToken
}

export async function disconnect(): Promise<void> {
  const stored = loadTokens()
  if (stored?.refreshToken) {
    try { await httpJson('POST', REVOKE_ENDPOINT, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ token: stored.refreshToken }) }) } catch {}
  }
  clearTokens(); accessToken = ''; accessExpiry = 0
}
