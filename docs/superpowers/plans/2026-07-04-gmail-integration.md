# Gmail Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native in-app Gmail client (read + send) that authenticates via the OAuth 2.0 loopback flow and talks to the Gmail REST API, replacing the embedded `accounts.google.com` sign-in that Google blocks at the TLS layer.

**Architecture:** All OAuth, token storage, and Gmail API calls run in the Electron **main process**; the refresh token is encrypted at rest with `safeStorage` (Windows DPAPI) and never crosses IPC. A new lazy-loaded **Mail** page in the renderer talks to the main process over a typed `gmail:*` IPC surface and renders each email body in a script-free sandboxed iframe with remote images blocked by default.

**Tech Stack:** Electron 28, TypeScript, React 18, Zustand, Node `http`/`https`/`crypto`, Electron `safeStorage` + `shell.openExternal`, Gmail REST API v1, Google OAuth 2.0 (PKCE). Tests: vitest (added by this plan).

## Global Constraints

- OAuth scopes, verbatim: `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/gmail.send`. No other scopes.
- v1 is **read + send only** — no archive/delete/label/mark-read (would need `gmail.modify`). Do not add mailbox-mutation calls.
- Tokens NEVER cross IPC to the renderer. The renderer receives only decoded mail data.
- Refresh token persisted ONLY via `safeStorage.encryptString`; if `safeStorage.isEncryptionAvailable()` is false, refuse to persist (never write plaintext).
- Email HTML renders in an `<iframe sandbox>` WITHOUT `allow-scripts`. Remote images blocked by default.
- Every `gmail:*` IPC handler returns a discriminated result: `{ ok: true, ... }` or `{ ok: false, error: string }`. No thrown IPC, no silent catches, no perpetual spinners.
- Single account in v1. Token store is keyed by email to leave room for multi-account later.
- Follow existing codebase patterns: `ipcMain.handle` + preload `contextBridge`, `pageType` union for pages, `--ds-*` CSS theme vars for all UI.
- Bundled default `client_id` lives in `src/main/gmail/config.ts` as a placeholder constant; a user-provided `client_id`/`client_secret` from Settings overrides it.

---

## File Structure

**New — main process:**
- `src/main/gmail/base64url.ts` — base64url encode/decode helpers (pure).
- `src/main/gmail/mime.ts` — parse a Gmail `messages.get(format=full)` payload into a normalized message; build an RFC 2822 raw message for sending (pure).
- `src/main/gmail/http.ts` — small GET/POST HTTP helper (arbitrary content-type, JSON + form) returning `{ status, body }`.
- `src/main/gmail/config.ts` — bundled client_id/secret constants, scopes, endpoints.
- `src/main/gmail/store.ts` — safeStorage-encrypted token persistence.
- `src/main/gmail/oauth.ts` — PKCE + loopback consent, token exchange/refresh/revoke, access-token guard.
- `src/main/gmail/client.ts` — Gmail REST wrapper (profile, listThreads, getThread, getAttachment, send).
- `src/main/gmail/ipc.ts` — registers all `gmail:*` `ipcMain.handle` handlers + `gmail:connected` push.

**New — renderer:**
- `src/renderer/src/services/mailService.ts` — typed wrappers over `window.electronAPI.gmail.*`.
- `src/renderer/src/components/pages/MailPage.tsx` — the Mail page (list + reader + compose).
- `src/renderer/src/components/pages/mail/EmailFrame.tsx` — the sandboxed HTML-body iframe with image toggle.

**New — tests:**
- `src/main/gmail/base64url.test.ts`
- `src/main/gmail/mime.test.ts`

**Modified:**
- `package.json` — add vitest devDep + `test` script.
- `src/preload/index.ts` — add `gmail` bridge namespace.
- `src/main/index.ts` — import & call `registerGmailIpc(...)`.
- `src/renderer/src/store/browserStore.ts` — add `'mail'` to `pageType` union + `openSpecialPage` type.
- `src/renderer/src/App.tsx` — lazy import + render MailPage for `pageType === 'mail'`.
- `src/renderer/src/components/browser/Sidebar.tsx` — add a "Mail" nav item.
- `src/renderer/src/components/pages/SettingsPage.tsx` — add the Gmail account block.

---

## Task 1: Test infrastructure

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add vitest devDependency and test script**

In `package.json`, add to `"devDependencies"`:
```json
"vitest": "^2.1.0"
```
Add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: adds vitest, exit 0.

- [ ] **Step 3: Sanity test file**

Create `src/main/gmail/smoke.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
describe('smoke', () => { it('runs', () => { expect(1 + 1).toBe(2) }) })
```

- [ ] **Step 4: Run**

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 5: Remove smoke file and commit**

Delete `src/main/gmail/smoke.test.ts`.
```bash
git add package.json package-lock.json
git commit -m "test: add vitest for Gmail pure-function tests"
```

---

## Task 2: base64url helpers

**Files:**
- Create: `src/main/gmail/base64url.ts`
- Test: `src/main/gmail/base64url.test.ts`

**Interfaces:**
- Produces:
  - `b64urlEncode(input: Buffer | string): string` — base64url, no padding.
  - `b64urlDecode(input: string): Buffer` — tolerates missing padding and `-_`.

- [ ] **Step 1: Write the failing test**

Create `src/main/gmail/base64url.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { b64urlEncode, b64urlDecode } from './base64url'

describe('base64url', () => {
  it('encodes without padding and url-safe alphabet', () => {
    expect(b64urlEncode('subjects?>>')).toBe(Buffer.from('subjects?>>').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''))
  })
  it('round-trips a buffer', () => {
    const buf = Buffer.from([0, 255, 16, 128, 63, 64])
    expect(b64urlDecode(b64urlEncode(buf)).equals(buf)).toBe(true)
  })
  it('decodes a value missing padding', () => {
    expect(b64urlDecode('YQ').toString()).toBe('a')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/gmail/base64url.test.ts`
Expected: FAIL — cannot find module './base64url'.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/gmail/base64url.ts`:
```typescript
export function b64urlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64urlDecode(input: string): Buffer {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  return Buffer.from(b64 + pad, 'base64')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/gmail/base64url.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/main/gmail/base64url.ts src/main/gmail/base64url.test.ts
git commit -m "feat(gmail): base64url encode/decode helpers"
```

---

## Task 3: MIME parse + RFC-2822 build

**Files:**
- Create: `src/main/gmail/mime.ts`
- Test: `src/main/gmail/mime.test.ts`

**Interfaces:**
- Consumes: `b64urlEncode`, `b64urlDecode` from `./base64url`.
- Produces:
  - Types:
    ```typescript
    export interface MailAttachment { filename: string; mimeType: string; attachmentId: string; size: number }
    export interface ParsedMessage {
      id: string; threadId: string; from: string; to: string; cc: string;
      subject: string; date: string; snippet: string; unread: boolean;
      textHtml: string; textPlain: string; attachments: MailAttachment[];
      messageIdHeader: string; references: string;
    }
    ```
  - `parseGmailMessage(raw: any): ParsedMessage` — `raw` is one Gmail `messages.get(format=full)` resource (has `id`, `threadId`, `snippet`, `labelIds`, `payload`).
  - `buildRawMessage(opts: { from: string; to: string; subject: string; body: string; inReplyTo?: string; references?: string }): string` — returns a base64url-encoded RFC 2822 message ready for `messages.send`.

- [ ] **Step 1: Write the failing test**

Create `src/main/gmail/mime.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { parseGmailMessage, buildRawMessage } from './mime'
import { b64urlEncode, b64urlDecode } from './base64url'

const msg = {
  id: 'm1', threadId: 't1', snippet: 'Hello there', labelIds: ['UNREAD', 'INBOX'],
  payload: {
    mimeType: 'multipart/mixed',
    headers: [
      { name: 'From', value: 'Alice <alice@example.com>' },
      { name: 'To', value: 'bob@example.com' },
      { name: 'Subject', value: 'Hi Bob' },
      { name: 'Date', value: 'Mon, 01 Jul 2026 10:00:00 -0000' },
      { name: 'Message-ID', value: '<abc@mail.example.com>' },
    ],
    parts: [
      { mimeType: 'text/plain', body: { data: b64urlEncode('plain body') } },
      { mimeType: 'text/html', body: { data: b64urlEncode('<b>html body</b>') } },
      { mimeType: 'application/pdf', filename: 'doc.pdf', body: { attachmentId: 'att1', size: 1234 } },
    ],
  },
}

describe('parseGmailMessage', () => {
  it('extracts headers, bodies, unread flag, attachments', () => {
    const p = parseGmailMessage(msg)
    expect(p.from).toBe('Alice <alice@example.com>')
    expect(p.subject).toBe('Hi Bob')
    expect(p.textPlain).toBe('plain body')
    expect(p.textHtml).toBe('<b>html body</b>')
    expect(p.unread).toBe(true)
    expect(p.messageIdHeader).toBe('<abc@mail.example.com>')
    expect(p.attachments).toEqual([{ filename: 'doc.pdf', mimeType: 'application/pdf', attachmentId: 'att1', size: 1234 }])
  })
  it('handles a single-part text/plain payload', () => {
    const single = { id: 'm2', threadId: 't2', snippet: 's', labelIds: ['INBOX'],
      payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: 'x' }], body: { data: b64urlEncode('just text') } } }
    const p = parseGmailMessage(single)
    expect(p.textPlain).toBe('just text')
    expect(p.unread).toBe(false)
  })
})

