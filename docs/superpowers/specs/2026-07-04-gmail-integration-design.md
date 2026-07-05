# Native Gmail Integration — Design Spec

**Date:** 2026-07-04
**Status:** Approved (design), pending implementation plan
**Author:** Erick OMARI + Claude

## Background & motivation

Signing into Google by driving `accounts.google.com` inside the app's embedded
`BrowserView` is blocked by Google's anti-embedded-browser OAuth policy. This was
verified exhaustively (2026-07-04): with a flawless spoofed identity — Chrome 149
UA, full `Sec-CH-UA` brands, correct `navigator.userAgentData` high-entropy hints,
`webdriver:false`, `window.chrome` present, and even the `x-client-data` header —
Google still rejected at the email step (`/v3/signin/rejected`). The remaining tell
is Electron's TLS/JA3 fingerprint, which cannot be changed from JS or HTTP headers.
See memory `ghsignin-websecurity` for the full investigation.

The Google-blessed path is to become an OAuth client and talk to the **Gmail REST
API**, with the one-time consent handled in the user's real system browser via the
OAuth 2.0 loopback flow. Mail is then read and sent entirely in-app through the API.
This is how `gcloud`, GitHub CLI, and VS Code authenticate.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Audience | Ship to public eventually; works for the developer + up to 100 test users immediately in the Cloud project's Testing mode. |
| Feature scope (v1) | **Read + send.** Scopes: `gmail.readonly`, `gmail.send`. No archive/delete/label management. |
| Credential model | **Bundled dev `client_id` + advanced per-user override** (client_id/secret in Settings). |
| Architecture | Main-process OAuth + Gmail API; renderer never sees tokens. Raw REST over the existing `httpPost` helper (no `googleapis` SDK). |
| Accounts | Single account in v1; architected for multi-account later. |

### Important non-engineering constraint

The code is identical for personal vs public use. "Public" is a separate Google
track: publishing the OAuth consent screen + passing a CASA Tier-2 security
assessment (required because `gmail.readonly` is a *restricted* scope). Estimated
$540+/yr and weeks–months. Nothing in this spec changes based on that outcome; the
Cloud project is simply flipped from "Testing" to "Published" once Google approves.
Until then, only the project's test users can connect (others see "access blocked:
app not verified").

## Architecture

Everything security-sensitive (OAuth, tokens, API calls) runs in the **main
process**. The renderer's Mail page only ever receives already-decoded mail data
over IPC. This matches the existing `ipcMain.handle` + preload-bridge pattern and
satisfies CLAUDE.md's "encryption at rest / never expose secrets."

```
Renderer (MailPage.tsx)
   │  window.electronAPI.gmail.*   (IPC, typed via mailService.ts)
   ▼
Main process
   ├── gmail/ipc.ts     — ipcMain.handle wiring
   ├── gmail/oauth.ts   — loopback consent, token exchange/refresh/revoke (PKCE)
   ├── gmail/client.ts  — Gmail REST wrapper (list/get/send, MIME parse/build)
   └── gmail/store.ts    — safeStorage-encrypted refresh-token persistence
        │
        ▼  HTTPS (existing httpPost / https helpers with retry + DNS fallback)
   Gmail REST API + Google OAuth token endpoint
```

### Files

**New — main:**
- `src/main/gmail/oauth.ts`
- `src/main/gmail/client.ts`
- `src/main/gmail/store.ts`
- `src/main/gmail/ipc.ts` (registers handlers; imported from `index.ts`)

**New — renderer:**
- `src/renderer/src/components/pages/MailPage.tsx` (lazy-loaded)
- `src/renderer/src/services/mailService.ts`

**Modified:**
- `src/preload/index.ts` — add `gmail` bridge namespace.
- `src/renderer/src/App.tsx` — register `pageType: 'mail'` + lazy import + render.
- `src/renderer/src/store/browserStore.ts` — add `'mail'` to the `pageType` union and `openSpecialPage` type.
- `src/renderer/src/components/browser/Sidebar.tsx` — add a "Mail" nav item.
- `src/renderer/src/components/pages/SettingsPage.tsx` — add the Gmail account block.
- `src/main/index.ts` — import and call the Gmail IPC registration.

