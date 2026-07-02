# Annotation Sticky Notes with AI — Design

## Problem

The annotation tool (canvas + in-page toolbar injected into the guest page by `AnnotationCanvas.tsx`) covers drawing, but the user wants sticky notes: type notes onto any page, have them saved, and have AI help write them.

## Goals

- A "🗒 Note" button in the existing annotation toolbar creates a draggable sticky note on the page: editable text, delete button, AI button.
- Notes persist per page URL across annotation sessions and app restarts.
- AI integration per note: note with text → the text is sent as a question/instruction about the current page and the AI's answer replaces the note content; empty note → the AI writes a summary of the page into it.
- Everything works within the existing architecture: one injected script, in-page DOM, no new IPC channels.

## Non-goals

- No cross-device/cloud sync — persistence is the site's localStorage (per-origin, survives restarts via the `persist:main` session).
- No rich text, colors, or resize on notes — plain text, fixed width, classic yellow. (Add later if asked.)
- No notes outside annotation mode — closing the annotation tool hides notes (data stays saved); reopening restores them.
- No streaming AI responses into notes — single request/response like the Summarize button.

## Design

### 1. In-page note widgets (inside `INJECT_SCRIPT`)

- Toolbar gains a `🗒 Note` action button (in the actions row, next to Undo/Redo/Clear/Save). Click → `createNote()` spawns a note near the toolbar with a small random offset.
- A note is a `position:fixed` div (`z-index` above the canvas), ~220px wide: drag-handle header (with × delete and ✨ AI buttons), yellow paper body (`#fef08a`-family, dark text), and a `contenteditable` text area.
- Notes carry `pointer-events:all` and sit above the canvas; the canvas ignores events on them (notes are siblings, not children — clicks land on the note first).
- State: `notes = [{id, x, y, text}]` inside the script. Create/drag-end/edit (input event, debounced)/delete all call `saveNotes()`.

### 2. Persistence

- `saveNotes()` writes `JSON.stringify(notes)` to the page's `localStorage` under `'__aihub_notes::' + location.origin + location.pathname`.
- On inject, `loadNotes()` reads that key and re-creates the widgets. The `persist:main` session keeps site localStorage across app restarts.
- `window.__aihub.remove()` also removes note DOM elements (data already saved).
- localStorage failures (rare: private contexts, quota) are caught; notes still work for the session, just don't persist.

### 3. AI bridge (host-polled queue)

Guest pages can't call `electronAPI`, so the ✨ button only enqueues:

- In-page: `window.__aihub_aiQueue = window.__aihub_aiQueue || []`; ✨ pushes `{noteId, text}` and sets the note into a "✨ thinking…" state (button disabled, subtle pulse).
- Host (`AnnotationCanvas.tsx`): while the annotation is mounted, a `setInterval` (1000ms) runs `execScript` draining the queue: `(function(){var q=window.__aihub_aiQueue||[];window.__aihub_aiQueue=[];return JSON.stringify(q)})()`.
- For each drained request the host builds the prompt:
  - text non-empty → `Answer briefly based on this page.\nQUESTION/INSTRUCTION: <text>\n\nPAGE CONTENT:\n<pageText>`
  - text empty → `Summarize this page in 3-5 short bullet points.\n\nPAGE CONTENT:\n<pageText>`
  - `pageText` comes from the same `buildPageExtractionScript()` used by the AI panel (YouTube-transcript aware, 8000-char cap).
- Host calls `window.electronAPI.ai.chat(...)` (existing Ollama→OpenRouter path), then writes the result back: `execScript` calling `window.__aihub_setNoteText(noteId, resultJSON)` — an in-page helper that replaces the note text, clears the thinking state, and saves.
- Errors (AI unavailable etc.): the error message text goes into the note the same way — visible, retryable by clicking ✨ again, consistent with how the AI panel surfaces errors.

### 4. Host component changes (`AnnotationCanvas.tsx`)

- Add the polling `setInterval` in the existing `useEffect` (started after inject, cleared on cleanup/tab-switch).
- Import `buildPageExtractionScript` from `../../services/pageExtractor`.
- No new components, stores, or IPC.

## Error handling

- AI request fails → error text lands in the note; note remains editable; ✨ retries.
- Queue drain `execScript` failures (tab navigated mid-poll) → caught and ignored; next tick retries.
- Malformed queue contents → ignored entries.
- localStorage unavailable → in-session notes only.

## Testing

Manual, in the dev build:

1. Open annotation on a page → click 🗒 → note appears; type text; drag it; close annotation; reopen → note restored at position with text.
2. Restart app, revisit page, open annotation → note still there.
3. ✨ on an empty note → page summary appears in note.
4. ✨ on a note containing a question about the page → relevant answer replaces it.
5. × deletes; reopening doesn't resurrect it.
6. Ollama off + no cloud key → note shows the diagnostic error text.
