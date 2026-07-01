# AI Bot Tool Use Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the AIAssistant chat bot (nav-bar AI button panel) the ability to actually execute multi-step browser actions — open/close/navigate/switch tabs, save/remove bookmarks, read the current page's text — driven by natural language, with a live step log and a Stop button.

**Architecture:** `sendMessage` in `AIAssistant.tsx` becomes an agent loop: call the existing `ai.chat` IPC, parse the response for a trailing `###ACTIONS###` JSON block (provider-agnostic — works with any model regardless of native function-calling support), execute each action against the existing renderer store/IPC surface, feed results back, repeat until the model answers with plain text or a cap is hit.

**Tech Stack:** React + Zustand (existing `useBrowserStore`), existing `window.electronAPI` IPC surface (`ai.chat`, `bookmarks.*`, `ai.categorizeBookmark`, `tabView.navigate`, `webview.execScript`) — no new IPC, no new main-process code.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-01-ai-bot-tool-use-design.md`
- **No automated test suite exists in this project** (Electron app, no jest/vitest/tsx configured — confirmed by checking `package.json`). Every task's verification is: (1) `npx tsc --noEmit -p tsconfig.web.json` must show no errors for the touched file, and (2) where noted, a manual check in the running dev build (`npm run dev`), matching this project's established verification pattern. Do not add a test framework as part of this plan — out of scope.
- Deviation from the spec's "Architecture" section: the spec described a new main-process `tabAgent:*` IPC namespace. On closer inspection this isn't needed — tab actions can be done entirely through the existing renderer-side `useBrowserStore` actions plus the existing `tabView.navigate` IPC, and bookmark actions through the existing `bookmarks:*`/`ai.categorizeBookmark` IPC. This plan implements the identical tool behavior with **zero new main-process code**. Noted here since it's a legitimate simplification found during planning, not a scope cut.
- `read_page` takes no `tabId` argument (spec listed it as optional) — it always reads the active tab, matching the existing `getPageContent` prop's actual signature already wired into `AIAssistant.tsx`. No plumbing exists for reading a non-active tab's content, and nothing in this feature needs it (YAGNI).
- Every new/changed file must pass the existing typecheck: `npx tsc --noEmit -p tsconfig.web.json` for renderer files.

---

### Task 1: Extend `browserStore.ts` for step tracking and tab-id return

**Files:**
- Modify: `src/renderer/src/store/browserStore.ts`

**Interfaces:**
- Produces: `AIMessage.steps?: { label: string; status: 'pending' | 'done' | 'error' }[]` — consumed by Task 4 (loop) and Task 5 (UI rendering).
- Produces: `addTab(url?, pageType?) => string` (now returns the new tab's id) — consumed by Task 2's `open_tab` executor.
- Produces: `setAIMessageStepStatus(msgIndex: number, stepIndex: number, status: 'done' | 'error') => void` — consumed by Task 4.

- [ ] **Step 1: Add the `steps` field to `AIMessage`**

In `src/renderer/src/store/browserStore.ts`, change line 5:

```ts
export interface AIMessage { role: 'user'|'assistant'|'system'; content: string; steps?: { label: string; status: 'pending' | 'done' | 'error' }[] }
```

- [ ] **Step 2: Change `addTab`'s declared return type and add `setAIMessageStepStatus` to the store interface**

In the `BrowserState` interface, change:

```ts
  addTab: (url?: string, pageType?: Tab['pageType']) => void
```
to:
```ts
  addTab: (url?: string, pageType?: Tab['pageType']) => string
```

And in the `// AI` section of the interface (after `clearAIMessages: () => void`), add:

```ts
  setAIMessageStepStatus: (msgIndex: number, stepIndex: number, status: 'done' | 'error') => void
```

- [ ] **Step 3: Make `addTab` return the new id**

Replace the `addTab` implementation:

```ts
  addTab: (url = 'home', pageType = 'browser') => {
    const id = `tab-${++tabN}`
    const isHome = url === 'home' && pageType === 'browser'
    set(s => ({
      tabs: [...s.tabs, { id, url, title: isHome ? 'New Tab' : pageType !== 'browser' ? pageType.charAt(0).toUpperCase() + pageType.slice(1) : url, favicon: '', isLoading: false, isHome, pageType }],
      activeTabId: id,
      canGoBack: false,
      canGoForward: false,
    }))
    return id
  },
```

