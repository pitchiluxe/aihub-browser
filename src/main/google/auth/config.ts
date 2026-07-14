// Central OAuth + API configuration for the Google integration.
//
// Client credentials: blank by default and never committed. The shipped app
// resolves them at runtime from the encrypted session (user pastes a Google
// "Desktop app" OAuth client ID in Settings → Google). For a desktop PKCE
// client the secret is not confidential and may be left empty.
export const DEFAULT_CLIENT_ID = ''
export const DEFAULT_CLIENT_SECRET = ''

// Google Identity OAuth 2.0 endpoints (current, non-deprecated).
export const OAUTH_ENDPOINTS = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
} as const

// REST API bases for each supported product + OpenID userinfo.
export const API_BASES = {
  gmail: 'https://gmail.googleapis.com/gmail/v1',
  drive: 'https://www.googleapis.com/drive/v3',
  calendar: 'https://www.googleapis.com/calendar/v3',
  userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
} as const

// Loopback callback. Google's "Desktop app" client type allows the loopback
// redirect (127.0.0.1) on ANY port and ignores the port when matching, so the
// preferred port is best-effort: if 3000 is busy we transparently fall back to
// an OS-assigned free port. If you instead register a "Web application" client,
// add BOTH of these exact URIs as Authorized redirect URIs and keep port 3000
// free:  http://127.0.0.1:3000/callback  and  http://localhost:3000/callback
export const CALLBACK = {
  host: '127.0.0.1',
  preferredPort: 3000,
  path: '/callback',
} as const

// OAuth consent timeout — how long we keep the loopback server open waiting for
// the user to finish signing in in their browser.
export const CONSENT_TIMEOUT_MS = 5 * 60_000