describe('buildRawMessage', () => {
  it('produces a decodable RFC 2822 message with reply headers', () => {
    const raw = buildRawMessage({ from: 'me@example.com', to: 'you@example.com', subject: 'Re: Hi', body: 'reply text', inReplyTo: '<abc@mail.example.com>', references: '<abc@mail.example.com>' })
    const decoded = b64urlDecode(raw).toString('utf-8')
    expect(decoded).toContain('To: you@example.com')
    expect(decoded).toContain('Subject: Re: Hi')
    expect(decoded).toContain('In-Reply-To: <abc@mail.example.com>')
    expect(decoded).toContain('\r\n\r\nreply text')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/gmail/mime.test.ts`
Expected: FAIL — cannot find module './mime'.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/gmail/mime.ts`:
```typescript
import { b64urlEncode, b64urlDecode } from './base64url'

export interface MailAttachment { filename: string; mimeType: string; attachmentId: string; size: number }
export interface ParsedMessage {
  id: string; threadId: string; from: string; to: string; cc: string;
  subject: string; date: string; snippet: string; unread: boolean;
  textHtml: string; textPlain: string; attachments: MailAttachment[];
  messageIdHeader: string; references: string;
}

function header(headers: any[], name: string): string {
  const h = (headers || []).find(x => x.name?.toLowerCase() === name.toLowerCase())
  return h?.value || ''
}

function walk(part: any, out: { html: string; plain: string; atts: MailAttachment[] }) {
  if (!part) return
  const mime = part.mimeType || ''
  if (part.filename && part.body?.attachmentId) {
    out.atts.push({ filename: part.filename, mimeType: mime, attachmentId: part.body.attachmentId, size: part.body.size || 0 })
  } else if (mime === 'text/html' && part.body?.data) {
    out.html = out.html || b64urlDecode(part.body.data).toString('utf-8')
  } else if (mime === 'text/plain' && part.body?.data) {
    out.plain = out.plain || b64urlDecode(part.body.data).toString('utf-8')
  }
  for (const child of part.parts || []) walk(child, out)
}

export function parseGmailMessage(raw: any): ParsedMessage {
  const payload = raw.payload || {}
  const headers = payload.headers || []
  const acc = { html: '', plain: '', atts: [] as MailAttachment[] }
  walk(payload, acc)
  return {
    id: raw.id, threadId: raw.threadId,
    from: header(headers, 'From'), to: header(headers, 'To'), cc: header(headers, 'Cc'),
    subject: header(headers, 'Subject'), date: header(headers, 'Date'),
    snippet: raw.snippet || '', unread: (raw.labelIds || []).includes('UNREAD'),
    textHtml: acc.html, textPlain: acc.plain, attachments: acc.atts,
    messageIdHeader: header(headers, 'Message-ID'), references: header(headers, 'References'),
  }
}

export function buildRawMessage(opts: {
  from: string; to: string; subject: string; body: string; inReplyTo?: string; references?: string
}): string {
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
  ]
  if (opts.inReplyTo) lines.push(`In-Reply-To: ${opts.inReplyTo}`)
  if (opts.references) lines.push(`References: ${opts.references}`)
  const message = lines.join('\r\n') + '\r\n\r\n' + opts.body
  return b64urlEncode(Buffer.from(message, 'utf-8'))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/gmail/mime.test.ts`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add src/main/gmail/mime.ts src/main/gmail/mime.test.ts
git commit -m "feat(gmail): MIME parse + RFC-2822 message build"
```

---

## Task 4: Config + HTTP helper

**Files:**
- Create: `src/main/gmail/config.ts`
- Create: `src/main/gmail/http.ts`

**Interfaces:**
- Produces (config):
  - `GMAIL_SCOPES: string` (space-joined), `AUTH_ENDPOINT`, `TOKEN_ENDPOINT`, `REVOKE_ENDPOINT`, `GMAIL_API_BASE` constants.
  - `DEFAULT_CLIENT_ID: string`, `DEFAULT_CLIENT_SECRET: string` (placeholder empty strings until the user supplies real values).
- Produces (http):
  - `httpJson(method: 'GET'|'POST', url: string, opts?: { headers?: Record<string,string>; body?: string; timeoutMs?: number }): Promise<{ status: number; body: string }>`

- [ ] **Step 1: Create config**

Create `src/main/gmail/config.ts`:
```typescript
// Bundled OAuth client for the shipped app. Replace these with the values from
// your Google Cloud "Desktop app" OAuth client. A user-provided client in
// Settings overrides them at runtime. For a desktop PKCE client the secret is
// not treated as confidential; leave it empty unless using a classic client.
export const DEFAULT_CLIENT_ID = '' // TODO(owner): paste Desktop OAuth client_id
export const DEFAULT_CLIENT_SECRET = ''

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ')

export const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
export const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1'
```

Note: `DEFAULT_CLIENT_ID` empty is intentional — the live-test task supplies a real value or the Settings override is used. Code paths must handle an empty default by erroring clearly ("no Google client configured").

- [ ] **Step 2: Create HTTP helper**

Create `src/main/gmail/http.ts`:
```typescript
import http from 'http'
import https from 'https'
import { URL } from 'url'

// Minimal request helper for Gmail + OAuth. Returns the raw body string and
// status; callers parse JSON. Kept separate from index.ts's httpPost because
// that one is POST/JSON-only and Gmail needs GET plus form-encoded token calls.
export function httpJson(
  method: 'GET' | 'POST',
  url: string,
  opts: { headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const lib = parsed.protocol === 'https:' ? https : http
    const headers: Record<string, string> = { ...(opts.headers || {}) }
    if (opts.body != null) headers['Content-Length'] = String(Buffer.byteLength(opts.body))
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method, headers, timeout: opts.timeoutMs ?? 30000,
    }, res => {
      let b = ''
      res.on('data', c => { b += c })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: b }))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    if (opts.body != null) req.write(opts.body)
    req.end()
  })
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors from these files. (If the project has no `tsconfig.node.json`, run `npm run build` and confirm the main bundle builds.)

- [ ] **Step 4: Commit**

```bash
git add src/main/gmail/config.ts src/main/gmail/http.ts
git commit -m "feat(gmail): OAuth/API config constants + HTTP helper"
```

---

## Task 5: Encrypted token store

**Files:**
- Create: `src/main/gmail/store.ts`

**Interfaces:**
- Consumes: Electron `safeStorage`, `app.getPath('userData')` is NOT used — tokens go in `~/.aihub-browser` to match the app's `APP_DIR`. Import path base: use `os.homedir()` + `.aihub-browser`.
- Produces:
  - Type `StoredTokens { email: string; refreshToken: string; clientId: string; clientSecret: string }`
  - `saveTokens(t: StoredTokens): void` — throws if `safeStorage` unavailable.
  - `loadTokens(): StoredTokens | null`
  - `clearTokens(): void`
  - `isEncryptionAvailable(): boolean`

- [ ] **Step 1: Implement**

Create `src/main/gmail/store.ts`:
```typescript
import { safeStorage } from 'electron'
import os from 'os'
import fs from 'fs'
import { join } from 'path'

const FILE = join(os.homedir(), '.aihub-browser', 'gmail-tokens.enc')

export interface StoredTokens { email: string; refreshToken: string; clientId: string; clientSecret: string }

export function isEncryptionAvailable(): boolean {
  try { return safeStorage.isEncryptionAvailable() } catch { return false }
}

export function saveTokens(t: StoredTokens): void {
  if (!isEncryptionAvailable()) throw new Error('OS secure storage unavailable — refusing to store tokens in plaintext')
  const enc = safeStorage.encryptString(JSON.stringify(t))
  fs.mkdirSync(join(os.homedir(), '.aihub-browser'), { recursive: true })
  fs.writeFileSync(FILE, enc)
}

export function loadTokens(): StoredTokens | null {
  try {
    if (!fs.existsSync(FILE) || !isEncryptionAvailable()) return null
    const buf = fs.readFileSync(FILE)
    return JSON.parse(safeStorage.decryptString(buf)) as StoredTokens
  } catch { return null }
}

export function clearTokens(): void {
  try { fs.unlinkSync(FILE) } catch {}
}
```

- [ ] **Step 2: Typecheck / build**

Run: `npm run build`
Expected: main bundle builds (no type errors). The renderer is unaffected.

- [ ] **Step 3: Commit**

```bash
git add src/main/gmail/store.ts
git commit -m "feat(gmail): safeStorage-encrypted token persistence"
```

---

## Task 6: OAuth loopback + token lifecycle

**Files:**
- Create: `src/main/gmail/oauth.ts`

**Interfaces:**
- Consumes: `httpJson` (`./http`), `b64urlEncode` (`./base64url`), config constants (`./config`), store fns (`./store`), Electron `shell`, Node `crypto`, `http`.
- Produces:
  - `beginConnect(): Promise<{ ok: true; email: string } | { ok: false; error: string }>` — runs the full loopback consent + token exchange + fetch profile + persist.
  - `getAccessToken(): Promise<string>` — returns a valid access token, refreshing if needed; throws `Error('needs-reconnect')` if refresh fails with invalid_grant, `Error('not-connected')` if no tokens.
  - `disconnect(): Promise<void>` — revoke + clearTokens + reset memory.
  - `currentEmail(): string | null` — the connected account email (from store), or null.

- [ ] **Step 1: Implement**

Create `src/main/gmail/oauth.ts`:
```typescript
import { shell } from 'electron'
import crypto from 'crypto'
import http from 'http'
import { b64urlEncode } from './base64url'
import { httpJson } from './http'
import { saveTokens, loadTokens, clearTokens } from './store'
import {
  DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET, GMAIL_SCOPES,
  AUTH_ENDPOINT, TOKEN_ENDPOINT, REVOKE_ENDPOINT, GMAIL_API_BASE,
} from './config'

let accessToken = ''
let accessExpiry = 0 // epoch ms
let pendingServer: http.Server | null = null

function creds() {
  const stored = loadTokens()
  const clientId = stored?.clientId || DEFAULT_CLIENT_ID
  const clientSecret = stored?.clientSecret || DEFAULT_CLIENT_SECRET
  return { clientId, clientSecret }
}

function form(obj: Record<string, string>): string {
  return Object.entries(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
}

export function currentEmail(): string | null {
  return loadTokens()?.email ?? null
}

export async function beginConnect(): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  // Allow overriding via a user-provided client entered in Settings before connect;
  // Settings writes them into a temporary store entry consumed here. If none and no
  // bundled default, error clearly.
  const overrideId = loadTokens()?.clientId // pre-seeded override (email empty) if user set one
  const clientId = overrideId || DEFAULT_CLIENT_ID
  const clientSecret = loadTokens()?.clientSecret || DEFAULT_CLIENT_SECRET
  if (!clientId) return { ok: false, error: 'No Google client configured. Add your OAuth client_id in Settings → Gmail.' }

  const verifier = b64urlEncode(crypto.randomBytes(32))
  const challenge = b64urlEncode(crypto.createHash('sha256').update(verifier).digest())
  const state = b64urlEncode(crypto.randomBytes(16))

  return new Promise(resolve => {
    let settled = false
    const finish = (r: { ok: true; email: string } | { ok: false; error: string }) => {
      if (settled) return; settled = true
      try { pendingServer?.close() } catch {}; pendingServer = null
      clearTimeout(timer)
      resolve(r)
    }
    // cancel any prior pending flow
    try { pendingServer?.close() } catch {}
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '', 'http://127.0.0.1')
        const code = url.searchParams.get('code')
        const gotState = url.searchParams.get('state')
        const err = url.searchParams.get('error')
        res.setHeader('Content-Type', 'text/html')
        if (err || !code || gotState !== state) {
          res.end('<h2>Sign-in failed. You can close this tab.</h2>')
          finish({ ok: false, error: err || 'invalid callback' })
          return
        }
        res.end('<h2>Connected. You can close this tab and return to AIHub Browser.</h2>')
        const port = (server.address() as any).port
        // exchange code
        const tokenRes = await httpJson('POST', TOKEN_ENDPOINT, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form({
            code, client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}),
            redirect_uri: `http://127.0.0.1:${port}`, grant_type: 'authorization_code', code_verifier: verifier,
          }),
        })
        const tok = JSON.parse(tokenRes.body)
        if (!tok.access_token || !tok.refresh_token) { finish({ ok: false, error: tok.error_description || 'token exchange failed' }); return }
        accessToken = tok.access_token
        accessExpiry = Date.now() + (tok.expires_in ?? 3600) * 1000
        // fetch profile for the account email
        const prof = await httpJson('GET', `${GMAIL_API_BASE}/users/me/profile`, { headers: { Authorization: `Bearer ${accessToken}` } })
        const email = JSON.parse(prof.body).emailAddress || 'unknown'
        saveTokens({ email, refreshToken: tok.refresh_token, clientId, clientSecret })
        finish({ ok: true, email })
      } catch (e: any) {
        finish({ ok: false, error: e.message || 'callback error' })
      }
    })
    pendingServer = server
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as any).port
      const authUrl = `${AUTH_ENDPOINT}?` + form({
        client_id: clientId, redirect_uri: `http://127.0.0.1:${port}`, response_type: 'code',
        scope: GMAIL_SCOPES, access_type: 'offline', prompt: 'consent',
        code_challenge: challenge, code_challenge_method: 'S256', state,
      })
      shell.openExternal(authUrl)
    })
    const timer = setTimeout(() => finish({ ok: false, error: 'consent timed out' }), 5 * 60_000)
  })
}

