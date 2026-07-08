# Screenshot & Tab Recording — Design

## Problem

Users want to capture what they're browsing: a screenshot (optionally marked
up) or a short video recording of a tab. Two gaps exist today:

1. `AnnotationCanvas.tsx`'s existing "💾 Save" button in the in-page toolbar
   only exports the transparent drawing-canvas layer (`cv.toDataURL(...)`) —
   the strokes with nothing underneath. It's not actually a screenshot.
2. There's no way to grab a plain screenshot without entering annotate mode,
   and no recording capability at all. A `webview:capture` IPC handler
   (`wc.capturePage()`) already exists in `main/index.ts` but nothing in the
   renderer calls it — dead code.

## Goals

- Fix the annotation Save button so it exports the real page pixels
  composited with the drawn strokes — an actual annotated screenshot.
- Add a standalone screenshot button (nav bar) that captures the active tab
  instantly, no annotate mode required.
- Add a tab recording button (nav bar): start/stop video capture of the
  active tab's content, with a visible recording indicator + elapsed timer.
- Both screenshot and recording save through a native "Save As" dialog
  (consistent with the existing `file:saveMd` summary-download pattern),
  not a silent browser-style auto-download.

## Non-goals

- No annotation/drawing on top of recordings (video is raw capture only).
- No cloud upload, sharing, or clip-editing — save-to-disk only.
- No audio capture (system or mic) — video only, matches typical bug-report /
  walkthrough use case and avoids permission-prompt complexity.
- No cross-platform recording backend abstraction — `desktopCapturer` is
  cross-platform in Electron already, no special-casing needed.

## Design

### 1. Annotated screenshot fix (`AnnotationCanvas.tsx`)

The in-page `INJECT_SCRIPT`'s Save button currently does:

```js
a.href = cv.toDataURL('image/png')  // strokes only, transparent bg
```

Change: the guest page can't reach `capturePage()` (that's a main-process /
webContents-level API, not available to page JS), so compositing must happen
host-side. New flow:

- In-page Save button no longer downloads directly. Instead it serializes the
  strokes canvas to a dataURL and calls a new bridge function
  `window.__aihub_requestScreenshot(strokesDataUrl)` which enqueues
  `{type:'annotated', strokesDataUrl}` onto the existing `__aihub_aiQueue`
  drain mechanism already polled by `AnnotationCanvas.tsx` (reuse the poll
  loop rather than adding a second one).
- Host, on drain: calls `window.electronAPI.webview.capture(wcId)` (wires up
  the existing `webview:capture` IPC) to get the full-page dataURL, draws it
  to an offscreen `<canvas>`, draws the strokes dataURL on top, then calls
  the new `file:saveImage` IPC with the composited PNG buffer.
- `file:saveImage` IPC (new, `main/index.ts`, mirrors `file:saveMd`): opens
  `dialog.showSaveDialog` defaulting to `Documents/annotation-<timestamp>.png`,
  writes the buffer, returns `{success, filePath}`.

### 2. Standalone screenshot button (`NavigationBar.tsx`)

- New camera-icon button next to existing nav actions.
- On click: get the active tab's `wcId` (already tracked in `browserStore`
  via `tabWcIds`, same lookup `AnnotationCanvas` uses), call
  `window.electronAPI.webview.capture(wcId)`, then `file:saveImage` with that
  raw dataURL directly (no compositing — plain screenshot).
- Brief visual confirmation (e.g. flash/checkmark on the button for ~1s),
  matching the existing `sv.innerHTML = SV_CHECK` pattern used for note-save
  feedback.

### 3. Tab recording (`NavigationBar.tsx` + main process)

- New main-process IPC `recorder:getSourceId` — calls
  `desktopCapturer.getSources({types:['window']})` and returns the id of
  *this* app's own window (matched via `mainWindow.getMediaSourceId()`,
  Electron's built-in helper for exactly this — avoids fragile title-matching
  against the source list).
- Renderer, on record-button click:
  - `navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } } })`
  - `MediaRecorder` on that stream (`video/webm;codecs=vp9`), collect chunks
    in memory.
  - Button becomes a stop control; a small badge shows a red dot + `mm:ss`
    elapsed (setInterval tick, cleared on stop).
- On stop: assemble chunks into a `Blob`, convert to `ArrayBuffer`, send to a
  new `file:saveVideo` IPC (same save-dialog pattern, default
  `Documents/recording-<timestamp>.webm`), then stop all stream tracks.
- Recording captures the whole app window (titlebar/tabs included, since
  that's what `desktopCapturer` sees) — acceptable for this use case; cropping
  to just the active tab's content area is a possible future refinement, not
  in scope now.

### 4. New IPC surface (`main/index.ts`)

| Channel | Direction | Purpose |
|---|---|---|
| `file:saveImage` | renderer→main | Save a PNG dataURL/buffer via native dialog |
| `file:saveVideo` | renderer→main | Save a WebM buffer via native dialog |
| `recorder:getSourceId` | renderer→main | Get this window's `desktopCapturer` source id |

`webview:capture` already exists and needs no changes — just gets its first
real caller.

## Error handling

- `capturePage()` / compositing failure → screenshot button shows a brief
  error state (red flash) instead of a silent no-op; nothing written to disk.
- `getUserMedia` denial or `desktopCapturer` failure → recording button
  reverts to idle state, no crash; Electron doesn't prompt for OS permission
  on this path (it's an internal capture of the app's own window, not the
  full desktop), so denial is only expected on API/plumbing failure.
- Save dialog cancel (`canceled: true`) → treated as success-no-op, matches
  existing `file:saveMd` behavior.
- Recording stopped by closing the tab/app mid-record → `MediaRecorder`'s
  `onstop` still fires for whatever chunks were captured; partial recordings
  save rather than being silently lost.
