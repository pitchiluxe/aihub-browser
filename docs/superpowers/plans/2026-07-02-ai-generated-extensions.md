# AI-Generated Extensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Generate with AI" button in the Extensions page that has the AI invent 5–10 working extensions (optionally themed) and saves them persistently alongside built-ins.

**Architecture:** A shared `customExts.ts` module replaces the page-private CustomExt helpers so `App.tsx` can re-inject enabled custom extensions on every page load (fixing the existing navigation-persistence gap). A new `extensionGenerator.ts` service builds a strict-JSON generation prompt for the existing `ai:chat` IPC and validates/parses the response per-item. A new modal in `ExtensionsPage.tsx` drives it.

**Tech Stack:** TypeScript, React, existing `window.electronAPI.ai.chat` (Ollama → OpenRouter fallback), localStorage.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-02-ai-generated-extensions-design.md`
- No automated test suite exists. Verification per task is `npx tsc --noEmit -p tsconfig.web.json` (all files here are renderer files); pre-existing unrelated TS errors elsewhere are not this plan's concern. Final task is manual verification in the running dev app.
- localStorage key `aihub-custom-exts` and the stored `CustomExt` shape must stay byte-identical — no migration.
- No new IPC channels; generation uses the existing `window.electronAPI.ai.chat(msgs)` which returns `{content, model, provider}`; a failed call has `provider === 'error'` or `'none'` with the error text in `content`.
- Generated code is syntax-checked with `new Function(code)` — constructed, never invoked in the host renderer.
- Valid categories are exactly: Media, Privacy, Productivity, Accessibility, Developer, Reading.

---

### Task 1: Shared custom-extension module + navigation-persistence fix

**Files:**
- Create: `src/renderer/src/extensions/customExts.ts`
- Modify: `src/renderer/src/components/pages/ExtensionsPage.tsx` (top of file, lines 1–23)
- Modify: `src/renderer/src/App.tsx` (imports + the `did-stop-loading` case)

**Interfaces:**
- Produces: `CustomExt` interface and `loadCustomExts(): CustomExt[]`, `saveCustomExts(exts: CustomExt[]): void` from `src/renderer/src/extensions/customExts.ts` — consumed by Tasks 2 and 3.

- [ ] **Step 1: Create the shared module**

Create `src/renderer/src/extensions/customExts.ts`:

```ts
// Custom (user-created or AI-generated) extensions. Shared between the
// Extensions page (create/generate/delete/toggle) and App.tsx (re-injection
// on every page load). Storage shape and key predate this module — do not
// change either.
export interface CustomExt {
  id: string
  name: string
  tagline: string
  icon: string
  category: string
  injectCode: string
  removeCode: string
}

export function loadCustomExts(): CustomExt[] {
  try { return JSON.parse(localStorage.getItem('aihub-custom-exts') || '[]') } catch { return [] }
}

export function saveCustomExts(exts: CustomExt[]) {
  try { localStorage.setItem('aihub-custom-exts', JSON.stringify(exts)) } catch {}
}
```

- [ ] **Step 2: Point ExtensionsPage at the shared module**

In `src/renderer/src/components/pages/ExtensionsPage.tsx`, find:

```tsx
import { EXTENSION_DEFS, ExtensionDef } from '../../extensions/extensionDefs'
import { useBrowserStore } from '../../store/browserStore'

const CATEGORIES = ['All', 'Media', 'Privacy', 'Productivity', 'Accessibility', 'Developer', 'Reading'] as const

interface CustomExt {
  id: string
  name: string
  tagline: string
  icon: string
  category: string
  injectCode: string
  removeCode: string
}

function loadCustomExts(): CustomExt[] {
  try { return JSON.parse(localStorage.getItem('aihub-custom-exts') || '[]') } catch { return [] }
}
function saveCustomExts(exts: CustomExt[]) {
  try { localStorage.setItem('aihub-custom-exts', JSON.stringify(exts)) } catch {}
}
```

Replace with:

```tsx
import { EXTENSION_DEFS, ExtensionDef } from '../../extensions/extensionDefs'
import { CustomExt, loadCustomExts, saveCustomExts } from '../../extensions/customExts'
import { useBrowserStore } from '../../store/browserStore'

