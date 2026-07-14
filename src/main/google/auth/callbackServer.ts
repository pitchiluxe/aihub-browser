import http from 'http'
import { URL } from 'url'
import { CALLBACK } from './config'

export interface CallbackResult {
  code: string
  state: string
}

export interface RunningCallback {
  redirectUri: string
  port: number
  // Resolves when Google redirects back with a valid code + matching state,
  // rejects on error / state mismatch / timeout.
  wait: Promise<CallbackResult>
  close: () => void
}

const successPage = `<!doctype html><html><head><meta charset="utf-8"><title>Signed in</title>
<style>body{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#0b0b12;color:#e8e8f0;display:flex;height:100vh;margin:0;align-items:center;justify-content:center}
.card{text-align:center;padding:40px 48px;border-radius:16px;background:#16161f;border:1px solid #2a2a3a}
h1{font-size:20px;margin:0 0 8px}p{color:#9a9ab0;margin:0}</style></head>
<body><div class="card"><h1>✓ Signed in</h1><p>You can close this tab and return to AIHub Browser.</p></div>
<script>window.setTimeout(function(){window.close()},400)</script></body></html>`

const failPage = (msg: string) => `<!doctype html><html><head><meta charset="utf-8"><title>Sign-in failed</title>
<style>body{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#0b0b12;color:#e8e8f0;display:flex;height:100vh;margin:0;align-items:center;justify-content:center}
.card{text-align:center;padding:40px 48px;border-radius:16px;background:#16161f;border:1px solid #4a2a2a}
h1{font-size:20px;margin:0 0 8px}p{color:#c08a8a;margin:0}</style></head>
<body><div class="card"><h1>Sign-in failed</h1><p>${msg}</p></div></body></html>`

function listen(server: http.Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => reject(err)
    server.once('error', onError)
    server.listen(port, host, () => {
      server.removeListener('error', onError)
      resolve((server.address() as import('net').AddressInfo).port)
    })
  })
}

// Start a one-shot loopback HTTP server that captures the OAuth redirect.
// Tries the preferred fixed port first (so a "Web application" client with a
// registered redirect URI works), then falls back to an ephemeral port (valid
// for "Desktop app" clients, which accept any loopback port).
export async function startCallbackServer(expectedState: string): Promise<RunningCallback> {
  let resolveWait!: (r: CallbackResult) => void
  let rejectWait!: (e: Error) => void
  const wait = new Promise<CallbackResult>((res, rej) => {
    resolveWait = res
    rejectWait = rej
  })

  const server = http.createServer((req, res) => {
    let parsed: URL
    try {
      parsed = new URL(req.url || '', `http://${CALLBACK.host}`)
    } catch {
      res.writeHead(400).end()
      return
    }
    // Ignore stray requests (e.g. favicon) that aren't the callback path.
    if (!parsed.pathname.startsWith(CALLBACK.path)) {
      res.writeHead(404).end()
      return
    }
    const code = parsed.searchParams.get('code')
    const state = parsed.searchParams.get('state')
    const err = parsed.searchParams.get('error')
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    if (err || !code || state !== expectedState) {
      const msg = err || (!code ? 'no authorization code' : 'state mismatch (possible CSRF)')
      res.end(failPage(msg))
      rejectWait(new Error(msg))
      return
    }
    res.end(successPage)
    resolveWait({ code, state })
  })

  let port: number
  try {
    port = await listen(server, CALLBACK.host, CALLBACK.preferredPort)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      port = await listen(server, CALLBACK.host, 0) // OS-assigned free port
    } else {
      throw e
    }
  }

  return {
    port,
    redirectUri: `http://${CALLBACK.host}:${port}${CALLBACK.path}`,
    wait,
    close: () => { try { server.close() } catch { /* already closed */ } },
  }
}
