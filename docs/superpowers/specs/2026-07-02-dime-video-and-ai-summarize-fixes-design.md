# Dime Video Dimming + AI Summarize Fixes — Design

## Problem

Two unrelated but both currently-broken features, batched together as one release slice per user request:

**1. Dime extension dims the video it's supposed to spotlight.** `extensionDefs.ts`'s `dime` extension injects a single `position:fixed; inset:0` overlay covering the entire viewport whenever a video plays, with no cutout for the video itself (`extensionDefs.ts:39-75`). The video gets darkened along with everything else — the opposite of the extension's stated purpose ("Dims the background while video plays").

**2. AI summarize on YouTube videos returns a generic error instead of a summary.** Two compounding problems:
- The content the AI is given to summarize (`getPageContent` in `App.tsx:105-115`) is `document.body.innerText`, which on a YouTube watch page is nearly empty — the transcript lives behind a UI panel the user has to manually expand, never in the page's plain text.
- Separately, the exact error text the user reported ("All cloud models are currently unavailable...") only comes from one code path in `ai:chat` (`main/index.ts:849-858`) — it fires when the Ollama call fails *and* every OpenRouter fallback model also fails. The Ollama failure is currently silently swallowed by an empty `catch {}` (`main/index.ts:832`), so even though the user has Ollama running, there's no way to know *why* the actual request to it failed. This can't be reproduced from this environment (it's the user's installed app, not this dev setup) — the fix scopes to making the failure diagnosable instead of guessing a specific root cause.

## Goals

- Dime's overlay never darkens the video(s) currently playing — only the rest of the page.
- Asking the AI (via chat or the manual Summarize action) to summarize a YouTube video that has captions gets the actual transcript, not an empty/near-empty page-text extraction.
- If Ollama fails for any reason during a chat/summarize request, that failure is logged and surfaces in the final error message instead of being silently discarded — so if "all cloud models unavailable" happens again, the message itself explains why the local model didn't work instead of just listing generic troubleshooting steps.

## Non-goals

- Not fixing whatever specific cause is behind the user's one reported instance of the Ollama failure (can't reproduce it here) — this is an observability fix, not a guessed patch.
- Not adding transcript support for non-YouTube video sites (Vimeo, etc.) — YouTube only, matching what was asked.
- Not changing Dime's settings UI (opacity slider stays as-is).
- Not touching the manual "Summarize" button's UI or the `ai:summarizePage` IPC's request/response shape — only its internal Ollama-failure handling.

## Design

### 1. Dime: spotlight overlay instead of full-screen overlay

Replace the single full-viewport `<div>` with a "spotlight" technique: one absolutely-positioned, fully transparent `<div>` sized and positioned to exactly match the playing video's `getBoundingClientRect()`, using `box-shadow: 0 0 0 9999px rgba(0,0,0,<opacity>)`. A box-shadow paints *outside* the element's own box, so the interior — sitting exactly over the video — stays untouched while everything else on the page darkens around it. `pointer-events: none` on the spotlight div, matching the current overlay, so it never blocks clicks on the video's own controls.

The video's position/size can change without a resize/scroll event firing reliably (YouTube's player resizes on layout changes, fullscreen toggle, theater mode, etc.), so the spotlight's rect is recomputed on a lightweight `setInterval` (~250ms, cheap enough not to matter) plus `resize`/`scroll` listeners for immediate responsiveness. If more than one video is playing at once, the largest by rendered area is spotlighted (single-video is the overwhelmingly common case; this just prevents a nonsensical pick when there are multiple).

Show/hide semantics stay identical to today: appears when any video starts playing, disappears when none are, opacity setting unchanged.

### 2. YouTube transcript extraction for `read_page` / Summarize

