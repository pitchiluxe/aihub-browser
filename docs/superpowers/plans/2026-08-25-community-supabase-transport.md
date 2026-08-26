# Community Cross-Device Transport + Discord Stage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Community tab a real multi-device community — every device sees every member, every message, every typing indicator and every voice/screen-share participant — and give video and screen share a Discord-shaped stage that fills the window instead of a squashed strip at the bottom.

**Architecture:** Keep `store.ts`'s pure rule functions and the entire existing IPC surface exactly as they are. Add a **replication layer** in the main process: every mutation that succeeds locally is also written to Supabase, and a Realtime subscription folds remote rows back into the same local `CommunityState` before firing the same `broadcast()` the renderer already listens to. The local JSON file becomes a warm replica rather than the source of truth. Presence, typing and WebRTC signaling move onto Supabase Realtime channels, which makes them cross-device without the peer-connection code changing at all.

**Tech Stack:** Electron 34 (main process), `@supabase/supabase-js` v2 (Postgres + Realtime + anonymous Auth), React 18 + TypeScript + Tailwind (renderer), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-25-community-discord-platform-design.md` — specifically §4 "Transport seam", which named `CommunityTransport` / `SignalingChannel` and was never implemented. This plan implements that seam for real.

## Global Constraints

- **Supabase client runs in the MAIN process only.** The renderer never sees the URL, the anon key, or a JWT. One connection per device, not one per window. This preserves the existing threat model: the renderer's opinion about who may post is not consulted.
- **The existing IPC channel names do not change.** `community:status`, `community:post`, `community:event`, `community:voice:*` etc. keep their names and payload shapes. The renderer is modified only where the plan explicitly says so.
- **`store.ts` stays pure.** No network calls, no `await`, no Supabase import. It remains functions over a state object.
- **Offline must still work.** If Supabase is unconfigured or unreachable, every existing local behaviour continues unchanged and `status().network` reports `'local'`. No feature becomes a dead button.
- **Credentials at rest are encrypted with `safeStorage`**, in `userData/community-backend.json`, same pattern as `community-identity.json`. Never logged, never returned across IPC.
- **Peer ids must be globally unique.** Today `peerId = String(e.sender.id)` — a `webContents` id, unique only within one process. Across five devices these collide. Peer ids become `${deviceId}:${webContentsId}`.
- **All five target devices are on one LAN**, so `iceServers` may stay empty for host-candidate connection. A configurable STUN/TURN field is added anyway so a device off the LAN is a settings change, not a code change.
- Run `npm test` and `npm run typecheck` before every commit. Both must pass.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `src/main/community/backendConfig.ts` | Read/write/validate the encrypted Supabase credentials. No network. |
| `src/main/community/remote.ts` | Owns the Supabase client, anonymous auth, connection lifecycle and status. Nothing about community semantics. |
| `src/main/community/sync.ts` | Maps `CommunityState` collections ⇄ Postgres rows. Pure mapping functions, no client. |
| `src/main/community/replication.ts` | The engine: push local mutations up, fold remote changes down, then `broadcast()`. |
| `src/main/community/remotePresence.ts` | Realtime Presence + typing broadcast, merged with the local tracker. |
| `src/main/community/remoteSignaling.ts` | Realtime broadcast relay for WebRTC offers/answers/ICE across devices. |
| `supabase/migrations/0001_community.sql` | Tables, indexes, RLS policies, realtime publication. |
| `src/renderer/src/components/community/VoiceStage.tsx` | The Discord-shaped stage, extracted from `VoiceDock.tsx`. |
| `src/renderer/src/components/community/BackendPanel.tsx` | Settings UI for URL + anon key + ICE servers, and connection state. |

**Modify:**

| File | Change |
|---|---|
| `src/renderer/src/components/community/VoiceDock.tsx` | Loses `VoiceStage` and `Tile`; keeps only the control bar. |
| `src/renderer/src/components/community/CommunityShell.tsx:427` | Mounts `VoiceStage` in the main content column, `VoiceDock` stays in `.cm-dock`. |
| `src/renderer/src/components/community/useVoiceSession.ts:41` | `ICE_SERVERS` read from config instead of a hardcoded `[]`. |
| `src/main/community/index.ts` | `currentStatus()` gains `network: 'local' \| 'connecting' \| 'remote'`; mutating handlers call `replication.push()`; voice handlers use composite peer ids. |
| `src/main/community/signaling.ts` | `send` gains a remote fan-out path; peer id type documented as composite. |
| `src/preload/index.ts` | Adds `community.backend.*` and `community.onBackendStatus`. |
| `package.json` | Adds `@supabase/supabase-js`. |

---

## Task 1: Discord-shaped video stage

Independent of everything else. Ships on its own and fixes the "shows weirdly" complaint immediately.

**The defect:** `CommunityShell.tsx:427` mounts `<VoiceDock>` — which internally renders the whole `VoiceStage` — inside `.cm-dock`, below the composer. `VoiceDock.tsx`'s `Tile` then uses `height: large ? 340 : small ? 72 : 150`, fixed pixels. Result: a short strip pinned under the chat, with a 340px "large" tile regardless of window size.

**The target:** stage occupies the main content column, replacing the message list while video is live. The focused tile (screen share by default) fills all remaining vertical space; the other participants sit in a horizontal filmstrip along the bottom of the stage; the control dock stays where it is.

**Files:**
- Create: `src/renderer/src/components/community/VoiceStage.tsx`
- Create: `src/renderer/src/components/community/VoiceStage.test.tsx`
- Modify: `src/renderer/src/components/community/VoiceDock.tsx` (delete `VoiceStage` + `Tile`, delete the `anyVideo` branch, drop the now-unused stream props)
- Modify: `src/renderer/src/components/community/CommunityShell.tsx:427`

**Interfaces:**
- Consumes: `VoicePeer`, `VoiceError` from `./useVoiceSession`; `CommunityMember` from `./useCommunity`.
- Produces:
```ts
export interface VoiceStageProps {
  peers: VoicePeer[]
  selfPeerId: string
  memberById: Map<string, CommunityMember>
  remoteStreams: Record<string, MediaStream>
  localVideoStream: MediaStream | null
  screenShareStream: MediaStream | null
  speaking: Record<string, boolean>
}
export default function VoiceStage(props: VoiceStageProps): JSX.Element
/** True when any peer has camera or screen share on — the caller uses this to
 *  decide whether to render the stage instead of the message list. */
export function stageIsLive(peers: VoicePeer[]): boolean
```

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/components/community/VoiceStage.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { stageIsLive, pickFocus } from './VoiceStage'
import type { VoicePeer } from './useVoiceSession'

const peer = (over: Partial<VoicePeer>): VoicePeer => ({
  peerId: 'p1', memberId: 'm1', channel: 'voice',
  muted: false, deafened: false, camera: false, sharing: false, ...over,
})

describe('stageIsLive', () => {
  it('is false when nobody has camera or share on', () => {
    expect(stageIsLive([peer({}), peer({ peerId: 'p2' })])).toBe(false)
  })
  it('is true when someone has a camera on', () => {
    expect(stageIsLive([peer({}), peer({ peerId: 'p2', camera: true })])).toBe(true)
  })
  it('is true when someone is sharing a screen', () => {
    expect(stageIsLive([peer({ sharing: true })])).toBe(true)
  })
})

describe('pickFocus', () => {
  it('prefers a screen share over a camera', () => {
    const peers = [peer({ peerId: 'cam', camera: true }), peer({ peerId: 'screen', sharing: true })]
    expect(pickFocus(peers, null)).toBe('screen')
  })
  it('prefers the earliest sharer when two people share', () => {
    const peers = [peer({ peerId: 'a', sharing: true }), peer({ peerId: 'b', sharing: true })]
    expect(pickFocus(peers, null)).toBe('a')
  })
  it('honours an explicit choice over the sharer', () => {
    const peers = [peer({ peerId: 'a', sharing: true }), peer({ peerId: 'b', camera: true })]
    expect(pickFocus(peers, 'b')).toBe('b')
  })
  it('falls back to the sharer when the chosen peer has left', () => {
    const peers = [peer({ peerId: 'a', sharing: true })]
    expect(pickFocus(peers, 'gone')).toBe('a')
  })
  it('falls back to the first camera when nobody is sharing', () => {
    const peers = [peer({ peerId: 'a' }), peer({ peerId: 'b', camera: true })]
    expect(pickFocus(peers, null)).toBe('b')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/community/VoiceStage.test.tsx`
