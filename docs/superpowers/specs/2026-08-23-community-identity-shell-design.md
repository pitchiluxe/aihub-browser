# Community — Slice 1: Identity & Shell

**Date:** 2026-08-23
**Status:** Approved design, ready for implementation plan
**Slice:** 1 of 5 (see *Roadmap* at the end)

---

## Goal

Give AIHub Browser a Community section: rooms where users of the app meet and
talk. Slice 1 builds the foundation everything else stands on — an anonymous but
enforceable identity, the sidebar entry, the page shell, and the channel rail.

Slice 1 does **not** send or display messages. That is Slice 2.

## Why this is different from every feature shipped so far

Every existing AIHub feature is local. Bookmarks, Bible, Rewind, notes, history —
all on disk in `userData`, no server, no account, no ongoing cost. Community is
the first feature that requires a server the project owns and operates
continuously. That brings obligations the codebase has never had: uptime, a
hosting bill that scales with users, moderation, a DMCA contact, mandatory CSAM
reporting (US operators report to NCMEC), and GDPR deletion requests.

Those obligations are why moderation and legal surface are treated as shipping
requirements in Slice 4, not as polish.

## Scope

### In scope for Slice 1

- Ed25519 device keypair, generated and stored in the main process
- Registration against a Supabase Edge Function; server-issued member id
- Signed-request → short-lived JWT exchange, with refresh
- Handle picker and deterministic generated avatar
- Community guidelines acceptance gate
- Sidebar entry and `CommunityPage` with onboarding, connected, and error states
- Channel rail rendering channels from the server (Bible Study is the only
  active one)
- Reset-identity action in Settings

### Out of scope for Slice 1

- Sending, reading, or storing messages (Slice 2)
- Verse share, prayer wall, verse of the day (Slice 3)
- Reports, bans, admin panel, delete-my-data (Slice 4)
- Any channel other than Bible Study (Slice 5)
- File uploads or images — permanently out for v1, in every slice

### Release gate

Slice 1 is not released on its own. A build containing Community must also
contain Slice 2, or the sidebar entry leads to a room that cannot be used. Slice
1 is verified by tests and by manual run, not by shipping.

---

## Architecture

```
Renderer   components/pages/CommunityPage.tsx
           components/community/*                  UI only — never holds keys
     |
     |  IPC: window.electronAPI.community.*
     v
Main       src/main/community/identity.ts          keypair, signing, safeStorage
           src/main/community/authClient.ts        register, token, refresh
           src/main/community/handle.ts            validation and normalization
     |
     |  HTTPS
     v
Supabase   Edge Function community-register
           Edge Function community-token
           Postgres + row-level security
```

### Why the key lives in the main process

The renderer is the process that composes untrusted web content. A signing key
reachable from there is a signing key reachable by a page bug. The renderer asks
main to sign; main returns a token and never returns key material. This is the
same boundary the app already draws for provider API keys.

### Key storage

The private key is encrypted with Electron `safeStorage` (Windows DPAPI, macOS
Keychain, Linux libsecret) and written through the existing `jsonStore` helper to
`community-identity.json` in `userData`.

If `safeStorage.isEncryptionAvailable()` returns false — a real case on Linux
without a keyring — the key is written unencrypted with an `insecure: true`
marker, and the Community page shows a persistent banner saying the identity key
is not protected by the OS on this machine. Failing silently is not acceptable;
neither is refusing to run.

---

## Identity protocol

### Registration

`POST {SUPABASE_URL}/functions/v1/community-register`

```json
{
  "publicKey": "<base64 Ed25519 SPKI>",
  "handle": "<normalized handle>",
  "guidelinesVersion": 1,
  "timestamp": 1755950000,
  "nonce": "<base64 16 random bytes>",
  "signature": "<base64 signature over canonical payload>"
}
```

The signature covers a canonical JSON encoding of every field except
`signature`, with object keys sorted lexicographically. Canonicalization must be
a shared, tested function — a mismatch between client and server serialization is
the most likely source of a silent auth failure.