Both `getPageContent` (`App.tsx`, used by the AI chat bot's `read_page` tool and the "Attach Page" button) and the manual "Summarize" button's page-text extraction go through the same injected-script mechanism (`webview.execScript`). The fix lives at that layer, extracted into its own small module (`src/renderer/src/services/pageExtractor.ts`) rather than growing the inline script string further in `App.tsx` — this mirrors the precedent already set by pulling agent-tool logic into `agentTools.ts`.

Extraction logic, run inside the guest page:
1. If `location.hostname` doesn't include `youtube.com` or the URL has no `v` query param, skip straight to the existing generic `document.body.innerText` extraction (unchanged behavior for every non-YouTube-video page).
2. Otherwise, read `window.ytInitialPlayerResponse` — a global YouTube embeds in every watch-page load containing caption track metadata (`captions.playerCaptionsTracklistRenderer.captionTracks`), the standard, long-used mechanism transcript tools rely on (no extra network round-trip needed to discover available tracks).
3. Guard against YouTube's SPA navigation leaving this global stale (clicking to a new video from a video page doesn't always reload the page): compare `ytInitialPlayerResponse.videoDetails.videoId` against the current URL's `v` param. If they don't match, treat it as unavailable and fall through to generic text extraction rather than risk summarizing the wrong video.
4. If a caption track exists, `fetch()` its `baseUrl` (same-origin request, no CORS issue — the page is already on youtube.com) to get the transcript as XML, parse out each `<text>` segment's content, HTML-entity-decode it, and join into plain text.
5. If no caption tracks are present at all (video has no captions), fall through to generic `document.body.innerText` extraction — same graceful-degradation contract every other extraction path in this codebase already follows (never throw, always return *something* usable).
6. Whichever text is produced (transcript or generic), truncate to the existing 8000-char cap before returning.

### 3. Stop silently swallowing Ollama failures

In both `ai:chat` and `ai:summarizePage` (`main/index.ts`), the `catch {}` around the Ollama attempt is replaced with one that captures a short diagnostic string describing what happened — Ollama wasn't reachable at all, the HTTP status Ollama returned, or the exception message from a timed-out/failed request — and `console.warn`s it immediately (visible in DevTools/main-process logs the moment it happens, for future debugging without needing to reproduce first).

That diagnostic also gets folded into whichever fallback message the handler was already going to return:
- If OpenRouter also exhausted its candidates ("All cloud models are currently unavailable" case): append `(Local Ollama also failed: <diagnostic>)` before the existing troubleshooting bullet list.
- If no OpenRouter key is configured at all ("No AI configured" case) but Ollama *was* detected running and still failed: swap the "Install Ollama" instruction (misleading if it's already installed and running) for the actual diagnostic instead.

This doesn't fix a specific bug the user hit — it makes the next occurrence of "AI isn't working" actually debuggable instead of a dead end.

## Error handling

- Transcript fetch failure (network error, malformed XML, YouTube changing its response shape) is caught and falls back to generic page-text extraction — never throws, never blocks the summarize/chat flow.
- The stale-`ytInitialPlayerResponse` guard (video ID mismatch) prevents a wrong-video summary being silently presented as correct.
- Ollama diagnostic capturing never changes the actual control flow (still tries Ollama, still falls back to OpenRouter, still returns the same shape of `{content, model, provider}`) — it's strictly additive information.

## Testing

No automated test suite in this project (established in the prior session) — manual verification:
1. Play a YouTube video with the Dime extension enabled → background dims, video itself stays full brightness. Resize the window / toggle theater mode / go fullscreen while playing → spotlight follows the video's new bounds.
2. Two videos playing at once (e.g. two tabs, or an embedded video below the main one) → the larger one gets spotlit, no crash.
3. Ask the AI bot "summarize this video" on a YouTube video known to have captions → response reflects actual video content, not a generic "AI browser" description.
4. Same on a video with captions disabled → falls back to a generic summary attempt rather than erroring.
5. Click "Summarize" (manual button) on a YouTube video → same transcript-based behavior as the chat path, since both share the same extraction code.
6. Code-review confirmation (can't force-reproduce the original Ollama failure): read the modified `ai:chat`/`ai:summarizePage` and confirm a deliberately-broken Ollama call (e.g. wrong port) produces a `console.warn` and a diagnostic-annotated fallback message, then revert.