Expected: FAIL — `Failed to resolve import "./VoiceStage"`.

- [ ] **Step 3: Write `VoiceStage.tsx`**

Create `src/renderer/src/components/community/VoiceStage.tsx`. The two exported helpers are the tested logic; the component is layout.

```tsx
import React, { useEffect, useRef, useState } from 'react'
import { MicOff, MonitorUp, Grid2x2, Maximize2 } from 'lucide-react'
import { Avatar } from './bits'
import type { CommunityMember } from './useCommunity'
import type { VoicePeer } from './useVoiceSession'

/**
 * The stage: what everyone came to look at.
 *
 * Discord's shape, and it is the right one. The thing being watched — a shared
 * screen, or whoever is on camera — takes every pixel of height that is going,
 * and the rest of the room runs along the bottom in a filmstrip that never
 * competes with it. The previous version rendered this into the bottom dock at
 * a fixed 340px, which meant a shared screen arrived smaller than the chat it
 * was interrupting.
 *
 * Nothing here is sized in pixels. The focus tile is `flex-1 min-h-0` inside a
 * column, so it grows to the window; the filmstrip is a fixed-basis row that
 * scrolls sideways once there are more people than fit.
 */

export interface VoiceStageProps {
  peers: VoicePeer[]
  selfPeerId: string
  memberById: Map<string, CommunityMember>
  remoteStreams: Record<string, MediaStream>
  localVideoStream: MediaStream | null
  screenShareStream: MediaStream | null
  speaking: Record<string, boolean>
}

/** Is there anything worth showing? No camera and no share means no stage —
 *  a grid of five avatars is exactly the member list, one column over. */
export function stageIsLive(peers: VoicePeer[]): boolean {
  return peers.some(p => p.camera || p.sharing)
}

/**
 * Which tile belongs in the big slot.
 *
 * An explicit click wins, but only while that peer is still in the room —
 * otherwise someone leaving would leave the stage focused on nothing. After
 * that, a screen share beats a camera, because a share is a deliberate "look
 * at this" and a camera is just a face. Ties go to the earliest in roster
 * order, which is join order, so the stage does not flip between two sharers
 * every time the roster re-announces.
 */
export function pickFocus(peers: VoicePeer[], chosen: string | null): string | null {
  if (chosen && peers.some(p => p.peerId === chosen)) return chosen
  return peers.find(p => p.sharing)?.peerId
    ?? peers.find(p => p.camera)?.peerId
    ?? peers[0]?.peerId
    ?? null
}

export default function VoiceStage(props: VoiceStageProps) {
  const {
    peers, selfPeerId, memberById, remoteStreams,
    localVideoStream, screenShareStream, speaking,
  } = props

  const [chosen, setChosen] = useState<string | null>(null)
  const [grid, setGrid] = useState(false)

  const focusId = pickFocus(peers, chosen)

  const streamFor = (peer: VoicePeer): MediaStream | null => {
    if (peer.peerId !== selfPeerId) return remoteStreams[peer.peerId] ?? null
    // Your own two streams are separate objects; the share is the one that
    // matters when both are running.
    return peer.sharing ? screenShareStream : localVideoStream
  }

  const tiles = peers.map(peer => ({
    peer,
    stream: streamFor(peer),
    isSelf: peer.peerId === selfPeerId,
    isSpeaking: !!speaking[peer.peerId === selfPeerId ? 'self' : peer.peerId],
  }))

  const focus = tiles.find(t => t.peer.peerId === focusId) ?? null
  const strip = tiles.filter(t => t.peer.peerId !== focusId)
  const sharer = peers.find(p => p.sharing)

  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-2 p-3"
      style={{ background: 'var(--cm-void)' }}
      aria-label="Video stage"
    >
      <header className="flex shrink-0 items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--cm-dim)' }}>
          {sharer && <MonitorUp className="h-3.5 w-3.5" style={{ color: 'var(--cm-accent)' }} />}
          {sharer
            ? `${memberById.get(sharer.memberId)?.handle ?? 'Someone'} is sharing a screen`
            : 'Video'}
        </p>
        <button
          onClick={() => setGrid(g => !g)}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-[var(--cm-hover)]"
          style={{ color: 'var(--cm-dim)' }}
          aria-pressed={grid}
        >
          {grid
            ? <><Maximize2 className="h-3.5 w-3.5" /> Focus</>
            : <><Grid2x2 className="h-3.5 w-3.5" /> Grid</>}
        </button>
      </header>

      {grid ? (
        <div
          className="grid min-h-0 flex-1 auto-rows-fr gap-2 overflow-y-auto"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
        >
          {tiles.map(tile => (
            <Tile key={tile.peer.peerId} {...tile} memberById={memberById}
                  onClick={() => { setChosen(tile.peer.peerId); setGrid(false) }} />
          ))}
        </div>
      ) : (
        <>
          {/* The whole point: min-h-0 + flex-1 means the shared screen takes
              every pixel the window can spare, and shrinks rather than
              pushing the filmstrip off the bottom. */}
          <div className="min-h-0 flex-1">
            {focus && <Tile {...focus} memberById={memberById} focus />}
          </div>

          {strip.length > 0 && (
            <ul className="flex shrink-0 gap-2 overflow-x-auto pb-0.5" style={{ height: 108 }}>
              {strip.map(tile => (
                <li key={tile.peer.peerId} className="h-full shrink-0" style={{ width: 176 }}>
                  <Tile {...tile} memberById={memberById} onClick={() => setChosen(tile.peer.peerId)} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

function Tile({
  peer, stream, isSelf, isSpeaking, memberById, focus, onClick,
}: {
  peer: VoicePeer
  stream: MediaStream | null
  isSelf: boolean
  isSpeaking: boolean
  memberById: Map<string, CommunityMember>
  focus?: boolean
  onClick?: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const member = memberById.get(peer.memberId)
  const live = !!stream && (peer.camera || peer.sharing)

  useEffect(() => {
    if (video.current && stream) video.current.srcObject = stream
  }, [stream])

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? e => { if (e.key === 'Enter' || e.key === ' ') onClick() } : undefined}
      title={onClick ? `Focus ${member?.handle ?? 'this person'}` : undefined}
      className={`relative h-full w-full overflow-hidden rounded-xl ${isSpeaking ? 'cm-speaking' : ''} ${onClick ? 'cursor-pointer' : ''}`}
      style={{
        background: '#000',
        border: `1px solid ${isSpeaking ? 'var(--cm-accent)' : 'var(--cm-line)'}`,
      }}
    >
      {live ? (
        <video
          ref={video}
          autoPlay
          playsInline
          // Never play your own audio back: that is feedback, and it is loud.
          muted={isSelf}
          className="h-full w-full"
          // A shared screen must never be cropped — `contain` keeps the whole
          // desktop visible, letterboxed. A face may be cropped; `cover` fills
          // the tile so a row of cameras reads as one strip.
          style={{ objectFit: peer.sharing ? 'contain' : 'cover' }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center" style={{ background: 'var(--cm-void)' }}>
          <Avatar seed={member?.avatarSeed ?? peer.memberId} size={focus ? 96 : 40} />
        </div>
      )}

      <p className="absolute bottom-1.5 left-2 flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]"
         style={{ background: 'rgb(0 0 0 / .55)', color: '#fff' }}>
        {peer.muted && <MicOff className="h-3 w-3" />}
        {member?.handle ?? 'Member'}{isSelf ? ' (you)' : ''}
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/community/VoiceStage.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Strip the stage out of `VoiceDock.tsx`**

In `src/renderer/src/components/community/VoiceDock.tsx`:
1. Delete the `VoiceStage` function and the `Tile` function entirely (everything from `// ── The stage ──` to end of file).
2. Delete the `const [focused, setFocused] = useState<string | null>(null)` line and the `const anyVideo = ...` line.
3. Delete the `{anyVideo && (<VoiceStage ... />)}` block from the returned JSX.
4. Remove `remoteStreams`, `localVideoStream`, `screenShareStream` from `interface Props` and from the destructuring — the dock no longer touches streams.
5. Remove `Grid2x2` and `Maximize2` from the `lucide-react` import.
6. Update the component's doc comment's first line to: `The voice control dock. The stage it used to own now lives in VoiceStage.tsx, mounted in the main column so a shared screen gets the window rather than a 340px strip under the chat.`