const CATEGORIES = ['All', 'Media', 'Privacy', 'Productivity', 'Accessibility', 'Developer', 'Reading'] as const
```

- [ ] **Step 3: Re-inject enabled custom extensions on page load in App.tsx**

In `src/renderer/src/App.tsx`, find:

```tsx
import { buildPageExtractionScript } from './services/pageExtractor'
```

Add immediately after it:

```tsx
import { loadCustomExts } from './extensions/customExts'
```

Then find (inside the `did-stop-loading` case):

```tsx
          const wcId = store.tabWcIds[tabId]
          if (wcId) {
            const { extensionStates } = store
            EXTENSION_DEFS.forEach(ext => {
              const state = extensionStates[ext.id]
              if (state?.enabled) {
                const script = ext.inject(state.settings || {})
                window.electronAPI?.webview?.execScript?.(wcId, script)?.catch?.(() => {})
              }
            })
          }
```

Replace with:

```tsx
          const wcId = store.tabWcIds[tabId]
          if (wcId) {
            const { extensionStates } = store
            EXTENSION_DEFS.forEach(ext => {
              const state = extensionStates[ext.id]
              if (state?.enabled) {
                const script = ext.inject(state.settings || {})
                window.electronAPI?.webview?.execScript?.(wcId, script)?.catch?.(() => {})
              }
            })
            loadCustomExts().forEach(ext => {
              if (extensionStates[ext.id]?.enabled) {
                window.electronAPI?.webview?.execScript?.(wcId, ext.injectCode)?.catch?.(() => {})
              }
            })
          }
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors mentioning `customExts.ts`, `ExtensionsPage.tsx`, or `App.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/extensions/customExts.ts src/renderer/src/components/pages/ExtensionsPage.tsx src/renderer/src/App.tsx
git commit -m "feat: share custom-ext store and re-inject custom extensions on page load"
```

---

### Task 2: Generation service

**Files:**
- Create: `src/renderer/src/services/extensionGenerator.ts`

**Interfaces:**
- Consumes: `CustomExt` from `../extensions/customExts` (Task 1).
- Produces: `buildGenerationPrompt(topic: string, existingNames: string[]): string` and `parseGeneratedExtensions(raw: string, existingNames: string[]): { extensions: CustomExt[]; discarded: number }` — consumed by Task 3.

- [ ] **Step 1: Write the module**

Create `src/renderer/src/services/extensionGenerator.ts`:

```ts
import { CustomExt } from '../extensions/customExts'

const VALID_CATEGORIES = ['Media', 'Privacy', 'Productivity', 'Accessibility', 'Developer', 'Reading']

// Builds the single-shot generation prompt for ai:chat. The model must reply
// with ONLY a JSON array of extension objects following the codebase's
// window.__ext_<key> IIFE contract (same pattern as extensionDefs.ts).
export function buildGenerationPrompt(topic: string, existingNames: string[]): string {
  const theme = topic.trim()
    ? `All extensions must serve this theme: "${topic.trim()}".`
    : 'Invent a broadly useful, varied mix (productivity, reading, privacy, media, accessibility, developer tools).'
  return `You are an expert browser-extension author for AIHub Browser.

Generate 5 to 10 small, genuinely useful page-enhancement extensions. ${theme}

Each extension is plain JavaScript injected into every web page when the user enables it.

STRICT CONTRACT for each extension:
- injectCode: an IIFE following EXACTLY this pattern (choose a unique short key per extension):
(function(){
  var K='__ext_<uniquekey>';
  if(window[K])return;
  // do the work: create elements, add listeners, modify styles...
  window[K]={remove:function(){ /* undo EVERYTHING done above */ delete window[K];}};
})()
- removeCode: exactly this one line: window.__ext_<uniquekey>&&window.__ext_<uniquekey>.remove()
- Vanilla ES5-safe JavaScript only. No external network requests, no libraries, no fetch.
- Must not break pages. Any visual element uses z-index 2147483000 or higher.

Respond with ONLY a JSON array (no prose, no markdown fences) of 5 to 10 objects shaped:
[{"name":"...","tagline":"one line, under 80 chars","icon":"one emoji","category":"Media|Privacy|Productivity|Accessibility|Developer|Reading","injectCode":"...","removeCode":"..."}]