(Only change: `return id` added at the end. Existing callers that ignore the return value are unaffected — this is a backward-compatible signature widening.)

- [ ] **Step 4: Implement `setAIMessageStepStatus`**

Immediately after the `clearAIMessages: () => set({ aiMessages: [] }),` line, add:

```ts
  setAIMessageStepStatus: (msgIndex, stepIndex, status) => set(s => {
    const messages = [...s.aiMessages]
    const msg = messages[msgIndex]
    if (!msg?.steps || !msg.steps[stepIndex]) return {}
    const steps = [...msg.steps]
    steps[stepIndex] = { ...steps[stepIndex], status }
    messages[msgIndex] = { ...msg, steps }
    return { aiMessages: messages }
  }),
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors mentioning `browserStore.ts`. (Other pre-existing unrelated errors in this file/project are fine — this project has some pre-existing warnings unrelated to this change; only check that nothing new appears in `browserStore.ts`.)

- [ ] **Step 6: Manual smoke check**

Run `npm run dev`, open a new tab via the `+` button in the tab bar, confirm it still works exactly as before (title, home screen, etc.) — confirms the `addTab` signature change didn't break existing callers.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/store/browserStore.ts
git commit -m "feat: add AI message step tracking and tab-id return to store"
```

---

### Task 2: Create the agent tools module

**Files:**
- Create: `src/renderer/src/services/agentTools.ts`

