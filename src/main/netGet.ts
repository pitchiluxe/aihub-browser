// GET requests from the main process, through Chromium's network process
// (Electron `net.fetch`) instead of Node sockets. Measured 2026-10-12 on the
// user's PC: a Node `http.get` that timed out called `req.destroy()`, and the
// synchronous socket close blocked the main thread for 4.4 s — the window went
// "Not Responding". Ollama status polls time out routinely when the model is
// busy on the CPU, so this happened during normal use.

type Fetch = (url: string, init: { signal: AbortSignal; method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; text(): Promise<string> }>

/** Chromium error → the Node code our retry logic (isTransientNetError) checks. */
const CODES: [RegExp, string][] = [
  [/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED/, 'ENOTFOUND'],
  [/ERR_CONNECTION_REFUSED/, 'ECONNREFUSED'],
  [/ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE/, 'ECONNRESET'],
  [/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_NETWORK_ACCESS_DENIED/, 'ENETUNREACH'],
  [/ERR_ADDRESS_UNREACHABLE/, 'EHOSTUNREACH'],
  [/ERR_TIMED_OUT|ERR_CONNECTION_TIMED_OUT/, 'ETIMEDOUT'],
]

/** Chromium's fetch also reads file:// and app schemes; these helpers are for the web only. */
export function isWebUrl(url: string): boolean {
  try { const p = new URL(url).protocol; return p === 'http:' || p === 'https:' } catch { return false }
}

async function send(fetchImpl: Fetch, url: string, timeoutMs: number, init: { method?: string; headers?: Record<string, string>; body?: string }) {
  if (!isWebUrl(url)) throw new Error(`Not an http(s) URL: ${String(url).slice(0, 60)}`)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { ...init, signal: ctrl.signal })
    return { status: res.status, body: await res.text() }
  } catch (e: any) {
    if (ctrl.signal.aborted) throw new Error('timeout')
    const msg = String(e?.message || e)
    const code = CODES.find(([re]) => re.test(msg))?.[1]
    throw Object.assign(new Error(msg), code ? { code } : {})
  } finally {
    clearTimeout(timer)
  }
}

export function createNetGet(fetchImpl: Fetch) {
  return (url: string, timeoutMs = 5000): Promise<{ status: number; body: string }> => send(fetchImpl, url, timeoutMs, {})
}

/** POST a JSON body, parse a JSON reply; a non-2xx status rejects (like axios did). */
export function createNetPostJson(fetchImpl: Fetch) {
  return async (url: string, payload: unknown, timeoutMs = 20000): Promise<{ status: number; data: any }> => {
    const { status, body } = await send(fetchImpl, url, timeoutMs, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    let data: any = null
    try { data = body ? JSON.parse(body) : null } catch { data = body }
    if (status < 200 || status >= 300) throw Object.assign(new Error(`HTTP ${status}`), { status, data })
    return { status, data }
  }
}