Names must NOT duplicate any of these existing extensions: ${existingNames.join(', ') || '(none)'}
JSON string rules: injectCode/removeCode are single-line JSON strings — use \\n escapes for newlines and escape double quotes.`
}

// Extracts and validates the model's response. Never throws. Invalid items
// are dropped and counted; a response with no parseable array yields
// {extensions: [], discarded: 0} (caller treats that as a model failure).
export function parseGeneratedExtensions(
  raw: string,
  existingNames: string[],
): { extensions: CustomExt[]; discarded: number } {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fence ? fence[1] : raw
  const start = candidate.indexOf('[')
  const end = candidate.lastIndexOf(']')
  if (start === -1 || end <= start) return { extensions: [], discarded: 0 }

  let items: unknown[]
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1))
    if (!Array.isArray(parsed)) return { extensions: [], discarded: 0 }
    items = parsed
  } catch {
    return { extensions: [], discarded: 0 }
  }

  const taken = new Set(existingNames.map(n => n.toLowerCase()))
  const extensions: CustomExt[] = []
  let discarded = 0
  const now = Date.now()

  items.forEach((entry, i) => {
    try {
      const it = entry as Record<string, unknown>
      const name = typeof it?.name === 'string' ? it.name.trim() : ''
      const tagline = typeof it?.tagline === 'string' ? it.tagline.trim() : ''
      const injectCode = typeof it?.injectCode === 'string' ? it.injectCode.trim() : ''
      const removeCode = typeof it?.removeCode === 'string' ? it.removeCode.trim() : ''
      if (!name || !tagline || !injectCode || !removeCode) { discarded++; return }
      if (taken.has(name.toLowerCase())) { discarded++; return }
      // Syntax gate — constructed, never invoked in the host renderer.
      new Function(injectCode)
      new Function(removeCode)
      const icon = typeof it?.icon === 'string' && it.icon.trim()
        ? [...it.icon.trim()].slice(0, 2).join('')
        : '✨'
      const category = VALID_CATEGORIES.includes(it?.category as string)
        ? (it.category as string)
        : 'Productivity'
      taken.add(name.toLowerCase())
      extensions.push({ id: `custom-${now}-${i}`, name, tagline, icon, category, injectCode, removeCode })
    } catch {
      discarded++
    }
  })

  return { extensions, discarded }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors mentioning `extensionGenerator.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/services/extensionGenerator.ts
git commit -m "feat: add AI extension-generation prompt builder and response parser"
```

---

### Task 3: Generate-with-AI modal in the Extensions page

**Files:**
- Modify: `src/renderer/src/components/pages/ExtensionsPage.tsx`

**Interfaces:**
- Consumes: `buildGenerationPrompt`, `parseGeneratedExtensions` from `../../services/extensionGenerator` (Task 2); `CustomExt`, `saveCustomExts` from `../../extensions/customExts` (Task 1).

- [ ] **Step 1: Add imports**

In `src/renderer/src/components/pages/ExtensionsPage.tsx`, find:

```tsx
import { Search, Plus, X, ChevronDown, ChevronUp, Trash2, Code2, Puzzle } from 'lucide-react'
```

Replace with:

```tsx
import { Search, Plus, X, ChevronDown, ChevronUp, Trash2, Code2, Puzzle, Sparkles } from 'lucide-react'
```

Then find:

```tsx
import { CustomExt, loadCustomExts, saveCustomExts } from '../../extensions/customExts'
```

Add immediately after it:

```tsx
import { buildGenerationPrompt, parseGeneratedExtensions } from '../../services/extensionGenerator'
```

- [ ] **Step 2: Add modal state**

Find:

```tsx
  const [showCreate, setShowCreate] = useState(false)
```

Replace with:

```tsx
  const [showCreate, setShowCreate] = useState(false)
  const [showGenerate, setShowGenerate] = useState(false)
```

- [ ] **Step 3: Add the Generate button next to Create Extension**

Find:

```tsx
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
            style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.2)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(245,158,11,0.2)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(245,158,11,0.12)' }}
          >
            <Plus size={13} /> Create Extension
          </button>
```

Replace with:

```tsx
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowGenerate(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
              style={{ background: 'rgba(139,92,246,0.12)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.25)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(139,92,246,0.22)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(139,92,246,0.12)' }}
            >
              <Sparkles size={13} /> Generate with AI
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
              style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.2)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(245,158,11,0.2)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(245,158,11,0.12)' }}
            >
              <Plus size={13} /> Create Extension
            </button>
          </div>
