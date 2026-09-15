import type { BackendConfig } from './backendConfig'

/**
 * Read backend credentials out of a .env file.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Five devices times five fields is twenty-five hand-copied values, two of
 * which are a JWT and a signing secret. Those are long, opaque, and fail in the
 * least helpful way possible when a character is dropped: the app connects,
 * reads work, and writes are silently refused. Letting the user point at a file
 * they already have turns a transcription problem into a file picker.
 *
 * ── What it deliberately does not do ──────────────────────────────────────
 *
 * It reads only the keys named below, and the caller returns only their *names*
 * to the renderer, never their values. A secret that has been read out of a
 * file the user chose, sealed with safeStorage, and never surfaced again has
 * not widened its exposure — it is in one more place on the same disk.
 *
 * Values are not logged anywhere, including on parse failure.
 */

/**
 * Accepted spellings, in priority order.
 *
 * Supabase renamed the anon key to "publishable" in 2025 and both names are in
 * circulation; Next.js projects carry a `NEXT_PUBLIC_` copy of anything the
 * browser needs. Accepting all of them means a file written for another app
 * works without editing, which is the entire point.
 */
const ALIASES = {
  supabaseUrl: ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'],
  supabaseKey: [
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  ],
  livekitUrl: ['LIVEKIT_URL', 'NEXT_PUBLIC_LIVEKIT_URL'],
  livekitKey: ['LIVEKIT_API_KEY'],
  livekitSecret: ['LIVEKIT_API_SECRET'],
} as const

/**
 * Never accepted, whatever the file contains.
 *
 * `service_role` bypasses row level security completely. A desktop app holding
 * one is a desktop app that can read and rewrite every row in the database
 * regardless of policy, so an import that silently picked it up because the
 * anon key was missing would quietly undo the entire security model.
 */
const REFUSED = ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY']

export interface EnvImport {
  /** Ready to validate and seal. */
  config: Pick<BackendConfig, 'url' | 'anonKey' | 'livekit'>
  /** Variable NAMES that were used. Safe to show; never the values. */
  found: string[]
  /** What was looked for and not found, so the panel can say which. */
  missing: string[]
}

/**
 * Parse `KEY=value` lines.
 *
 * Handles `export ` prefixes, surrounding single or double quotes, inline
 * comments on unquoted values, and CRLF. Not a full dotenv implementation —
 * multi-line values and variable interpolation are out of scope, because no
 * credential this reads has ever been written that way.
 */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}

  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line
    const eq = withoutExport.indexOf('=')
    if (eq <= 0) continue

    const key = withoutExport.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue

    let value = withoutExport.slice(eq + 1).trim()

    const quote = value[0]
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
      value = value.slice(1, -1)
    } else {
      // An unquoted value ends at a ` #`. Requiring the space matters: a key
      // can legitimately contain '#', and truncating one there would produce a
      // credential that is wrong in a way nothing reports.
      const comment = value.indexOf(' #')
      if (comment !== -1) value = value.slice(0, comment).trim()
    }

    out[key] = value
  }

  return out
}

function pick(env: Record<string, string>, names: readonly string[]): { name: string; value: string } | null {
  for (const name of names) {
    const value = (env[name] ?? '').trim()
    if (value) return { name, value }
  }
  return null
}

/**
 * Turn a parsed .env into the fields the backend config needs.
 *
 * Partial results are returned rather than refused: a file with Supabase but no
 * LiveKit is a perfectly good import, and `missing` tells the panel to say which
 * half still needs filling in by hand.
 */
export function backendFromEnv(text: string): EnvImport {
  const env = parseEnv(text)

  const supabaseUrl = pick(env, ALIASES.supabaseUrl)
  const supabaseKey = pick(env, ALIASES.supabaseKey)
  const livekitUrl = pick(env, ALIASES.livekitUrl)
  const livekitKey = pick(env, ALIASES.livekitKey)
  const livekitSecret = pick(env, ALIASES.livekitSecret)

  const found: string[] = []
  const missing: string[] = []

  for (const [entry, label] of [
    [supabaseUrl, 'SUPABASE_URL'],
    [supabaseKey, 'SUPABASE_PUBLISHABLE_KEY'],
    [livekitUrl, 'LIVEKIT_URL'],
    [livekitKey, 'LIVEKIT_API_KEY'],
    [livekitSecret, 'LIVEKIT_API_SECRET'],
  ] as const) {
    if (entry) found.push(entry.name)
    else missing.push(label)
  }

  const livekit = livekitUrl && livekitKey && livekitSecret
    ? { url: livekitUrl.value, apiKey: livekitKey.value, apiSecret: livekitSecret.value }
    : null

  return {
    config: {
      url: supabaseUrl?.value ?? '',
      anonKey: supabaseKey?.value ?? '',
      livekit,
    },
    found,
    missing,
  }
}

/** Names in the file that this import will never read. Reported so the user
 *  knows the service-role key was seen and deliberately left alone. */
export function refusedKeysIn(text: string): string[] {
  const env = parseEnv(text)
  return REFUSED.filter(name => (env[name] ?? '').trim())
}
