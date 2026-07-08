# Screenshot & Tab Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user take an instant screenshot of the active tab, record it as a video, and get a real annotated-screenshot export (page pixels + drawn strokes) from the existing annotation tool — all saved to disk via a native "Save As" dialog.

**Architecture:** Three independent additions on top of existing plumbing. (1) New main-process IPC channels (`file:saveImage`, `file:saveVideo`, `recorder:getSourceId`) alongside the already-existing-but-unused `webview:capture`. (2) Two new nav-bar buttons (`NavigationBar.tsx`) that call `webview:capture` for screenshots and use `getUserMedia` + `MediaRecorder` against `recorder:getSourceId` for video. (3) A fix to `AnnotationCanvas.tsx`'s in-page Save button so it composites the real captured page under the drawn strokes instead of exporting a transparent-background strokes-only PNG.

**Tech Stack:** TypeScript, Electron (`BrowserWindow.getMediaSourceId()`, `dialog.showSaveDialog`, `webContents.capturePage()`), React, browser `MediaRecorder`/`getUserMedia` APIs, `HTMLCanvasElement` compositing.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-07-screenshot-and-recording-design.md`
- No automated test suite in this repo. Verification is `npx tsc --noEmit -p tsconfig.node.json` for main/preload changes, `npx tsc --noEmit -p tsconfig.web.json` for renderer changes, and a final manual pass in the running dev app.
- `window.electronAPI` is typed as `any` (see `src/renderer/src/App.tsx:29`) — no `.d.ts` to update when adding new channels.
- Follow the existing `file:saveMd` pattern (`src/main/index.ts`) for all new save-to-disk IPC: `dialog.showSaveDialog(mainWindow, {...})`, `canceled` → `{success:false}` (no error), write failure → `{success:false, error}`.
- Never let injected in-page script code (`AnnotationCanvas.tsx`'s `INJECT_SCRIPT`) throw — wrap risky calls in try/catch, matches existing codebase-wide contract there.
- Recording captures the whole app window (via `getMediaSourceId()`), not a cropped tab region — accepted scope limit per spec's non-goals.

---

### Task 1: Main-process IPC — save image, save video, get recording source id

**Files:**
- Modify: `src/main/index.ts` (add three `ipcMain.handle` blocks near the existing `file:saveMd` handler)
- Modify: `src/preload/index.ts` (expose the three new channels)

**Interfaces:**
- Produces (consumed by Tasks 2 & 3):
  - `window.electronAPI.file.saveImage({dataUrl: string, baseName?: string}): Promise<{success: boolean, filePath?: string, error?: string}>`
  - `window.electronAPI.file.saveVideo({buffer: ArrayBuffer}): Promise<{success: boolean, filePath?: string, error?: string}>`
  - `window.electronAPI.recorder.getSourceId(): Promise<string | null>`
  - `window.electronAPI.webview.capture(wcId: number): Promise<string | null>` — already exists, unchanged, listed here because Tasks 2 & 3 depend on it.

- [ ] **Step 1: Add the `file:saveImage` and `file:saveVideo` handlers**

In `src/main/index.ts`, find the existing handler:

```ts
// ── IPC: Save summary as Markdown ─────────────────────────────────────────
ipcMain.handle('file:saveMd', async (_e, { title, content }: { title: string; content: string }) => {
  const safeName = title.replace(/[^a-z0-9\s]/gi, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'summary'
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Summary as Markdown',
    defaultPath: join(os.homedir(), 'Documents', `${safeName}.md`),
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })
  if (canceled || !filePath) return { success: false }
  try {
    fs.writeFileSync(filePath, content, 'utf-8')
    return { success: true, filePath }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})