Response: `{ memberId, jwt, expiresAt, member }`.

### Token refresh

`POST {SUPABASE_URL}/functions/v1/community-token` with `{ memberId, timestamp,
nonce, signature }`. Returns a fresh JWT.

### Replay and skew defenses

- The function rejects a `timestamp` more than 120 seconds from server time.
- Each `nonce` is inserted into a `used_nonces` table with a unique constraint
  and a 5-minute TTL; a duplicate insert fails the request.
- JWT lifetime is 60 minutes. The client refreshes at 50 minutes, and also on any
  401 (once — a second 401 surfaces an error rather than looping).

### What the server can and cannot see

The server sees a public key, a handle, and a creation time. It never sees an
email, a name, or a machine identifier. Two installs by the same person are
unlinkable unless the person exports and imports the key.

---

## Data model (Slice 1 subset)

```
members
  id             uuid primary key
  public_key     text unique not null
  handle         text not null
  avatar_seed    text not null
  trust_level    int  not null default 0
  is_admin       bool not null default false
  banned_at      timestamptz
  ban_reason     text
  guidelines_version int not null
  created_at     timestamptz not null default now()

channels
  id             uuid primary key
  slug           text unique not null
  name           text not null
  description    text not null
  is_active      bool not null default true
  sort_order     int  not null default 0

used_nonces
  nonce          text primary key
  created_at     timestamptz not null default now()
```

`trust_level` is created here but enforced in Slice 2. Slice 1 writes the column
so the enforcement migration does not have to backfill.

### Row-level security

- `members`: a member may select their own row and the public columns (`id`,
  `handle`, `avatar_seed`, `trust_level`) of any non-banned member. A member may
  update only `handle` on their own row.
- `channels`: any authenticated member may select rows where `is_active`. No
  member may insert, update, or delete.
- `used_nonces`: no client access at all; the Edge Function uses the service
  role.

The service-role key exists only in Edge Function environment variables. It is
never present in the desktop app. The anon key is embedded in the app, which is
correct — it is public by design and useless without RLS-passing auth.

---

## Handles and avatars

**Validation** (shared function, used by client for instant feedback and by the
server as the actual gate):

- Unicode NFKC normalization first, then trim
- 3 to 24 characters after normalization
- Rejects control characters, zero-width characters, and bidirectional override
  characters — these are the standard impersonation tools
- Collapses internal whitespace runs to a single space
- Rejects a server-side profanity and impersonation list (`admin`, `moderator`,
  `aihub`, `support` and variants)

**Uniqueness is not required.** Two people may both be "Grace". They are
distinguished in the UI by a four-character suffix derived from the member id,
rendered in a dimmer color: `Grace·a3f1`. Requiring global uniqueness in a faith
community means telling people their own name is taken.

**Avatars** are generated, never uploaded: `avatarFor(memberId)` is a pure
function returning an SVG identicon derived from the id. Same id always yields
the same avatar. No image hosting, no image moderation, no upload surface.

---

## IPC surface

Exposed on `window.electronAPI.community`:

| method | returns | notes |
|---|---|---|
| `status()` | `{ state, member?, insecureKeyStorage, error? }` | `state` is one of `unregistered`, `ready`, `banned`, `error` |
| `register(handle)` | `{ member }` or throws | generates keypair on first call |
| `channels()` | `Channel[]` | authenticated read |
| `exportKey()` | `{ mnemonicOrBase64 }` | user-initiated only |
| `importKey(value)` | `{ member }` | replaces local identity |
| `resetIdentity()` | `void` | deletes local key, returns to `unregistered` |

`resetIdentity` deletes only the local key. It orphans the server-side member row
rather than deleting it — real server-side deletion is Slice 4, and the UI text
must say exactly that rather than implying data is erased.

---

## UI

### Sidebar

One new entry in `NAV_ITEMS` in `src/renderer/src/components/browser/Sidebar.tsx`:
`Users` icon, label `Community`, `page: 'community'`, accent `#34d399`.