```

- [ ] **Step 4: Render the modal**

Find:

```tsx
      {/* Create Extension Modal */}
      {showCreate && (
```

Add immediately before it:

```tsx
      {/* Generate with AI Modal */}
      {showGenerate && (
        <GenerateExtModal
          existingNames={allExts.map(e => e.name)}
          onClose={() => setShowGenerate(false)}
          onGenerated={(exts) => {
            const updated = [...customExts, ...exts]
            setCustomExts(updated)
            saveCustomExts(updated)
          }}
        />
      )}

```

- [ ] **Step 5: Add the GenerateExtModal component**

At the very end of the file (after the closing brace of `CreateExtModal`), add:

```tsx
// ── Generate with AI Modal ───────────────────────────────────────────────────
function GenerateExtModal({ existingNames, onClose, onGenerated }: {
  existingNames: string[]
  onClose: () => void
  onGenerated: (exts: CustomExt[]) => void
}) {
  const [topic, setTopic]     = useState('')
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')
  const [summary, setSummary] = useState('')

  const generate = async () => {
    setBusy(true); setError(''); setSummary('')
    try {
      const result = await window.electronAPI.ai.chat([
        { role: 'user', content: buildGenerationPrompt(topic, existingNames) },
      ])
      if (!result || result.provider === 'error' || result.provider === 'none') {
        setError(result?.content || 'AI is unavailable.')
        return
      }
      const { extensions, discarded } = parseGeneratedExtensions(result.content || '', existingNames)
      if (extensions.length === 0) {
        setError("The AI response couldn't be parsed — try again (local models sometimes fumble JSON).")
        return
      }
      onGenerated(extensions)
      setSummary(`Added ${extensions.length} extension${extensions.length === 1 ? '' : 's'}${discarded > 0 ? ` · ${discarded} discarded as invalid` : ''}`)
      setTimeout(onClose, 1800)
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden flex flex-col"
        style={{ background: '#0d1526', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center gap-2.5">
            <Sparkles size={18} style={{ color: '#a78bfa' }} />
            <span className="text-sm font-semibold text-white">Generate Extensions with AI</span>
          </div>
          <button onClick={onClose} disabled={busy}
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ color: '#475569', background: 'rgba(255,255,255,0.05)' }}>
            <X size={14} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="text-[10px] uppercase tracking-widest font-bold block mb-1.5" style={{ color: '#334155' }}>
              Topic <span style={{ color: '#1e3a5f', textTransform: 'none', fontWeight: 400 }}>— optional</span>
            </label>
            <input
              value={topic}
              onChange={e => setTopic(e.target.value)}
              disabled={busy}
              placeholder="e.g. tools for reading articles — leave empty and I'll pick useful ones"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0' }}
            />
          </div>

          {busy && (
            <p className="text-xs" style={{ color: '#64748b' }}>
              ✨ Generating 5–10 extensions… local AI can take 30–60s.
            </p>
          )}
          {error && (
            <p className="text-xs whitespace-pre-wrap" style={{ color: '#f87171' }}>{error}</p>
          )}
          {summary && (
            <p className="text-xs font-semibold" style={{ color: '#4ade80' }}>{summary}</p>
          )}

          <p className="text-xs" style={{ color: '#1e3a5f' }}>
            ⚠ Generated code runs in the context of every web page you visit. New extensions start disabled — review, then enable the ones you want.
          </p>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <button onClick={onClose} disabled={busy}
            className="px-4 py-2 rounded-xl text-sm transition-all"
            style={{ background: 'rgba(255,255,255,0.05)', color: '#64748b', border: '1px solid rgba(255,255,255,0.07)' }}>
            Close
          </button>
          <button onClick={generate} disabled={busy}
            className="px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{
              background: busy ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg,#8b5cf6,#6d28d9)',
              color: busy ? '#334155' : '#fff',
              border: 'none', cursor: busy ? 'not-allowed' : 'pointer',
              boxShadow: busy ? 'none' : '0 0 16px rgba(139,92,246,0.3)',
            }}>
            {busy ? 'Generating…' : '✨ Generate'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors mentioning `ExtensionsPage.tsx`.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/pages/ExtensionsPage.tsx
git commit -m "feat: Generate-with-AI modal creates 5-10 extensions in one shot"
```

---

### Task 4: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev build**

Run: `npm run dev` (detaches; wait ~10s for the window).

- [ ] **Step 2: Generate with empty topic**

Extensions page → "✨ Generate with AI" → leave topic empty → Generate.
Expected: after the wait, "Added N extensions" (N between 5 and 10, minus any discarded); N new cards appear with Custom badges, sensible names/emoji icons/categories; all start disabled.

- [ ] **Step 3: Enable one and verify navigation persistence**

Enable a generated extension with a visible effect → open a normal website → effect visible → click a link on that site.
Expected: effect still present after navigation (Task 1's fix).

- [ ] **Step 4: Restart persistence**

Quit and relaunch dev app.
Expected: generated extensions still listed; the enabled one still takes effect on page load.

- [ ] **Step 5: Themed generation**

Generate again with topic "tools for reading long articles".
Expected: new batch clearly themed around reading.

- [ ] **Step 6: Delete**

Delete one generated extension.
Expected: card gone; effect removed from open tabs; still gone after restart.

- [ ] **Step 7: Report results**

Note any step that failed and what happened instead. Do not mark complete until Steps 2–6 pass.