export async function getAccessToken(): Promise<string> {
  const stored = loadTokens()
  if (!stored) throw new Error('not-connected')
  if (accessToken && Date.now() < accessExpiry - 60_000) return accessToken
  const { clientId, clientSecret } = creds()
  const res = await httpJson('POST', TOKEN_ENDPOINT, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({
      client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}),
      refresh_token: stored.refreshToken, grant_type: 'refresh_token',
    }),
  })
  const tok = JSON.parse(res.body)
  if (!tok.access_token) {
    if (tok.error === 'invalid_grant') { clearTokens(); accessToken = ''; throw new Error('needs-reconnect') }
    throw new Error(tok.error_description || 'token refresh failed')
  }
  accessToken = tok.access_token
  accessExpiry = Date.now() + (tok.expires_in ?? 3600) * 1000
  return accessToken
}

export async function disconnect(): Promise<void> {
  const stored = loadTokens()
  if (stored?.refreshToken) {
    try { await httpJson('POST', REVOKE_ENDPOINT, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ token: stored.refreshToken }) }) } catch {}
  }
  clearTokens(); accessToken = ''; accessExpiry = 0
}
```

Note on the override: Settings will call `gmail:setCredentials` (Task 8) which writes a store entry with `email:''` plus clientId/secret so `beginConnect` picks them up. After a successful connect the entry is overwritten with the real email + same client.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: main bundle builds, no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/gmail/oauth.ts
git commit -m "feat(gmail): OAuth loopback consent + token refresh/revoke"
```