## OAuth loopback flow (`gmail/oauth.ts`)

1. Renderer calls `gmail:connect`.
2. Main generates a PKCE `code_verifier` + S256 `code_challenge` and a random
   `state`.
3. `http.createServer` binds `127.0.0.1:0` (OS-assigned ephemeral port).
4. Build the consent URL against `https://accounts.google.com/o/oauth2/v2/auth`:
   - `client_id` = user override if set, else bundled dev client_id
   - `redirect_uri` = `http://127.0.0.1:<port>`
   - `response_type=code`, `scope=https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send`
   - `access_type=offline`, `prompt=consent` (forces a refresh token every time)
   - `code_challenge`, `code_challenge_method=S256`, `state`
5. `shell.openExternal(consentUrl)` — opens in the real default browser.
6. User approves → Google redirects to the loopback server → capture `code`,
   validate `state`, respond with a minimal "You can close this tab and return to
   AIHub Browser" HTML page, then close the server.
7. POST to `https://oauth2.googleapis.com/token` with `code`, `code_verifier`,
   `client_id` (+ `client_secret` only when using a user-provided classic client;
   PKCE-only public clients omit it) → `{access_token, refresh_token, expires_in}`.
8. Persist the refresh token (encrypted); keep the access token + expiry in memory.
9. Fetch the account email once (`users.getProfile`) for display; emit
   `gmail:connected`.

**Timeout/cancel:** if no callback arrives within 5 minutes, close the server and
return `{ok:false, error:'consent timed out'}`. A second `gmail:connect` while one
is pending cancels the first.

**Refresh:** before any API call, if the access token is within 60s of expiry (or a
call returns 401), POST `grant_type=refresh_token` to the token endpoint and update
the in-memory access token. If refresh fails with `invalid_grant` (revoked/expired
refresh token), clear stored tokens and return a `needs-reconnect` error.

## Gmail client (`gmail/client.ts`)

