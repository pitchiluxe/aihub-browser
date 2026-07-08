// Bundled OAuth client for the shipped app. Replace these with the values from
// your Google Cloud "Desktop app" OAuth client. A user-provided client in
// Settings overrides them at runtime. For a desktop PKCE client the secret is
// not treated as confidential; leave it empty unless using a classic client.
export const DEFAULT_CLIENT_ID = '' // intentionally blank — paste your Desktop OAuth
export const DEFAULT_CLIENT_SECRET = '' // client_id/secret into Settings > Gmail instead (not tracked by git)
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ')

export const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
export const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1'
