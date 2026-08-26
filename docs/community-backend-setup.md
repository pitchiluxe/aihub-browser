# Connecting the Community to a backend

Until you do this, **the Community tab is local to one computer.** Messages are
stored in `community-data.json` in your profile folder and seen only on that
machine; the member list shows one person because it is counting that machine's
own windows. This is why five devices each showed `ONLINE — 1`.

Ten minutes, once, and all five devices join the same room.

---

## 1. Create a Supabase project

Go to <https://supabase.com>, sign in, and create a new project. The free tier is
enough for a community of this size.

Note the **database password** when you set it — you will not need it for AIHub,
but you will want it later and Supabase shows it once.

Wait for the project to finish provisioning (a minute or two).

## 2. Run the schema

Open **SQL Editor** in the Supabase dashboard, paste the entire contents of
[`supabase/migrations/0001_community.sql`](../supabase/migrations/0001_community.sql),
and run it.

Expected result: `Success. No rows returned.`

The script is safe to re-run — every table is `create table if not exists` and
every policy is preceded by a `drop policy if exists`.

## 3. Turn on anonymous sign-ins

**Authentication → Providers → Anonymous → enable.**

This one is not optional and it is off by default on a new project.

AIHub signs in anonymously so that Postgres row level security has an
`auth.uid()` to work with. Without a session, every policy that asks "is this
your row?" compares against null, which Postgres treats as not-true, and **every
write is silently refused** — the app connects, reads succeed, and nothing you
send ever lands. If you skip this step AIHub will tell you so by name rather
than leaving you to discover it.

## 4. Copy the two values AIHub needs

**Settings → API**:

| Field in AIHub | Where it is in Supabase |
|---|---|
| Project URL | Settings → API → Project URL |
| Anon key | Settings → API → Project API keys → `anon` `public` |

Take the **anon public** key, not `service_role`. The service role key bypasses
row level security entirely; it must never go into a desktop app.

## 5. Get LiveKit, for voice and screen share

Voice, video and screen share go through a **LiveKit** media server — the same
arrangement the QuickBooks breakroom uses, and for the same reasons: one upload
per person instead of one per person *per other person*, and NAT traversal
handled by the server so there is no STUN or TURN to configure.

If you already have a LiveKit project, reuse it. AIHub names its rooms
`aihub:<channel>` where the breakroom names them `breakroom:<channel>`, so the
two cannot collide and one project can serve both.

Otherwise create one free at <https://cloud.livekit.io>.

You need three values, from **Project → Settings**:

| Field in AIHub | Where it is in LiveKit |
|---|---|
| LiveKit URL | Project URL — starts `wss://` |
| API key | Settings → Keys → key (starts `API…`) |
| API secret | Settings → Keys → secret |

The **secret never leaves the main process.** It signs an 8-hour join token
scoped to one room, and the token is what the page receives — the same split
the breakroom makes between its token route and its client.

Skipping LiveKit is allowed. Voice then falls back to direct device-to-device
connections, which reach the windows of this app and, with a STUN server, a
local network — but not reliably between machines. The dock says which is in
use.

## 6. Paste everything into AIHub

Community tab → the banner at the top says *"This community is on this computer
only"* → **Set up**. Paste the Supabase URL and anon key, the three LiveKit
values, and press **Connect**.

Leave the STUN/TURN list empty. It is only consulted by the fallback, and with
LiveKit configured it is ignored entirely.

## 7. Repeat on every device

Same project URL, same anon key, on all five machines.

The **first** device to connect seeds the room with whatever history it already
had locally. Every device after that finds those rows already present and adds
only what is genuinely new, so nobody's existing conversations are lost or
duplicated.

---

## Checking it worked

1. The banner at the top of the Community tab disappears. (A working connection
   gets no banner — a message that is always true is one nobody reads.)
2. The member list shows everyone who has joined, not just you.
3. A message posted on one machine appears on the others within a second.
4. Someone typing on one machine shows as typing on the others.
5. Two machines joining the same voice channel see each other in the roster.
6. One machine shares a screen; the other fills its window with it, with the
   people in a strip along the bottom.

---

## Which tables this creates

Every table is named `aihub_*` — `aihub_messages`, `aihub_members`,
`aihub_channels` and so on. That is deliberate: it means step 2 can be run
against a Supabase project that **already has another app in it** without any
chance of colliding with or altering that app's tables. Every statement is
`create ... if not exists`, and nothing in the script touches an object it did
not create.

## About the anon key

The anon key is a **public client credential.** It ships inside the app and any
user can read it out of their own configuration. That is normal and expected —
it is not a secret in the way a password is.

What protects the data is the row level security in step 2. Those policies are
the entire access control system, which is why the schema turns RLS on for every
table and why the policies must not be disabled. In particular:

- `post as self` is what makes the author of a message mean anything. Without
  it, anyone holding the anon key could post under any handle in the room.
- `is_moderator()` gates bans, channel management and the reports queue.
- The audit log has an insert policy and no update or delete policy, so an
  administrative action cannot be un-logged afterwards.

AIHub still stores your copy of the key encrypted with the operating system's
keychain. On a machine with no keychain available (some Linux setups) it says so
in the settings panel rather than pretending otherwise.

## Devices on different networks

With LiveKit configured, nothing to do. The media server relays every stream and
does its own traversal, so a device on mobile data joins the same room as one on
your desk.

Without LiveKit, calls fall back to direct peer-to-peer connections. Those work
on one network; off it they need a STUN server (`stun:stun.l.google.com:19302`)
and often a TURN relay, which costs money or must be self-hosted. Those fields
exist in the settings panel for that case, and are ignored when LiveKit is on.

## What is still per-device

Deliberately not shared, because it describes you rather than the room:

- Which channels you have read, and your unread counts
- Your per-channel notification preferences
- Your block list

## Known limitation: attachments

File attachments are stored on the machine that uploaded them and served over
`aihub-community-file://`. **A recipient on another device sees the message but
cannot open the file.** Moving attachments to Supabase Storage is a separate
piece of work and is not part of this setup.

Text, reactions, replies, threads, edits, moderation, voice, video and screen
share all work across devices.

## Disconnecting

**Set up → Disconnect** returns that device to local-only. It does not delete
anything from Supabase, and reconnecting picks the room back up.