---

## Task 7: Gmail REST client

**Files:**
- Create: `src/main/gmail/client.ts`

**Interfaces:**
- Consumes: `getAccessToken` (`./oauth`), `httpJson` (`./http`), `parseGmailMessage`/`buildRawMessage`/types (`./mime`), `b64urlDecode` (`./base64url`), `GMAIL_API_BASE` (`./config`).
- Produces:
  - `interface ThreadRow { id: string; from: string; subject: string; snippet: string; date: string; unread: boolean }`
  - `listThreads(q: string, pageToken?: string): Promise<{ threads: ThreadRow[]; nextPageToken?: string }>`
  - `getThread(id: string): Promise<ParsedMessage[]>`
  - `getAttachmentData(messageId: string, attachmentId: string): Promise<Buffer>`
  - `sendMessage(opts: { from: string; to: string; subject: string; body: string; inReplyTo?: string; references?: string; threadId?: string }): Promise<void>`
  - Internal `apiGet`/`apiPost` that attach the bearer token and retry once on 401 via `getAccessToken`.

- [ ] **Step 1: Implement**

Create `src/main/gmail/client.ts`:
```typescript
import { getAccessToken } from './oauth'
import { httpJson } from './http'
import { parseGmailMessage, buildRawMessage, ParsedMessage } from './mime'
import { b64urlDecode } from './base64url'
import { GMAIL_API_BASE } from './config'

export interface ThreadRow { id: string; from: string; subject: string; snippet: string; date: string; unread: boolean }

async function apiGet(path: string): Promise<any> {
  let token = await getAccessToken()
  let res = await httpJson('GET', `${GMAIL_API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 401) { token = await getAccessToken(); res = await httpJson('GET', `${GMAIL_API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } }) }
  if (res.status >= 400) throw new Error(`Gmail API ${res.status}: ${res.body.slice(0, 200)}`)
  return JSON.parse(res.body)
}

async function apiPost(path: string, body: object): Promise<any> {
  let token = await getAccessToken()
  const opts = () => ({ headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  let res = await httpJson('POST', `${GMAIL_API_BASE}${path}`, opts())
  if (res.status === 401) { token = await getAccessToken(); res = await httpJson('POST', `${GMAIL_API_BASE}${path}`, opts()) }
  if (res.status >= 400) throw new Error(`Gmail API ${res.status}: ${res.body.slice(0, 200)}`)
  return JSON.parse(res.body)
}

function h(headers: any[], name: string): string {
  return (headers || []).find((x: any) => x.name?.toLowerCase() === name.toLowerCase())?.value || ''
}

export async function listThreads(q: string, pageToken?: string): Promise<{ threads: ThreadRow[]; nextPageToken?: string }> {
  const params = new URLSearchParams({ maxResults: '25' })
  if (q) params.set('q', q)
  if (pageToken) params.set('pageToken', pageToken)
  const list = await apiGet(`/users/me/threads?${params.toString()}`)
  const rows: ThreadRow[] = []
  for (const t of list.threads || []) {
    // metadata-only fetch keeps list payloads small
    const meta = await apiGet(`/users/me/threads/${t.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)
    const first = meta.messages?.[0]
    const headers = first?.payload?.headers || []
    rows.push({
      id: t.id, from: h(headers, 'From'), subject: h(headers, 'Subject'),
      snippet: t.snippet || first?.snippet || '', date: h(headers, 'Date'),
      unread: (meta.messages || []).some((m: any) => (m.labelIds || []).includes('UNREAD')),
    })
  }
  return { threads: rows, nextPageToken: list.nextPageToken }
}

export async function getThread(id: string): Promise<ParsedMessage[]> {
  const t = await apiGet(`/users/me/threads/${id}?format=full`)
  return (t.messages || []).map(parseGmailMessage)
}

export async function getAttachmentData(messageId: string, attachmentId: string): Promise<Buffer> {
  const a = await apiGet(`/users/me/messages/${messageId}/attachments/${attachmentId}`)
  return b64urlDecode(a.data)
}

export async function sendMessage(opts: {
  from: string; to: string; subject: string; body: string; inReplyTo?: string; references?: string; threadId?: string
}): Promise<void> {
  const raw = buildRawMessage(opts)
  await apiPost('/users/me/messages/send', opts.threadId ? { raw, threadId: opts.threadId } : { raw })
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: main bundle builds.

- [ ] **Step 3: Commit**

```bash
git add src/main/gmail/client.ts
git commit -m "feat(gmail): REST client (list/get/attachment/send)"
```

---

## Task 8: IPC surface + preload bridge

**Files:**
- Create: `src/main/gmail/ipc.ts`
- Modify: `src/main/index.ts` (import + call `registerGmailIpc`)
- Modify: `src/preload/index.ts` (add `gmail` namespace)

**Interfaces:**
- Consumes: oauth (`beginConnect`, `disconnect`, `currentEmail`, `getAccessToken`), client (`listThreads`, `getThread`, `getAttachmentData`, `sendMessage`), store (`saveTokens`, `loadTokens`, `isEncryptionAvailable`), the app's existing `safelySend` for the push event, and the existing download persistence for saved attachments (write the buffer to the user's Downloads dir).
- Produces:
  - `registerGmailIpc(safelySend: (channel: string, ...args: any[]) => void): void`
  - Preload `electronAPI.gmail`: `status()`, `connect()`, `disconnect()`, `setCredentials(clientId, clientSecret)`, `listThreads(q, pageToken)`, `getThread(id)`, `getAttachment(messageId, attachmentId, filename)`, `send(opts)`, `onConnected(cb)`.

- [ ] **Step 1: Implement IPC module**

Create `src/main/gmail/ipc.ts`:
```typescript
import { ipcMain, app } from 'electron'
import os from 'os'
import fs from 'fs'
import { join } from 'path'
import { beginConnect, disconnect, currentEmail } from './oauth'
import { listThreads, getThread, getAttachmentData, sendMessage } from './client'
import { loadTokens, saveTokens, isEncryptionAvailable } from './store'

type Ok<T> = { ok: true } & T
type Result<T> = Ok<T> | { ok: false; error: string }
const ok = <T extends object>(data: T): Ok<T> => ({ ok: true, ...data })
const fail = (error: string) => ({ ok: false, error })

export function registerGmailIpc(safelySend: (channel: string, ...args: any[]) => void): void {
  ipcMain.handle('gmail:status', () => ok({ connected: !!currentEmail(), email: currentEmail() }))

  ipcMain.handle('gmail:setCredentials', (_e, clientId: string, clientSecret: string) => {
    if (!isEncryptionAvailable()) return fail('OS secure storage unavailable')
    // seed a store entry (email empty) so beginConnect uses these creds
    const existing = loadTokens()
    saveTokens({ email: existing?.email || '', refreshToken: existing?.refreshToken || '', clientId, clientSecret })
    return ok({})
  })

  ipcMain.handle('gmail:connect', async () => {
    const r = await beginConnect()
    if (r.ok) safelySend('gmail:connected', { email: r.email })
    return r
  })

  ipcMain.handle('gmail:disconnect', async () => { await disconnect(); return ok({}) })

  ipcMain.handle('gmail:listThreads', async (_e, args: { q?: string; pageToken?: string }) => {
    try { return ok(await listThreads(args?.q || '', args?.pageToken)) }
    catch (e: any) { return fail(e.message) }
  })

  ipcMain.handle('gmail:getThread', async (_e, args: { id: string }) => {
    try { return ok({ messages: await getThread(args.id) }) }
    catch (e: any) { return fail(e.message) }
  })

  ipcMain.handle('gmail:getAttachment', async (_e, args: { messageId: string; attachmentId: string; filename: string }) => {
    try {
      const buf = await getAttachmentData(args.messageId, args.attachmentId)
      const dir = app.getPath('downloads')
      let dest = join(dir, args.filename)
      let n = 1
      while (fs.existsSync(dest)) { const dot = args.filename.lastIndexOf('.'); const base = dot > 0 ? args.filename.slice(0, dot) : args.filename; const ext = dot > 0 ? args.filename.slice(dot) : ''; dest = join(dir, `${base} (${n++})${ext}`) }
      fs.writeFileSync(dest, buf)
      return ok({ savedPath: dest })
    } catch (e: any) { return fail(e.message) }
  })

  ipcMain.handle('gmail:send', async (_e, opts: { to: string; subject: string; body: string; inReplyTo?: string; references?: string; threadId?: string }) => {
    try {
      const from = currentEmail()
      if (!from) return fail('not-connected')
      await sendMessage({ from, ...opts })
      return ok({})
    } catch (e: any) { return fail(e.message) }
  })
}
```

