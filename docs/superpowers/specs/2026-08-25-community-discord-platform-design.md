# Community v2 — A Real Communication Workspace

**Date:** 2026-08-25
**Status:** Approved, in implementation
**Supersedes scope of:** `2026-08-23-community-identity-shell-design.md` (Slices 3–5)

---

## Goal

Turn the Community page from a single-column message board into a dedicated
communication workspace: categories and channels the owner manages, roles and
permissions enforced in the main process, threads and replies, uploads, search,
presence, moderation with an audit trail, and real voice/video/screen share.

## The constraint that shapes everything

**There is no server.** Community today is local: an Ed25519 device keypair, a
handle, and `community-data.json` in `userData`. Messages reach nobody else.
There is no authentication, no account system, no database, no WebSocket, and
no upload path.

Everything in this design is therefore built to one rule: *anything that can be
made genuinely functional on one machine is built and works; anything that
cannot is built against a named interface and says so in the UI.* No feature
ships as a button that does nothing.

What this buys us is not a demo. `store.ts` is already pure functions over a
state object — the previous author wrote it that way so the rules could become
row-level security policies later. This design keeps that property and adds a
transport seam, so the remote implementation is an addition rather than a
rewrite.

### What works on one machine

Channels and categories, owner-only channel management, roles and permissions,
message editing, replies, threads, reactions, mentions, unread state, typing
indicators, uploads, search, member profiles, notification preferences,
moderation, audit log, responsive layout, theming — and, because two
`BrowserWindow`s can complete a WebRTC handshake through a main-process relay,
**voice, video and screen share between windows.**

### What is gated on a backend

Cross-machine messaging, presence of other people, direct messages with other
people, and connectivity across NATs (no STUN/TURN configured). Each is built
against `CommunityTransport` / `SignalingChannel` and surfaces a named banner
rather than failing silently.

---

## Architecture

```
Renderer  components/community/**        shell, channels, chat, members, voice
          services/communityTransport.ts CommunityTransport (Local | Remote)
          services/voiceSession.ts       RTCPeerConnection mesh
Shared    shared/community.ts            model, permissions, constants
          shared/communityPermissions.ts pure permission resolution
          shared/communityMigrate.ts     v0 -> v1 state migration
Main      main/community/index.ts        IPC, authorization, broadcast
          main/community/store.ts        rules as pure functions
          main/community/ownership.ts    Google-verified owner binding
          main/community/attachments.ts  upload validation and storage
          main/community/signaling.ts    WebRTC relay between windows
          main/community/presence.ts     runtime presence and typing
```

---

## 1. Data model

`CommunityState` gains `schemaVersion` and:

| Collection | Shape | Purpose |
|---|---|---|
| `categories` | `Record<id, Category>` | `{ id, name, position }` |
| `channels` | `Record<slug, Channel>` | channels become **state**, not a constant |
| `roles` | `Record<id, Role>` | `{ id, name, color, position, permissions[] }` |
| `memberRoles` | `Record<memberId, roleId[]>` | assignment |
| `reads` | `Record<memberId, Record<slug, number>>` | unread + new-message divider |
| `notifPrefs` | `Record<memberId, Record<slug, NotifLevel>>` | per-channel preference |
| `auditLog` | `AuditEntry[]` | every administrative action |
| `ownership` | `{ memberId, email, verifiedAt } \| null` | the Community Owner |

`Channel` = the previous `ChannelDef` fields plus `categoryId`, `position`,
`type: 'text' | 'voice' | 'announcement'`, `topic`, `archivedAt?`, and
`overrides` (per-role permission grants and denials).

`Message` gains `editedAt`, `replyToId`, `threadRootId`, `mentions: string[]`,
`mentionsEveryone`, and `attachments: Attachment[]`. Every addition is optional
and read through a defaulting accessor, so an existing message needs no rewrite.

### Migration v0 → v1

Additive and non-destructive. On load, if `schemaVersion` is absent:

1. Seed `channels` from the existing `CHANNELS` constant, **keeping every slug
   byte-identical**, so every stored `message.channel` still resolves. This is
   the reason no existing channel is renamed.
2. Create categories and assign the seven existing channels; append the new
   channels (`general`, `announcements`, `ai`, `technology`, `cloud`,
   `networking`, `support`, `random`).
3. Create the `owner`, `moderator` and `member` roles. Any member with the
   legacy `isAdmin` flag becomes `moderator`. `isAdmin` is retained read-only so
   `canModerate` keeps answering correctly during the transition.
4. Leave `members`, `messages`, `blocks` and `reports` untouched.

Verified by a test that migrates a captured v0 fixture and asserts message
count, channel resolution, member identity and report state are unchanged.

---

## 2. Permissions

```ts
type Permission =
  | 'send_messages' | 'attach_files' | 'add_reactions' | 'mention_everyone'
  | 'use_voice' | 'use_video' | 'screen_share'
  | 'manage_messages' | 'manage_members' | 'manage_channels'
  | 'manage_roles' | 'view_audit_log'

permissionsFor(state, memberId, channelSlug?): Set<Permission>
```

Pure, in `shared/communityPermissions.ts`. The owner short-circuits to every
permission. Everyone else receives the union of their roles' permissions, then
the channel's `overrides` are applied (denials win over grants).

**Enforcement lives in the main process.** Every mutating IPC handler begins
with a permission check and returns `{ ok: false, error }` before touching
state. The renderer's checks decide only what to render. The explicit threat
model is a user opening DevTools and calling `window.api.community.*` directly;
a test does exactly that for every `manage_*` handler.

Default role permissions:

- **owner** — all.
- **moderator** — `manage_messages`, `manage_members`, `view_audit_log`, plus
  member permissions.
- **member** — `send_messages`, `attach_files`, `add_reactions`, `use_voice`,
  `use_video`, `screen_share`.

`mention_everyone` and `manage_channels` are owner-only by default.

---

## 3. Ownership

The Community Owner is the account whose **Google-verified** email normalises
to `erickomari243@gmail.com`.

`community:claimOwnership`:

1. Requires the existing Google auth service (`src/main/google/auth`), which
   already requests `openid email profile` and already implements
   `fetchEmail()`. If no OAuth client is configured, the handler returns a clear
   "Google sign-in is not configured" error — never a silent fallback.
2. Reads the verified address from the token exchange.
3. Normalises: trim, lowercase; for `gmail.com` and `googlemail.com` only, strip
   `.` and any `+tag` from the local part.
4. On match, binds `ownership` to the current community identity and grants the
   `owner` role.

Idempotent. A claim from a different identity while `ownership` is set is
refused. The email comes from Google's token response, not from a text field —
typing the address proves nothing.

Every administrative action writes an `AuditEntry` (actor, action, target type
and id, metadata, timestamp) inside the same state transaction as the change, so
an action cannot succeed unlogged.

---

## 4. Transport seam

```ts
interface CommunityTransport { send, edit, remove, react, typing, subscribe }
interface SignalingChannel   { join, leave, offer, answer, ice, subscribe }
```

`LocalTransport` wraps today's IPC and is the only implementation that ships.
`RemoteTransport` is a typed stub throwing `TransportUnavailable`, which the UI
renders as a named banner.

`SignalingChannel` is satisfied by a main-process relay between windows. WebRTC
does not specify its signaling channel — it needs only to move SDP offers,
answers and ICE candidates between peers, and `ipcMain` forwarding does that
completely. The peer connection cannot tell the difference. The honest limit is
NAT traversal: with no STUN/TURN configured this reaches loopback and usually a
LAN, and the settings pane exposes ICE server fields, empty by default.

---

## 5. Real-time events

One typed event bus, `community:event`, carrying a discriminated union:
`message.new`, `message.edit`, `message.delete`, `reaction`, `typing`,
`presence`, `channel.created|updated|deleted|reordered`, `voice.*`. The three
existing ad-hoc channels stay forwarded for one version.

