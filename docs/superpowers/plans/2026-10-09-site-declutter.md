# Per-Site Page Declutter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let users create, preview, pause, and delete local per-origin rules that hide distracting elements on selected websites.

**Architecture:** Add a small validated local rule model keyed by exact HTTP(S) origin, plus a dedicated internal AIHub page for managing selectors. Apply one uniquely identified stylesheet to each matching live BrowserView through the existing `webview.execScript` IPC boundary after navigation; remove the previous stylesheet on every top-level load before applying the new origin's rules. The feature does not inspect or upload page content.

**Tech Stack:** Electron 44 BrowserViews, React, TypeScript, Zustand, existing `webview.execScript` preload bridge, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-aihub-browser-superpowers.md` (Slice B).

## Global Constraints

- Persist cleanup rules locally in the AIHub renderer profile; do not add network or cloud dependencies.
- Match exact normalized HTTP(S) origins; never apply a rule to a different origin.
- Validate selector count and size, reject CSS declaration/block delimiters, and contain malformed selectors without breaking page navigation.
- Inject through the existing isolated IPC boundary; keep web security, context isolation, and Node integration settings unchanged.
- Provide preview/apply, pause, and delete controls; users must be able to restore the original page by removing the cleanup stylesheet.
- Validate with focused Vitest tests, `npm run typecheck`, `npm test`, and `npm run build`.

## Review Focus

- `https://example.com` rules must not apply to `https://other.example.com`, a different scheme, or a different port.
- Invalid selectors and attempts to inject CSS declarations must be rejected before stylesheet construction.
- A navigation from a cleaned origin to an unconfigured origin must remove the prior origin's stylesheet.
- Disabled and deleted rules must restore the original page style.
- Sleeping tabs and internal AIHub pages must not receive page scripts.

---

### Task 1: Origin-scoped rule model and safe stylesheet builder

**Files:**
- Create: `src/renderer/src/extensions/declutterRules.ts`
- Test: `src/renderer/src/extensions/declutterRules.test.ts`

**Interfaces:**
- `DeclutterRule = { id: string; origin: string; selectors: string[]; enabled: boolean; updatedAt: number }`.
- `normalizeOrigin(url: string): string | null` returns canonical `URL.origin` for HTTP(S), otherwise `null`.
- `normalizeSelectors(input: string[]): { ok: true; selectors: string[] } | { ok: false; error: string }` trims, de-duplicates, caps rules at 30 selectors and each selector at 300 characters, and rejects `{`, `}`, `;`, empty input, and malformed CSS selector syntax.
- `loadDeclutterRules(storage?: Pick<Storage, 'getItem'>): DeclutterRule[]` reads the versioned local key `aihub-site-declutter-v1`, validates every field, and returns an empty list on malformed storage.
- `saveDeclutterRules(rules: DeclutterRule[], storage?: Pick<Storage, 'setItem'>): boolean` writes validated rules and returns false on storage failure.
- `selectorsForOrigin(origin: string, rules: readonly DeclutterRule[]): string[]` returns selectors only for the exact normalized origin and enabled rule.
- `buildDeclutterStyleScript(selectors: readonly string[]): string` removes the prior `style[data-aihub-declutter]`, safely embeds the selector array as JSON, verifies each selector with `querySelectorAll`, and injects only `display:none!important` rules for valid selectors.

- [x] **Step 1: Write failing tests for normalization, persistence, and script safety**

Test canonical origins including case/default ports, non-web URLs, cross-scheme/host/port isolation, rule bounds and malformed stored JSON, duplicate selectors, forbidden declaration/block characters, invalid selectors, paused rules, and stylesheet removal/replacement behavior in jsdom.

- [x] **Step 2: Run the focused tests and verify the missing module fails**

Run: `npx vitest run src/renderer/src/extensions/declutterRules.test.ts`
Expected: FAIL because `declutterRules.ts` is not implemented.

- [x] **Step 3: Implement the pure rule model and DOM stylesheet helper**

Keep storage injectable for tests, validate loaded data as untrusted, and serialize selector arrays with `JSON.stringify` rather than interpolating selector text into JavaScript source. Keep the style element id constant and replace it on each apply so applying twice never duplicates effects.

- [x] **Step 4: Run focused rule tests**