**Interfaces:**
- Consumes: `useBrowserStore` (Task 1's `addTab`/`setAIMessageStepStatus` additions), `window.electronAPI.bookmarks.*`, `window.electronAPI.ai.categorizeBookmark`, `window.electronAPI.tabView.navigate` (all pre-existing, unchanged).
- Produces: `parseActionsBlock(raw: string): { narration: string; actions: ToolAction[] | null }`, `describeAction(a: ToolAction): string`, `executeAction(action: ToolAction, ctx: { getPageContent?: () => Promise<string> }): Promise<ToolResult>`, `AGENT_TOOLS_DOC: string` — all consumed by Task 3/4.

- [ ] **Step 1: Write the module**

Create `src/renderer/src/services/agentTools.ts`:

```ts
import { useBrowserStore } from '../store/browserStore'

export interface ToolAction {
  tool: string
  [key: string]: any
}

export interface ToolResult {
  [key: string]: any
  error?: string
}

export interface ParsedResponse {
  narration: string
  actions: ToolAction[] | null
}

const ACTIONS_MARKER = '###ACTIONS###'

// Extracts a trailing `###ACTIONS###\n{"actions":[...]}` block from a raw
// model response. Anything before the marker is the user-facing narration;
// the block itself is parsed and stripped. A missing or malformed block
// means "no actions this turn" — never throws.
export function parseActionsBlock(raw: string): ParsedResponse {
  const idx = raw.indexOf(ACTIONS_MARKER)
  if (idx === -1) return { narration: raw.trim(), actions: null }

  const narration = raw.slice(0, idx).trim()
  let jsonPart = raw.slice(idx + ACTIONS_MARKER.length).trim()
  jsonPart = jsonPart.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()

  try {
    const parsed = JSON.parse(jsonPart)
    if (Array.isArray(parsed?.actions)) {
      return { narration, actions: parsed.actions }
    }
  } catch {
    // fall through — malformed JSON degrades to plain text, never crashes
  }
  return { narration: raw.trim(), actions: null }
}

export function describeAction(a: ToolAction): string {
  switch (a.tool) {
    case 'list_tabs':       return 'Listing open tabs'
    case 'open_tab':        return `Opening ${a.url}`
    case 'close_tab':       return 'Closing tab'
    case 'navigate_tab':    return `Navigating to ${a.url}`
    case 'switch_tab':      return 'Switching tab'
    case 'list_bookmarks':  return 'Listing bookmarks'
    case 'add_bookmark':    return `Bookmarking ${a.title || a.url}`
    case 'remove_bookmark': return 'Removing bookmark'
    case 'read_page':       return 'Reading page content'
    default:                 return `Running ${a.tool}`
  }
}

function deriveTitle(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

export interface ToolContext {
  getPageContent?: () => Promise<string>
}

// Executes one parsed action against the existing store/IPC surface. Never
// throws — failures come back as {error} so the model can see and react to
// them on the next loop turn.
export async function executeAction(action: ToolAction, ctx: ToolContext): Promise<ToolResult> {
  const store = useBrowserStore.getState()

  try {
    switch (action.tool) {
      case 'list_tabs': {
        return { tabs: store.tabs.map(t => ({ id: t.id, url: t.url, title: t.title, isHome: t.isHome })) }
      }

      case 'open_tab': {
        if (!action.url) return { error: 'url is required' }
        const tabId = store.addTab(action.url, 'browser')
        return { tabId, url: action.url }
      }

      case 'close_tab': {
        if (!action.tabId) return { error: 'tabId is required' }
        if (!store.tabs.some(t => t.id === action.tabId)) return { error: 'tab not found' }
        store.closeTab(action.tabId)
        return { ok: true }
      }

      case 'navigate_tab': {
        if (!action.tabId || !action.url) return { error: 'tabId and url are required' }
        if (!store.tabs.some(t => t.id === action.tabId)) return { error: 'tab not found' }
        store.updateTab(action.tabId, {
          url: action.url, title: deriveTitle(action.url), isHome: false, isLoading: true, pageType: 'browser',
        })
        window.electronAPI.tabView.navigate(action.tabId, action.url)
        return { ok: true }
      }

      case 'switch_tab': {
        if (!action.tabId) return { error: 'tabId is required' }
        if (!store.tabs.some(t => t.id === action.tabId)) return { error: 'tab not found' }
        store.setActiveTab(action.tabId)
        return { ok: true }
      }

      case 'list_bookmarks': {
        return { bookmarks: store.bookmarks.map(b => ({ id: b.id, url: b.url, title: b.title, category: b.category })) }
      }

      case 'add_bookmark': {
        if (!action.url || !action.title) return { error: 'url and title are required' }
        let category = action.category
        let color = '#60a5fa'
        if (!category) {
          try {
            const cat = await window.electronAPI.ai.categorizeBookmark(action.url, action.title)
            category = cat.category
            color = cat.color
          } catch { category = 'Tools' }
        }
        const favicon = `https://www.google.com/s2/favicons?domain=${action.url}&sz=32`
        const saved = await window.electronAPI.bookmarks.add({
          url: action.url, title: action.title, favicon, category, color,
        })
        store.addBookmark(saved)
        return { id: saved.id }
      }

      case 'remove_bookmark': {
        if (!action.id) return { error: 'id is required' }
        await window.electronAPI.bookmarks.remove(action.id)
        store.removeBookmark(action.id)
        return { ok: true }
      }

      case 'read_page': {
        if (!ctx.getPageContent) return { error: 'no active page to read' }
        const text = await ctx.getPageContent()
        if (!text) return { error: 'page has no readable text' }
        return { text }
      }

      default:
        return { error: `unknown tool "${action.tool}"` }
    }
  } catch (e: any) {
    return { error: e?.message || String(e) }
  }
}

// Appended to the system prompt so the model knows what it can do and the
// exact protocol for doing it. Provider-agnostic on purpose — see the
// design doc's "Tool protocol" section for why this isn't native
// function-calling.
export const AGENT_TOOLS_DOC = `
## Taking actions

You can act on the browser, not just talk. When the user's request needs an
action (opening/closing/navigating tabs, saving or removing bookmarks,
reading the current page's actual text), end your reply with a JSON block
in exactly this format:

###ACTIONS###
{"actions":[{"tool":"open_tab","url":"https://example.com"}]}

Rules:
- Everything BEFORE the ###ACTIONS### marker is shown to the user as your message — briefly say what you're about to do.
- Everything AFTER the marker must be ONLY the JSON object, nothing else.
- You can include multiple actions in one block — they run in order.
- Only include the block when you actually need to act. Plain questions get a plain answer, no block.
- After actions run, you'll be told the results and can respond again — either take more actions or give a final answer (no block = done).

Available tools:
- list_tabs() — no args. Returns open tabs.
- open_tab({url}) — opens a new tab at url.
- close_tab({tabId}) — closes a tab by id (get ids from list_tabs).
- navigate_tab({tabId, url}) — navigates an existing tab to url.
- switch_tab({tabId}) — makes a tab the active one.
- list_bookmarks() — no args. Returns saved bookmarks.
- add_bookmark({url, title, category?}) — saves a bookmark. This is what "save this link/page for me" means — category is optional, auto-detected if omitted.
- remove_bookmark({id}) — deletes a bookmark by id.
- read_page() — returns the visible text of the page in the CURRENT active tab. Use this whenever you need to actually know what a page says (summarizing, answering questions about it, or writing a good bookmark title) rather than guessing from the URL alone.

Example — "open 5 real websites and bookmark them":
I'll open 5 sites and bookmark each one.
###ACTIONS###
{"actions":[
  {"tool":"open_tab","url":"https://news.ycombinator.com"},
  {"tool":"open_tab","url":"https://github.com"},
  {"tool":"open_tab","url":"https://wikipedia.org"},
  {"tool":"open_tab","url":"https://developer.mozilla.org"},
  {"tool":"open_tab","url":"https://arstechnica.com"},
  {"tool":"add_bookmark","url":"https://news.ycombinator.com","title":"Hacker News"},
  {"tool":"add_bookmark","url":"https://github.com","title":"GitHub"},
  {"tool":"add_bookmark","url":"https://wikipedia.org","title":"Wikipedia"},
  {"tool":"add_bookmark","url":"https://developer.mozilla.org","title":"MDN Web Docs"},
  {"tool":"add_bookmark","url":"https://arstechnica.com","title":"Ars Technica"}
]}
`
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors mentioning `agentTools.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/services/agentTools.ts
git commit -m "feat: add provider-agnostic agent tool executor and protocol"
```

---

### Task 3: Wire the tool docs into the system prompt

**Files:**
- Modify: `src/renderer/src/components/ai/AIAssistant.tsx`

**Interfaces:**
- Consumes: `AGENT_TOOLS_DOC` from `../../services/agentTools` (Task 2).

- [ ] **Step 1: Import the tools module**

At the top of `src/renderer/src/components/ai/AIAssistant.tsx`, after the existing `useBrowserStore` import, add:

```tsx
import { parseActionsBlock, describeAction, executeAction, AGENT_TOOLS_DOC } from '../../services/agentTools'
```

- [ ] **Step 2: Append the tool docs to the system prompt**

Find the end of `buildSystemPrompt`'s template string (currently ending in `...${pageCtx}${bookmarkCtx}${historyCtx}\``) and change it to also append `AGENT_TOOLS_DOC`:

```tsx
    return `You are AIHub Browser Assistant — an intelligent AI agent built into AIHub Browser.

You are deeply aware of the user's browser context: their bookmarks, recent history, current page, and habits. Use this context to give highly personalized, proactive responses.

## Core capabilities
• Navigate the web — open any of the user's bookmarks when asked ("open YouTube", "go to Netflix")
• Summarize and analyze web pages
• Research topics across multiple sources
• Write, translate, generate code
• Answer questions about AIHub Browser features
• Surface latest AI news from Hacker News

## AIHub Browser features
- **Bookmark Sphere**: 3D force-directed knowledge graph. Bookmarks cluster by category.
- **AI Assistant** (you): local Ollama or cloud OpenRouter, switchable in Settings.
- **Research Mode**: multi-tab analysis, cross-reference, generate reports.
- **Agent Mode**: automate form filling, data gathering, site monitoring.
- **Extensions**: 12+ built-in browser extensions, toggleable on/off.
- **History**: semantic search across all browsing history.

## Navigation commands
When user asks to open a site, reply concisely: "Opening [Site Name] ↗" — the browser detects this and opens the tab automatically.

Be concise, warm, and genuinely helpful. Use **bold** for site names and key terms. Bullet points for lists.${pageCtx}${bookmarkCtx}${historyCtx}${AGENT_TOOLS_DOC}`
  }, [currentUrl, currentTitle, bookmarks, browseHistory])
```

(Only change from the existing code: `${AGENT_TOOLS_DOC}` appended right before the closing backtick.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors mentioning `AIAssistant.tsx` (an "unused import" error for `parseActionsBlock`/`describeAction`/`executeAction` is expected and fine at this point — Task 4 uses them).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/ai/AIAssistant.tsx
git commit -m "feat: append agent tool docs to AI system prompt"
```

---

### Task 4: Rewrite `sendMessage` as the agent loop

**Files:**
- Modify: `src/renderer/src/components/ai/AIAssistant.tsx`

**Interfaces:**
- Consumes: `parseActionsBlock`, `describeAction`, `executeAction` (Task 2/3), `setAIMessageStepStatus` (Task 1).
- Produces: `stopLoop: () => void` — consumed by Task 5 (Stop button).

- [ ] **Step 1: Destructure `setAIMessageStepStatus` from the store**

Change:
```tsx
  const {
    isAIPanelOpen, toggleAIPanel,
    aiMessages, addAIMessage, clearAIMessages,
    isAILoading, setAILoading,
    ollamaStatus, setOllamaStatus,
    bookmarks, addTab,
  } = useBrowserStore()
```
to:
```tsx
  const {
    isAIPanelOpen, toggleAIPanel,
    aiMessages, addAIMessage, clearAIMessages, setAIMessageStepStatus,
    isAILoading, setAILoading,
    ollamaStatus, setOllamaStatus,
    bookmarks, addTab,
  } = useBrowserStore()
```

- [ ] **Step 2: Add the stop ref and stop handler**

Immediately after the `inputRef` declaration (`const inputRef = useRef<HTMLTextAreaElement>(null)`), add:

```tsx
  const stopRequestedRef = useRef(false)
  const stopLoop = useCallback(() => { stopRequestedRef.current = true }, [])
```

- [ ] **Step 3: Replace `sendMessage` with the agent loop**

Replace the entire existing `sendMessage` function (from `// ── Send message ──...` through its closing `}`) with:

```tsx
  // ── Send message — agent loop: the model can request tool actions via a
  // JSON block (see agentTools.ts); we execute them and loop, until it
  // answers with plain text or a safety cap is hit. ─────────────────────────
  const sendMessage = async () => {
    const msg = input.trim()
    if (!msg || isAILoading) return
    setInput('')

    // Check navigation intent first — no AI call needed
    if (tryNavIntent(msg)) return

    addAIMessage({ role: 'user', content: msg })
    setAILoading(true)
    stopRequestedRef.current = false

    const MAX_TURNS = 6
    const MAX_ACTIONS = 25
    let actionsUsed = 0

    // Mirrors what's sent to ai.chat — includes synthetic tool-result turns
    // that are never pushed into the visible aiMessages store.
    let loopHistory: { role: string; content: string }[] =
      useBrowserStore.getState().aiMessages.map(m => ({ role: m.role, content: m.content }))

    try {
      for (let turn = 1; turn <= MAX_TURNS; turn++) {
        let systemPrompt = buildSystemPrompt()

        if (AI_NEWS_INTENT.test(msg) && turn === 1) {
          setFetchingNews(true)
          try {
            const news = await (window.electronAPI as any).ai.getLatestNews()
            if (news.success && news.articles.length > 0) {
              const list = news.articles
                .map((a: any, i: number) => `${i + 1}. **${a.title}** (${a.score} pts on HN)\n   ${a.url}`)
                .join('\n\n')
              systemPrompt += `\n\n## LIVE AI NEWS FROM HACKER NEWS (fetched just now)\n\n${list}\n\nPresent these articles to the user. For each, give a one-sentence summary based on the title. Tell them you fetched these live.`
            }
          } catch {}
          setFetchingNews(false)
        }

        const result = await window.electronAPI.ai.chat([{ role: 'system', content: systemPrompt }, ...loopHistory])
        const raw = result.content || ''
        if (result.provider === 'ollama' && !ollamaStatus?.running) {
          setOllamaStatus({ running: true, models: ollamaStatus?.models || [] })
        }

        const { narration, actions } = parseActionsBlock(raw)

        if (!actions || actions.length === 0 || stopRequestedRef.current) {
          addAIMessage({ role: 'assistant', content: narration || raw })
          return
        }

        if (actionsUsed + actions.length > MAX_ACTIONS) {
          addAIMessage({ role: 'assistant', content: (narration ? narration + '\n\n' : '') + 'Stopped after reaching the action limit for this run.' })
          return
        }

        const msgIndex = useBrowserStore.getState().aiMessages.length
        addAIMessage({
          role: 'assistant',
          content: narration,
          steps: actions.map(a => ({ label: describeAction(a), status: 'pending' as const })),
        })
        loopHistory.push({ role: 'assistant', content: raw })

        const results: any[] = []
        for (let i = 0; i < actions.length; i++) {
          if (stopRequestedRef.current) break
          const res = await executeAction(actions[i], { getPageContent })
          actionsUsed++
          setAIMessageStepStatus(msgIndex, i, res.error ? 'error' : 'done')
          results.push({ tool: actions[i].tool, ...res })
        }

        if (stopRequestedRef.current) {
          addAIMessage({ role: 'assistant', content: `Stopped — ran ${results.length} of ${actions.length} actions.` })
          return
        }

        loopHistory.push({
          role: 'user',
          content: `[Action results]\n${JSON.stringify(results)}\n\nContinue the task if more steps are needed, otherwise respond normally without an actions block.`,
        })
      }

      addAIMessage({ role: 'assistant', content: 'Stopped after reaching the action limit for this run.' })
    } catch {
      addAIMessage({ role: 'assistant', content: 'Connection error. Please try again.' })
    } finally {
      setAILoading(false)
      setFetchingNews(false)
    }
  }
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors mentioning `AIAssistant.tsx`.

