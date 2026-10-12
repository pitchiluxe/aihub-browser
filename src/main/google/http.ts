import { net } from 'electron'
import { createNetRequest } from '../netGet'

// Minimal request helper shared by the OAuth token calls and every Google API
// module. Returns the raw body string + status; callers parse JSON.
// Through Chromium's network process (Electron net.fetch), not Node sockets: a
// timed-out Node request can block the main thread while its socket closes
// (see netGet.ts — measured 4.4 s "Not Responding" on 2026-10-12).
const request = createNetRequest((url, init) => net.fetch(url, { ...init, bypassCustomProtocolHandlers: true }))

export async function httpJson(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  opts: { headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}
): Promise<{ status: number; body: string }> {
  try {
    return await request(method, url, opts)
  } catch (e: any) {
    if (e?.message === 'timeout') throw new Error('request timed out')
    throw e
  }
}

// application/x-www-form-urlencoded body builder for the token endpoint.
export function formEncode(obj: Record<string, string>): string {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
}
