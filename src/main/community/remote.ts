import WebSocket from 'ws'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { BackendConfig } from './backendConfig'

/**
 * The connection, and nothing else.
 *
 * ── Why anonymous auth rather than the bare anon key ──────────────────────
 *
 * Row level security answers "is this your row?" with `auth.uid()`. With no
 * session that expression is null, so every policy comparing against it
 * evaluates to null — which Postgres treats as not-true — and refuses the
 * write. The failure mode is vicious: the client connects, the subscription
 * reports SUBSCRIBED, reads succeed because the read policies say `using
 * (true)`, and writes silently do nothing. It presents as a working community
 * where messages never arrive anywhere.
 *
 * `signInAnonymously()` mints a real user, so `auth.uid()` is a value and the
 * policies mean what they say.
 *
 * ── Why persistSession is off ─────────────────────────────────────────────
 *
 * This is the Electron main process. There is no localStorage, and supabase-js
 * reaches for one when persisting. The session is re-minted each launch, which
 * costs one request and keeps no token on disk — and the member row is bound to
 * the *identity keypair*, not to the session, so a new anonymous uid on Tuesday
 * is still the same member.
 */

export type RemoteStatus = 'off' | 'connecting' | 'online' | 'error'

export interface RemoteHandle {
  client: SupabaseClient
  /** The anonymous auth uid this launch. Written onto the member row so RLS
   *  can recognise this device on subsequent writes. */
  authUid: string
}

export type ConnectResult = RemoteHandle | { error: string }

export async function connectRemote(config: BackendConfig): Promise<ConnectResult> {
  let client: SupabaseClient
  try {
    client = createClient(config.url, config.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
      // The default is 10 events/second, which a busy voice room signalling ICE
      // candidates will exceed, and the excess is dropped rather than queued —
      // a dropped candidate is a call that never connects.
      //
      // `transport` is not optional here. This runs in Electron's main process,
      // which is Node, and Node only gained a global WebSocket in 22 — Electron
      // 34 ships Node 20. Without it realtime-js refuses to connect with
      // "Node.js detected but native WebSocket not found", and the failure is
      // quiet in the worst way: config validates, the client constructs, the UI
      // reports itself configured, and every message is written to the local
      // replica and pushed nowhere. Two machines sat in the same room, each
      // seeing only itself, with no error on screen.
      realtime: { params: { eventsPerSecond: 30 }, transport: WebSocket as never },
    })
  } catch (error) {
    return { error: `That project URL could not be used: ${messageOf(error)}` }
  }

  try {
    const { data, error } = await client.auth.signInAnonymously()
    if (error) return { error: translate(error.message) }
    if (!data.user) return { error: 'Supabase accepted the key but returned no session.' }
    return { client, authUid: data.user.id }
  } catch (error) {
    return { error: `Could not reach ${config.url}: ${messageOf(error)}` }
  }
}

/**
 * Turn Supabase's wording into something that names the fix.
 *
 * Anonymous sign-in is off by default on a new project, so this is the error
 * every first-time setup hits, and "Signups not allowed for this instance" does
 * not tell anybody which switch to flip.
 */
function translate(message: string): string {
  if (/anonymous/i.test(message) || /signups not allowed/i.test(message)) {
    return 'Anonymous sign-ins are turned off for this Supabase project. '
      + 'Turn them on under Authentication → Providers → Anonymous, then try again.'
  }
  if (/invalid api key/i.test(message)) {
    return 'That anon key was rejected. Copy it again from Settings → API → Project API keys → anon public.'
  }
  return message
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