- [ ] **Step 5: Manual check — plain question still works (regression)**

Run `npm run dev`, open the AI panel (nav-bar AI button), ask "what's the capital of France?". Expected: single assistant reply, no step log, no `###ACTIONS###` text visible anywhere in the rendered bubble.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/ai/AIAssistant.tsx
git commit -m "feat: rewrite AI sendMessage as a tool-executing agent loop"
```

---

### Task 5: Add the Stop button and step-log rendering

**Files:**
- Modify: `src/renderer/src/components/ai/AIAssistant.tsx`

**Interfaces:**
- Consumes: `stopLoop` (Task 4), `AIMessage.steps` (Task 1).

- [ ] **Step 1: Import the Stop icon**

Change the lucide-react import line:
```tsx
import {
  Bot, X, Send, Loader2, Sparkles, FileText, Trash2, AlertCircle,
  Zap, Paperclip, Download, BookmarkPlus, Check, Newspaper, ExternalLink,
} from 'lucide-react'
```
to:
```tsx
import {
  Bot, X, Send, Loader2, Sparkles, FileText, Trash2, AlertCircle,
  Zap, Paperclip, Download, BookmarkPlus, Check, Newspaper, ExternalLink, Square,
} from 'lucide-react'
```

- [ ] **Step 2: Render the step log under each assistant message**

Find this block inside the `aiMessages.map` rendering:
```tsx
                    <div style={msg.role === 'user' ? {
                      maxWidth: '82%', borderRadius: 14, borderTopRightRadius: 4,
                      padding: '9px 12px', fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap',
                      background: 'linear-gradient(135deg, rgba(59,130,246,0.82), rgba(99,102,241,0.72))',
                      color: '#fff', boxShadow: '0 2px 14px rgba(59,130,246,0.28)',
                      userSelect: 'text', WebkitUserSelect: 'text', cursor: 'text',
                    } : {
                      maxWidth: '82%', borderRadius: 14, borderTopLeftRadius: 4,
                      padding: '9px 12px', fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap',
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                      color: '#cbd5e1', userSelect: 'text', WebkitUserSelect: 'text', cursor: 'text',
                    }}>
                      <MdMessage content={msg.content} onNavigate={url => addTab(url, 'browser')} />
                    </div>
