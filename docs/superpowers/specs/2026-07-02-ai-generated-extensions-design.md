# AI-Generated Extensions — Design

## Problem

The Extensions page has a manual "Create Extension" flow (name + tagline + hand-written inject/remove JS), but nothing helps a non-programmer get new extensions. The user wants a Generate button that has the AI invent 5–10 great, useful extensions in one shot and save them into the Extensions page alongside the built-ins.

Two existing gaps this feature must not inherit:

- Custom extensions only apply to tabs open at toggle time — `App.tsx`'s `did-stop-loading` auto-reinjection loops over `EXTENSION_DEFS` only, so any custom extension dies on the first navigation. (Approved: fix as part of this feature.)
- `CustomExt` and its localStorage load/save helpers live inside `ExtensionsPage.tsx`, so nothing outside that page component can re-inject them.

## Goals

- One click on a "Generate with AI" button in the Extensions page produces 5–10 new, working, useful extensions saved persistently.
- Optional topic: an empty input means "AI picks broadly useful ones"; a filled input steers generation around that theme (e.g. "tools for reading articles").
- Generated extensions behave exactly like built-ins afterward: toggle on/off, survive navigation and app restarts, deletable.
- Broken AI output (invalid JSON, syntax-error JS) never lands in the store — dropped per-item with a visible count, not a fatal error.

## Non-goals

- No settings UI for generated extensions (built-in-style `settings` arrays stay a built-in-only feature).
- No editing of generated extension code after the fact (delete-and-regenerate is the loop; the existing manual Create modal covers hand-tuning).
- No new IPC or main-process changes for generation itself — the existing `ai:chat` handler (Ollama → OpenRouter fallback) is the only AI path.
- Not sandboxing extension code beyond today's trust model — custom extensions already run user-provided JS in every page; generated ones follow the same rule and the same warning copy.

## Design

### 1. Shared custom-extension module

Move `CustomExt`, `loadCustomExts`, `saveCustomExts` (currently private to `ExtensionsPage.tsx`) into a new `src/renderer/src/extensions/customExts.ts`. `ExtensionsPage.tsx` imports from it; `App.tsx` can now import it too without depending on a page component. localStorage key `aihub-custom-exts` and the stored shape stay byte-identical — no migration.

### 2. Navigation-persistence fix

In `App.tsx`'s `did-stop-loading` handler, directly after the existing `EXTENSION_DEFS.forEach` injection loop, add a second loop: `loadCustomExts()` filtered to entries whose `extensionStates[id]?.enabled` is true, injecting each `injectCode` via the same `execScript` call. Custom and generated extensions now re-inject on every page load exactly like built-ins.

### 3. Generation service

New `src/renderer/src/services/extensionGenerator.ts` (same extract-to-service precedent as `pageExtractor.ts` / `agentTools.ts`):

- `buildGenerationPrompt(topic: string, existingNames: string[]): string` — instructs the model to return ONLY a fenced JSON array of 5–10 objects `{name, tagline, icon, category, injectCode, removeCode}`. The prompt embeds: the IIFE + `window.__ext_<key>` template contract (unique key per extension, `remove()` undoes everything), the six valid categories (Media, Privacy, Productivity, Accessibility, Developer, Reading), "icon is a single emoji", "names must not duplicate: <existingNames>", and — when `topic` is non-empty — "all extensions must serve this theme: <topic>".
- `parseGeneratedExtensions(raw: string): { extensions: CustomExt[]; discarded: number }` — finds the first `[` … matching `]` JSON array in the response (tolerates fenced code blocks and prose around it), `JSON.parse`s it, then per item: required string fields present and non-empty; category coerced into the valid set (fallback `Productivity`); icon truncated to 2 chars; `new Function(injectCode)` and `new Function(removeCode)` inside try/catch as a syntax gate (constructed, never invoked — host renderer never executes extension code); id assigned `custom-<Date.now()>-<index>`. Invalid items increment `discarded`; valid ones are returned. A response with no parseable array returns `{extensions: [], discarded: 0}` and the caller treats it as a model failure.

### 4. Generate UI

In `ExtensionsPage.tsx`, a "✨ Generate with AI" button beside "Create Extension" opens a small modal:

- Optional topic input, placeholder "e.g. tools for reading articles — leave empty and I'll pick useful ones".
- Generate button → disables into a spinner state with "Generating 5–10 extensions… local AI can take 30–60s".
- Calls `window.electronAPI.ai.chat([{role:'user', content: buildGenerationPrompt(topic, existingNames)}])` (the exact existing `ai:chat` renderer call signature used by the AI assistant).
- On response: `parseGeneratedExtensions`; if `extensions.length > 0`, append to the custom-exts store (via the shared module) and show "Added N extensions" plus "· M discarded as invalid" when M > 0, then close after a beat.
- If the model errored or nothing parsed: show the `ai:chat` response's error text verbatim in the modal (the newly added Ollama diagnostics surface here for free). Modal stays open for retry.
- Generated extensions render through the existing custom-ext card path: Custom badge, delete button, toggle. Newly generated ones start disabled (user opts in per extension).

## Error handling

- AI unreachable / all models fail → `ai:chat` returns its diagnostic-annotated error message as content; the modal shows it verbatim and stays open.
- Partial garbage (e.g. 7 items, 2 broken) → 5 saved, "2 discarded" shown.
- Zero parseable output → "The AI response couldn't be parsed — try again (local models sometimes fumble JSON)." Nothing saved.
- Duplicate names against existing extensions → prompt asks the model to avoid them; parser additionally drops exact-name duplicates as invalid.

## Testing

No automated suite (established). Manual verification in the dev build:

1. Generate with empty topic → 5–10 new cards appear with Custom badges, sensible names/icons/categories.
2. Enable one → effect visible on a page; navigate to another page → effect persists (the navigation fix).
3. Restart app → generated extensions still listed; enabled ones still active after page loads.
4. Generate with a topic → results clearly themed.
5. Delete a generated extension → card gone, page effect removed.
6. Stop Ollama with no OpenRouter key → modal shows the diagnostic error, nothing saved.