- [ ] **Step 2: Wire into main**

In `src/main/index.ts`, add near the other imports:
```typescript
import { registerGmailIpc } from './gmail/ipc'
```
Then, after `mainWindow` is created and `safelySend` is defined (place it alongside the other `ipcMain.handle` registrations near the bottom of the file), add:
```typescript
registerGmailIpc(safelySend)
```

- [ ] **Step 3: Add preload bridge**

In `src/preload/index.ts`, add a new namespace inside the `exposeInMainWorld` object (after the `window` block):
```typescript
  gmail: {
    status:         () => ipcRenderer.invoke('gmail:status'),
    connect:        () => ipcRenderer.invoke('gmail:connect'),
    disconnect:     () => ipcRenderer.invoke('gmail:disconnect'),
    setCredentials: (clientId: string, clientSecret: string) => ipcRenderer.invoke('gmail:setCredentials', clientId, clientSecret),
    listThreads:    (q: string, pageToken?: string) => ipcRenderer.invoke('gmail:listThreads', { q, pageToken }),
    getThread:      (id: string) => ipcRenderer.invoke('gmail:getThread', { id }),
    getAttachment:  (messageId: string, attachmentId: string, filename: string) => ipcRenderer.invoke('gmail:getAttachment', { messageId, attachmentId, filename }),
    send:           (opts: any) => ipcRenderer.invoke('gmail:send', opts),
    onConnected:    (cb: (e: { email: string }) => void) => { const h = (_: any, d: any) => cb(d); ipcRenderer.on('gmail:connected', h); return () => ipcRenderer.removeListener('gmail:connected', h) },
  },
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: main + preload bundles build, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/gmail/ipc.ts src/main/index.ts src/preload/index.ts
git commit -m "feat(gmail): IPC handlers + preload bridge"
```

---

## Task 9: Renderer mail service + page registration

**Files:**
- Create: `src/renderer/src/services/mailService.ts`
- Modify: `src/renderer/src/store/browserStore.ts` (add `'mail'` to `pageType` union + `openSpecialPage` param types wherever the union appears)
- Modify: `src/renderer/src/App.tsx` (lazy import + render)
- Modify: `src/renderer/src/components/browser/Sidebar.tsx` (nav item)

**Interfaces:**
- Consumes: `window.electronAPI.gmail.*`.
- Produces (mailService):
  - Types `ThreadRow`, `ParsedMessage` mirroring the main-process shapes.
  - `mailStatus()`, `mailConnect()`, `mailDisconnect()`, `mailSetCredentials(id, secret)`, `mailListThreads(q, pageToken?)`, `mailGetThread(id)`, `mailGetAttachment(mId, aId, filename)`, `mailSend(opts)`, `onMailConnected(cb)`.

- [ ] **Step 1: Create mail service**

Create `src/renderer/src/services/mailService.ts`:
```typescript
export interface ThreadRow { id: string; from: string; subject: string; snippet: string; date: string; unread: boolean }
export interface MailAttachment { filename: string; mimeType: string; attachmentId: string; size: number }
export interface ParsedMessage {
  id: string; threadId: string; from: string; to: string; cc: string;
  subject: string; date: string; snippet: string; unread: boolean;
  textHtml: string; textPlain: string; attachments: MailAttachment[];
  messageIdHeader: string; references: string;
}
const api = () => (window as any).electronAPI.gmail

export const mailStatus = () => api().status() as Promise<{ ok: boolean; connected: boolean; email: string | null }>
export const mailConnect = () => api().connect() as Promise<{ ok: boolean; email?: string; error?: string }>
export const mailDisconnect = () => api().disconnect() as Promise<{ ok: boolean }>
export const mailSetCredentials = (id: string, secret: string) => api().setCredentials(id, secret) as Promise<{ ok: boolean; error?: string }>
export const mailListThreads = (q: string, pageToken?: string) =>
  api().listThreads(q, pageToken) as Promise<{ ok: boolean; threads?: ThreadRow[]; nextPageToken?: string; error?: string }>
export const mailGetThread = (id: string) =>
  api().getThread(id) as Promise<{ ok: boolean; messages?: ParsedMessage[]; error?: string }>
export const mailGetAttachment = (mId: string, aId: string, filename: string) =>
  api().getAttachment(mId, aId, filename) as Promise<{ ok: boolean; savedPath?: string; error?: string }>
export const mailSend = (opts: { to: string; subject: string; body: string; inReplyTo?: string; references?: string; threadId?: string }) =>
  api().send(opts) as Promise<{ ok: boolean; error?: string }>
export const onMailConnected = (cb: (e: { email: string }) => void) => api().onConnected(cb) as () => void
```

- [ ] **Step 2: Extend the pageType union**

In `src/renderer/src/store/browserStore.ts`, change every occurrence of the page-type union to include `'mail'`. The `Tab` interface line becomes:
```typescript
export interface Tab { id: string; url: string; title: string; favicon: string; isLoading: boolean; isHome: boolean; fromHome?: boolean; pageType?: 'browser'|'settings'|'history'|'downloads'|'wifi'|'vpn'|'research'|'agents'|'extensions'|'mail' }
```
And the `addTab` signature's `pageType` param type gets `|'mail'` added the same way (match the existing union exactly).

- [ ] **Step 3: Extend openSpecialPage typing + Sidebar prop**

In `src/renderer/src/App.tsx`, the `openSpecialPage` callback's `pageType` parameter union — add `| 'mail'`:
```typescript
const openSpecialPage = useCallback((pageType: 'settings' | 'history' | 'downloads' | 'wifi' | 'vpn' | 'research' | 'agents' | 'extensions' | 'mail') => {
```
In `src/renderer/src/components/browser/Sidebar.tsx`, add `| 'mail'` to both the `onOpenPage` prop type (line ~10) and the `NAV_ITEMS` `page` union type (line ~16), matching the existing unions.

- [ ] **Step 4: Add lazy import + render in App**

In `src/renderer/src/App.tsx`, alongside the other `lazy(() => import(...))` page declarations:
```typescript
const MailPage = lazy(() => import('./components/pages/MailPage'))
```
In the special-pages render block (where `tab.pageType === 'downloads' && <DownloadsPage />` etc. appear), add:
```tsx
{tab.pageType === 'mail' && <MailPage />}
```

- [ ] **Step 5: Add the Sidebar nav item**

In `src/renderer/src/components/browser/Sidebar.tsx`, import the `Mail` icon from `lucide-react` (add to the existing import) and add to `NAV_ITEMS` (near the WiFi/VPN entries):
```typescript
{ icon: Mail, label: 'Mail', page: 'mail', type: 'mail' },
```

- [ ] **Step 6: Create a stub MailPage so the build resolves**