```

Add immediately after it:

```ts
// ── IPC: Save screenshot as PNG ────────────────────────────────────────────
ipcMain.handle('file:saveImage', async (_e, { dataUrl, baseName }: { dataUrl: string; baseName?: string }) => {
  const safeName = (baseName || 'screenshot').replace(/[^a-z0-9\s-]/gi, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'screenshot'
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Screenshot',
    defaultPath: join(os.homedir(), 'Documents', `${safeName}-${Date.now()}.png`),
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
  })
  if (canceled || !filePath) return { success: false }
  try {
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'))
    return { success: true, filePath }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

// ── IPC: Save tab recording as WebM ────────────────────────────────────────
ipcMain.handle('file:saveVideo', async (_e, { buffer }: { buffer: ArrayBuffer }) => {
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Recording',
    defaultPath: join(os.homedir(), 'Documents', `recording-${Date.now()}.webm`),
    filters: [{ name: 'WebM Video', extensions: ['webm'] }],
  })
  if (canceled || !filePath) return { success: false }
  try {
    fs.writeFileSync(filePath, Buffer.from(buffer))
    return { success: true, filePath }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

// ── IPC: Media source id for tab/window recording ─────────────────────────
// getMediaSourceId() (no-arg BrowserWindow method) hands back an id usable
// directly as chromeMediaSourceId in a renderer-side getUserMedia call,
// scoped to this app's own window — no desktopCapturer.getSources() call or
// OS screen-picker permission dance needed for capturing our own window.
ipcMain.handle('recorder:getSourceId', () => {
  try { return mainWindow.getMediaSourceId() } catch { return null }
})
```

- [ ] **Step 2: Expose the new channels in preload**

In `src/preload/index.ts`, find:

```ts
  file: {
    saveMd: (opts: { title: string; content: string }) => ipcRenderer.invoke('file:saveMd', opts),
  },
```

Replace with:

```ts
  file: {
    saveMd:    (opts: { title: string; content: string })      => ipcRenderer.invoke('file:saveMd', opts),
    saveImage: (opts: { dataUrl: string; baseName?: string })  => ipcRenderer.invoke('file:saveImage', opts),
    saveVideo: (opts: { buffer: ArrayBuffer })                  => ipcRenderer.invoke('file:saveVideo', opts),
  },
```

Find:

```ts
  webview: {
    capture:     (wcId: number)                 => ipcRenderer.invoke('webview:capture', wcId),
    execScript:  (wcId: number, script: string) => ipcRenderer.invoke('webview:execScript', wcId, script),
  },
```

Add immediately after it:

```ts
  recorder: {
    getSourceId: (): Promise<string | null> => ipcRenderer.invoke('recorder:getSourceId'),
  },
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors mentioning `main/index.ts` or `preload/index.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "feat: add screenshot/recording save IPC and media source id"
```

---

### Task 2: Nav-bar screenshot and recording buttons

**Files:**
- Modify: `src/renderer/src/components/browser/NavigationBar.tsx`

**Interfaces:**
- Consumes: `window.electronAPI.webview.capture(wcId): Promise<string|null>`, `window.electronAPI.file.saveImage(...)`, `window.electronAPI.file.saveVideo(...)`, `window.electronAPI.recorder.getSourceId(): Promise<string|null>` (all from Task 1); `tabWcIds: Record<string, number>` from `useBrowserStore()` (already defined in `src/renderer/src/store/browserStore.ts:64`).

- [ ] **Step 1: Import new icons and pull `tabWcIds` from the store**

Find:

```tsx
import {
  ChevronLeft, ChevronRight, RotateCw, Home, Bookmark, Bot,
  Lock, AlertTriangle, PanelLeft, Pencil, Search, Globe,
} from 'lucide-react'
```

Replace with:

```tsx
import {
  ChevronLeft, ChevronRight, RotateCw, Home, Bookmark, Bot,
  Lock, AlertTriangle, PanelLeft, Pencil, Search, Globe, Camera, Video, Square,
} from 'lucide-react'
```

Find:

```tsx
  const {
    tabs, activeTabId, toggleAIPanel, isAIPanelOpen,
    bookmarks, addBookmark, removeBookmark, toggleSidebar, isSidebarOpen,
    isAnnotationMode, toggleAnnotationMode,
  } = useBrowserStore()
```

Replace with:

```tsx
  const {
    tabs, activeTabId, toggleAIPanel, isAIPanelOpen,
    bookmarks, addBookmark, removeBookmark, toggleSidebar, isSidebarOpen,
    isAnnotationMode, toggleAnnotationMode, tabWcIds,
  } = useBrowserStore()
```

- [ ] **Step 2: Add screenshot + recording state and handlers**

Find:

```tsx
  // Ctrl+L now arrives via the main process (works even when a page inside
  // the BrowserView has focus) as this custom event — see App.tsx.
  useEffect(() => {
    const h = () => {
      inputRef.current?.focus()
      setTimeout(() => inputRef.current?.select(), 10)
    }
    document.addEventListener('aihub-focus-url', h)
    return () => document.removeEventListener('aihub-focus-url', h)
  }, [])
```

Add immediately after it:

```tsx
  // ── Screenshot ────────────────────────────────────────────────────────
  const takeScreenshot = async () => {
    const wcId = activeTabId ? tabWcIds[activeTabId] : null
    if (!wcId) { showBmToast("No page to capture"); return }
    try {
      const dataUrl = await window.electronAPI.webview.capture(wcId)
      if (!dataUrl) { showBmToast("Couldn't capture screenshot"); return }
      const result = await (window.electronAPI as any).file.saveImage({ dataUrl, baseName: 'screenshot' })
      if (result?.success) showBmToast('Screenshot saved')
      else if (result?.error) showBmToast(`Couldn't save: ${result.error}`)
      // canceled dialog: silent, matches file:saveMd behavior
    } catch (e: any) {
      showBmToast(`Couldn't capture: ${e?.message || e}`)
    }
  }

  // ── Tab recording ────────────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false)
  const [recSeconds,  setRecSeconds]  = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recStreamRef     = useRef<MediaStream | null>(null)
  const recChunksRef     = useRef<Blob[]>([])
  const recTimerRef      = useRef<ReturnType<typeof setInterval> | null>(null)

  const formatRecTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  const startRecording = async () => {
    try {
      const sourceId = await (window.electronAPI as any).recorder.getSourceId()
      if (!sourceId) { showBmToast("Couldn't start recording"); return }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } },
      } as any)
      recStreamRef.current = stream
      recChunksRef.current = []
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' })
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recChunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        const blob = new Blob(recChunksRef.current, { type: 'video/webm' })
        recChunksRef.current = []
        const buffer = await blob.arrayBuffer()
        const result = await (window.electronAPI as any).file.saveVideo({ buffer })
        if (result?.success) showBmToast('Recording saved')
        else if (result?.error) showBmToast(`Couldn't save: ${result.error}`)
        recStreamRef.current?.getTracks().forEach(t => t.stop())
        recStreamRef.current = null
      }
      recorder.start()
      mediaRecorderRef.current = recorder
      setIsRecording(true)
      setRecSeconds(0)
      recTimerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000)
    } catch (e: any) {
      showBmToast(`Couldn't start recording: ${e?.message || e}`)
    }
  }

  const stopRecording = () => {
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null }
    setIsRecording(false)
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
  }

  // Safety net: if the nav bar unmounts mid-recording, stop the stream
  // rather than leaking an active capture.
  useEffect(() => () => {
    if (recTimerRef.current) clearInterval(recTimerRef.current)
    recStreamRef.current?.getTracks().forEach(t => t.stop())
  }, [])
