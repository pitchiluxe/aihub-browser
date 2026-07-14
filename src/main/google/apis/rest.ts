import { httpJson } from '../http'
import { getAccessToken, NeedsReauthError } from '../auth/tokenManager'

// Thin authenticated REST helper shared by every API module. Injects the bearer
// token, retries once on a 401 with a freshly minted token (covers a token that
// expired between the cache check and the request), and surfaces NeedsReauth
// unchanged so the UI can prompt a reconnect.
export async function apiRequest(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body?: object
): Promise<any> {
  const send = async () => {
    const token = await getAccessToken()
    const opts: { headers: Record<string, string>; body?: string } = {
      headers: { Authorization: `Bearer ${token}` },
    }
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(body)
    }
    return httpJson(method, url, opts)
  }

  let res = await send()
  if (res.status === 401) res = await send()
  if (res.status === 401) throw new NeedsReauthError()
  if (res.status >= 400) throw new Error(`Google API ${res.status}: ${res.body.slice(0, 200)}`)
  return res.body ? JSON.parse(res.body) : {}
}
