# Annotation Sticky Notes with AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sticky notes in the annotation tool — draggable, editable, saved per page URL, with a per-note ✨ AI button (empty note → page summary; note with text → AI answers it about the page).

**Architecture:** Note widgets live inside the existing `INJECT_SCRIPT` (in-page DOM, same as the annotation toolbar), persisted to the guest page's localStorage keyed by URL. AI requests flow through a host-polled queue: the ✨ button enqueues on `window.__aihub_aiQueue`, the `AnnotationCanvas` React component drains it every second via `execScript`, calls the existing `ai:chat`, and writes answers back with an in-page `window.__aihub_setNoteText` helper.

**Tech Stack:** TypeScript, React, injected in-page JS strings, `window.electronAPI.webview.execScript`, `window.electronAPI.ai.chat`, `buildPageExtractionScript()` from `services/pageExtractor`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-02-annotation-sticky-notes-design.md`
- No automated test suite. Verification per task is `npx tsc --noEmit -p tsconfig.web.json`; final task is manual verification in the running dev app.
- Never throw from injected page-context code — wrap risky operations (localStorage, JSON) in try/catch and degrade silently (existing codebase-wide contract).
- No new IPC channels. `window.electronAPI.ai.chat(msgs)` returns `{content, model, provider}`.
- Notes persistence key: `'__aihub_notes::' + location.origin + location.pathname`.
- All note DOM uses `z-index:2147483647` (above the canvas at 2147483646).

---

### Task 1: In-page sticky-note widgets with persistence

**Files:**
- Modify: `src/renderer/src/components/browser/AnnotationCanvas.tsx` (the `INJECT_SCRIPT` template string only — three insertion points)

**Interfaces:**
- Produces (in-page, consumed by Task 2's host polling): `window.__aihub_aiQueue: Array<{noteId: string, text: string}>` — ✨ clicks push here; `window.__aihub_setNoteText(id: string, text: string)` — replaces a note's text, clears its thinking state, saves.

- [ ] **Step 1: Add the 🗒 Note button to the toolbar actions row**

In `src/renderer/src/components/browser/AnnotationCanvas.tsx`, inside `INJECT_SCRIPT`, find:

```js
  actionsRow.appendChild(actionBtn('\\uD83D\\uDCBE Save',function(){
    var a=document.createElement('a');
    a.download='annotation-'+Date.now()+'.png';
    a.href=cv.toDataURL('image/png');
    document.body.appendChild(a); a.click(); a.remove();
  },'#22c55e'));
```

Add immediately after it (still before `tb.appendChild(actionsRow);`):

```js
  actionsRow.appendChild(actionBtn('\\uD83D\\uDDD2 Note',function(){ createNote(); },'#eab308'));
```

- [ ] **Step 2: Add the notes section**

In the same `INJECT_SCRIPT`, find:

```js
  window.__aihub={
    remove:function(){ cv.remove(); tb.remove(); delete window.__aihub; }
  };
  return 'injected';
