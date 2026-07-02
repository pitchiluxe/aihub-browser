# Dime Video Dimming + AI Summarize Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Dime extension darkening the video it's supposed to spotlight, add YouTube transcript extraction so the AI can actually summarize videos, and stop silently swallowing Ollama failures so "AI isn't working" is diagnosable instead of a dead end.

**Architecture:** Dime's fix is a self-contained rewrite of one injected script (box-shadow spotlight instead of full-viewport overlay). The transcript work extracts the existing inline page-extraction script into its own module and adds YouTube-specific logic ahead of the existing generic fallback. The Ollama-diagnostics fix threads a captured error string through two existing IPC handlers into their existing fallback messages — no new IPC, no new return shapes.

**Tech Stack:** TypeScript, React, Electron main-process IPC (`ipcMain.handle`), injected browser-context JS strings (same pattern already used throughout `extensionDefs.ts` and `agentTools.ts`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-02-dime-video-and-ai-summarize-fixes-design.md`
- No automated test suite exists in this project (confirmed in prior sessions — no jest/vitest/tsx configured). Verification per task is `npx tsc --noEmit -p tsconfig.web.json` (renderer files) or `-p tsconfig.node.json` (main-process files), plus manual verification in the running dev app for the final task.
- Never throw from any injected page-context script or from the page-content extraction path — always degrade to the existing generic-text fallback. This is an existing codebase-wide contract (see `agentTools.ts`'s `executeAction`, `AnnotationCanvas.tsx`'s injected script) and must hold here too.
- `read_page`/`getPageContent`'s existing 8000-char truncation cap must be preserved for both the transcript path and the generic-text path.
- The Ollama-diagnostic changes must not alter the `{content, model, provider}` / `{summary}` return shapes of `ai:chat` / `ai:summarizePage` — purely additive text in the existing fallback message fields.

---

### Task 1: Fix Dime extension — spotlight overlay instead of full-viewport overlay

**Files:**
- Modify: `src/renderer/src/extensions/extensionDefs.ts:26-77` (the `dime` extension entry)

**Interfaces:**
- No change to the `ExtensionDef` shape (`inject`/`remove`/`settings` fields unchanged in type) — only the JS source strings change.

- [ ] **Step 1: Replace the `dime` extension's `inject` and `remove` fields**

Find this entire block (lines 26-77 of `src/renderer/src/extensions/extensionDefs.ts`):

```ts
export const EXTENSION_DEFS: ExtensionDef[] = [
  {
    id: 'dime',
    name: 'Dime',
    tagline: 'Dims the background while video plays',
    description: 'Creates a dark overlay around playing videos to bring cinematic focus to the content. Opacity is fully adjustable. Works on YouTube, Vimeo, and any HTML5 video.',
    icon: '🎬',
    color: '#f59e0b',
    category: 'Media',
    version: '1.0.0',
    settings: [
      { key: 'opacity', label: 'Dim Opacity', type: 'range', min: 0.1, max: 0.95, step: 0.05, default: 0.7 },
    ],
    inject: (s) => `(function(){
  var K='__ext_dime';
  if(window[K]){window[K].update(${+(s.opacity ?? 0.7)});return;}
  var op=${+(s.opacity ?? 0.7)},ov=null;
  function show(){
    if(ov)return;
    ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,'+op+');z-index:2147483640;pointer-events:none;transition:opacity 0.4s;opacity:0;';
    if(document.body)document.body.appendChild(ov);
    setTimeout(function(){if(ov)ov.style.opacity='1';},10);
  }
  function hide(){
    if(!ov)return;
    var o=ov;ov=null;
    o.style.opacity='0';
    setTimeout(function(){try{o.remove();}catch(e){}},420);
  }
  function check(){
    var pl=false;
    document.querySelectorAll('video').forEach(function(v){if(!v.paused&&!v.ended&&v.readyState>2)pl=true;});
    pl?show():hide();
  }
  document.addEventListener('play',check,true);
  document.addEventListener('pause',check,true);
  document.addEventListener('ended',check,true);
  check();
  window[K]={
    update:function(v){op=v;if(ov)ov.style.background='rgba(0,0,0,'+v+')';},
    remove:function(){
      hide();
      document.removeEventListener('play',check,true);
      document.removeEventListener('pause',check,true);
      document.removeEventListener('ended',check,true);
      delete window[K];
    }
  };
})()`,
    remove: `window.__ext_dime&&window.__ext_dime.remove()`,
  },
```

Replace with:

```ts
export const EXTENSION_DEFS: ExtensionDef[] = [
  {
    id: 'dime',
    name: 'Dime',
    tagline: 'Dims the background while video plays',
    description: 'Creates a dark overlay around playing videos to bring cinematic focus to the content. Opacity is fully adjustable. Works on YouTube, Vimeo, and any HTML5 video.',
    icon: '🎬',
    color: '#f59e0b',
    category: 'Media',
    version: '1.0.0',
    settings: [
      { key: 'opacity', label: 'Dim Opacity', type: 'range', min: 0.1, max: 0.95, step: 0.05, default: 0.7 },
    ],
    inject: (s) => `(function(){
  var K='__ext_dime';
  if(window[K]){window[K].update(${+(s.opacity ?? 0.7)});return;}
  var op=${+(s.opacity ?? 0.7)},ov=null,poll=null;
  function findLargestPlaying(){
    var best=null,bestArea=0;
    document.querySelectorAll('video').forEach(function(v){
      if(v.paused||v.ended||v.readyState<=2)return;
      var r=v.getBoundingClientRect();
      var area=r.width*r.height;
      if(area>bestArea){bestArea=area;best=r;}
    });
    return best;
  }
  function show(){
    if(ov)return;
    ov=document.createElement('div');
    ov.style.cssText='position:fixed;background:transparent;z-index:2147483640;pointer-events:none;transition:opacity 0.4s;opacity:0;';
    ov.style.boxShadow='0 0 0 9999px rgba(0,0,0,'+op+')';
    if(document.body)document.body.appendChild(ov);
    setTimeout(function(){if(ov)ov.style.opacity='1';},10);
  }
  function hide(){
    if(!ov)return;
    var o=ov;ov=null;
    o.style.opacity='0';
    setTimeout(function(){try{o.remove();}catch(e){}},420);
  }
  function position(){
    var r=findLargestPlaying();
    if(!r){hide();return;}
    if(!ov)show();
    if(ov){
      ov.style.left=r.left+'px';
      ov.style.top=r.top+'px';
      ov.style.width=r.width+'px';
      ov.style.height=r.height+'px';
    }
  }
  function check(){ position(); }
  document.addEventListener('play',check,true);
  document.addEventListener('pause',check,true);
  document.addEventListener('ended',check,true);
  window.addEventListener('resize',position);
  window.addEventListener('scroll',position,true);
  poll=setInterval(position,250);
  check();
  window[K]={
    update:function(v){
      op=v;
      if(ov)ov.style.boxShadow='0 0 0 9999px rgba(0,0,0,'+v+')';
    },
    remove:function(){
      hide();
      if(poll)clearInterval(poll);
      document.removeEventListener('play',check,true);
      document.removeEventListener('pause',check,true);
      document.removeEventListener('ended',check,true);
      window.removeEventListener('resize',position);
      window.removeEventListener('scroll',position,true);
      delete window[K];
    }
  };
})()`,
    remove: `window.__ext_dime&&window.__ext_dime.remove()`,
  },
```

(Only the `inject` function body changed — `remove`, `settings`, and every other field are byte-for-byte identical. Note the array's opening line `export const EXTENSION_DEFS: ExtensionDef[] = [` is included in both blocks only so the match is unambiguous — don't duplicate it.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors mentioning `extensionDefs.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/extensions/extensionDefs.ts
git commit -m "fix: Dime extension no longer dims the video it spotlights"
```

---

### Task 2: Create the page-extraction module with YouTube transcript support

**Files:**
- Create: `src/renderer/src/services/pageExtractor.ts`

**Interfaces:**
- Produces: `buildPageExtractionScript(): string` — consumed by Task 3.

- [ ] **Step 1: Write the module**

Create `src/renderer/src/services/pageExtractor.ts`:

```ts
// Builds the injected script used to extract "page content" for the AI —
// either the actual YouTube transcript (when the current page is a YouTube
// watch page with captions available) or the page's visible text otherwise.
// Both paths share the same 8000-char cap. Never throws: any failure along
// the transcript path falls back to the generic text extraction, matching
// the no-throw contract every other page-injection script in this codebase
// follows (see agentTools.ts, AnnotationCanvas.tsx).
export function buildPageExtractionScript(): string {
  return `(function(){
  function genericText(){
    var s=document.body.innerText||document.body.textContent||'';
    return s.slice(0,8000);
  }
  try{
    var params = new URLSearchParams(location.search);
    var vid = params.get('v');
    if(location.hostname.indexOf('youtube.com')!==-1 && vid){
      var pr = window.ytInitialPlayerResponse;
      if(pr && pr.videoDetails && pr.videoDetails.videoId===vid){
        var tracks = pr.captions && pr.captions.playerCaptionsTracklistRenderer && pr.captions.playerCaptionsTracklistRenderer.captionTracks;
        if(tracks && tracks.length){
          return fetch(tracks[0].baseUrl).then(function(r){return r.text();}).then(function(xml){
            var doc = new DOMParser().parseFromString(xml,'text/xml');
            var nodes = doc.getElementsByTagName('text');
            var parts=[];
            for(var i=0;i<nodes.length;i++){
              var raw = nodes[i].textContent || '';
              var ta = document.createElement('textarea'); ta.innerHTML = raw;
              parts.push(ta.value);
            }
            var joined = parts.join(' ').replace(/\\s+/g,' ').trim();
            return joined ? joined.slice(0,8000) : genericText();
          }).catch(function(){ return genericText(); });
        }
      }
    }
  }catch(e){}
  return genericText();
})()`
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors mentioning `pageExtractor.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/services/pageExtractor.ts
git commit -m "feat: add YouTube transcript extraction for page-content reads"
```

---

### Task 3: Wire the new extractor into `getPageContent`

**Files:**
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `buildPageExtractionScript()` from Task 2 (`./services/pageExtractor`).

- [ ] **Step 1: Import the new module**

Find this line near the top of `src/renderer/src/App.tsx`:

```tsx
import { loadBookmarks } from './services/bookmarkService'
```

Add immediately after it:

```tsx
import { buildPageExtractionScript } from './services/pageExtractor'
```

- [ ] **Step 2: Use it in `getPageContent`**

Find:

```tsx
  const getPageContent = useCallback(async (): Promise<string> => {
    if (!activeTabId) return ''
    const wcId = useBrowserStore.getState().tabWcIds[activeTabId]
    if (!wcId) return ''
    try {
      const res = await window.electronAPI.webview.execScript(wcId,
        `(function(){var s=document.body.innerText||document.body.textContent||'';return s.slice(0,8000);})()`
      )
      return res?.ok ? String(res.result || '').trim() : ''
    } catch { return '' }
  }, [activeTabId])
```

Replace with:

```tsx
  const getPageContent = useCallback(async (): Promise<string> => {
    if (!activeTabId) return ''
    const wcId = useBrowserStore.getState().tabWcIds[activeTabId]
    if (!wcId) return ''
    try {
      const res = await window.electronAPI.webview.execScript(wcId, buildPageExtractionScript())
      return res?.ok ? String(res.result || '').trim() : ''
    } catch { return '' }
  }, [activeTabId])
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors mentioning `App.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat: use YouTube-aware extraction for read_page/Summarize"
```

---

### Task 4: Surface Ollama failures in `ai:chat` instead of swallowing them

**Files:**
- Modify: `src/main/index.ts` (the `ai:chat` IPC handler)

**Interfaces:**
- No change to `ai:chat`'s return shape (`{content, model, provider}`) — purely additive diagnostic text in the existing fallback message strings.

- [ ] **Step 1: Capture and log the Ollama failure instead of discarding it**

Find, inside the `ai:chat` handler:

```ts
  // 1. Try local Ollama (preferred — private & free)
  try {
    const ol = await checkOllamaRunning()
    if (ol.running && ol.models.length > 0) {
      const preferred = preferredModel || getData().settings.aiModel || ''
      const model = (preferred && ol.models.includes(preferred)) ? preferred : ol.models[0]
      const { status, body } = await httpPost(
        `${olBase}/api/chat`, { model, messages, stream: false }, {}, 90000
      )
      if (status >= 200 && status < 400) {
        const raw = JSON.parse(body)?.message?.content || ''
        const content = stripThinkTags(raw)
        if (content) return { content, model, provider: 'ollama' }
      }
    }
  } catch {}
```

Replace with:

```ts
  // 1. Try local Ollama (preferred — private & free)
  let ollamaDiag = ''
  try {
    const ol = await checkOllamaRunning()
    if (ol.running && ol.models.length > 0) {
      const preferred = preferredModel || getData().settings.aiModel || ''
      const model = (preferred && ol.models.includes(preferred)) ? preferred : ol.models[0]
      try {
        const { status, body } = await httpPost(
          `${olBase}/api/chat`, { model, messages, stream: false }, {}, 90000
        )
        if (status >= 200 && status < 400) {
          const raw = JSON.parse(body)?.message?.content || ''
          const content = stripThinkTags(raw)
          if (content) return { content, model, provider: 'ollama' }
          ollamaDiag = `Ollama returned an empty response (model: ${model})`
        } else {
          ollamaDiag = `Ollama request failed (HTTP ${status}, model: ${model})`
        }
      } catch (e: any) {
        ollamaDiag = `Ollama request failed: ${e?.message || e} (model: ${model})`
      }
    }
  } catch (e: any) {
    ollamaDiag = `Ollama check failed: ${e?.message || e}`
  }
  if (ollamaDiag) console.warn('[aihub] ai:chat Ollama fallback:', ollamaDiag)
```

- [ ] **Step 2: Fold the diagnostic into the existing fallback messages**

Find:

```ts
    if (lastError) {
      return {
        content: `Cloud AI error: ${lastError}\n\nTry:\n• Wait 1–2 minutes and retry\n• Install Ollama (ollama.com) for private local AI\n• Check your OpenRouter API key in Settings → AI Configuration`,
        model: 'error', provider: 'error',
      }
    }
    return {
      content: 'All cloud models are currently unavailable.\n\n• Wait 1–2 minutes and retry\n• Install Ollama at ollama.com and run: ollama pull llama3.1\n• Check your OpenRouter API key in Settings → AI Configuration',
      model: 'none', provider: 'none',
    }
  }

  return {
    content: 'No AI configured.\n\n• Install Ollama at ollama.com, then run: ollama pull llama3.1\n• OR go to Settings → AI Configuration and paste your OpenRouter API key\n\nGet a free key at openrouter.ai',
    model: 'none', provider: 'none',
  }
})
```

Replace with:

```ts
    if (lastError) {
      return {
        content: `Cloud AI error: ${lastError}${ollamaDiag ? `\n\n(Local Ollama also failed: ${ollamaDiag})` : ''}\n\nTry:\n• Wait 1–2 minutes and retry\n• Install Ollama (ollama.com) for private local AI\n• Check your OpenRouter API key in Settings → AI Configuration`,
        model: 'error', provider: 'error',
      }
    }
    return {
      content: `All cloud models are currently unavailable.${ollamaDiag ? `\n\n(Local Ollama also failed: ${ollamaDiag})` : ''}\n\n• Wait 1–2 minutes and retry\n• Install Ollama at ollama.com and run: ollama pull llama3.1\n• Check your OpenRouter API key in Settings → AI Configuration`,
      model: 'none', provider: 'none',
    }
  }

  return {
    content: ollamaDiag
      ? `Ollama is set up but the request failed: ${ollamaDiag}\n\nTry:\n• Wait 1–2 minutes and retry\n• Restart Ollama\n• OR go to Settings → AI Configuration and paste an OpenRouter API key as a cloud fallback\n\nGet a free key at openrouter.ai`
      : 'No AI configured.\n\n• Install Ollama at ollama.com, then run: ollama pull llama3.1\n• OR go to Settings → AI Configuration and paste your OpenRouter API key\n\nGet a free key at openrouter.ai',
    model: 'none', provider: 'none',
  }
})
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "fix: stop silently swallowing Ollama failures in ai:chat"
```

---

### Task 5: Surface Ollama failures in `ai:summarizePage` instead of swallowing them

**Files:**
- Modify: `src/main/index.ts` (the `ai:summarizePage` IPC handler)

**Interfaces:**
- No change to `ai:summarizePage`'s return shape (`{summary}`) — purely additive diagnostic text.

- [ ] **Step 1: Replace the handler's Ollama-try block and final fallback**

Find the entire `ai:summarizePage` handler:

```ts
ipcMain.handle('ai:summarizePage', async (_e, pageText: string, url: string) => {
  const { olBase, orKey, orBase, orMdl } = getAIConfig()

  // Build prompt — use real extracted page text if available, else URL-based summary
  const userContent = pageText && pageText.length > 100
    ? `Summarize the following web page content in 3-5 concise bullet points. Focus on key takeaways, what the page is about, and who it's for.\n\nURL: ${url}\n\nPAGE CONTENT:\n${pageText.slice(0, 6000)}`
    : `Summarize the website at ${url} in 3-5 concise bullet points. Focus on what it does and who it's for.`

  const msgs = [{ role: 'user', content: userContent }]

  try {
    const ol = await checkOllamaRunning()
    if (ol.running && ol.models.length > 0) {
      const pref  = getData().settings.aiModel || ''
      const model = (pref && ol.models.includes(pref)) ? pref : ol.models[0]
      const { status, body } = await httpPost(`${olBase}/api/chat`, { model, messages: msgs, stream: false }, {}, 45000)
      if (status >= 200 && status < 400) {
        const raw = JSON.parse(body)?.message?.content || ''
        const summary = stripThinkTags(raw)
        if (summary) return { summary }
      }
    }
  } catch {}

  if (orKey) {
    const candidates = [...new Set([orMdl, ...OR_FREE_FALLBACKS])]
    for (const model of candidates) {
      try {
        const summary = await openRouterChat(orBase, orKey, model, msgs, 800)
        if (summary) return { summary }
      } catch { break }
    }
  }

  return { summary: 'Unable to summarize — Ollama offline and no cloud API key configured.' }
})
```

Replace with:

```ts
ipcMain.handle('ai:summarizePage', async (_e, pageText: string, url: string) => {
  const { olBase, orKey, orBase, orMdl } = getAIConfig()

  // Build prompt — use real extracted page text if available, else URL-based summary
  const userContent = pageText && pageText.length > 100
    ? `Summarize the following web page content in 3-5 concise bullet points. Focus on key takeaways, what the page is about, and who it's for.\n\nURL: ${url}\n\nPAGE CONTENT:\n${pageText.slice(0, 6000)}`
    : `Summarize the website at ${url} in 3-5 concise bullet points. Focus on what it does and who it's for.`

  const msgs = [{ role: 'user', content: userContent }]

  let ollamaDiag = ''
  try {
    const ol = await checkOllamaRunning()
    if (ol.running && ol.models.length > 0) {
      const pref  = getData().settings.aiModel || ''
      const model = (pref && ol.models.includes(pref)) ? pref : ol.models[0]
      try {
        const { status, body } = await httpPost(`${olBase}/api/chat`, { model, messages: msgs, stream: false }, {}, 45000)
        if (status >= 200 && status < 400) {
          const raw = JSON.parse(body)?.message?.content || ''
          const summary = stripThinkTags(raw)
          if (summary) return { summary }
          ollamaDiag = `Ollama returned an empty response (model: ${model})`
        } else {
          ollamaDiag = `Ollama request failed (HTTP ${status}, model: ${model})`
        }
      } catch (e: any) {
        ollamaDiag = `Ollama request failed: ${e?.message || e} (model: ${model})`
      }
    }
  } catch (e: any) {
    ollamaDiag = `Ollama check failed: ${e?.message || e}`
  }
  if (ollamaDiag) console.warn('[aihub] ai:summarizePage Ollama fallback:', ollamaDiag)

  if (orKey) {
    const candidates = [...new Set([orMdl, ...OR_FREE_FALLBACKS])]
    for (const model of candidates) {
      try {
        const summary = await openRouterChat(orBase, orKey, model, msgs, 800)
        if (summary) return { summary }
      } catch { break }
    }
  }

  return {
    summary: ollamaDiag
      ? `Unable to summarize — local Ollama failed: ${ollamaDiag}${orKey ? ' (cloud fallback also failed)' : ' and no cloud API key configured'}.`
      : 'Unable to summarize — Ollama offline and no cloud API key configured.',
  }
})
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "fix: stop silently swallowing Ollama failures in ai:summarizePage"
```

---

### Task 6: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev build**

Run: `npm run dev` (detaches; wait ~10s for the window to appear).

- [ ] **Step 2: Dime extension — video stays bright, background dims**

Enable the Dime extension (sidebar → Extensions → Dime → enable). Navigate to a YouTube video and play it.
Expected: page around the video darkens, the video itself stays full brightness. Resize the window, toggle YouTube's theater mode, and go fullscreen while playing — the dimmed region should track the video's new bounds each time, not stay pinned to the old position.

- [ ] **Step 3: YouTube transcript summarization via the AI bot**

Play a YouTube video that has captions/subtitles available (most popular videos do — check for the "cc" button in the player). In the AI panel (nav-bar AI button), ask: `summarize this video`.
Expected: the response reflects the video's actual spoken content (specific claims, topics, names mentioned in the video), not a generic "this is a YouTube page" non-answer.

- [ ] **Step 4: Graceful fallback on a video without captions**

Find or use a video with captions disabled. Ask the AI bot to summarize it.
Expected: no crash, no error about transcripts — falls back to whatever generic-page-text-based response the model produces (same behavior as before this plan, for that case).

- [ ] **Step 5: Manual Summarize button uses the same extraction**

On the same captioned video from Step 3, click the "Summarize" quick-action button in the AI panel instead of asking via chat.
Expected: same transcript-derived quality of summary — confirms both entry points share the fixed extraction path.

- [ ] **Step 6: Ollama diagnostic message (if reproducible)**

If Ollama is running: temporarily stop it (or block port 11434) and ask the AI bot a question with no OpenRouter key configured in Settings.
Expected: the error message explicitly says Ollama's check/request failed (not the old generic "No AI configured" implying nothing is set up), matching the new `ollamaDiag`-aware branch. Restart Ollama afterward.

- [ ] **Step 7: Report results**

If any expectation fails, note which step and what happened instead — do not mark this task complete until all six behavioral checks pass (Step 6 can be skipped if Ollama isn't available to test against, but note that it was skipped and why).