```

- [ ] **Step 3: Add the buttons to the right-side action group**

Find:

```tsx
        <NavBtn
          onClick={toggleAnnotationMode}
          title="Annotate page"
          active={isAnnotationMode}
        >
          <Pencil size={13} />
        </NavBtn>

        {/* AI assistant button — purple accent — opens the full docked panel */}
        <AIButton onClick={toggleAIPanel} active={isAIPanelOpen} />
```

Replace with:

```tsx
        <NavBtn
          onClick={toggleAnnotationMode}
          title="Annotate page"
          active={isAnnotationMode}
        >
          <Pencil size={13} />
        </NavBtn>

        <NavBtn onClick={takeScreenshot} title="Screenshot" disabled={isSpecialPage || !activeTabId}>
          <Camera size={13} />
        </NavBtn>

        {isRecording ? (
          <button
            onClick={stopRecording}
            title="Stop recording"
            className="no-drag flex items-center gap-1.5 rounded-xl"
            style={{
              height: 32, padding: '0 10px', cursor: 'pointer',
              background: 'rgba(239,68,68,0.16)', border: '1px solid rgba(239,68,68,0.4)',
              color: '#f87171',
            }}
          >
            <Square size={11} fill="currentColor" />
            <span style={{ fontSize: 11, fontWeight: 700 }}>{formatRecTime(recSeconds)}</span>
          </button>
        ) : (
          <NavBtn onClick={startRecording} title="Record tab" disabled={isSpecialPage || !activeTabId}>
            <Video size={13} />
          </NavBtn>
        )}

        {/* AI assistant button — purple accent — opens the full docked panel */}
        <AIButton onClick={toggleAIPanel} active={isAIPanelOpen} />
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors mentioning `NavigationBar.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/browser/NavigationBar.tsx
git commit -m "feat: add screenshot and tab-recording buttons to nav bar"
```