```

Replace with:

```js
  // ── Sticky notes — in-page widgets, persisted per URL in site localStorage ──
  var NOTES_KEY='__aihub_notes::'+location.origin+location.pathname;
  var notes=[];
  var noteEls={};
  function saveNotes(){try{localStorage.setItem(NOTES_KEY,JSON.stringify(notes));}catch(e){}}
  function makeNoteEl(n){
    var el=document.createElement('div');
    el.id='__aihub_note_'+n.id;
    el.style.cssText='position:fixed;left:'+n.x+'px;top:'+n.y+'px;width:220px;z-index:2147483647;background:linear-gradient(180deg,#fef08a,#fde047);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.35);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;flex-direction:column;overflow:hidden;';
    var head=document.createElement('div');
    head.style.cssText='display:flex;align-items:center;gap:6px;padding:6px 8px;background:rgba(0,0,0,0.07);cursor:grab;user-select:none;';
    var t=document.createElement('span');
    t.textContent='\\uD83D\\uDDD2';t.style.cssText='font-size:12px;';
    var sp=document.createElement('div');sp.style.flex='1';
    var ai=document.createElement('button');
    ai.type='button';ai.textContent='\\u2728';
    ai.title='Empty note: AI summarizes this page. With text: AI answers it about this page.';
    ai.style.cssText='width:22px;height:22px;border:none;border-radius:6px;background:rgba(0,0,0,0.08);cursor:pointer;font-size:12px;';
    var del=document.createElement('button');
    del.type='button';del.textContent='\\u00D7';del.title='Delete note';
    del.style.cssText='width:22px;height:22px;border:none;border-radius:6px;background:rgba(0,0,0,0.08);cursor:pointer;font-size:14px;line-height:1;color:#713f12;';
    head.appendChild(t);head.appendChild(sp);head.appendChild(ai);head.appendChild(del);
    var body=document.createElement('div');
    body.contentEditable='true';
    body.textContent=n.text||'';
    body.style.cssText='min-height:70px;max-height:220px;overflow-y:auto;padding:8px 10px;font-size:12px;line-height:1.5;color:#422006;outline:none;white-space:pre-wrap;word-break:break-word;';
    el.appendChild(head);el.appendChild(body);
    document.body.appendChild(el);
    noteEls[n.id]={el:el,body:body,ai:ai};
    var deb=null;
    body.addEventListener('input',function(){
      n.text=body.textContent||'';
      if(deb)clearTimeout(deb);
      deb=setTimeout(saveNotes,400);
    });
    del.onclick=function(){
      notes=notes.filter(function(x){return x.id!==n.id;});
      delete noteEls[n.id];
      el.remove();saveNotes();
    };
    ai.onclick=function(){
      if(ai.disabled)return;
      ai.disabled=true;ai.textContent='\\u23F3';
      window.__aihub_aiQueue=window.__aihub_aiQueue||[];
      window.__aihub_aiQueue.push({noteId:n.id,text:(n.text||'').trim()});
    };
    var ndrag=false,nx=0,ny=0;
    head.addEventListener('mousedown',function(e){
      if(e.target===ai||e.target===del)return;
      ndrag=true;var r=el.getBoundingClientRect();nx=e.clientX-r.left;ny=e.clientY-r.top;e.preventDefault();
    });
    window.addEventListener('mousemove',function(e){
      if(!ndrag)return;
      n.x=Math.max(4,e.clientX-nx);n.y=Math.max(4,e.clientY-ny);
      el.style.left=n.x+'px';el.style.top=n.y+'px';
    });
    window.addEventListener('mouseup',function(){ if(ndrag){ndrag=false;saveNotes();} });
  }
  function createNote(){
    var tbr=tb.getBoundingClientRect();
    var n={id:Date.now()+''+Math.floor(Math.random()*1000),
      x:Math.min(window.innerWidth-240,tbr.right+16+Math.random()*40),
      y:Math.max(8,tbr.top+Math.random()*40),text:''};
    notes.push(n);makeNoteEl(n);saveNotes();
  }
  function loadNotes(){
    try{
      var s=localStorage.getItem(NOTES_KEY);
      if(!s)return;
      var arr=JSON.parse(s);
      if(Array.isArray(arr)){notes=arr;notes.forEach(makeNoteEl);}
    }catch(e){}
  }
  window.__aihub_setNoteText=function(id,text){
    var rec=noteEls[id];var n=null;
    for(var i=0;i<notes.length;i++)if(notes[i].id===id)n=notes[i];
    if(!rec||!n)return;
    n.text=text;rec.body.textContent=text;
    rec.ai.disabled=false;rec.ai.textContent='\\u2728';
    saveNotes();
  };
  loadNotes();

  window.__aihub={
    remove:function(){
      cv.remove(); tb.remove();
      Object.keys(noteEls).forEach(function(k){try{noteEls[k].el.remove();}catch(e){}});
      delete window.__aihub_setNoteText;
      delete window.__aihub_aiQueue;
      delete window.__aihub;
    }
  };
  return 'injected';