Create `src/renderer/src/components/pages/MailPage.tsx`:
```tsx
export default function MailPage() {
  return <div className="p-8 text-aihub-text">Mail (stub)</div>
}
```

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: renderer builds, no type errors, MailPage chunk emitted.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/services/mailService.ts src/renderer/src/store/browserStore.ts src/renderer/src/App.tsx src/renderer/src/components/browser/Sidebar.tsx src/renderer/src/components/pages/MailPage.tsx
git commit -m "feat(gmail): renderer mail service + Mail page registration"
```

---

## Task 10: Sandboxed email body iframe

**Files:**
- Create: `src/renderer/src/components/pages/mail/EmailFrame.tsx`

**Interfaces:**
- Produces: `export default function EmailFrame({ html, plain }: { html: string; plain: string }): JSX.Element` — renders email HTML in a script-free sandboxed iframe with remote images blocked until the user clicks "Show images"; falls back to preformatted `plain` when there's no HTML.

- [ ] **Step 1: Implement**

Create `src/renderer/src/components/pages/mail/EmailFrame.tsx`:
```tsx
import React, { useMemo, useState } from 'react'

// Neutralize remote image sources so tracking pixels don't fire until the user
// opts in. Replaces src/srcset/background with data-* holders we can restore.
function blockRemoteImages(html: string): string {
  return html
    .replace(/\ssrc=/gi, ' data-blocked-src=')
    .replace(/\ssrcset=/gi, ' data-blocked-srcset=')
    .replace(/background=/gi, 'data-blocked-background=')
}
function restoreImages(html: string): string {
  return html
    .replace(/\sdata-blocked-src=/gi, ' src=')
    .replace(/\sdata-blocked-srcset=/gi, ' srcset=')
    .replace(/data-blocked-background=/gi, 'background=')
}

export default function EmailFrame({ html, plain }: { html: string; plain: string }) {
  const [showImages, setShowImages] = useState(false)
  const hasHtml = !!html.trim()

  const srcDoc = useMemo(() => {
    if (!hasHtml) return ''
    const body = showImages ? restoreImages(html) : blockRemoteImages(html)
    // CSP blocks scripts + any resource load except images (only present once opted in).
    const csp = `default-src 'none'; img-src ${showImages ? 'https: data:' : "data:"}; style-src 'unsafe-inline'; font-src data:;`
    return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}">` +
      `<base target="_blank"><style>body{font-family:sans-serif;color:#111;background:#fff;margin:12px;} img{max-width:100%;}</style></head>` +
      `<body>${body}</body></html>`
  }, [html, showImages, hasHtml])

  if (!hasHtml) {
    return <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, color: 'rgb(var(--ds-text-2))' }}>{plain}</pre>
  }
  return (
    <div>
      {!showImages && /data-blocked-src=|data-blocked-srcset=|data-blocked-background=/i.test(blockRemoteImages(html)) && (
        <button onClick={() => setShowImages(true)}
          style={{ marginBottom: 8, padding: '4px 10px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
            background: 'rgb(var(--ds-accent) / 0.12)', color: 'rgb(var(--ds-accent-soft))', border: '1px solid rgb(var(--ds-accent) / 0.25)' }}>
          Show remote images
        </button>
      )}
      <iframe
        title="email-body"
        sandbox=""
        srcDoc={srcDoc}
        style={{ width: '100%', minHeight: 200, border: 'none', background: '#fff', borderRadius: 8 }}
      />
    </div>
  )
}
```

Note: `sandbox=""` allows NO capabilities (no scripts, no same-origin, no forms). `<base target="_blank">` makes link clicks request a new tab, which the main window-open handler routes; nothing auto-navigates.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: builds; EmailFrame compiles.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/pages/mail/EmailFrame.tsx
git commit -m "feat(gmail): sandboxed email body iframe with image blocking"
```

---

## Task 11: MailPage — connect + inbox list

**Files:**
- Modify: `src/renderer/src/components/pages/MailPage.tsx` (replace the stub)

**Interfaces:**
- Consumes: mailService fns, `ThreadRow`, `ParsedMessage`; `EmailFrame`.
- Produces: the full Mail page default export. Inbox list on the left, reader on the right (reader filled in Task 12), compose (Task 13).

- [ ] **Step 1: Implement connect gate + inbox list**

Replace `src/renderer/src/components/pages/MailPage.tsx` with:
```tsx
import React, { useEffect, useState, useCallback } from 'react'
import { Mail, RefreshCw, Loader2, LogOut, Search } from 'lucide-react'
import {
  mailStatus, mailConnect, mailDisconnect, mailListThreads, onMailConnected, ThreadRow,
} from '../../services/mailService'
import ThreadReader from './mail/ThreadReader'

export default function MailPage() {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [threads, setThreads] = useState<ThreadRow[]>([])
  const [nextToken, setNextToken] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    const s = await mailStatus()
    setConnected(s.connected); setEmail(s.email)
  }, [])

  useEffect(() => { refreshStatus() }, [refreshStatus])
  useEffect(() => onMailConnected(e => { setConnected(true); setEmail(e.email); load('') }), [])

  const load = useCallback(async (query: string, token?: string) => {
    setLoading(true); setError('')
    const r = await mailListThreads(query, token)
    setLoading(false)
    if (!r.ok) { setError(r.error || 'Failed to load'); return }
    setThreads(prev => token ? [...prev, ...(r.threads || [])] : (r.threads || []))
    setNextToken(r.nextPageToken)
  }, [])

  useEffect(() => { if (connected) load('') }, [connected, load])

  const connect = async () => {
    setConnecting(true); setError('')
    const r = await mailConnect()
    setConnecting(false)
    if (!r.ok) setError(r.error || 'Connect failed')
    else { setConnected(true); setEmail(r.email || null) }
  }

  const disconnect = async () => { await mailDisconnect(); setConnected(false); setEmail(null); setThreads([]); setActiveId(null) }

  if (connected === null) {
    return <div className="flex items-center justify-center h-full text-aihub-muted"><Loader2 className="animate-spin" /></div>
  }

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8" style={{ background: 'linear-gradient(160deg, rgb(var(--ds-bg)) 0%, rgb(var(--ds-bg-3)) 100%)' }}>
        <Mail size={44} style={{ color: 'rgb(var(--ds-accent))' }} />
        <div style={{ fontSize: 18, fontWeight: 700, color: 'rgb(var(--ds-text-1))' }}>Connect your Gmail</div>
        <div style={{ fontSize: 13, color: 'rgb(var(--ds-text-4))', maxWidth: 380 }}>
          Sign in opens once in your system browser (Google blocks in-app sign-in). After that, read and send mail right here.
        </div>
        <button onClick={connect} disabled={connecting}
          style={{ padding: '10px 20px', borderRadius: 12, fontWeight: 600, cursor: 'pointer',
            background: 'rgb(var(--ds-accent))', color: '#fff', border: 'none', opacity: connecting ? 0.7 : 1 }}>
          {connecting ? 'Waiting for browser…' : 'Connect Gmail'}
        </button>
        {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}
      </div>
    )
  }

  return (
    <div className="flex h-full" style={{ background: 'rgb(var(--ds-bg))', color: 'rgb(var(--ds-text-1))' }}>
      {/* Left: inbox list */}
      <div style={{ width: 360, borderRight: '1px solid var(--ds-border-sm)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 12, borderBottom: '1px solid var(--ds-border-sm)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'rgb(var(--ds-text-4))' }}>{email}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button title="Refresh" onClick={() => load(q)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgb(var(--ds-text-4))' }}><RefreshCw size={14} /></button>
              <button title="Disconnect" onClick={disconnect} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgb(var(--ds-text-4))' }}><LogOut size={14} /></button>
            </div>
          </div>
          <form onSubmit={e => { e.preventDefault(); load(q) }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 10, background: 'var(--ds-glass-xs)' }}>
            <Search size={13} style={{ color: 'rgb(var(--ds-text-4))' }} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search mail (e.g. is:unread)"
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'rgb(var(--ds-text-2))', fontSize: 12 }} />
          </form>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {error && <div style={{ padding: 12, color: '#f87171', fontSize: 12 }}>{error}</div>}
          {threads.map(t => (
            <button key={t.id} onClick={() => setActiveId(t.id)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', cursor: 'pointer',
                borderBottom: '1px solid var(--ds-border-sm)', background: activeId === t.id ? 'var(--ds-glass-sm)' : 'transparent' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: t.unread ? 700 : 500, color: 'rgb(var(--ds-text-2))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.from || '(unknown)'}</span>
                {t.unread && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'rgb(var(--ds-accent))', flexShrink: 0, marginTop: 4 }} />}
              </div>
              <div style={{ fontSize: 12.5, color: 'rgb(var(--ds-text-3))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject || '(no subject)'}</div>
              <div style={{ fontSize: 11, color: 'rgb(var(--ds-text-4))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.snippet}</div>
            </button>
          ))}
          {loading && <div style={{ padding: 12, textAlign: 'center' }}><Loader2 className="animate-spin" size={16} style={{ color: 'rgb(var(--ds-accent))' }} /></div>}
          {!loading && nextToken && <button onClick={() => load(q, nextToken)} style={{ width: '100%', padding: 10, fontSize: 12, background: 'none', border: 'none', color: 'rgb(var(--ds-accent-soft))', cursor: 'pointer' }}>Load more</button>}
          {!loading && threads.length === 0 && !error && <div style={{ padding: 24, textAlign: 'center', color: 'rgb(var(--ds-text-4))', fontSize: 13 }}>No messages</div>}
        </div>
      </div>
      {/* Right: reader */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {activeId ? <ThreadReader threadId={activeId} accountEmail={email || ''} /> : <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'rgb(var(--ds-text-4))' }}>Select a message</div>}
      </div>
    </div>
  )
}
```