```
and change the closing part to also render steps:
```tsx
                    <div style={msg.role === 'user' ? {
                      maxWidth: '82%', borderRadius: 14, borderTopRightRadius: 4,
                      padding: '9px 12px', fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap',
                      background: 'linear-gradient(135deg, rgba(59,130,246,0.82), rgba(99,102,241,0.72))',
                      color: '#fff', boxShadow: '0 2px 14px rgba(59,130,246,0.28)',
                      userSelect: 'text', WebkitUserSelect: 'text', cursor: 'text',
                    } : {
                      maxWidth: '82%', borderRadius: 14, borderTopLeftRadius: 4,
                      padding: '9px 12px', fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap',
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                      color: '#cbd5e1', userSelect: 'text', WebkitUserSelect: 'text', cursor: 'text',
                    }}>
                      {msg.content && <MdMessage content={msg.content} onNavigate={url => addTab(url, 'browser')} />}
                      {msg.steps && msg.steps.length > 0 && (
                        <div style={{ marginTop: msg.content ? 8 : 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {msg.steps.map((s, si) => (
                            <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                              <span style={{ color: s.status === 'done' ? '#34d399' : s.status === 'error' ? '#f87171' : '#facc15', flexShrink: 0 }}>
                                {s.status === 'done' ? '✓' : s.status === 'error' ? '✕' : '⏳'}
                              </span>
                              <span style={{ color: '#94a3b8' }}>{s.label}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
```
(Two changes: `msg.content &&` guard added before `<MdMessage>` since narration can be empty when the model goes straight to actions, and the new `msg.steps` block appended after it.)

- [ ] **Step 3: Add the Stop button next to Send**

Find:
```tsx
                <button onClick={sendMessage} disabled={!input.trim() || isAILoading} style={{
                  width: 30, height: 30, borderRadius: 10, border: 'none', cursor: input.trim() ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  background: input.trim() && !isAILoading ? 'linear-gradient(135deg, #3b82f6, #6366f1)' : 'rgba(255,255,255,0.06)',
                  opacity: !input.trim() || isAILoading ? 0.35 : 1,
                  boxShadow: input.trim() && !isAILoading ? '0 2px 14px rgba(59,130,246,0.4)' : 'none',
                  transition: 'all 0.15s',
                }}>
                  {isAILoading
                    ? <Loader2 size={13} style={{ color: '#60a5fa', animation: 'spin 0.7s linear infinite' }} />
                    : <Send size={13} style={{ color: '#fff' }} />}
                </button>
```
and add a Stop button right after its closing `</button>`:
```tsx
                <button onClick={sendMessage} disabled={!input.trim() || isAILoading} style={{
                  width: 30, height: 30, borderRadius: 10, border: 'none', cursor: input.trim() ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  background: input.trim() && !isAILoading ? 'linear-gradient(135deg, #3b82f6, #6366f1)' : 'rgba(255,255,255,0.06)',
                  opacity: !input.trim() || isAILoading ? 0.35 : 1,
                  boxShadow: input.trim() && !isAILoading ? '0 2px 14px rgba(59,130,246,0.4)' : 'none',
                  transition: 'all 0.15s',
                }}>
                  {isAILoading
                    ? <Loader2 size={13} style={{ color: '#60a5fa', animation: 'spin 0.7s linear infinite' }} />
                    : <Send size={13} style={{ color: '#fff' }} />}
                </button>
                {isAILoading && (
                  <button onClick={stopLoop} title="Stop" style={{
                    width: 30, height: 30, borderRadius: 10, border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    background: 'rgba(239,68,68,0.12)', color: '#f87171',
                  }}>
                    <Square size={11} fill="currentColor" />
                  </button>
                )}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors mentioning `AIAssistant.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ai/AIAssistant.tsx
git commit -m "feat: add Stop button and live step log to AI chat"
```

---

### Task 6: Full manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev build**

Run: `npm run dev` (detaches; wait ~10s for the window to appear).

- [ ] **Step 2: Simple two-action task**

In the AI panel, send: `open youtube.com and bookmark it`
Expected: narration + a 2-line step log, both turning to ✓; a new tab opens to YouTube; the bookmark appears (check via the home page bookmark grid or Settings).

- [ ] **Step 3: Multi-action single-turn task (the original ask)**

Send: `open 5 different real websites and bookmark all of them`
Expected: one assistant bubble with a 10-item step log (5 opens + 5 bookmarks, or interleaved — whatever order the model chose) all resolving to ✓; 5 new tabs exist; 5 new bookmarks exist.

- [ ] **Step 4: Stop mid-run**

Send another multi-action request (e.g. `open 5 more different websites and bookmark them`), click the Stop button after 2-3 steps show ✓.
Expected: remaining steps never turn ✓ (stay ⏳ or don't render further updates), no further tabs/bookmarks appear after the stop point, loop ends cleanly (input re-enabled).

- [ ] **Step 5: Conversational page understanding**

Navigate a tab to a real article page. In the AI panel, send: `summarize this` (no button click).
Expected: a `read_page` step appears and resolves ✓, followed by an actual summary of the page's real content (not a generic non-answer).

Then send: `save this link for me`.
Expected: an `add_bookmark` step resolves ✓, bookmark for the current page appears.

- [ ] **Step 6: Regression — manual Summarize/Attach Page buttons still work**

Click the existing "Summarize" quick-action button (not the chat).
Expected: behaves exactly as before this plan (unchanged code path — `summarizePage` was not touched).

- [ ] **Step 7: Report results**

If any expectation fails, note which step and what happened instead — do not mark this task complete until all six checks pass.