```

(Note: `createNote` is referenced by Step 1's button and defined here — both live inside the same IIFE, and the button only calls it on click, after the whole script has run. The keyboard-shortcut handler already ignores `contenteditable` targets, so typing in a note never switches tools.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors mentioning `AnnotationCanvas.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/browser/AnnotationCanvas.tsx
git commit -m "feat: sticky notes in annotation tool with per-URL persistence"
```

---

### Task 2: Host-side AI bridge

**Files:**
- Modify: `src/renderer/src/components/browser/AnnotationCanvas.tsx` (imports + the React component at the bottom; `INJECT_SCRIPT` unchanged)

**Interfaces:**
- Consumes: `window.__aihub_aiQueue` / `window.__aihub_setNoteText` (Task 1, in-page); `buildPageExtractionScript(): string` from `../../services/pageExtractor`; `window.electronAPI.ai.chat(msgs)` → `{content, model, provider}`.

- [ ] **Step 1: Add the import**

Find:

```tsx
import { useEffect, useRef } from 'react'
import { useBrowserStore } from '../../store/browserStore'
```

Replace with:

```tsx
import { useEffect, useRef } from 'react'
import { useBrowserStore } from '../../store/browserStore'
import { buildPageExtractionScript } from '../../services/pageExtractor'
```

- [ ] **Step 2: Add the drain script constant and polling loop**

Find:

```tsx
export default function AnnotationCanvas() {
  const { activeTabId, tabWcIds } = useBrowserStore()
  const wcId = activeTabId ? tabWcIds[activeTabId] : null
  const wcIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!wcId) return
    wcIdRef.current = wcId
    window.electronAPI.webview.execScript(wcId, INJECT_SCRIPT).catch(() => {})

    return () => {
      if (wcIdRef.current !== null) {
        window.electronAPI.webview.execScript(wcIdRef.current, `window.__aihub&&window.__aihub.remove()`).catch(() => {})
      }
      wcIdRef.current = null
    }
  }, [wcId])
```

Replace with:

```tsx
// Drains pending note-AI requests enqueued by ✨ buttons inside the page.
const DRAIN_SCRIPT = `(function(){var q=window.__aihub_aiQueue||[];window.__aihub_aiQueue=[];return JSON.stringify(q);})()`

export default function AnnotationCanvas() {
  const { activeTabId, tabWcIds } = useBrowserStore()
  const wcId = activeTabId ? tabWcIds[activeTabId] : null
  const wcIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!wcId) return
    wcIdRef.current = wcId
    window.electronAPI.webview.execScript(wcId, INJECT_SCRIPT).catch(() => {})

    // Guest pages can't reach electronAPI, so the ✨ buttons only enqueue.
    // Poll the queue, run ai:chat host-side, write answers back into notes.
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

    return () => {
      clearInterval(poll)
      if (wcIdRef.current !== null) {
        window.electronAPI.webview.execScript(wcIdRef.current, `window.__aihub&&window.__aihub.remove()`).catch(() => {})
      }
      wcIdRef.current = null
    }
  }, [wcId])
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors mentioning `AnnotationCanvas.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/browser/AnnotationCanvas.tsx
git commit -m "feat: AI bridge writes chat answers into annotation sticky notes"
```

---

### Task 3: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev build**

Run: `npm run dev` (detaches; wait ~10s).

- [ ] **Step 2: Create, edit, drag, persist**

Open a normal website → toggle the annotation tool (pencil icon in the nav bar) → click "🗒 Note" → note appears near the toolbar → type text → drag it elsewhere → close the annotation tool → reopen it.
Expected: note reappears at its dragged position with the typed text.

- [ ] **Step 3: Restart persistence**

Quit and relaunch the dev app, revisit the same URL, open annotation.
Expected: note still there.

- [ ] **Step 4: AI summary (empty note)**

On a content-rich page, create a fresh note, leave it empty, click ✨.
Expected: button shows ⏳, then within ~5–60s the note fills with a 3–5 bullet summary of the page, ✨ restored.

- [ ] **Step 5: AI answer (note with text)**

Type a question about the page into a note (e.g. "what is the main claim here?"), click ✨.
Expected: answer relevant to the page replaces the question.

- [ ] **Step 6: Delete**

Click × on a note; close and reopen annotation.
Expected: note gone; does not resurrect.

- [ ] **Step 7: AI-unavailable path (if practical)**

If Ollama can be stopped and no cloud key is set: click ✨ on a note.
Expected: the diagnostic error text lands in the note; ✨ is clickable again. (Skip with a note if Ollama can't be stopped safely.)

- [ ] **Step 8: Report results**

Note any failed step and what happened instead. Do not mark complete until Steps 2–6 pass.
