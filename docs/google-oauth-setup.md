# Google Sign-In Setup (OAuth 2.0 Authorization Code + PKCE)

AIHub Browser signs in to Google using the **officially supported desktop-app
flow**: the consent screen opens in your **real system browser** (never an
embedded WebView/BrowserWindow), Google redirects to a **loopback callback**
(`http://127.0.0.1:3000/callback`), and the app exchanges the authorization code
— protected by **PKCE** — for tokens. This is why it does **not** trigger
_"This browser or app may not be secure."_

You only need to create a Google OAuth client once and paste its **Client ID**
into **Settings → Google** (or the Mail page's Connect button).

---

## 1. Create / pick a Google Cloud project

1. Go to <https://console.cloud.google.com/>.
2. Top bar → project picker → **New Project** → name it (e.g. `AIHub Browser`) →
   **Create**, then select it.

## 2. Enable the APIs you want

**APIs & Services → Library**, then Enable each of:

- **Gmail API**
- **Google Drive API**
- **Google Calendar API**

(Enable only the ones you plan to use; you can add more later.)

## 3. Configure the OAuth consent screen

**APIs & Services → OAuth consent screen**

1. **User type: External** → Create.
2. App name, user support email, developer contact email → Save & Continue.
3. **Scopes** → Add or remove scopes → add the ones matching the APIs above:
   - `.../auth/gmail.readonly`, `.../auth/gmail.send`
   - `.../auth/drive.readonly`
   - `.../auth/calendar.readonly`
   - (`openid`, `email`, `profile` are added automatically.)
4. **Test users** → add your own Google address (and anyone else who will sign
   in) → Save.

Gmail read/send are **restricted/sensitive** scopes. In **Testing** mode they
work immediately for listed test users (no verification needed) — this is all
you need for personal use.

## 4. Create the OAuth client

**APIs & Services → Credentials → Create Credentials → OAuth client ID**

- **Application type: Desktop app** ← recommended.
  - Desktop clients allow the loopback redirect on **any port**, so no redirect
    URI needs to be registered. The app prefers port **3000** and falls back to
    a free port automatically.
- Click **Create** and copy the **Client ID** (a Desktop client secret is issued
  but is **not** treated as confidential with PKCE; you may leave the secret
  field blank in the app).

> **If you must use an "Web application" client instead**, add BOTH of these as
> **Authorized redirect URIs**, and keep port 3000 free:
> ```
> http://127.0.0.1:3000/callback
> http://localhost:3000/callback
> ```

## 5. Connect in AIHub Browser

1. Open **Settings → Google** (or **Mail → Connect Gmail**).
2. Paste the **Client ID** (and secret only if you created a Web client).
3. Click **Connect** → your system browser opens the Google consent screen →
   approve → the tab shows "Signed in" and closes → the app is connected.

Your **refresh token** is stored **encrypted at rest** via the OS keychain
(Windows DPAPI / macOS Keychain / Linux libsecret). No password is ever stored,
and access tokens live only in memory and auto-refresh.

---

## Going to Production (optional)

For distribution beyond test users, submit the app for **OAuth verification**
(**OAuth consent screen → Publish App**). Restricted Gmail scopes require Google
review (branding, privacy policy, and a security assessment for large user
bases). For personal or small-team use, **Testing** mode with listed test users
is sufficient and requires no review.

## Troubleshooting

- **"needs-reconnect" / silent sign-out** — the refresh token was revoked or
  expired (unused 6 months; **7 days in Testing mode**). Just Connect again.
- **`redirect_uri_mismatch`** — you created a *Web* client but didn't register
  the two loopback URIs above (or port 3000 was busy). Use a **Desktop** client
  to avoid this entirely.
- **`access_denied` / app not verified** — add your account under **Test users**
  on the consent screen.
- **"secure storage unavailable"** — the OS keychain isn't accessible (common on
  headless Linux); the app refuses to store tokens in plaintext by design.

---

## Architecture (for developers)

```
src/main/google/
  http.ts                  shared HTTP + form-encode helper
  index.ts                 registerGoogleIpc() — the only main-process entry
  ipc.ts                   google:* / drive:* / calendar:* + gmail:* (compat)
  auth/
    config.ts              endpoints, API bases, loopback callback, client
    scopes.ts              per-API scope registry  ← add new APIs here
    pkce.ts                RFC 7636 verifier/challenge + state
    callbackServer.ts      one-shot loopback HTTP server (127.0.0.1:3000)
    secureStore.ts         safeStorage-encrypted session (refresh token only)
    tokenManager.ts        access-token cache, refresh, revoke, invalid_grant
    authService.ts         orchestration: system browser → code → tokens
    index.ts               public surface
  apis/
    rest.ts                authenticated REST helper (bearer + 401 retry)
    gmail.ts               Gmail API
    drive.ts               Drive API
    calendar.ts            Calendar API
```

**Add a new Google API** (e.g. People):
1. `auth/scopes.ts` — add `'people'` to `GoogleApiId` + its scopes to `API_SCOPES`.
2. `auth/config.ts` — add the base URL to `API_BASES`.
3. `apis/people.ts` — new module using `apiRequest()` from `apis/rest.ts`.
4. `ipc.ts` — add `people:*` handlers; `preload/index.ts` — add a `people` bridge.

The renderer connects with `window.electronAPI.google.connect(['gmail','drive','calendar'])`;
scopes are incremental, so adding one later keeps the others (`include_granted_scopes`).