The `pageType` union is written out in three places — the `Props` interface, the
`NavItem` interface, and `App.tsx`. All three need the new member. That
duplication is a small existing wart; this change extracts the union into a
single exported type in `src/shared/` and has all three import it, because
touching it three times by hand is exactly how the next page type gets missed.

### CommunityPage states

1. **Unregistered** — what Community is, the no-uploads rule stated plainly, the
   guidelines text, a required acceptance checkbox, a handle field with live
   validation, a live avatar preview, and a Join button.
2. **Ready** — channel rail on the left with Bible Study active, the member's
   handle and avatar at the bottom, and a main pane that says messages arrive in
   the next update. (This state exists only during development; Slice 2 fills the
   pane.)
3. **Banned** — the ban reason and an explanation. No composer, no rail.
4. **Error** — the specific failure and a retry button. Never a generic message.

---

## Error handling

Each of these is a distinct, specific message — not a shared "something went
wrong":

| Failure | Behavior |
|---|---|
| Network unreachable during register | Keep the generated key, leave `memberId` null, show a retry button. Retrying must not generate a second keypair. |
| Clock skew rejection | Tell the user their system clock is wrong and by roughly how much. Signature auth will keep failing until they fix it, so a generic error would strand them. |
| `safeStorage` unavailable | Register normally, show the persistent unprotected-key banner. |
| Handle rejected by server | Show the server's reason inline on the field. |
| Member banned | Switch to the banned state. |
| 401 after refresh | One retry, then the error state. No refresh loop. |
| Offline on page open when already registered | Show the rail from cache, marked offline. |

---

## Testing

Vitest, following the existing per-module `*.test.ts` convention in `src/main`:

- `identity.test.ts` — keypair generation, sign/verify round trip, verification
  fails on a tampered payload, canonical JSON is stable across key ordering
- `handle.test.ts` — length bounds, NFKC normalization, control and zero-width
  and bidi rejection, whitespace collapsing, reserved-name rejection
- `avatar.test.ts` — determinism for one id, difference across ids, valid SVG
- `authClient.test.ts` — refresh fires at the threshold, a 401 triggers exactly
  one re-token, skew rejection surfaces the clock message, a failed register
  leaves a reusable keypair

RLS policies are verified with SQL against a local Supabase instance. That
procedure is documented in the implementation plan; it is not a Vitest suite.

---

## Acceptance criteria

1. First open of Community shows onboarding; Join is disabled until the
   guidelines checkbox is ticked and the handle validates.
2. Joining produces a member on the server whose `public_key` matches the local
   key, and the page reaches the ready state.
3. Restarting the app returns to the ready state with no re-registration and no
   new keypair.
4. The private key never crosses IPC. Verified by inspecting the preload surface
   and by a test asserting that no IPC response contains the key.
5. Replaying a captured register or token request fails on the server.
6. A member row with `banned_at` set produces the banned state.
7. Exporting a key on one machine and importing it on another yields the same
   member id and handle.
8. `npm run typecheck` and `npm test` pass.

---

## Ongoing cost

Supabase's free tier covers early usage. Past it, this is a recurring monthly
bill that grows with the community and does not stop. That is accepted as part of
building this feature.

---

## Roadmap

| Slice | Contents |
|---|---|
| **1** | Identity and shell — this document |
| 2 | Messages, realtime, composer, trust-level rate limiting. Text only. |
| 3 | Verse share from the Bible reader, prayer wall with praying reactions, scheduled verse of the day |
| 4 | Reports, admin panel, bans, community guidelines page, delete-my-data |
| 5 | Additional channels, starting with Developers |

Each slice gets its own design document, implementation plan, and review cycle.

### Deliberately deferred

- **Scheduled prayer rooms.** Recurrence, timezones, and notifications make this
  its own project. Build it once people are reliably showing up.
- **A cybersecurity channel.** It draws the population most likely to probe a new
  server, and separating education from exploit is a moderation job nobody is staffed
  for.
- **File and image uploads.** Not deferred — excluded. Text-only removes the
  malware and illegal-image surface entirely, and that is the single most
  valuable safety property this design has.