Note: this imports `./mail/ThreadReader`, created in Task 12. The build will fail until then — that's expected; commit Task 11 and Task 12 together if executing inline, or create the reader stub first. To keep this task independently buildable, also create a one-line stub now:

Create `src/renderer/src/components/pages/mail/ThreadReader.tsx`:
```tsx
export default function ThreadReader(_: { threadId: string; accountEmail: string }) { return null }
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: builds (reader is a stub).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/pages/MailPage.tsx src/renderer/src/components/pages/mail/ThreadReader.tsx
git commit -m "feat(gmail): Mail page connect gate + inbox list"
```

---

## Task 12: Thread reader + attachments

**Files:**
- Modify: `src/renderer/src/components/pages/mail/ThreadReader.tsx` (replace the stub)

**Interfaces:**
- Consumes: `mailGetThread`, `mailGetAttachment`, `ParsedMessage` (mailService); `EmailFrame`. Also a `onReply` callback prop to open compose (compose added in Task 13; for now include the prop, default no-op).
- Produces: `export default function ThreadReader({ threadId, accountEmail, onReply }: { threadId: string; accountEmail: string; onReply?: (m: ParsedMessage) => void }): JSX.Element`

- [ ] **Step 1: Implement**

Replace `src/renderer/src/components/pages/mail/ThreadReader.tsx` with:
```tsx
import React, { useEffect, useState } from 'react'
import { Loader2, Paperclip, Reply, Download } from 'lucide-react'
import { mailGetThread, mailGetAttachment, ParsedMessage } from '../../../services/mailService'
import EmailFrame from './EmailFrame'

export default function ThreadReader({ threadId, accountEmail, onReply }: { threadId: string; accountEmail: string; onReply?: (m: ParsedMessage) => void }) {
  const [messages, setMessages] = useState<ParsedMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    mailGetThread(threadId).then(r => {
      if (!alive) return
      setLoading(false)
      if (!r.ok) setError(r.error || 'Failed to load thread')
      else setMessages(r.messages || [])
    })
    return () => { alive = false }
  }, [threadId])

  const saveAttachment = async (m: ParsedMessage, aId: string, filename: string) => {
    const r = await mailGetAttachment(m.id, aId, filename)
    if (r.ok && r.savedPath) setSaved(s => ({ ...s, [aId]: r.savedPath! }))
  }

  if (loading) return <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}><Loader2 className="animate-spin" style={{ color: 'rgb(var(--ds-accent))' }} /></div>
  if (error) return <div style={{ padding: 24, color: '#f87171' }}>{error}</div>

  return (
    <div style={{ padding: 20 }}>
      {messages.map(m => (
        <div key={m.id} style={{ marginBottom: 24, borderBottom: '1px solid var(--ds-border-sm)', paddingBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'rgb(var(--ds-text-1))' }}>{m.subject || '(no subject)'}</div>
              <div style={{ fontSize: 12, color: 'rgb(var(--ds-text-4))' }}>{m.from} → {m.to}</div>
              <div style={{ fontSize: 11, color: 'rgb(var(--ds-text-4))' }}>{m.date}</div>
            </div>
            <button onClick={() => onReply?.(m)} title="Reply"
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
                background: 'rgb(var(--ds-accent) / 0.12)', color: 'rgb(var(--ds-accent-soft))', border: '1px solid rgb(var(--ds-accent) / 0.25)', fontSize: 12 }}>
              <Reply size={12} /> Reply
            </button>
          </div>
          <EmailFrame html={m.textHtml} plain={m.textPlain} />
          {m.attachments.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {m.attachments.map(a => (
                <button key={a.attachmentId} onClick={() => saveAttachment(m, a.attachmentId, a.filename)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                    background: 'var(--ds-glass-sm)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-3))' }}>
                  {saved[a.attachmentId] ? <Download size={12} /> : <Paperclip size={12} />}
                  {a.filename} {saved[a.attachmentId] ? '· saved' : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: builds; reader renders bodies + attachments.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/pages/mail/ThreadReader.tsx
git commit -m "feat(gmail): thread reader with sandboxed bodies + attachment save"
```

---

## Task 13: Compose + reply

**Files:**
- Create: `src/renderer/src/components/pages/mail/Compose.tsx`
- Modify: `src/renderer/src/components/pages/MailPage.tsx` (wire compose open/close + pass `onReply` to reader)

**Interfaces:**
- Consumes: `mailSend` (mailService), `ParsedMessage`.
- Produces: `export default function Compose({ initial, onClose, onSent }: { initial: { to: string; subject: string; body: string; inReplyTo?: string; references?: string; threadId?: string }; onClose: () => void; onSent: () => void }): JSX.Element`

- [ ] **Step 1: Implement compose modal**

