# AI Bot Tool Use — Design

## Problem

The AI Assistant (`AIAssistant.tsx`, opened via the nav-bar AI button) can only talk. Its one piece of "action" is a regex match on the user's message (`OPEN_PATTERNS` in `tryNavIntent`) that opens a bookmarked tab if the wording looks like "open X". It cannot execute a multi-step instruction like "open 5 random tabs and bookmark them."

`AgentsPage.tsx` (the separate Agent Mode page) looks like it does more, but doesn't — its "agents" are canned system prompts that produce advice text. No IPC call it makes ever opens a tab, closes a tab, or touches a bookmark. Neither surface can actually act on the user's behalf today.

## Goal

Give the AIAssistant chat bot the ability to execute real multi-step browser actions (opening/closing/navigating tabs, managing bookmarks) in response to natural-language instructions, with the user able to watch it work and stop it mid-run.

## Non-goals (this iteration)

- Page reading/summarization as part of the action loop (the existing manual "Summarize" button stays as-is, untouched).
- Web search / URL discovery. The model relies on its own training knowledge to name real URLs (sufficient for the "open 5 news sites" class of request). No search API is introduced.
- Agent Mode page (`AgentsPage.tsx`) — left as-is, out of scope.
- Undo/rollback of completed actions if the user hits Stop mid-run.

## Architecture

The existing `sendMessage` flow in `AIAssistant.tsx` becomes an **agent loop**. There is no separate "agent mode" toggle — every message goes through the same loop. Ordinary questions simply terminate after one turn because the model's response contains no action block.

```
user message
   → build system prompt (existing buildSystemPrompt + tool docs)
   → window.electronAPI.ai.chat(history)          [existing IPC, unchanged]
   → parse response for a trailing JSON action block
   → no block?  render as normal assistant message, loop ends
   → block found?
       → execute each action in order via window.electronAPI.tabAgent.*  (new IPC)
       → render each action's result as a step-log line, live, as it completes
       → append a synthetic "tool result" user-turn describing what happened
       → call ai.chat again with the extended history
       → repeat, capped at 6 turns / 25 total actions
   → Stop button sets a ref checked before each action; halts the loop,
     already-completed actions are not rolled back
```

All of this lives in the renderer (`AIAssistant.tsx`). The only new main-process surface is a thin `tabAgent:*` IPC namespace that wraps *existing* logic (tab creation already goes through `tabview:create`/`BrowserView`, bookmarks through the existing `bookmarks:*` handlers) — no new business logic in main, just an agent-callable entry point that returns structured results instead of the fire-and-forget shape the current handlers use.

## Tool protocol

Free-tier OpenRouter models and self-hosted Ollama models have inconsistent support for native provider function-calling APIs (some free OpenRouter models silently ignore `tools`, some Ollama models require a specific chat template to honor it). Rather than branch behavior per-provider, the system prompt asks the model to emit a **JSON action block as literal text** when it wants to act — this works identically regardless of which model in the fallback chain (`OR_FREE_FALLBACKS`, Ollama) ends up answering.

Format (appended to the assistant's own reply, extracted before display):
```
###ACTIONS###
{"actions":[
  {"tool":"open_tab","url":"https://news.ycombinator.com"},
  {"tool":"add_bookmark","url":"https://news.ycombinator.com","title":"Hacker News","category":"News"}
]}
```
The `###ACTIONS###` marker makes extraction unambiguous even if the model wraps the JSON in prose or a code fence. Anything before the marker is shown to the user as the assistant's message for that turn (its "here's what I'm about to do" narration); the block itself is stripped before display.

If the JSON fails to parse, the loop treats the turn as final (no actions) and shows the raw text — a malformed block degrades to "the bot just talked," never a crash.

## Tools (v1)

All operate on the renderer's `useBrowserStore` state and the existing `window.electronAPI` surface; the new `tabAgent` IPC methods are thin wrappers that also return a result object for the loop to report back to the model.

| Tool | Args | Behavior | Result shape |
|---|---|---|---|
| `list_tabs` | — | Snapshot of open tabs | `{tabs: [{id,url,title}]}` |
| `open_tab` | `url` | Creates a new tab, navigates it | `{tabId, url}` |
| `close_tab` | `tabId` | Closes a tab (falls back to "not found" if stale id) | `{ok: bool}` |
| `navigate_tab` | `tabId, url` | Navigates an existing tab | `{ok: bool}` |
| `switch_tab` | `tabId` | Makes a tab active | `{ok: bool}` |
| `list_bookmarks` | — | Existing bookmarks (for dedup/context) | `{bookmarks: [{id,url,title,category}]}` |
| `add_bookmark` | `url, title, category?` | Adds a bookmark (reuses existing AI categorize heuristic if `category` omitted) | `{id}` |
| `remove_bookmark` | `id` | Removes a bookmark | `{ok: bool}` |

Unknown tool names or malformed args produce an `{error: "..."}` result fed back to the model rather than throwing — keeps the loop resilient to model mistakes.

## Safety caps

- **6 loop turns max** (LLM calls), **25 total actions max** across the whole run — both hard stops, loop ends and tells the user it hit the cap.
- Every action is inherently reversible/cheap (tabs, bookmarks — no payments, no credentials, no permanent deletion), consistent with the "Regular" action category; no per-action confirmation gate.
- Stop button (rendered next to the input while a loop is running) sets `stopRequestedRef.current = true`, checked before each action executes — the current action finishes, subsequent ones don't start.

## UI

Inside the existing message list (`AIAssistant.tsx`'s `aiMessages` rendering), a running/completed action loop renders as:
- The model's narration text (if any) as a normal assistant bubble.
- A compact step list under it: `⏳ Opening github.com…` → `✓ Opened github.com` per action, updated live as each completes (not batched until the end).
- A Stop button appears in the input area only while `isAILoading` is true *and* a loop is mid-run (distinguish "waiting on one LLM call" from "waiting on one LLM call as part of a multi-turn loop" isn't necessary — Stop is just always available while `isAILoading`, since stopping between actions is always safe).

## Error handling

- `ai.chat` IPC failure (network, provider error) mid-loop → loop ends, existing error message pattern (`'Connection error. Please try again.'`) reused, whatever actions already ran stay done.
- Individual action failure (e.g. `close_tab` on an already-closed tab) → doesn't abort the loop; the `{error}` result is fed back so the model can adapt (e.g. try the next tab instead).
- Turn/action cap hit → loop ends with a synthetic assistant message: "Stopped after reaching the action limit for this run."

## Testing

No existing automated test suite in this project (Electron + manual verification is the established pattern per prior sessions). Verification plan:
1. Manual: "open youtube.com and bookmark it" → single-turn, 2 actions, verify tab opens and bookmark appears in Settings/HomePage bookmark list.
2. Manual: "open 5 different real websites and bookmark all of them" → multi-action single turn (10 actions), verify step log renders each live, all 5 tabs exist, all 5 bookmarks exist.
3. Manual: trigger mid-run and click Stop after 2-3 steps → verify remaining actions don't execute, already-done ones stay.
4. Manual: ask a plain question ("what's the capital of France") → verify zero actions, normal chat behavior unaffected (regression check against existing `tryNavIntent`/summarize/AI-news paths).
5. Manual: force a malformed-JSON case (hard to trigger deliberately; covered by code review of the parse-failure fallback path instead).