Run: `npx vitest run src/renderer/src/extensions/declutterRules.test.ts`
Expected: PASS for valid selectors, safe rejection cases, storage recovery, and stylesheet lifecycle.

### Task 2: Declutter management page and navigation entry

**Files:**
- Create: `src/renderer/src/components/pages/DeclutterPage.tsx`
- Test: `src/renderer/src/components/pages/DeclutterPage.test.tsx`
- Modify: `src/shared/pageTypes.ts`
- Modify: `src/renderer/src/components/browser/Sidebar.tsx`
- Modify: `src/renderer/src/components/browser/CommandPalette.tsx`
- Modify: `src/renderer/src/components/browser/NavigationBar.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Add page type `'declutter'`; `aihub://declutter` opens it using the existing navigation handling.
- `DeclutterPage` reads open web tabs and BrowserView ids from `useBrowserStore`, lets the user choose an origin, enter one CSS selector per line, preview/apply to a matching live tab, enable/disable a saved rule, and delete a rule.
- Preview/apply calls `window.electronAPI.webview.execScript(wcId, buildDeclutterStyleScript(selectors))` only for a live browser tab whose normalized origin equals the selected origin.

- [x] **Step 1: Add component tests before adding the page**

Mock only the browser store and Electron bridge. Verify no matching live tab means Preview is disabled, invalid selectors show an inline error, preview targets only the chosen origin, and pause/delete remove the saved rule.

- [x] **Step 2: Run the focused component test and verify the missing page fails**

Run: `npx vitest run src/renderer/src/components/pages/DeclutterPage.test.tsx`
Expected: FAIL because the component is not implemented.

- [x] **Step 3: Implement the page and route it through existing internal-page conventions**

Add the lazy page import/render case in App, the sidebar entry, command-palette target, and a toolbar button that opens a new `aihub://declutter` tab without replacing the page the user is cleaning. Match existing AIHub research/extension page styling and keyboard labels.

- [x] **Step 4: Run page and model tests**

Run: `npx vitest run src/renderer/src/components/pages/DeclutterPage.test.tsx src/renderer/src/extensions/declutterRules.test.ts`
Expected: PASS, with no unexpected IPC calls for mismatched or sleeping tabs.

### Task 3: Apply rules across page navigation and verify the release path

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Test: `src/renderer/src/components/pages/DeclutterPage.test.tsx`
- Test: `src/renderer/src/extensions/declutterRules.test.ts`

**Interfaces:**
- Consumes rule functions from Task 1 and the editor persistence from Task 2.
- On each committed top-level document navigation, App removes any old cleanup stylesheet, then applies the enabled selectors for that exact URL origin to that live tab. Same-document navigation does not need reinjection because the CSS remains in that document.
- Rule changes immediately apply to currently open, loaded tabs on the same origin; unrelated tabs are untouched.

- [x] **Step 1: Add failing navigation/rule-change regression tests**

Verify an origin change removes the old rules before applying a new rule, no-rule origins clear the injected style, same-origin open tabs receive a rule update, and sleeping/internal tabs do not receive IPC calls.

- [x] **Step 2: Run focused tests and verify the origin-transition cases fail**

Run: `npx vitest run src/renderer/src/components/pages/DeclutterPage.test.tsx src/renderer/src/extensions/declutterRules.test.ts`
Expected: FAIL on the not-yet-integrated navigation cases.

- [x] **Step 3: Integrate stylesheet refresh with the existing tab-load event handler**

Use the event tab id and its live BrowserView id; derive the current URL from store state after the navigation event. Clear the prior style first even when there is no rule for the destination origin. Catch script errors so a malformed/unavailable DOM does not block page loading.

- [x] **Step 4: Run all checks and inspect the final change**

Run: `npx vitest run src/renderer/src/components/pages/DeclutterPage.test.tsx src/renderer/src/extensions/declutterRules.test.ts`
Run: `npm run typecheck`
Run: `npm test`
Run: `npm run build`
Run: `git diff --check`
Expected: all checks pass and site CSS is scoped by origin.

## Sensitive checks

- Never store page text, cookies, form contents, or captured element markup in the declutter rule.
- Treat localStorage content as untrusted; validate on load and again before building an injected script.
- Do not auto-generate or apply selectors without a visible preview; the user directly enters and confirms each selector in this slice.
- Preserve unrelated page CSS by using one uniquely tagged stylesheet that can be removed as a whole.