Raw REST over the existing `httpPost` (and a small `httpGet`/`httpRequest` helper if
one doesn't exist) against `https://gmail.googleapis.com/gmail/v1`. All calls attach
`Authorization: Bearer <access_token>` and go through the refresh guard.

- `listThreads(q?, pageToken?)` → `GET users/me/threads?q=&pageToken=` → returns
  thread ids + a `nextPageToken`. A second `threads.get` (format=metadata) per row,
  or `messages.list`+batch, hydrates snippet/from/subject/date/unread. (Implementation
  detail: use `threads.list` then `threads.get` with `format=metadata` and
  `metadataHeaders=From,Subject,Date` for the list rows to keep payloads small.)
- `getThread(id)` → `GET users/me/threads/{id}?format=full` → parse each message's
  MIME tree into `{id, from, to, cc, subject, date, textHtml, textPlain, unread,
  attachments:[{filename, mimeType, attachmentId, size}]}`.
- `getAttachment(messageId, attachmentId)` → `users.messages.attachments.get` →
  base64url data → hand to the existing download manager to save.
- `send({to, subject, body, inReplyTo?, references?, threadId?})` → build an RFC 2822
  message (headers + body; `In-Reply-To`/`References` for replies), base64url-encode,
  `POST users/me/messages/send` with `{raw, threadId?}`.

**MIME parsing and RFC-2822 building are pure functions** (no network) — the primary
unit-test targets.

## IPC surface (`gmail/ipc.ts` + preload)

| Channel | Args | Returns |
|---|---|---|
| `gmail:status` | — | `{connected, email?}` |
| `gmail:connect` | — | `{ok, email?}` \| `{ok:false, error}` |
| `gmail:disconnect` | — | `{ok}` |
| `gmail:listThreads` | `{q?, pageToken?}` | `{ok, threads[], nextPageToken?}` |
| `gmail:getThread` | `{id}` | `{ok, messages[]}` |
| `gmail:getAttachment` | `{messageId, attachmentId, filename}` | `{ok, savedPath}` |
| `gmail:send` | `{to, subject, body, inReplyTo?, threadId?}` | `{ok}` |
| `gmail:connected` (push) | — | `{email}` |

Every handler returns a discriminated `{ok:true,...}|{ok:false,error}` result; the
renderer surfaces errors inline. No thrown IPC.

## Mail UI (`MailPage.tsx`)

One page, master–detail:

- **Inbox list (left pane):** rows show sender, subject, snippet, relative date, and
  an unread dot. A search box maps to Gmail's `q` (e.g. `is:unread`, `from:x`).
  Infinite scroll drives `pageToken`. Empty/error/loading states explicit (reusing
  the app's existing spinner/empty patterns — and NOT leaving a perpetual spinner,
  per the Downloads bug lesson).
- **Thread reader (right pane):** each message shows headers + a sandboxed HTML body
  (Section below) + attachment chips (click → `gmail:getAttachment` → download
  manager). A "Reply" button opens compose prefilled.
- **Compose modal:** `to`, `subject`, `body` (plain-text v1), Send. Reply prefills
  recipient, `Re:` subject, `In-Reply-To`/`References`, and a quoted original.
- Styled entirely with `--ds-*` theme vars so it recolors with the active theme.

## HTML email sandboxing (security-critical)

Email HTML is untrusted/hostile. Each message body renders in an
`<iframe sandbox>` with:
- **No `allow-scripts`** — scripts in email never execute.
- A restrictive `srcdoc` + CSP `<meta>` that blocks all resource loads by default.
- **Remote images blocked by default** (strip/neutralize `src`), with a per-message
  "Show images" toggle that re-injects them — prevents tracking-pixel/beacon leaks.
- Links do not auto-navigate; clicks route through the app's existing new-tab handler
  and are treated as untrusted (same suspicion rules as any external link).

## Token storage & security (`gmail/store.ts`)

- Refresh token encrypted with `safeStorage.encryptString` (Windows DPAPI) →
  `~/.aihub-browser/gmail-tokens.enc`.
- If `safeStorage.isEncryptionAvailable()` is false, **refuse to persist** and warn;
  never write plaintext tokens.
- Access token lives only in main-process memory.
- Tokens never cross IPC into the renderer.
- `gmail:disconnect` calls Google's revoke endpoint then deletes the file.
- The bundled `client_id` is not a true secret for a desktop PKCE client; a
  user-provided `client_secret` (classic client) is stored the same encrypted way.

## Settings additions (`SettingsPage.tsx`)

A new "Gmail" block:
- Connect / Disconnect button + connected-email display.
- Collapsible "Use my own Google credentials" with `client_id` / `client_secret`
  fields (the advanced override), persisted via the settings store.
- A one-line link/help text pointing to the Cloud-project setup for advanced users.

## Error handling

- Discriminated result objects everywhere; inline UI messaging for: not connected,
  consent timed out/cancelled, refresh failed → reconnect prompt, API 4xx/5xx,
  offline/DNS. Reuse the app's `withNetRetry` for transient network failures.
- No silent catches; no perpetual spinners (explicit error/empty terminal states).

## Testing / verification

- **Unit (pure, no network):** MIME-tree → message parse; RFC-2822 build (incl.
  reply headers); base64url round-trips.
- **Live (CDP-driven, real Gmail test user):** connect (consent opens in system
  browser, loopback captures code), list inbox, open a thread with HTML + images
  (confirm images blocked until toggled), send a test message, verify receipt.
  Driven the same way the sign-in investigation was (remote-debugging-port + a CDP
  script), with an isolated userData profile.

## Out of scope (v1 — future work)

- Multiple accounts (architecture leaves room: token store keyed by email).
- Mailbox mutation: archive, delete, mark read/unread, labels (needs `gmail.modify`).
- Rich-text/HTML compose, drafts, attachments on send.
- Push/watch notifications for new mail (Pub/Sub) — v1 polls on open + manual refresh.

## Prerequisites (user, one-time, outside code)

1. Google Cloud project → enable Gmail API.
2. OAuth consent screen (External, Testing) → add test users (incl.
   erickomari243@gmail.com).
3. Create a **Desktop app** OAuth client → obtain `client_id` (+ secret).
4. Provide that `client_id` to bundle as the default (or use the Settings override).
5. For public launch later: publish consent screen + CASA assessment.