---

### Task 3: Fix annotation Save button to export a real composited screenshot

**Files:**
- Modify: `src/renderer/src/components/browser/AnnotationCanvas.tsx`

**Interfaces:**
- Consumes: `window.electronAPI.webview.capture(wcId): Promise<string|null>` (existing), `window.electronAPI.file.saveImage(...)` (Task 1).
- Produces (in-page): `window.__aihub_shotQueue: Array<{strokesDataUrl: string}>` — pushed by the Save button, drained by the existing host poll loop alongside `__aihub_aiQueue`.

- [ ] **Step 1: Change the in-page Save button to enqueue instead of downloading directly**

Find (inside `INJECT_SCRIPT`):

```js
  actionsRow.appendChild(actionBtn('\\uD83D\\uDCBE Save',function(){
    var a=document.createElement('a');
    a.download='annotation-'+Date.now()+'.png';
    a.href=cv.toDataURL('image/png');
    document.body.appendChild(a); a.click(); a.remove();
  },'#22c55e'));
```

Replace with:

```js
  actionsRow.appendChild(actionBtn('\\uD83D\\uDCBE Save',function(){
    window.__aihub_shotQueue=window.__aihub_shotQueue||[];
    window.__aihub_shotQueue.push({strokesDataUrl:cv.toDataURL('image/png')});
  },'#22c55e'));
```

- [ ] **Step 2: Widen the drain script to pull both queues in one round trip**

Find:

```tsx
// Drains pending note-AI requests enqueued by ✨ buttons inside the page.
const DRAIN_SCRIPT = `(function(){var q=window.__aihub_aiQueue||[];window.__aihub_aiQueue=[];return JSON.stringify(q);})()`
```

Replace with:

```tsx
// Drains pending note-AI requests AND pending screenshot requests in one
// round trip — both are queued by in-page buttons and can only be reached
// from the host via execScript.
const DRAIN_SCRIPT = `(function(){
  var ai=window.__aihub_aiQueue||[];window.__aihub_aiQueue=[];
  var shots=window.__aihub_shotQueue||[];window.__aihub_shotQueue=[];
  return JSON.stringify({ai:ai,shots:shots});
})()`

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

// Composites the captured page (actual pixels) under the drawn strokes
// layer (transparent PNG). Scales the strokes image to the page image's
// pixel dimensions so a HiDPI mismatch between capturePage()'s device
// pixels and the strokes canvas's CSS pixels doesn't misalign the overlay.
async function compositeScreenshot(pageDataUrl: string, strokesDataUrl: string): Promise<string> {
  const [pageImg, strokesImg] = await Promise.all([loadImage(pageDataUrl), loadImage(strokesDataUrl)])
  const canvas = document.createElement('canvas')
  canvas.width = pageImg.naturalWidth
  canvas.height = pageImg.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(pageImg, 0, 0)
  ctx.drawImage(strokesImg, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}
```

- [ ] **Step 3: Update the poll loop to handle both queue types**

Find:

```tsx
    const poll = setInterval(async () => {
      const id = wcIdRef.current
      if (id === null) return
      try {
        const res = await window.electronAPI.webview.execScript(id, DRAIN_SCRIPT)
        if (!res?.ok) return
        const queue = JSON.parse(String(res.result || '[]'))
        if (!Array.isArray(queue) || queue.length === 0) return
        const pageRes = await window.electronAPI.webview.execScript(id, buildPageExtractionScript())
        const pageText = pageRes?.ok ? String(pageRes.result || '').trim() : ''
        for (const req of queue) {
          if (!req || typeof req.noteId !== 'string') continue
          const prompt = req.text
            ? `Answer briefly based on this page.\nQUESTION/INSTRUCTION: ${req.text}\n\nPAGE CONTENT:\n${pageText}`
            : `Summarize this page in 3-5 short bullet points.\n\nPAGE CONTENT:\n${pageText}`
          let answer = ''
          try {
            const result = await window.electronAPI.ai.chat([{ role: 'user', content: prompt }])
            answer = result?.content || 'No response from AI.'
          } catch (e: any) {
            answer = `AI error: ${e?.message || e}`
          }
          const target = wcIdRef.current
          if (target === null) break
          await window.electronAPI.webview.execScript(
            target,
            `window.__aihub_setNoteText&&window.__aihub_setNoteText(${JSON.stringify(req.noteId)},${JSON.stringify(answer)})`
          ).catch(() => {})
        }
      } catch {}
    }, 1000)
```

