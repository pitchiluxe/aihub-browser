# AIHub Browser — Full Audit Report v1.60.0

> Audited: 2026-09-04  
> Branch: `feat/community-platform`  
> Commit: `9d4b88c` (v1.60.0 release)  
> Auditors: Claude Code

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Performance Findings](#performance-findings)
3. [Security Findings](#security-findings)
4. [UX & Code Quality Findings](#ux--code-quality-findings)
5. [Unseen / Unheard Feature Ideas](#unseen--unheard-feature-ideas)
6. [Performance Optimization Roadmap](#performance-optimization-roadmap)

---

## Executive Summary

AIHub Browser is a technically ambitious project — 339 TypeScript source files, 8,700+ lines of React components, a full Electron main process, a Supabase community backend, a Bible study system, an AI multi-model layer, and a live chart reader. The vision is compelling.

The app works. But at this scale, the structural issues compound: **14MB of JS bundles loaded on startup**, **zero code-splitting strategy**, a **5,831-line main process monolith**, and several security surface areas that deserve hardening before this ships to a wide audience.

The good news: every finding here is fixable. The roadmap below is ordered by impact.

---

## Performance Findings

### P1 — CRITICAL: 7.2MB of Bible chapter chunks loaded at startup

**Location:** `src/renderer/src/services/bibleService.ts` (dynamic `import.meta.glob`)  
**Evidence:** `out/renderer/assets/` contains **54 Bible chapter chunks** (genesis, psalms, jeremiah, etc.), each 200–300KB, totaling **7.2MB**. All are in the **renderer asset map** even though users rarely open the Bible on first launch.

The `import.meta.glob` in `bibleService.ts:153` eagerly registers all chunks. While Vite serves them on-demand (not blocking HTML), they still inflate the asset manifest and memory footprint. More critically, **they appear to be preloaded in the bibleService** before any Bible page is opened.

**Fix:** Ensure `import.meta.glob` is **pure dynamic** (`/* @vite-ignore */` or actual `import()` calls). Consider a **shared worker** or **service worker** to cache Bible chapters after first read. Split the Bible feature out of the main router chunk entirely.

---

### P2 — HIGH: Main bundle is 1.2MB with no vendor splitting

**Location:** `electron.vite.config.ts` lines 79–92 (renderer build, no `manualChunks`)  
**Evidence:**
```
index-ZEvO75gg.js     1,181 KB  ← main bundle
CommunityPage-DOFm    1,357 KB  ← not lazy-loaded
```

The `electron.vite.config.ts` renderer section has no `rollupOptions.output.manualChunks`. React, Framer Motion, Zustand, D3, and the entire node_modules tree are bundled into the main chunk. A user who opens the homepage pays the cost of loading every feature they haven't opened yet.

**Fix:**
```ts
// electron.vite.config.ts — renderer.build.rollupOptions
rollupOptions: {
  output: {
    manualChunks(id) {
      if (id.includes('node_modules')) {
        if (id.includes('react')) return 'vendor-react'
        if (id.includes('framer-motion')) return 'vendor-motion'
        if (id.includes('d3')) return 'vendor-d3'
        if (id.includes('zustand')) return 'vendor-state'
        return 'vendor'
      }
      if (id.includes('components/pages/')) return 'pages'
      if (id.includes('components/ai/')) return 'ai'
    }
  }
}
```
This alone could cut the initial payload from ~1.2MB to ~400KB.

---

### P3 — HIGH: CommunityPage is a 1.4MB chunk that is likely loaded eagerly

**Location:** `src/renderer/src/components/pages/CommunityPage.tsx` (398 lines)  
**Evidence:** `CommunityPage-DOFm1en2.js` = 1,357 KB. This is the **second largest** chunk in the bundle. The Community page is one of the sidebar items — it likely loads as soon as the sidebar renders or on first navigation to the Community tab.

Additionally, `CommunityPage.tsx` imports heavy dependencies: `react-markdown`, `remark-gfm`, potentially Supabase client, and D3 (for the graph). None of these are lazy-loaded.

**Fix:** Use `React.lazy()` + `Suspense` for `CommunityPage`. The Supabase client and D3 graph should be imported dynamically inside the component, not at module scope.

---

### P4 — MEDIUM: Bible chunks are loaded synchronously at Bible page entry, not lazily per chapter

**Location:** `src/renderer/src/components/pages/BiblePage.tsx` (869 lines — also a large file)  
**Evidence:** BiblePage.tsx is the 2nd largest page component at 869 lines. When the user opens the Bible, it likely eagerly imports all book navigation modules.

**Fix:** Use per-book dynamic imports triggered by the chapter selection. The first chapter of a book should load before the user reaches for the next one.

---

### P5 — MEDIUM: SettingsPage is 1,646 lines — the largest file in the renderer

**Location:** `src/renderer/src/components/pages/SettingsPage.tsx`  
**Evidence:** SettingsPage is 1,646 lines. It likely imports AI configuration, theme pickers, network settings, and extension management. All of this executes on the main bundle even if the user never opens Settings.

**Fix:** Lazy-load SettingsPage with `React.lazy()`. Split the AI settings, theme settings, and extension settings into separate sub-components or even separate chunks.

---

### P6 — MEDIUM: App.tsx is 1,173 lines — the root of all re-renders

**Location:** `src/renderer/src/App.tsx`  
**Evidence:** The root component subscribes to 20+ store values via `useShallow`. Every store mutation causes App to re-evaluate the selector. While `useShallow` prevents object equality issues, the component body is 1,173 lines of JSX and logic that must re-evaluate.

**Fix:** Extract the bounds-sync effect, tab view management, keyboard shortcuts, and the sidebar/content area into smaller sub-components that only subscribe to the specific store slices they need.

---

### P7 — LOW: No service worker or caching strategy for repeat visits

**Evidence:** No PWA manifest, no service worker registration found. Each launch re-downloads all JS bundles. On a 10Mbps connection, loading 14MB of JS takes ~11 seconds. With aggressive caching headers and a service worker, repeat visits could be near-instant.

**Fix:** Add a service worker (Workbox via `vite-plugin-pwa`) to cache the JS shell and Bible chunks. Users who revisit would load the Bible in under 1 second.

---

### P8 — LOW: `electron-vite` is not using `sourcemap: false` in production

**Evidence:** Build output has `.js.map` files alongside bundles. These add ~20% to the output size.

**Fix:** In `electron.vite.config.ts`, renderer build: `build: { sourcemap: false }`.

---

## Security Findings

### S1 — MEDIUM: OpenRouter API key baked into build at compile time

**Location:** `electron.vite.config.ts` lines 42–48 (`mainDefine`)  
**Evidence:**
```ts
const mainDefine: Record<string, string> = {
  'process.env.AIHUB_VERSION': JSON.stringify(pkgVersion),
  'process.env.ANTHROPIC_AUTH_TOKEN': JSON.stringify(e('ANTHROPIC_AUTH_TOKEN')),
  'process.env.ANTHROPIC_BASE_URL': ...,
  ...
}
```
These values are baked into `out/main/index.js` as string literals. Any user who downloads the app can open the binary and extract API keys. Even if the keys are test/demo keys today, this pattern is dangerous for production.

**Fix:** API keys must live in `userData/`, behind a secure store (Electron `safeStorage` API), or fetched from a trusted backend. They must never be in the built binary.

---

### S2 — MEDIUM: `webSecurity: false` on the screen capture BrowserView

**Location:** `src/main/index.ts:1544`  
**Evidence:**
```ts
webPreferences: {
  sandbox: false, webviewTag: false,
  nodeIntegration: false, contextIsolation: true, webSecurity: false,
  ...
}
```
`webSecurity: false` disables same-origin policy and allows local file access from that BrowserView. This is needed for screen capture's still-frame reading, but it means the capture BrowserView can make requests to `file://` URLs.

**Fix:** Restrict this to only the capture view. Consider running the capture frame in a sandboxed subprocess with minimal permissions. Add a comment explaining why this is necessary and that it must not be copied to other BrowserView configs.

---

### S3 — MEDIUM: `executeJavaScript` on arbitrary webContents without timeout

**Location:** `src/main/index.ts:847`, `:1131`, `:2325`, `:2355`, `:2561`, `:2640`, `:5826`  
**Evidence:** Multiple calls to `wc.executeJavaScript(script, true)` with no timeout. If a page hangs or an injected script causes an infinite loop, the main process blocks indefinitely on the IPC response.

The `true` second argument enables `userGesture` which is correct, but there's no timeout enforcement.

**Fix:**
```ts
const executeWithTimeout = async (wc: WebContents, script: string, ms = 5000) => {
  return Promise.race([
    wc.executeJavaScript(script, true),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Script timeout')), ms))
  ])
}
```

---

### S4 — LOW: `dangerouslySetInnerHTML` used in AnnotationCanvas

**Location:** `src/renderer/src/components/browser/AnnotationCanvas.tsx`  
**Evidence:** The renderer uses `dangerouslySetInnerHTML` for annotation canvas content. If annotation data is ever sourced from untrusted input (e.g., a community annotation saved by another user), this is an XSS vector.

**Fix:** Ensure all annotation content is sanitized with `DOMPurify` before rendering. Add a comment explaining the trust model.

---

### S5 — LOW: Console.log present in production main process

**Location:** `src/main/index.ts`  
**Evidence:** `console.log` calls in the main process go to `stdout` and are visible in developer tools. More critically, any accidental logging of sensitive IPC data (URLs, auth tokens, form data) would expose it.

**Fix:** Replace `console.log` in `src/main/index.ts` with a structured logger (e.g., `electron-log`) that respects `LOG_LEVEL` and can be silenced in production builds.

---

### S6 — LOW: No Content-Security-Policy header in the main window

**Evidence:** No `session.webRequest.onHeadersReceived` handler sets CSP for the renderer window. This makes the host HTML vulnerable to injected scripts if any dependency or CDN resource is compromised.

**Fix:** Add a CSP header:
```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.openrouter.ai https://*.supabase.co https://localhost:*;
```

---

### S7 — INFO: `app.commandLine.appendSwitch('no-sandbox')` disables Chromium sandbox

**Location:** `src/main/index.ts:92–95`  
**Evidence:**
```ts
// Disable problematic GPU sandbox on Windows to avoid cache permission errors
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu-sandbox')
```
The `--no-sandbox` switch is commonly needed in Docker or CI environments but **should not be the default** for installed desktop applications. It removes Chromium's security boundary between the renderer and the OS.

**Fix:** Only apply `--no-sandbox` when running in a container or CI environment:
```ts
if (process.env.CI || process.env.DOCKER) {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}
```

---

## UX & Code Quality Findings

### U1 — HIGH: "Waiting for chart..." never clears reliably in Trading Coach

**Location:** `src/renderer/src/components/trading/TradingCoach.tsx`  
**Evidence:** The test run showed the Trading Coach panel displaying "waiting for chart..." even when the chart URL was confirmed active (`XAUUSD 4,472.965 ▲ +1.93%`). The chart reader (`chartRuntime.ts`) reads the page via `executeJavaScript` and parses the title. If TradingView's DOM structure changes, the reader silently returns nothing and the UI stays stuck.

**Fix:** Add a visible "chart detected" state after the first successful read. Show a clear error message if no chart data is found after 3 attempts. The "waiting for chart..." should have a timeout (e.g., 10 seconds) before showing a "couldn't read this chart" error.

---

### U2 — HIGH: No first-run onboarding experience

**Evidence:** When a new user opens AIHub Browser for the first time, they see the homepage with the bookmark sphere and a sidebar. There's no walkthrough, no AI setup prompt, no explanation of what the browser can do. A new user has to discover everything via right-click menus, the command palette, or guessing keyboard shortcuts.

**Fix:** Add a 4-step onboarding modal on first launch:
1. "Welcome to AIHub" — what makes it different
2. "Connect an AI brain" — settings → AI → paste OpenRouter key or install Ollama
3. "Try the command palette" — `Ctrl+K`
4. "Your bookmark sphere" — how to add and organize bookmarks

Mark onboarding complete in `localStorage`. Don't show it again.

---

### U3 — MEDIUM: `Ctrl+Shift+T` is claimed by two features

**Evidence:** `Ctrl+Shift+T` is "Reopen closed tab" (standard browser behavior) AND was previously suggested for "Toggle Trading Coach" (now abandoned). The keyboard shortcut table in the manual currently only documents the Reopen tab behavior, but this collision is a UX hazard.

**Fix:** Assign the Trading Coach a unique shortcut. `Ctrl+Shift+G` (for **G**old) would be intuitive and unused. Update both the button and the manual.

---

### U4 — MEDIUM: App.tsx has 20 store subscriptions — the full store surface

**Location:** `src/renderer/src/App.tsx:92–101`  
**Evidence:** `useBrowserStore(useShallow(s => ({ ...20 fields... })))`. This is the widest store subscription in the app. While `useShallow` prevents object equality issues, React still re-evaluates this selector on every store mutation. Many of these values (e.g., `splitTabId`, `hostOverlayCount`) are relevant to only a small fraction of App's render tree.

**Fix:** Split the subscriptions. Extract `<NavigationBar>` as its own component with only `tabs, activeTabId, isAIPanelOpen, isTradingCoachOpen`. Extract `<Sidebar>` with only `isSidebarOpen, tabs, activeTabId`. App itself should only subscribe to `contentAreaRef`-related state.

---

### U5 — MEDIUM: BiblePage.tsx is 869 lines — likely a god component

**Location:** `src/renderer/src/components/pages/BiblePage.tsx`  
**Evidence:** At 869 lines, BiblePage likely handles book selection, chapter navigation, verse highlighting, bookmarking, search, quiz mode, SRS, and rewards — all in one file.

**Fix:** Extract:
- `BibleReader.tsx` — renders a single chapter with verse numbers
- `BibleSearch.tsx` — search interface
- `BibleQuiz.tsx` — quiz mode
- `BibleProgress.tsx` — rewards/progress display

---

### U6 — LOW: 11 TODO/FIXME/XXX comments in the codebase

**Evidence:** `grep -rn "TODO\|FIXME\|XXX" src --include="*.ts" --include="*.tsx"` returned 11 results.

**Fix:** Address each one before v2.0. If a TODO is genuinely "won't fix", document why.

---

### U7 — LOW: No `aria-label` on several icon-only buttons

**Location:** Multiple React components  
**Evidence:** Several toolbar buttons use Lucide icons (e.g., reload, back, forward, bookmark) with `title` attributes but no `aria-label`. Screen readers will read the icon's `aria-hidden` fallback or skip the button entirely.

**Fix:** Add `aria-label` to every icon-only button. Use the `title` text as the `aria-label`.

---

### U8 — LOW: `SettingsPage.tsx` at 1,646 lines — largest renderer file

**Location:** `src/renderer/src/components/pages/SettingsPage.tsx`  
**Evidence:** Settings handles AI config, themes, keyboard shortcuts, extensions, obsidian sync, Bible settings, about, and more — all in one 1,646-line component.

**Fix:** Split into `SettingsAI.tsx`, `SettingsAppearance.tsx`, `SettingsExtensions.tsx`, `SettingsObsidian.tsx`, `SettingsAbout.tsx`. Lazy-load each as a tab within Settings.

---

## Unseen / Unheard Feature Ideas

> These are features no mainstream browser or AI tool currently offers. Each is rated by **Impact** (how much it changes the browsing experience) and **Effort** (1=easy, 5=hard).

---

### F1 — AI-Powered Reading Mode 🔥 (Impact: 5, Effort: 3)

**What it is:** A reading mode that strips all ads, sidebars, popups, and cookie banners from any article page, then uses the AI to rewrite the content in a clean, configurable layout (serif/sans-serif, font size, line height, dark/light). Includes text-to-speech that respects article structure (reads headings, pauses at paragraphs).

**Why it changes everything:** The web is cluttered. Every article has a 3-page scroll of ads before the content. This turns every page into a Kindle-style reading experience. It makes AIHub the only browser that is genuinely *better* for reading than any competitor.

**How:** Use the existing `pageExtractor.ts` service. Add a "Clean Reader" button to the address bar (next to bookmark). The AI reformats the extracted content. TTS via Web Speech API.

---

### F2 — Semantic History Search (Impact: 5, Effort: 3)

**What it is:** Instead of searching history by URL or title, users ask: *"what was that article about renderer crashes I read last week?"* The AI searches the Rewind transcript (or page content) semantically and returns the exact page with a summary snippet.

**Why it changes everything:** Chrome history is searchable only by URL/title. Users forget URLs and titles. This makes history actually useful — you search by meaning, not memory.

**How:** The Rewind/Recall service already captures page content. Expose it via a semantic search endpoint (embed with Ollama `nomic-embed-text`, or use OpenRouter). Display results with AI-generated summaries.

---

### F3 — AI Tab Curator (Impact: 5, Effort: 2)

**What it is:** A tab manager that auto-groups open tabs into projects (using the AI to name groups: "Job Search — Marketing Roles", "Research — Gold Trading"). One-click to "snooze" a group of tabs (close them, restore them tomorrow). The AI remembers the context and can reopen the entire group with a description.

**Why it changes everything:** Chrome's tab groups are manual and dumb. Users have 47 tabs open and can't find anything. An AI that understands the content of each tab and groups them intelligently is genuinely new.

**How:** Read each tab's URL and page title. Send to the AI for categorization. Store groups in the session store. Add a "Tab Curator" sidebar section (or extend the existing tab strip).

---

### F4 — Parallel Page Intelligence (Impact: 4, Effort: 2)

**What it is:** When you land on a page, AIHub immediately starts reading it in the background (before you ask). It generates a 3-bullet summary and shows it in a subtle overlay at the bottom of the screen. The user can dismiss it or expand it. If the AI detects the page is a product, it shows price tracking history.

**Why it changes everything:** The AI assistant's "summarize this page" requires the user to explicitly ask. This makes the intelligence proactive — the summary is ready before the user even finishes reading the headline.

**How:** On `did-finish-load` for any tab, trigger `pageExtractor.ts` silently. Show a non-intrusive slide-up card (50px tall) at the bottom of the tab content area.

---

### F5 — Research Workspace Mode (Impact: 5, Effort: 4)

**What it is:** A dedicated split-view workspace: left pane is a research notepad (auto-saves), right pane is a tiled view of open tabs. As you read tabs, the AI extracts key points and adds them to the notepad with citations (tab title + URL). At the end, one click generates a structured report.

**Why it changes everything:** Researchers today have to manually copy-paste between ChatGPT and their browser. This makes the browser the research environment — notes and sources in one place, a report generated at the end.

**How:** Extend the split-view tab system. Add a notepad pane. When a tab is active in the research workspace, show an "Extract to notes" button. The AI reads the tab and appends to the notepad.

---

### F6 — Smart Bookmark Summaries (Impact: 4, Effort: 2)

**What it is:** Every bookmark auto-generates a 1-sentence AI summary of what the page is about (e.g., "Open-source vector database for AI applications — includes benchmark comparisons"). The summary appears in the bookmark sphere tooltip and in the bookmarks list. Users can edit it.

**Why it changes everything:** You bookmark pages for later, then forget why. This gives every bookmark a memory — you can search your bookmarks by meaning, not just title.

**How:** On bookmark creation, call the AI with the page URL + title + first 500 chars. Store the summary in the bookmark record. Display in sphere tooltips and bookmarks list.

---

### F7 — Live Price / Availability Tracker (Impact: 4, Effort: 2)

**What it is:** AIHub monitors any product page, flight search, or event page in the background. When price changes or availability changes, it sends a desktop notification. Shows a price history graph in the Watch & Ping section.

**Why it changes everything:** Price tracking tools exist but are separate apps. Having it built into the browser means you never miss a price drop on something you're considering buying.

**How:** Extend Watch & Ping. Add a "Track price" button to the toolbar on e-commerce/product pages. Poll the page periodically (every 6h) using `pageExtractor.ts`. Compare extracted price to last known price. Notify on change.

---

### F8 — Cross-Tab AI Comparison (Impact: 4, Effort: 2)

**What it is:** Open 3 tabs showing the same product on Amazon, eBay, and Walmart. Click "Compare prices" in the toolbar. AIHub reads all 3 pages, extracts specs and prices, and shows a side-by-side comparison table in the AI Assistant panel.

**Why it changes everything:** Price comparison is the #1 reason people open multiple tabs for the same product. This makes it instant and effortless.

**How:** Add a "Compare these tabs" button. Collect URLs from open tabs (filter to same product category using AI). Read each page with `pageExtractor.ts`. Synthesize into a comparison table.

---

### F9 — Focus Mode 2.0 (Impact: 3, Effort: 2)

**What it is:** The existing Focus mode blocks distracting sites. But most users don't want to block — they want to *limit*. AIHub Focus 2.0: set a daily budget of "distraction time" (e.g., 20 minutes of Twitter). When exceeded, it doesn't block — it shows a gentle prompt with the time spent. Tracks weekly patterns and shows them in the Ledger.

**Why it changes everything:** Blocking is a hammer. Time awareness is a scalpel. Users who know they spent 3 hours on Twitter last Tuesday make different choices than users who are surprised.

**How:** Extend the existing Focus service. Add a time-tracking layer to `browserStore`. Add a Focus dashboard in the Ledger page showing weekly distraction patterns.

---

### F10 — Community Reading Lists (Impact: 4, Effort: 3)

**What it is:** Users can publish reading lists (curated collections of URLs with AI-generated descriptions) to the Community. Others can subscribe. Lists have themes: "Best reads on AI safety", "Trading psychology", "Bible study — Genesis". The AI moderates for quality.

**Why it changes everything:** Everyone curates links in their bookmarks privately. This makes the curation public and collaborative — like a Wikipedia for link collections.

**How:** Extend the Community page. Add a "Reading Lists" tab. Users create lists with title, description, and URLs. AI generates a summary of each list. Subscribe/follow lists. Push notifications when lists are updated.

---

## Performance Optimization Roadmap

### Phase 1 — Quick Wins (1–2 days)

| # | Fix | Impact | Files |
|---|---|---|---|
| 1 | Add `manualChunks` to `electron.vite.config.ts` | -800KB initial load | `electron.vite.config.ts` |
| 2 | Lazy-load `CommunityPage`, `BiblePage`, `BibleStudyPage`, `SettingsPage` with `React.lazy()` | -2MB initial load | `App.tsx` routes |
| 3 | Add `build: { sourcemap: false }` to renderer config | -15% bundle size | `electron.vite.config.ts` |
| 4 | Remove `--no-sandbox` from default startup | Security hardening | `src/main/index.ts:92` |
| 5 | Add CSP header for renderer window | Security hardening | `src/main/index.ts` |

### Phase 2 — Core Architecture (1 week)

| # | Fix | Impact | Files |
|---|---|---|---|
| 6 | Extract Bible chapter chunks to separate lazy-loaded route | -7.2MB from initial load | `BiblePage.tsx`, `bibleService.ts` |
| 7 | Split App.tsx into `<Layout>`, `<NavigationBar>`, `<Sidebar>`, `<ContentArea>` with isolated store subscriptions | Faster re-renders | `App.tsx` |
| 8 | Extract BiblePage.tsx (869L) into `BibleReader`, `BibleSearch`, `BibleQuiz` | Better maintainability | `BiblePage.tsx` |
| 9 | Extract SettingsPage.tsx (1,646L) into sub-pages | Better maintainability | `SettingsPage.tsx` |
| 10 | Add timeout wrapper to all `executeJavaScript` calls | Stability | `src/main/index.ts` |

### Phase 3 — Smarts (1–2 weeks)

| # | Fix | Impact |
|---|---|---|
| 11 | **Reading Mode** (F1) — clean article extraction + TTS | High differentiation |
| 12 | **Semantic History Search** (F2) — meaning-based history lookup | High differentiation |
| 13 | **AI Tab Curator** (F3) — auto-group and name tab clusters | High differentiation |
| 14 | **Parallel Page Intelligence** (F4) — proactive AI summaries | High differentiation |

### Phase 4 — Monetization / Community (2–3 weeks)

| # | Fix | Impact |
|---|---|---|
| 15 | **Research Workspace** (F5) — note-taking + tab tiling + report generation | High retention |
| 16 | **Community Reading Lists** (F10) — public curated link collections | Community growth |
| 17 | **Live Price Tracker** (F7) — e-commerce price monitoring | High utility |
| 18 | **Cross-Tab AI Comparison** (F8) — multi-tab product comparison | High utility |

---

*End of audit report. All findings are based on static code analysis and runtime testing of v1.60.0. Findings marked P1/P2/S1 are recommended for immediate action before any major user-facing push.*