Create `src/renderer/src/components/pages/mail/Compose.tsx`:
```tsx
import React, { useState } from 'react'
import { X, Send, Loader2 } from 'lucide-react'
import { mailSend } from '../../../services/mailService'

export default function Compose({ initial, onClose, onSent }: {
  initial: { to: string; subject: string; body: string; inReplyTo?: string; references?: string; threadId?: string }
  onClose: () => void; onSent: () => void
}) {
  const [to, setTo] = useState(initial.to)
  const [subject, setSubject] = useState(initial.subject)
  const [body, setBody] = useState(initial.body)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const send = async () => {
    if (!to.trim()) { setError('Recipient required'); return }
    setSending(true); setError('')
    const r = await mailSend({ to, subject, body, inReplyTo: initial.inReplyTo, references: initial.references, threadId: initial.threadId })
    setSending(false)
    if (!r.ok) setError(r.error || 'Send failed')
    else { onSent(); onClose() }
  }

  const field: React.CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 8, background: 'var(--ds-glass-xs)', border: '1px solid var(--ds-border-sm)', color: 'rgb(var(--ds-text-2))', fontSize: 13, outline: 'none' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 560, maxWidth: '90vw', background: 'var(--ds-panel-bg)', borderRadius: 14, border: '1px solid var(--ds-border-sm)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--ds-border-sm)' }}>
          <span style={{ fontWeight: 600, color: 'rgb(var(--ds-text-1))' }}>New message</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgb(var(--ds-text-4))' }}><X size={16} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input value={to} onChange={e => setTo(e.target.value)} placeholder="To" style={field} />
          <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" style={field} />
          <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Message" rows={10} style={{ ...field, resize: 'vertical' }} />
          {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={send} disabled={sending}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, cursor: 'pointer',
                background: 'rgb(var(--ds-accent))', color: '#fff', border: 'none', fontWeight: 600, opacity: sending ? 0.7 : 1 }}>
              {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire compose into MailPage**

In `src/renderer/src/components/pages/MailPage.tsx`:
- Add import: `import Compose from './mail/Compose'` and `import { ParsedMessage } from '../../services/mailService'` (extend the existing mailService import).
- Add state: `const [compose, setCompose] = useState<null | { to: string; subject: string; body: string; inReplyTo?: string; references?: string; threadId?: string }>(null)`
- Add a "Compose" button in the left-pane header (next to Refresh):
```tsx
<button title="Compose" onClick={() => setCompose({ to: '', subject: '', body: '' })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgb(var(--ds-accent-soft))' }}>✎</button>
```
- Build the reply handler and pass it to the reader:
```tsx
const handleReply = (m: ParsedMessage) => setCompose({
  to: m.from,
  subject: m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`,
  body: `\n\n---- On ${m.date}, ${m.from} wrote: ----\n${m.textPlain}`,
  inReplyTo: m.messageIdHeader,
  references: (m.references ? m.references + ' ' : '') + m.messageIdHeader,
  threadId: m.threadId,
})
```
Change the reader render to: `<ThreadReader threadId={activeId} accountEmail={email || ''} onReply={handleReply} />`
- Render the modal before the closing outer `</div>`:
```tsx
{compose && <Compose initial={compose} onClose={() => setCompose(null)} onSent={() => load(q)} />}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: builds.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/pages/mail/Compose.tsx src/renderer/src/components/pages/MailPage.tsx
git commit -m "feat(gmail): compose + reply"
```

---

## Task 14: Settings — Gmail account block

**Files:**
- Modify: `src/renderer/src/components/pages/SettingsPage.tsx`

**Interfaces:**
- Consumes: `mailStatus`, `mailConnect`, `mailDisconnect`, `mailSetCredentials` (mailService).

- [ ] **Step 1: Add a Gmail section**

In `src/renderer/src/components/pages/SettingsPage.tsx`:
- Import the mail service:
```typescript
import { mailStatus, mailConnect, mailDisconnect, mailSetCredentials } from '../../services/mailService'
```
- Add state near the other `useState`s:
```typescript
const [gmailConnected, setGmailConnected] = useState(false)
const [gmailEmail, setGmailEmail] = useState<string | null>(null)
const [gmailBusy, setGmailBusy] = useState(false)
const [showGmailCreds, setShowGmailCreds] = useState(false)
const [gClientId, setGClientId] = useState('')
const [gClientSecret, setGClientSecret] = useState('')
```
- In the mount `useEffect`, add: `mailStatus().then(s => { setGmailConnected(s.connected); setGmailEmail(s.email) })`
- Add handlers:
```typescript
const connectGmail = async () => {
  setGmailBusy(true)
  if (gClientId.trim()) await mailSetCredentials(gClientId.trim(), gClientSecret.trim())
  const r = await mailConnect()
  setGmailBusy(false)
  if (r.ok) { setGmailConnected(true); setGmailEmail(r.email || null) }
}
const disconnectGmail = async () => { await mailDisconnect(); setGmailConnected(false); setGmailEmail(null) }
```
- Add a new `<Section icon={<Mail size={15} />} title="Gmail">` block (import `Mail` from lucide-react in the existing import) at an appropriate place in the render, containing:
```tsx
<div className="mb-2">
  {gmailConnected ? (
    <div className="flex items-center justify-between">
      <div className={LBL} style={{ marginBottom: 0 }}>Connected: {gmailEmail}</div>
      <button onClick={disconnectGmail} className="px-3 py-1.5 rounded-xl text-xs font-medium" style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}>Disconnect</button>
    </div>
  ) : (
    <>
      <div className={DESC}>Sign-in opens once in your system browser, then mail lives here. Advanced: use your own Google OAuth client below.</div>
      <button onClick={connectGmail} disabled={gmailBusy}
        className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: 'rgb(var(--ds-accent))', color: '#fff', border: 'none', opacity: gmailBusy ? 0.7 : 1 }}>
        {gmailBusy ? 'Waiting…' : 'Connect Gmail'}
      </button>
      <button onClick={() => setShowGmailCreds(v => !v)} className="ml-3 text-xs" style={{ color: 'rgb(var(--ds-accent-soft))', background: 'none', border: 'none', cursor: 'pointer' }}>
        {showGmailCreds ? 'Hide' : 'Use my own Google credentials'}
      </button>
      {showGmailCreds && (
        <div className="mt-3 flex flex-col gap-2" style={{ maxWidth: 460 }}>
          <input value={gClientId} onChange={e => setGClientId(e.target.value)} placeholder="OAuth client_id"
            className="bg-aihub-card border border-aihub-border/40 rounded-lg px-3 py-1.5 text-sm text-aihub-text outline-none" />
          <input value={gClientSecret} onChange={e => setGClientSecret(e.target.value)} placeholder="OAuth client_secret (optional for desktop clients)"
            className="bg-aihub-card border border-aihub-border/40 rounded-lg px-3 py-1.5 text-sm text-aihub-text outline-none" />
        </div>
      )}
    </>
  )}
</div>
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: builds.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/pages/SettingsPage.tsx
git commit -m "feat(gmail): Settings account block (connect/disconnect + creds override)"
```

---

## Task 15: Live verification

**Files:** none (verification only). Requires a real `DEFAULT_CLIENT_ID` in `config.ts` OR the user entering their own client in Settings, and the account added as a test user in the Cloud project.

**Prerequisite (owner, one-time):** Create a Google Cloud project, enable Gmail API, configure the OAuth consent screen (External / Testing), add the Gmail account as a test user, create a Desktop OAuth client, and paste its `client_id` into `src/main/gmail/config.ts` (`DEFAULT_CLIENT_ID`). Rebuild.

- [ ] **Step 1: Build and launch the isolated instance**

Run: `npm run build`, then launch with a temp userData + remote debugging (the same harness used during the sign-in investigation): the isolated launcher script overriding `userData` + `--remote-debugging-port=9223`.

- [ ] **Step 2: Connect**

Open the Mail page → click "Connect Gmail". Confirm the consent screen opens in the **system browser** (not in-app), approve, and the loopback page shows "Connected. You can close this tab." Confirm the Mail page flips to the inbox and shows the account email.
Expected observation: no "browser may not be secure" message (consent happened in real Chrome).

- [ ] **Step 3: List + read**

Confirm the inbox lists threads. Open one with HTML + remote images. Confirm images are blocked until "Show remote images" is clicked. Confirm no scripts run (the iframe has `sandbox=""`).

- [ ] **Step 4: Send**

Compose a test email to yourself, Send. Confirm `{ok:true}` (no error shown) and that the message arrives (check via the inbox refresh or another client).

- [ ] **Step 5: Reply + attachment**

Reply to a thread; confirm the reply threads correctly (In-Reply-To set). Open a message with an attachment; click it; confirm the file lands in the Downloads folder.

- [ ] **Step 6: Disconnect**

Click Disconnect; confirm the token file is removed (`~/.aihub-browser/gmail-tokens.enc` gone) and the page returns to the connect gate.

- [ ] **Step 7: Record findings**

Note any failures with the exact error surfaced. If all pass, the feature is verified end-to-end.

---

## Self-review notes

- **Spec coverage:** OAuth loopback (Task 6), Gmail client read+send (Task 7), IPC (Task 8), Mail UI list/reader/compose (Tasks 11–13), HTML sandboxing (Task 10), encrypted token storage (Task 5), Settings block incl. creds override (Task 14), error handling as discriminated results (Tasks 8–13), testing unit + live (Tasks 2/3/15). All spec sections mapped.
- **Scope:** single cohesive feature; one plan. No mailbox mutation (matches read+send constraint).
- **Type consistency:** `ParsedMessage`/`ThreadRow`/`MailAttachment` defined identically in `mime.ts` (main) and mirrored in `mailService.ts` (renderer); IPC result shape `{ok,...}|{ok:false,error}` uniform; `messageIdHeader`/`references` used consistently for reply threading.
```
