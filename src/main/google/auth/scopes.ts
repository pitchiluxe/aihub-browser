// Scope registry — the single place that maps each supported Google API to the
// OAuth scopes it needs. Adding a new API is a one-line change here plus a new
// module under ../apis and a base URL in config.API_BASES.

export type GoogleApiId = 'gmail' | 'drive' | 'calendar'

// Always requested so we can identify the signed-in account (OpenID Connect).
export const BASE_SCOPES = ['openid', 'email', 'profile']

export const API_SCOPES: Record<GoogleApiId, string[]> = {
  gmail: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
  ],
  // readonly → browse the user's files; appdata → private per-app hidden
  // folder used by cross-device handoff (never exposes the rest of Drive).
  drive: [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.appdata',
  ],
  calendar: ['https://www.googleapis.com/auth/calendar.readonly'],
}

export const ALL_API_IDS: GoogleApiId[] = ['gmail', 'drive', 'calendar']

// Union of base scopes + every requested API's scopes, de-duplicated.
export function scopesForApis(apis: GoogleApiId[]): string[] {
  const set = new Set<string>(BASE_SCOPES)
  for (const a of apis) (API_SCOPES[a] || []).forEach(s => set.add(s))
  return [...set]
}

// True when every scope an API needs is present in `granted`.
export function apiIsGranted(api: GoogleApiId, granted: string[]): boolean {
  const need = API_SCOPES[api] || []
  return need.every(s => granted.includes(s))
}

export function grantedApis(granted: string[]): GoogleApiId[] {
  return ALL_API_IDS.filter(a => apiIsGranted(a, granted))
}
