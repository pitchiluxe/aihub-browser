import { shell, app } from 'electron'
import fs from 'fs'
import { spawn } from 'child_process'
import { httpJson, formEncode } from '../http'
import {
  OAUTH_ENDPOINTS, API_BASES, CONSENT_TIMEOUT_MS,
  DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET,
} from './config'
import { GoogleApiId, scopesForApis, grantedApis } from './scopes'
import { generatePkce, randomState } from './pkce'
import { startCallbackServer } from './callbackServer'
import { loadSession, saveSession, setStoredCredentials, GoogleSession } from './secureStore'
import { cacheAccessToken, getAccessToken, revokeAndClear, resetAccessCache } from './tokenManager'

export type ConnectResult =
  | { ok: true; email: string; scopes: string[]; apis: GoogleApiId[] }
  | { ok: false; error: string }

export interface AuthStatus {
  connected: boolean
  email: string | null
  scopes: string[]
  apis: GoogleApiId[]
}

let inFlight = false

function resolveClient(): { clientId: string; clientSecret: string } {
  const s = loadSession()
  return {
    clientId: s?.clientId || DEFAULT_CLIENT_ID,
    clientSecret: s?.clientSecret || DEFAULT_CLIENT_SECRET,
  }
}

// Open the OAuth URL in the user's real browser. shell.openExternal() is the
// correct, cross-platform primitive (never a BrowserWindow/WebView). The one
// trap: if AIHub itself is registered as the OS default http(s) handler,
// openExternal would loop the URL straight back into this app's embedded view —
// which is exactly the "browser may not be secure" surface. In that case only,
// launch a real installed browser binary directly so the consent screen always
// escapes the app.
function openAuthUrl(url: string): void {
  let appIsDefault = false
  try {
    appIsDefault = app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https')
  } catch { /* assume not default */ }

  if (!appIsDefault) {
    shell.openExternal(url)
    return
  }

  const pf = process.env['ProgramFiles'] || 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const local = process.env['LOCALAPPDATA'] || ''
  const candidates =
    process.platform === 'win32'
      ? [
          `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`,
          `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
          `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
          `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
          ...(local ? [`${local}\\Google\\Chrome\\Application\\chrome.exe`] : []),
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Firefox.app/Contents/MacOS/firefox',
          ]
        : ['google-chrome', 'microsoft-edge', 'chromium-browser', 'firefox']

  const bin = candidates.find(p => process.platform !== 'win32' && process.platform !== 'darwin' ? true : fs.existsSync(p))
  if (!bin) {
    shell.openExternal(url)
    return
  }
  try {
    spawn(bin, [url], { detached: true, stdio: 'ignore' }).unref()
  } catch {
    shell.openExternal(url)
  }
}

async function fetchEmail(accessToken: string): Promise<string> {
  try {
    const res = await httpJson('GET', API_BASES.userinfo, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (res.status < 400) return JSON.parse(res.body).email || 'unknown'
  } catch { /* fall through */ }
  return 'unknown'
}

// Run the full Authorization Code + PKCE flow for the requested APIs. When the
// user is already connected, previously granted scopes are merged in and
// include_granted_scopes keeps them — so adding Drive later doesn't drop Gmail.
export async function connect(apis: GoogleApiId[]): Promise<ConnectResult> {
  if (inFlight) return { ok: false, error: 'A sign-in is already in progress.' }
  const { clientId, clientSecret } = resolveClient()
  if (!clientId) {
    return { ok: false, error: 'No Google OAuth client configured. Add your Desktop client ID in Settings → Google.' }
  }

  const existing = loadSession()
  const requested = scopesForApis(apis)
  const scopeSet = new Set<string>([...(existing?.grantedScopes || []), ...requested])
  const scope = [...scopeSet].join(' ')

  const pkce = generatePkce()
  const state = randomState()
  inFlight = true
  let server: Awaited<ReturnType<typeof startCallbackServer>> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  try {
    server = await startCallbackServer(state)

    const authUrl =
      `${OAUTH_ENDPOINTS.auth}?` +
      formEncode({
        client_id: clientId,
        redirect_uri: server.redirectUri,
        response_type: 'code',
        scope,
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        code_challenge: pkce.challenge,
        code_challenge_method: pkce.method,
        state,
      })

    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error('Sign-in timed out. Please try again.')), CONSENT_TIMEOUT_MS)
    })

    openAuthUrl(authUrl)
    const { code } = await Promise.race([server.wait, timeout])

    // Exchange the authorization code for tokens (verifier proves this is the
    // same client that started the flow).
    const tokenRes = await httpJson('POST', OAUTH_ENDPOINTS.token, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formEncode({
        code,
        client_id: clientId,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
        redirect_uri: server.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: pkce.verifier,
      }),
    })

    let tok: any
    try {
      tok = JSON.parse(tokenRes.body)
    } catch {
      throw new Error(`token endpoint returned HTTP ${tokenRes.status}`)
    }
    if (!tok.access_token) throw new Error(tok.error_description || tok.error || 'token exchange failed')

    cacheAccessToken(tok.access_token, tok.expires_in)
    const granted = (tok.scope ? String(tok.scope).split(' ') : [...scopeSet]).filter(Boolean)

    // Reuse the previous refresh token if Google didn't issue a new one (it only
    // returns refresh_token on first consent for a given client+scope set).
    const refreshToken = tok.refresh_token || existing?.refreshToken || ''
    if (!refreshToken) throw new Error('No refresh token returned. Revoke the app at myaccount.google.com and retry.')

    const email = await fetchEmail(tok.access_token)
    const session: GoogleSession = { clientId, clientSecret, refreshToken, email, grantedScopes: granted }
    saveSession(session)

    return { ok: true, email, scopes: granted, apis: grantedApis(granted) }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'sign-in failed' }
  } finally {
    if (timer) clearTimeout(timer)
    server?.close()
    inFlight = false
  }
}

export async function disconnect(): Promise<void> {
  await revokeAndClear()
}

export function status(): AuthStatus {
  const s = loadSession()
  const scopes = s?.grantedScopes || []
  return {
    connected: !!s?.refreshToken,
    email: s?.email || null,
    scopes,
    apis: grantedApis(scopes),
  }
}

export function setCredentials(clientId: string, clientSecret: string): void {
  setStoredCredentials(clientId, clientSecret)
  resetAccessCache()
}

// Ensure a valid token exists for the given APIs; returns false if the user
// needs to (re)connect or hasn't granted those scopes.
export async function ensureConnected(apis: GoogleApiId[]): Promise<boolean> {
  const st = status()
  if (!st.connected) return false
  if (!apis.every(a => st.apis.includes(a))) return false
  try {
    await getAccessToken()
    return true
  } catch {
    return false
  }
}