- **Typing** — main-process map, 5s TTL, never persisted.
- **Presence** — runtime map keyed by window and member; heartbeat every 20s,
  TTL 45s; `online / idle / dnd / offline`, idle after 5 minutes without input.
  Not persisted, because presence that survives a restart is a lie.
- **Notifications** — per-channel `all | mentions | none`, default `mentions`;
  announcement channels default to `all`. Fires Electron's `Notification` when
  the window is unfocused, plus in-app unread badges.

---

## 6. Voice, video, screen share

`VoiceSessionManager` owns one `RTCPeerConnection` per peer (mesh; honest
ceiling around six participants) and speaks only to `SignalingChannel`.

- Speaking indicators from `AudioContext` + `AnalyserNode` RMS, thresholded and
  smoothed.
- Per-participant volume via an inbound `GainNode`.
- Deafen mutes all inbound and force-mutes outbound.
- Screen share via `desktopCapturer.getSources()` into a custom picker, wired
  through `session.setDisplayMediaRequestHandler` — Chrome's native picker is
  unavailable in Electron.
- Renegotiation on track add and remove, so enabling the camera mid-call does
  not drop audio.

Every permission failure (microphone, camera, screen) has its own UI state.

---

## 7. Uploads

The prior design banned uploads permanently, reasoning that no file ingress
means no malware surface and no image moderation to staff. That reasoning is
about *distribution*, and there is no distribution while the store is local, so
uploads are enabled now with the validation that makes re-tightening possible.

Main process only; the renderer never writes to disk.

- MIME sniffed from magic bytes, not the extension.
- Extension and MIME allowlist; 25 MB cap.
- Content-hash filename under `userData/community-files/`.
- Images re-encoded through `nativeImage`, discarding EXIF and anything that is
  not a decodable image.
- Served through a registered `aihub-community-file://` protocol scoped to that
  directory — no `file://` access, no path traversal.

If a remote transport is ever enabled, uploads re-gate pending a moderation
story.

---

## 8. Interface

Community remains the top-level page it already is (`pageType: 'community'`); a
Settings entry navigates to it, so "Settings → Community" works without a second
implementation.

Four columns: community rail, channel sidebar, chat, member list, plus a
persistent voice panel.

**Virtualization without a new dependency.** `MessageList` mounts a bounded
window of roughly 200 rows with measured spacers, reverse-infinite-scroll at 50
messages per page, and per-id height caching. Isolated behind `useMessageWindow`
so the strategy can change without touching `MessageRow`.

**Theming** through CSS custom properties on the shell root, respecting
`useTheme`. Default dark: deep slate and graphite with the teal-green accent the
Community sidebar entry already uses. An original palette, not Discord's.

**Responsive** — ≥1200px four columns; 900–1200px the member list collapses to a
toggle; <900px the sidebar becomes a drawer, the member list a sheet, and the
voice panel a compact bar that expands to a full-screen stage.

**Accessibility** — focus management in dialogs, ARIA roles on the message log
and member list, keyboard navigation between channels, and visible focus states.

---

## 9. Phases

| Phase | Contents | Verified by |
|---|---|---|
| 1 | Schema, migration, permission engine, ownership | Migration fixture; DevTools bypass test |
| 2 | Shell, categories, channels, owner channel CRUD | Existing channels and messages render unchanged |
| 3 | Edit, reply, threads, mentions, reactions, unread, typing | Two windows side by side |
| 4 | Uploads, search, profiles, members, presence, notifications | Unit plus manual |
| 5 | Voice, video, screen share | Two windows, real audio and video |
| 6 | Roles UI, moderation, audit log, responsive, performance | Full sweep |

## Non-goals

- Replacing the browser's authentication (there is none to replace).
- A generic "admin can do everything" role. Community ownership is its own
  model and does not grant anything outside Community.
- Copying Discord's branding, palette or assets.