Replace with:

```tsx
    const poll = setInterval(async () => {
      const id = wcIdRef.current
      if (id === null) return
      try {
        const res = await window.electronAPI.webview.execScript(id, DRAIN_SCRIPT)
        if (!res?.ok) return
        const drained = JSON.parse(String(res.result || '{}'))
        const aiQueue: any[] = Array.isArray(drained.ai) ? drained.ai : []
        const shotQueue: any[] = Array.isArray(drained.shots) ? drained.shots : []

        if (aiQueue.length > 0) {
          const pageRes = await window.electronAPI.webview.execScript(id, buildPageExtractionScript())
          const pageText = pageRes?.ok ? String(pageRes.result || '').trim() : ''
          for (const req of aiQueue) {
            if (!req || typeof req.noteId !== 'string') continue
            const prompt = req.text
              ? `Answer briefly based on this page.\nQUESTION/INSTRUCTION: ${req.text}\n\nPAGE CONTENT:\n${pageText}`
              : `Summarize this page in 3-5 short bullet points.\n\nPAGE CONTENT:\n${pageText}`
            let answer = ''
            try {
              const result = await window.electronAPI.ai.chat([{ role: 'user', content: prompt }])
              answer = result?.content || 'No response from AI.'
            } catch (e: any) {
              answer = `AI error: ${e?.message || e}`
            }
            const target = wcIdRef.current
            if (target === null) break
            await window.electronAPI.webview.execScript(
              target,
              `window.__aihub_setNoteText&&window.__aihub_setNoteText(${JSON.stringify(req.noteId)},${JSON.stringify(answer)})`
            ).catch(() => {})
          }
        }

        for (const shot of shotQueue) {
          if (!shot || typeof shot.strokesDataUrl !== 'string') continue
          try {
            const pageDataUrl = await window.electronAPI.webview.capture(id)
            if (!pageDataUrl) continue
            const composited = await compositeScreenshot(pageDataUrl, shot.strokesDataUrl)
            await (window.electronAPI as any).file.saveImage({ dataUrl: composited, baseName: 'annotation' })
          } catch { /* one failed shot shouldn't block the next poll tick */ }
        }
      } catch {}
    }, 1000)
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors mentioning `AnnotationCanvas.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/browser/AnnotationCanvas.tsx
git commit -m "fix: annotation Save button now exports composited page+strokes screenshot"
```

---

### Task 4: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Build and launch**

Run: `npm run build` (should complete with no errors, confirms Tasks 1–3 compile together), then `npm run dev` (wait ~10s).

- [ ] **Step 2: Standalone screenshot**

Open any normal website in a tab. Click the camera icon in the nav bar. A native "Save Screenshot" dialog should appear defaulting to `Documents/screenshot-<timestamp>.png`. Save it, then open the saved file.
Expected: PNG matches what was on screen (real page content, not blank).

- [ ] **Step 3: Screenshot with no active tab**

Go to the home screen (no tab open) and click the camera icon.
Expected: button is disabled (grayed out, not clickable) — no dialog, no crash.

- [ ] **Step 4: Tab recording**

On a tab with visible content/motion (e.g. a page with an animation, or just move the mouse over visible UI), click the video icon. It should switch to a red "■ 00:01" style stop button that counts up. Wait ~5 seconds, click it to stop.
Expected: native "Save Recording" dialog appears defaulting to `Documents/recording-<timestamp>.webm`. Save it, then play the file in a video player (e.g. VLC or a browser tab).
Expected: plays back ~5 seconds of the app window as it appeared during recording.

- [ ] **Step 5: Annotation composited screenshot**

Open a content-rich page (e.g. a news article). Click the pencil icon to enter annotate mode. Draw a few strokes and an arrow on the page. Click "💾 Save" in the in-page toolbar.
Expected: within ~1 second (poll interval), a native "Save Screenshot" dialog appears defaulting to `Documents/annotation-<timestamp>.png`. Save it, then open the file.
Expected: the saved PNG shows the real page content with your drawn strokes/arrow overlaid on top — not a blank/transparent image.

- [ ] **Step 6: Report results**

Note any failed step and what happened instead. Do not mark this plan complete until Steps 2, 4, and 5 pass.