- [ ] **Step 6: Mount the stage in the main column**

In `src/renderer/src/components/community/CommunityShell.tsx`:

1. Add to imports, next to `import VoiceDock from './VoiceDock'`:
```tsx
import VoiceStage, { stageIsLive } from './VoiceStage'
```

2. Add above the returned JSX, next to the other derived values:
```tsx
// While anyone in this room has a camera or a screen on, the stage replaces
// the message list. The chat is one click away on the channel spine, and a
// shared screen sharing the column with a transcript serves neither.
const stageLive = !!voice.channel && stageIsLive(voice.peers)
```

3. Find the main content column that renders `<MessageList ... />` and `<Composer ... />`. Wrap the message list so the stage takes its place:
```tsx
{stageLive ? (
  <VoiceStage
    peers={voice.peers}
    selfPeerId={voice.peerId}
    memberById={memberById}
    remoteStreams={voice.remoteStreams}
    localVideoStream={voice.localVideoStream}
    screenShareStream={voice.screenShareStream}
    speaking={voice.speaking}
  />
) : (
  <MessageList {...existingMessageListProps} />
)}
```
Keep `<Composer>` mounted in both branches — being able to type while watching a screen share is the point of having both.

4. At line 427, delete the three now-removed props from the `<VoiceDock>` call: `remoteStreams`, `localVideoStream`, `screenShareStream`.

- [ ] **Step 7: Verify the column can actually shrink**

The stage only fills the window if every ancestor allows it. Confirm the main column's classes include `min-h-0` and `flex-1` — a `flex-1` child inside a flex parent without `min-h-0` refuses to shrink below its content and the stage will overflow instead of fitting.

Run: `npm run typecheck`
Expected: PASS, no errors.

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/community/VoiceStage.tsx src/renderer/src/components/community/VoiceStage.test.tsx src/renderer/src/components/community/VoiceDock.tsx src/renderer/src/components/community/CommunityShell.tsx
git commit -m "fix(community): give video and screen share the window, not a strip"
```

---

## Task 2: Backend credentials, stored encrypted

**Files:**
- Create: `src/main/community/backendConfig.ts`
- Create: `src/main/community/backendConfig.test.ts`
- Modify: `package.json` (add `@supabase/supabase-js`)

**Interfaces:**
- Produces:
```ts
export interface BackendConfig {
  url: string
  anonKey: string
  /** Empty on a LAN. Each entry is a full RTCIceServer JSON object. */
  iceServers: RTCIceServerConfig[]
}
export interface RTCIceServerConfig {
  urls: string | string[]
  username?: string
  credential?: string
}
export type ConfigResult = { ok: true; config: BackendConfig } | { ok: false; error: string }

export function validateBackendConfig(input: unknown): ConfigResult
export function loadBackendConfig(safeStorage: SafeStorageLike, raw: string | null): BackendConfig | null
export function sealBackendConfig(safeStorage: SafeStorageLike, config: BackendConfig): { value: string; insecure: boolean }
```

- [ ] **Step 1: Write the failing test**

Create `src/main/community/backendConfig.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateBackendConfig, sealBackendConfig, loadBackendConfig } from './backendConfig'

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(`enc:${s}`),
  decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ''),
}

describe('validateBackendConfig', () => {
  it('accepts a well-formed https project url and key', () => {
    const out = validateBackendConfig({ url: 'https://abc.supabase.co', anonKey: 'ey.k.v', iceServers: [] })
    expect(out.ok).toBe(true)
  })
  it('rejects a url that is not https', () => {
    const out = validateBackendConfig({ url: 'http://abc.supabase.co', anonKey: 'ey.k.v' })
    expect(out).toEqual({ ok: false, error: 'The project URL must start with https://.' })
  })
  it('rejects a missing key rather than connecting anonymously', () => {
    const out = validateBackendConfig({ url: 'https://abc.supabase.co', anonKey: '  ' })
    expect(out).toEqual({ ok: false, error: 'The anon key is required.' })
  })
  it('trims a trailing slash so row URLs do not double up', () => {
    const out = validateBackendConfig({ url: 'https://abc.supabase.co/', anonKey: 'k' })
    expect(out.ok && out.config.url).toBe('https://abc.supabase.co')
  })
  it('rejects an ice server entry with no urls', () => {
    const out = validateBackendConfig({ url: 'https://a.supabase.co', anonKey: 'k', iceServers: [{}] })
    expect(out).toEqual({ ok: false, error: 'Every ICE server needs a urls value.' })
  })
})

describe('seal and load', () => {
  it('round-trips a config through encryption', () => {
    const config = { url: 'https://abc.supabase.co', anonKey: 'secret', iceServers: [] }
    const sealed = sealBackendConfig(fakeSafeStorage as any, config)
    expect(sealed.value).not.toContain('secret')
    expect(loadBackendConfig(fakeSafeStorage as any, sealed.value)).toEqual(config)
  })
  it('returns null for a null blob rather than throwing', () => {
    expect(loadBackendConfig(fakeSafeStorage as any, null)).toBe(null)
  })
  it('returns null when the OS can no longer decrypt it', () => {
    const broken = { ...fakeSafeStorage, decryptString: () => { throw new Error('keychain reset') } }
    expect(loadBackendConfig(broken as any, 'anything')).toBe(null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/community/backendConfig.test.ts`
Expected: FAIL — `Failed to resolve import "./backendConfig"`.

- [ ] **Step 3: Implement `backendConfig.ts`**

```ts
/**
 * Where the community lives, and the key that opens the door.
 *
 * Sealed with `safeStorage` and written beside the identity file, for the same
 * reason the identity is: an anon key in plaintext on disk is an anon key in
 * every backup, every sync folder and every support screenshot. `insecure` is
 * reported rather than hidden — on a Linux box with no keyring the encryption
 * is a no-op, and the user is entitled to know that before they paste a key.
 *
 * Validation lives here, away from the client, so a bad URL produces a
 * sentence next to the field instead of a failed connection thirty seconds
 * later with a stack trace in the console.
 */

export interface RTCIceServerConfig {
  urls: string | string[]
  username?: string
  credential?: string
}

export interface BackendConfig {
  url: string
  anonKey: string
  iceServers: RTCIceServerConfig[]
}

export type ConfigResult =
  | { ok: true; config: BackendConfig }
  | { ok: false; error: string }

interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(sealed: Buffer): string
}

export function validateBackendConfig(input: unknown): ConfigResult {
  const raw = (input ?? {}) as Partial<BackendConfig>

  const url = String(raw.url ?? '').trim().replace(/\/+$/, '')
  if (!url) return { ok: false, error: 'The project URL is required.' }
  if (!url.startsWith('https://')) return { ok: false, error: 'The project URL must start with https://.' }

  const anonKey = String(raw.anonKey ?? '').trim()
  if (!anonKey) return { ok: false, error: 'The anon key is required.' }

  const iceServers: RTCIceServerConfig[] = []
  for (const entry of Array.isArray(raw.iceServers) ? raw.iceServers : []) {
    const urls = (entry as RTCIceServerConfig)?.urls
    const filled = Array.isArray(urls) ? urls.filter(Boolean) : String(urls ?? '').trim()
    if (!filled || (Array.isArray(filled) && filled.length === 0)) {
      return { ok: false, error: 'Every ICE server needs a urls value.' }
    }
    const server: RTCIceServerConfig = { urls: filled }
    if ((entry as RTCIceServerConfig).username) server.username = String((entry as RTCIceServerConfig).username)
    if ((entry as RTCIceServerConfig).credential) server.credential = String((entry as RTCIceServerConfig).credential)
    iceServers.push(server)
  }

  return { ok: true, config: { url, anonKey, iceServers } }
}

export function sealBackendConfig(
  safeStorage: SafeStorageLike, config: BackendConfig,
): { value: string; insecure: boolean } {
  const plain = JSON.stringify(config)
  if (!safeStorage.isEncryptionAvailable()) {
    return { value: `plain:${plain}`, insecure: true }
  }
  return { value: safeStorage.encryptString(plain).toString('base64'), insecure: false }
}

export function loadBackendConfig(
  safeStorage: SafeStorageLike, raw: string | null,
): BackendConfig | null {
  if (!raw) return null
  try {
    const plain = raw.startsWith('plain:')
      ? raw.slice('plain:'.length)
      : safeStorage.decryptString(Buffer.from(raw, 'base64'))
    const parsed = validateBackendConfig(JSON.parse(plain))
    return parsed.ok ? parsed.config : null
  } catch {
    // A blob the OS can no longer decrypt is gone. Returning null drops the
    // app back to local mode, which is a working state; throwing here would
    // take the whole Community tab down over a keychain reset.
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/community/backendConfig.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Add the dependency**

```bash
npm install @supabase/supabase-js
```

Then confirm it resolves in the Node/main tsconfig:

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/main/community/backendConfig.ts src/main/community/backendConfig.test.ts
git commit -m "feat(community): encrypted backend credentials"
```

---

## Task 3: The Postgres schema

**Files:**
- Create: `supabase/migrations/0001_community.sql`
- Create: `docs/community-backend-setup.md`

**Interfaces:**
- Produces: table and column names consumed by `sync.ts` in Task 4. Exact names: `members(id, handle, handle_key, avatar_seed, public_key, created_at, is_admin, banned_at, auth_uid)`, `channels(slug, name, category_id, position, type, topic, accent, archived_at, overrides)`, `categories(id, name, position)`, `roles(id, name, color, position, permissions)`, `member_roles(member_id, role_id)`, `messages(id, channel, author_id, author_handle, body, kind, created_at, edited_at, reply_to_id, thread_root_id, mentions, mentions_everyone, attachments, reactions, hidden)`, `reports(id, message_id, reporter_id, reason, created_at, resolved_at, resolution)`, `audit_log(id, actor_id, action, target_type, target_id, metadata, created_at)`, `ownership(id, member_id, email, verified_at)`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0001_community.sql`:

```sql
-- AIHub Community — the shared room.
--
-- Column names are snake_case here and camelCase in CommunityState; sync.ts
-- owns that translation in one place so neither side has to compromise.
--
-- Every table is readable by any signed-in device and writable only where a
-- rule in store.ts already says so. The rules that could not be expressed as a
-- policy (cooldowns, established-member checks) stay in the main process; the
-- policies below cover the ones an attacker with the anon key could otherwise
-- drive directly — impersonating another author, editing someone else's
-- message, banning people.

create extension if not exists "pgcrypto";

-- ── Members ────────────────────────────────────────────────────────────────
-- auth_uid binds a member row to an anonymous Supabase session. It is what
-- makes "is this my row" answerable inside a policy.
create table if not exists public.members (
  id          uuid primary key,
  auth_uid    uuid not null default auth.uid(),
  handle      text not null,
  handle_key  text not null unique,
  avatar_seed text not null,
  public_key  text,
  is_admin    boolean not null default false,
  banned_at   bigint,
  created_at  bigint not null
);

create table if not exists public.categories (
  id       uuid primary key,
  name     text not null,
  position integer not null default 0
);

create table if not exists public.channels (
  slug        text primary key,
  name        text not null,
  category_id uuid references public.categories(id) on delete set null,
  position    integer not null default 0,
  type        text not null default 'text',
  topic       text,
  accent      text,
  archived_at bigint,
  overrides   jsonb not null default '{}'::jsonb
);

create table if not exists public.roles (
  id          uuid primary key,
  name        text not null,
  color       text,
  position    integer not null default 0,
  permissions jsonb not null default '[]'::jsonb
);

create table if not exists public.member_roles (
  member_id uuid not null references public.members(id) on delete cascade,
  role_id   uuid not null references public.roles(id) on delete cascade,
  primary key (member_id, role_id)
);

-- ── Messages ───────────────────────────────────────────────────────────────
create table if not exists public.messages (
  id                uuid primary key,
  channel           text not null,
  author_id         uuid not null references public.members(id) on delete cascade,
  author_handle     text not null,
  body              text not null default '',
  kind              text not null default 'text',
  created_at        bigint not null,
  edited_at         bigint,
  reply_to_id       uuid,
  thread_root_id    uuid,
  mentions          jsonb not null default '[]'::jsonb,
  mentions_everyone boolean not null default false,
  attachments       jsonb not null default '[]'::jsonb,
  reactions         jsonb not null default '{}'::jsonb,
  hidden            boolean not null default false
);

-- The one query the chat makes constantly: the tail of a channel, newest last.
create index if not exists messages_channel_created_idx
  on public.messages (channel, created_at desc);
create index if not exists messages_thread_idx
  on public.messages (thread_root_id) where thread_root_id is not null;

create table if not exists public.reports (
  id          uuid primary key,
  message_id  uuid not null references public.messages(id) on delete cascade,
  reporter_id uuid not null references public.members(id) on delete cascade,
  reason      text not null,
  created_at  bigint not null,
  resolved_at bigint,
  resolution  text
);

create table if not exists public.audit_log (
  id          uuid primary key,
  actor_id    uuid,
  action      text not null,
  target_type text,
  target_id   text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  bigint not null
);

-- Exactly one owner, enforced by the primary key rather than by convention.
create table if not exists public.ownership (
  id          boolean primary key default true check (id),
  member_id   uuid references public.members(id) on delete set null,
  email       text,
  verified_at bigint
);

-- ── Row level security ─────────────────────────────────────────────────────
alter table public.members      enable row level security;
alter table public.categories   enable row level security;
alter table public.channels     enable row level security;
alter table public.roles        enable row level security;
alter table public.member_roles enable row level security;
alter table public.messages     enable row level security;
alter table public.reports      enable row level security;
alter table public.audit_log    enable row level security;
alter table public.ownership    enable row level security;

-- Is this authenticated session a moderator? Used by several policies, so it
-- is a function rather than the same subquery copied nine times.
create or replace function public.is_moderator() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members m
    left join public.member_roles mr on mr.member_id = m.id
    left join public.roles r on r.id = mr.role_id
    where m.auth_uid = auth.uid()
      and (m.is_admin or r.permissions ? 'manage_messages')
  );
$$;

-- Everyone signed in can read the room. This is a community, not a mailbox.
create policy "read members"      on public.members      for select to authenticated using (true);
create policy "read categories"   on public.categories   for select to authenticated using (true);
create policy "read channels"     on public.channels     for select to authenticated using (true);
create policy "read roles"        on public.roles        for select to authenticated using (true);
create policy "read member_roles" on public.member_roles for select to authenticated using (true);
create policy "read messages"     on public.messages     for select to authenticated using (true);
create policy "read ownership"    on public.ownership    for select to authenticated using (true);

-- A device claims exactly one member row, its own.
create policy "claim own member" on public.members
  for insert to authenticated with check (auth_uid = auth.uid());
create policy "edit own member" on public.members
  for update to authenticated using (auth_uid = auth.uid()) with check (auth_uid = auth.uid());
-- Bans are somebody else changing your row, so moderators get their own policy.
create policy "moderate members" on public.members
  for update to authenticated using (public.is_moderator());

-- You may only post as yourself. This is the policy that makes author_id mean
-- something: without it, the anon key is a licence to speak in anyone's name.
create policy "post as self" on public.messages
  for insert to authenticated with check (
    author_id in (select id from public.members where auth_uid = auth.uid())
  );
create policy "edit own message" on public.messages
  for update to authenticated using (
    author_id in (select id from public.members where auth_uid = auth.uid())
  );
-- Reactions are an update to someone else's row, so moderators and reactors
-- both need the door; reaction validity is checked in store.ts before the push.
create policy "moderate messages" on public.messages
  for update to authenticated using (public.is_moderator());
create policy "delete own message" on public.messages
  for delete to authenticated using (
    author_id in (select id from public.members where auth_uid = auth.uid())
    or public.is_moderator()
  );

create policy "report anything" on public.reports
  for insert to authenticated with check (
    reporter_id in (select id from public.members where auth_uid = auth.uid())
  );
create policy "moderators read reports"    on public.reports for select to authenticated using (public.is_moderator());
create policy "moderators resolve reports" on public.reports for update to authenticated using (public.is_moderator());

create policy "append audit"     on public.audit_log for insert to authenticated with check (true);
create policy "moderators audit" on public.audit_log for select to authenticated using (public.is_moderator());

-- Channels, categories and roles are owner/manager territory.
create policy "manage channels" on public.channels
  for all to authenticated using (public.is_moderator()) with check (public.is_moderator());
create policy "manage categories" on public.categories
  for all to authenticated using (public.is_moderator()) with check (public.is_moderator());
create policy "manage roles" on public.roles
  for all to authenticated using (public.is_moderator()) with check (public.is_moderator());
create policy "manage member_roles" on public.member_roles
  for all to authenticated using (public.is_moderator()) with check (public.is_moderator());

-- Ownership is claimed once and only against a Google-verified address, which
-- the main process checks before it ever gets here.
create policy "claim ownership" on public.ownership
  for insert to authenticated with check (true);

-- ── Realtime ───────────────────────────────────────────────────────────────
-- Without this the client subscribes successfully and receives nothing, which
-- is the single most confusing failure mode Supabase has.
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.members;
alter publication supabase_realtime add table public.channels;
alter publication supabase_realtime add table public.categories;
alter publication supabase_realtime add table public.roles;
alter publication supabase_realtime add table public.member_roles;
```

- [ ] **Step 2: Write the setup doc**

Create `docs/community-backend-setup.md` with, in order: create a Supabase project; open SQL Editor and run `supabase/migrations/0001_community.sql`; enable **Anonymous sign-ins** under Authentication → Providers (the app uses `signInAnonymously()`, and it is off by default — connection fails with `Anonymous sign-ins are disabled` until it is on); copy Project URL and the `anon` `public` key from Settings → API; paste both into AIHub → Community → Settings → Backend. State plainly that the anon key is a public client key and that RLS is what protects the data, so the policies above must not be disabled.

- [ ] **Step 3: Verify the SQL parses**

There is no local Postgres in this repo, so verification is by running it once in the Supabase SQL Editor against the real project. Expected: `Success. No rows returned`. Re-running must also succeed — every statement is `if not exists` except the policies, so note in the doc that a re-run needs `drop policy if exists` first.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0001_community.sql docs/community-backend-setup.md
git commit -m "feat(community): the shared schema and its row level security"
```

---

## Task 4: The replication engine

The heart of the fix. Local state stays the thing everything reads; Supabase becomes the thing that fills it.

**Files:**
- Create: `src/main/community/sync.ts` (pure row ⇄ state mapping)
- Create: `src/main/community/sync.test.ts`
- Create: `src/main/community/remote.ts` (client + auth + connection state)
- Create: `src/main/community/replication.ts` (push/pull orchestration)
- Create: `src/main/community/replication.test.ts`
- Modify: `src/main/community/index.ts`

**Interfaces:**
- Consumes: `BackendConfig` from `./backendConfig`; `CommunityState`, `Message`, `Member` from `../../shared/community`.
- Produces:
```ts
// sync.ts — pure, no client, no await
export function messageToRow(m: Message): MessageRow
export function rowToMessage(r: MessageRow): Message
export function memberToRow(m: Member): MemberRow
export function rowToMember(r: MemberRow): Member
export function channelToRow(c: Channel): ChannelRow
export function rowToChannel(r: ChannelRow): Channel

// remote.ts
export type RemoteStatus = 'off' | 'connecting' | 'online' | 'error'
export interface RemoteHandle {
  client: SupabaseClient
  memberAuthUid: string
  status: () => RemoteStatus
  lastError: () => string | null
  close: () => Promise<void>
}
export async function connectRemote(config: BackendConfig): Promise<RemoteHandle | { error: string }>

// replication.ts
export interface Replication {
  push: (table: 'messages' | 'members' | 'channels' | 'categories' | 'roles' | 'member_roles' | 'reports' | 'audit_log', row: Record<string, unknown>) => void
  remove: (table: string, id: string) => void
  start: () => Promise<void>
  stop: () => Promise<void>
  status: () => RemoteStatus
}
export function createReplication(deps: ReplicationDeps): Replication
```

- [ ] **Step 1: Write the failing mapping test**

Create `src/main/community/sync.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { messageToRow, rowToMessage, memberToRow, rowToMember } from './sync'
import type { Message, Member } from '../../shared/community'

const message: Message = {
  id: '11111111-1111-4111-8111-111111111111',
  channel: 'general',
  authorId: '22222222-2222-4222-8222-222222222222',
  authorHandle: 'grace',
  body: 'hello',
  kind: 'text',
  createdAt: 1700000000000,
  reactions: { '👍': ['22222222-2222-4222-8222-222222222222'] },
} as Message

describe('message mapping', () => {
  it('round-trips without losing a field', () => {
    expect(rowToMessage(messageToRow(message))).toEqual(message)
  })
  it('writes camelCase state keys as snake_case columns', () => {
    const row = messageToRow({ ...message, replyToId: 'abc', mentionsEveryone: true } as Message)
    expect(row.reply_to_id).toBe('abc')
    expect(row.mentions_everyone).toBe(true)
    expect(row).not.toHaveProperty('replyToId')
  })
  it('defaults a row with null optionals to a message with them absent', () => {
    const bare = { ...messageToRow(message), edited_at: null, reply_to_id: null, attachments: null }
    const out = rowToMessage(bare as any)
    expect(out.editedAt).toBeUndefined()
    expect(out.attachments).toEqual([])
  })
})

describe('member mapping', () => {
  const member: Member = {
    id: '22222222-2222-4222-8222-222222222222',
    handle: 'Grace', handleKey: 'grace',
    avatarSeed: '22222222-2222-4222-8222-222222222222',
    createdAt: 1700000000000,
  } as Member
  it('round-trips', () => {
    expect(rowToMember(memberToRow(member))).toEqual(member)
  })
  it('keeps handleKey lowercase across the wire so uniqueness holds', () => {
    expect(memberToRow(member).handle_key).toBe('grace')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/main/community/sync.test.ts`
Expected: FAIL — `Failed to resolve import "./sync"`.

- [ ] **Step 3: Implement `sync.ts`**

Write pure mapping functions, one pair per collection. The rules, applied uniformly:
- camelCase state key → snake_case column.
- `undefined` in state → `null` in a row; `null` in a row → `undefined` in state (never `null`, so `?.` and `??` behave the way the rest of the codebase assumes).
- Arrays and records go into `jsonb` columns verbatim; a null jsonb reads back as `[]` or `{}`, never null.
- Timestamps stay `number` (epoch ms) on both sides — `bigint` in Postgres, not `timestamptz`, so no timezone conversion can shift a message.

Include this doc comment at the top:
```ts
/**
 * The translation layer between CommunityState and Postgres rows.
 *
 * Pure and boring on purpose. Every field crossing the wire crosses here, so
 * the round-trip test in sync.test.ts is the single thing standing between a
 * schema change and a silently dropped field — a `replyToId` that becomes
 * undefined in transit does not throw, it just quietly unthreads a
 * conversation on every machine except the one that sent it.
 */
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/main/community/sync.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `remote.ts`**

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { BackendConfig } from './backendConfig'

/**
 * The connection, and nothing else.
 *
 * Anonymous auth rather than a bare anon key, because RLS needs an `auth.uid()`
 * to answer "is this your row" — with no session every policy that says
 * `auth_uid = auth.uid()` evaluates against null and refuses everything, which
 * presents as a working connection that silently drops every write.
 *
 * `persistSession: false` and an explicit storage shim: this is Node, there is
 * no localStorage, and supabase-js reaches for one. The session is re-minted on
 * each launch, which costs nothing and keeps no token on disk.
 */
export type RemoteStatus = 'off' | 'connecting' | 'online' | 'error'

export async function connectRemote(config: BackendConfig) {
  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 20 } },
  })

  const { data, error } = await client.auth.signInAnonymously()
  if (error) {
    // The overwhelmingly common cause, and the message Supabase returns for it
    // is opaque enough to be worth translating.
    const hint = /anonymous/i.test(error.message)
      ? 'Anonymous sign-ins are turned off for this Supabase project. Enable them under Authentication → Providers.'
      : error.message
    return { error: hint }
  }
  if (!data.user) return { error: 'Supabase accepted the key but returned no session.' }

  return { client, memberAuthUid: data.user.id }
}
```

- [ ] **Step 6: Write the failing replication test**

Create `src/main/community/replication.test.ts`. It drives `createReplication` with a fake client so no network is touched. Cover, at minimum:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createReplication } from './replication'
import { emptyState } from '../../shared/communityMigrate'

function harness() {
  const state = emptyState()
  const broadcast = vi.fn()
  const upserts: any[] = []
  const fakeClient = {
    from: (table: string) => ({
      upsert: (row: any) => { upserts.push({ table, row }); return Promise.resolve({ error: null }) },
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      select: () => Promise.resolve({ data: [], error: null }),
    }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
  }
  const replication = createReplication({
    client: fakeClient as any,
    readState: () => state,
    updateState: (fn: any) => { fn(state) },
    broadcast,
  })
  return { state, broadcast, upserts, replication }
}

describe('push', () => {
  it('sends a posted message to the messages table', async () => {
    const h = harness()
    h.replication.push('messages', { id: 'm1', channel: 'general' })
    await h.replication.flush()
    expect(h.upserts).toEqual([{ table: 'messages', row: { id: 'm1', channel: 'general' } }])
  })

  it('keeps working when the network refuses, and does not lose the row', async () => {
    const h = harness()
    h.replication.push('messages', { id: 'm1' })
    // simulate offline: the queue survives so the message goes out on reconnect
    expect(h.replication.pending()).toBe(1)
  })
})

describe('pull', () => {
  it('folds a remote insert into local state and broadcasts it once', () => {
    const h = harness()
    h.replication.applyRemote('messages', 'INSERT', {
      id: 'm9', channel: 'general', author_id: 'a', author_handle: 'ada',
      body: 'hi', kind: 'text', created_at: 1, mentions: [], attachments: [], reactions: {},
    })
    expect(h.state.messages['m9']?.body).toBe('hi')
    expect(h.broadcast).toHaveBeenCalledWith('community:message', expect.anything())
  })

  it('ignores an echo of a row this device just pushed', () => {
    const h = harness()
    h.replication.push('messages', { id: 'm1', channel: 'general' })
    h.broadcast.mockClear()
    h.replication.applyRemote('messages', 'INSERT', { id: 'm1', channel: 'general', created_at: 1 })
    expect(h.broadcast).not.toHaveBeenCalled()
  })

  it('applies a remote delete by removing the local row', () => {
    const h = harness()
    h.state.messages['m2'] = { id: 'm2', channel: 'general' } as any
    h.replication.applyRemote('messages', 'DELETE', { id: 'm2' })
    expect(h.state.messages['m2']).toBeUndefined()
  })
})
```

- [ ] **Step 7: Run it and watch it fail**

Run: `npx vitest run src/main/community/replication.test.ts`
Expected: FAIL — `Failed to resolve import "./replication"`.

- [ ] **Step 8: Implement `replication.ts`**

Requirements the tests above pin down:

1. **`push(table, row)`** appends to an in-memory queue and drains it on a 250ms debounce. A failed drain leaves the rows in the queue and retries with backoff — a message typed on a flaky connection must not vanish. `pending()` reports queue depth for the tests and for the UI banner.
2. **Echo suppression.** Every pushed row id goes into a `Set<string>` for 10 seconds. `applyRemote` checks it first and returns early — otherwise your own message arrives back from Postgres and the renderer renders it twice.
3. **`applyRemote(table, event, row)`** maps the row through `sync.ts`, writes it into local state via `updateState`, then fires the *same* `broadcast()` calls the local path already fires: `community:message` and `community:event {type:'message.new'}` for a message insert, `community:event {type:'message.edit'}` for an update, `community:refresh` for members/channels/roles. This is the whole reason the renderer needs no changes.
4. **`start()`** does a full backfill first (`select` every table, fold into state, one `community:refresh`), *then* subscribes to Realtime. Order matters: subscribing first drops every event that arrives during the backfill.
5. **`stop()`** unsubscribes and clears the queue.

Doc comment:
```ts
/**
 * Local state as a replica, not a rival.
 *
 * The alternative — reading every view straight from Postgres — would mean a
 * round trip before the first message renders and a spinner on every channel
 * switch. Instead the JSON file stays exactly what it was, and this module
 * keeps it honest: local writes go up, remote writes come down, and both
 * arrive at the renderer through the one `broadcast()` it already listens to.
 *
 * That is the property worth protecting. The renderer does not know a server
 * exists, so `LocalTransport` and `RemoteTransport` are not two code paths
 * through the UI — they are the same path with a different filler.
 */
```

- [ ] **Step 9: Run it and watch it pass**

Run: `npx vitest run src/main/community/replication.test.ts`
Expected: PASS.

- [ ] **Step 10: Wire it into `index.ts`**

1. Add module state next to `presence` and `signaling`:
```ts
let replication: Replication | null = null
```

2. Extend `CommunityStatus`'s `network` from the literal `'local'` to `'local' | 'connecting' | 'remote' | 'error'`, and have `currentStatus()` read `replication?.status()`. This is what lets the UI stop claiming the room is local when it is not.

3. In each mutating handler, **after** the local rule functions have already accepted the change, push it. `community:post` at line 383 becomes:
```ts
broadcast('community:message', { channel: input.channel, message: published })
broadcast('community:event', { type: 'message.new', channel: input.channel, message: published })
replication?.push('messages', messageToRow(published))
```
Do the same for `community:react`, `community:editMessage`, `community:deleteMessage` (use `replication?.remove('messages', id)`), `community:join` (`members`), `community:setBanned` (`members`), `community:report` (`reports`), and every `admin.ts`-backed channel/category/role handler (`channels`, `categories`, `roles`, `member_roles`), plus `audit_log` wherever an `AuditEntry` is appended.

**The ordering is the rule and it is not negotiable:** local rules decide, local state changes, local broadcast fires, *then* the row goes up. Pushing first would make a rejected post appear on other devices.

4. Add the handlers the settings panel needs:
```ts
ipcMain.handle('community:backend:get', async () => {
  const config = backendConfig()          // decrypted, then key redacted
  return config ? { url: config.url, anonKey: '', iceServers: config.iceServers, configured: true } : { configured: false }
})
ipcMain.handle('community:backend:set', async (_e, input: unknown) => { /* validate, seal, reconnect, broadcast status */ })
ipcMain.handle('community:backend:clear', async () => { /* stop replication, delete file, back to local */ })
```
`community:backend:get` **never returns the key**. The panel shows "configured" and a Replace field, the way every other credential field in this app does.

5. Call `replication?.start()` from `registerCommunityIpc()` when a config is present, and `replication?.stop()` from the existing `before-quit` path.

- [ ] **Step 11: Verify**

Run: `npm test`
Expected: PASS. The existing `ipc.test.ts` (473 lines) must still pass untouched — if it does not, the local path was changed, which this task forbids.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/main/community/sync.ts src/main/community/sync.test.ts src/main/community/remote.ts src/main/community/replication.ts src/main/community/replication.test.ts src/main/community/index.ts
git commit -m "feat(community): replicate the room across devices"
```

---

## Task 5: Presence and typing, across devices

**Files:**
- Create: `src/main/community/remotePresence.ts`
- Create: `src/main/community/remotePresence.test.ts`
- Modify: `src/main/community/index.ts` (`community:heartbeat`, `community:typing`)

**Interfaces:**
- Consumes: `createPresenceTracker` from `./presence`, a `SupabaseClient` from `remote.ts`.
- Produces:
```ts
export interface RemotePresence {
  /** Announce this device on the shared channel. */
  track: (memberId: string, status: PresenceStatus, voiceChannel?: string) => Promise<void>
  typing: (memberId: string, channel: string, on: boolean) => Promise<void>
  /** Local windows merged with every other device's announcement. */
  snapshot: () => Record<string, PresenceStatus>
  typingIn: (channel: string) => string[]
  stop: () => Promise<void>
}
export function createRemotePresence(deps: {
  client: SupabaseClient
  local: ReturnType<typeof createPresenceTracker>
  deviceId: string
  onChange: () => void
}): RemotePresence
```

- [ ] **Step 1: Write the failing test**

Create `src/main/community/remotePresence.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { mergePresence, rankOf } from './remotePresence'

describe('mergePresence', () => {
  it('shows a member online when only a remote device reports them', () => {
    const out = mergePresence({}, [{ memberId: 'm1', status: 'online' }])
    expect(out).toEqual({ m1: 'online' })
  })
  it('keeps the strongest status when one member is on two devices', () => {
    const out = mergePresence({ m1: 'idle' }, [{ memberId: 'm1', status: 'online' }])
    expect(out.m1).toBe('online')
  })
  it('lets do-not-disturb win over online, because it was chosen', () => {
    const out = mergePresence({ m1: 'online' }, [{ memberId: 'm1', status: 'dnd' }])
    expect(out.m1).toBe('dnd')
  })
  it('drops nobody from the local snapshot when the remote list is empty', () => {
    expect(mergePresence({ m1: 'online' }, [])).toEqual({ m1: 'online' })
  })
})

describe('rankOf', () => {
  it('orders dnd above online above idle above offline', () => {
    expect(rankOf('dnd')).toBeGreaterThan(rankOf('online'))
    expect(rankOf('online')).toBeGreaterThan(rankOf('idle'))
    expect(rankOf('idle')).toBeGreaterThan(rankOf('offline'))
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/main/community/remotePresence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `remotePresence.ts`**

Uses Supabase Realtime **Presence** on a channel named `community:presence`. Each device `track()`s `{ memberId, status, voiceChannel, deviceId }`. On `sync`/`join`/`leave` it recomputes and calls `onChange()`, which in `index.ts` fires the existing `broadcast('community:event', { type: 'presence', presence })`.

Typing rides a Realtime **broadcast** event (`typing`) on the same channel rather than Presence — typing is a pulse, not a state, and putting it in Presence would rewrite every device's presence object on every keystroke.

Export `rankOf` and `mergePresence` as pure functions so the merge rule is testable without a socket. Reuse the exact `RANK` ordering already in `presence.ts:39` — do not invent a second one; import it if `presence.ts` is changed to export it.

Doc comment:
```ts
/**
 * Presence that reaches past this machine.
 *
 * `presence.ts` answers "which of my windows is alive" and it answers it well;
 * this answers "who else is here", which is the question the member list was
 * asking all along and getting a one-person answer to.
 *
 * Realtime Presence rather than a table, because presence is worthless the
 * moment it is stale and a row that outlives the process it described is worse
 * than no row — it is a person listed as online who closed their laptop an hour
 * ago. Supabase drops a device's presence when its socket goes, which is
 * exactly the semantics wanted and exactly what a table cannot give.
 */
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/main/community/remotePresence.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire into the two handlers**

In `index.ts`, `community:heartbeat` (line 919) becomes:
```ts
presence.heartbeat(String(e.sender.id), who.id, status ?? 'online')
await remotePresence?.track(who.id, status ?? 'online')
broadcast('community:event', { type: 'presence', presence: mergedPresence() })
```
where `mergedPresence()` is `remotePresence ? remotePresence.snapshot() : presence.snapshot()`.

`community:typing` (line 927) gains `await remotePresence?.typing(who.id, channel, typing)` and reads its member list from `remotePresence?.typingIn(channel) ?? presence.typingIn(channel)`.

- [ ] **Step 6: Verify and commit**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add src/main/community/remotePresence.ts src/main/community/remotePresence.test.ts src/main/community/index.ts
git commit -m "feat(community): see who is actually here"
```

---

## Task 6: Voice, video and screen share across devices

**Files:**
- Create: `src/main/community/remoteSignaling.ts`
- Create: `src/main/community/remoteSignaling.test.ts`
- Modify: `src/main/community/index.ts` (voice handlers — composite peer ids)
- Modify: `src/main/community/signaling.ts` (doc + remote fan-out)
- Modify: `src/renderer/src/components/community/useVoiceSession.ts:41` (config-driven ICE)

**Interfaces:**
- Produces:
```ts
/** Globally unique across machines. `${deviceId}:${webContentsId}`. */
export type PeerId = string
export function compositePeerId(deviceId: string, webContentsId: number | string): PeerId
export function deviceOf(peerId: PeerId): string

export interface RemoteSignaling {
  join: (peerId: PeerId, memberId: string, channel: string) => Promise<VoicePeer[]>
  leave: (peerId: PeerId) => Promise<void>
  signal: (from: PeerId, to: PeerId, payload: unknown) => Promise<boolean>
  setState: (peerId: PeerId, patch: Partial<VoicePeer>) => Promise<void>
  occupancy: () => Record<string, VoicePeer[]>
  stop: () => Promise<void>
}
```

- [ ] **Step 1: Write the failing test**

Create `src/main/community/remoteSignaling.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { compositePeerId, deviceOf, isLocalPeer } from './remoteSignaling'

describe('compositePeerId', () => {
  it('is unique across machines that share a webContents id', () => {
    expect(compositePeerId('devA', 1)).not.toBe(compositePeerId('devB', 1))
  })
  it('round-trips its device half', () => {
    expect(deviceOf(compositePeerId('devA', 7))).toBe('devA')
  })
  it('survives a device id that is a uuid with dashes', () => {
    const id = compositePeerId('9f0c1e2a-0000-4000-8000-000000000000', 3)
    expect(deviceOf(id)).toBe('9f0c1e2a-0000-4000-8000-000000000000')
  })
})

describe('isLocalPeer', () => {
  it('routes a same-device peer through the in-process relay', () => {
    expect(isLocalPeer(compositePeerId('devA', 2), 'devA')).toBe(true)
  })
  it('routes another device through the realtime relay', () => {
    expect(isLocalPeer(compositePeerId('devB', 2), 'devA')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/main/community/remoteSignaling.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `remoteSignaling.ts`**

`compositePeerId` joins with `:` and `deviceOf` splits on the **first** `:` only (a webContents id is numeric, a device id is a uuid — but splitting on the last colon would break the moment either format changes).

The module keeps a Realtime channel per voice room, `voice:<slug>`, and broadcasts four event types: `join`, `leave`, `signal`, `state`. Every device maintains its own view of the roster from those events, and `occupancy()` merges the in-process hub's peers with the remote ones.

Routing rule, and the reason `isLocalPeer` is tested: a signal addressed to a peer on this device goes through the existing in-process `sendToPeer` — no round trip to Frankfurt to reach the window next to it — and everything else goes over Realtime.

Doc comment:
```ts
/**
 * The same relay, one hop further out.
 *
 * signaling.ts said it plainly: "Swapping this module's `send` for a
 * server-backed one is the entire change needed to make it reach further — the
 * peer connection code above it does not move." This is that swap, and the
 * claim held: useVoiceSession.ts is unchanged except for where it reads its
 * ICE servers from.
 *
 * Peer ids had to grow, though. `e.sender.id` is a webContents id, unique
 * inside one process and emphatically not across five machines — two laptops
 * would both call their first window "1" and each would answer the other's
 * offers. Hence `${deviceId}:${webContentsId}`.
 */
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/main/community/remoteSignaling.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Switch the voice handlers to composite ids**

In `index.ts`, replace every `String(e.sender.id)` inside the four `community:voice:*` handlers with `compositePeerId(deviceId(), e.sender.id)`, where `deviceId()` returns a uuid minted once and stored in the identity file. Update `releaseCommunityWindow(windowId)` the same way.

`sendToPeer` must now match on the webContents half:
```ts
function sendToPeer(peerId: string, channel: string, payload: unknown) {
  const local = peerId.slice(peerId.indexOf(':') + 1)
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    if (String(win.webContents.id) !== local) continue
    win.webContents.send(channel, payload)
    return
  }
}
```

- [ ] **Step 6: Make ICE servers configurable**

`useVoiceSession.ts:41` currently hardcodes `const ICE_SERVERS: RTCIceServer[] = []`. Replace with a value fetched once from `community:backend:get`:

```ts
// Empty is correct on a LAN — host candidates find each other directly, and a
// STUN round trip would only add latency to a connection that did not need it.
// It stops being correct the moment one device is somewhere else, so the list
// comes from settings rather than from this line.
const [iceServers, setIceServers] = useState<RTCIceServer[]>([])
useEffect(() => {
  api?.backend?.get?.().then((b: any) => setIceServers(b?.iceServers ?? []))
}, [])
```
and pass `{ iceServers }` at line 141.

- [ ] **Step 7: Verify**

Run: `npm test && npm run typecheck`
Expected: PASS. `signaling.test.ts` (180 lines) must still pass — the in-process hub's contract has not changed, only the shape of the ids flowing through it.

- [ ] **Step 8: Commit**

```bash
git add src/main/community/remoteSignaling.ts src/main/community/remoteSignaling.test.ts src/main/community/index.ts src/main/community/signaling.ts src/renderer/src/components/community/useVoiceSession.ts
git commit -m "feat(community): voice and screen share reach other machines"
```

---

## Task 7: The settings panel, and telling the truth about the connection

**Files:**
- Create: `src/renderer/src/components/community/BackendPanel.tsx`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/components/community/CommunityShell.tsx` (status banner)
- Modify: `src/renderer/src/components/community/useCommunity.ts` (surface `network`)

- [ ] **Step 1: Extend the preload surface**

In `src/preload/index.ts`, inside the `community: {` object, add:
```ts
backend: {
  get:   ()             => ipcRenderer.invoke('community:backend:get'),
  set:   (input: any)   => ipcRenderer.invoke('community:backend:set', input),
  clear: ()             => ipcRenderer.invoke('community:backend:clear'),
},
```

- [ ] **Step 2: Build `BackendPanel.tsx`**

Three fields — Project URL, anon key (`type="password"`, empty when already configured, placeholder `Configured — paste a new key to replace`), and a repeatable ICE server row — plus a live connection line reading `Local only` / `Connecting…` / `Connected — N members` / the error sentence from the main process, verbatim. A Disconnect button calls `clear()`.

Above the fields, one paragraph of plain text explaining that until a backend is configured, this community exists only on this computer and nobody else can see it. That sentence is the whole reason the user filed this bug; it should have been on screen from the start.

- [ ] **Step 3: Replace the "local" banner**

`currentStatus().network` is now a four-state value. Render:
- `local` → "This community is on this computer only. Other people cannot see your messages." + a Set up button opening `BackendPanel`.
- `connecting` → spinner, "Connecting to the community…"
- `remote` → nothing. A working connection needs no banner.
- `error` → the main process's sentence, and a Retry.

- [ ] **Step 4: Verify**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Manual verification on two machines — the actual acceptance test**

Nothing above proves the bug is fixed. This does. With the schema applied and both machines configured against the same project:

1. Join as `alpha` on machine A and `beta` on machine B. **Both member lists show two people.** (Today: one each.)
2. Post from A. **It appears on B within a second, without a refresh.** (Today: never.)
3. Start typing on B. **A shows "beta is typing".**
4. Both join the same voice channel. **The roster shows two peers on both.**
5. B shares a screen. **A's stage fills its window with B's screen, B's camera tile sits in the bottom filmstrip.** (Today: a 340px strip under the chat.)
6. Close A's window mid-call. **B's roster drops to one within the presence TTL and the dead tile disappears.**

Record the result of each. A step that does not pass is a bug in the task above it, not a note for later.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/community/BackendPanel.tsx src/preload/index.ts src/renderer/src/components/community/CommunityShell.tsx src/renderer/src/components/community/useCommunity.ts
git commit -m "feat(community): backend settings, and an honest connection banner"
```

---

## Self-Review

**Spec coverage.** The spec's §4 named `CommunityTransport` and `SignalingChannel` and shipped neither; Tasks 4 and 6 implement both, under different names that match what they actually are (`replication`, `remoteSignaling`). The spec's "gated on a backend" list — cross-machine messaging (Task 4), presence of other people (Task 5), DMs with other people (Task 4, `messages` carries dm channels), NAT traversal (Task 6, configurable ICE) — is now covered end to end. The spec's promise that `store.ts` rules become RLS policies is honoured in Task 3.

**Known gaps, stated rather than hidden.** Attachments still write to local disk (`attachments.ts`) and their `aihub-community-file://` URLs resolve only on the machine that uploaded them — a recipient on another device sees the message and a broken file. Fixing that means Supabase Storage and is deliberately **out of scope for this plan**; the composer should say so until it is done. `reads`, `notifPrefs` and `blocks` stay per-device by design.

**Type consistency.** `PeerId` is `string` throughout. `VoicePeer` is imported from `signaling.ts` in main and re-declared structurally in `useVoiceSession.ts` — they must stay in step; Task 6 does not change its shape. `RemoteStatus` (`remote.ts`) and `CommunityStatus['network']` are deliberately different types: the former is the client's view, the latter adds `'local'` for "no client at all".
