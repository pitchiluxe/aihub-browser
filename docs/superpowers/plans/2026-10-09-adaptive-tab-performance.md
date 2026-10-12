# Adaptive Tab Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep AIHub responsive with many tabs by making background-tab resource release adaptive, safe around active work, and measurably testable.

**Architecture:** Extract the tab-sleep decision into a pure renderer service driven by tab state, last-use timestamps, and a tab-count-based idle policy. Forward Chromium audible-state transitions through the existing main-to-renderer tab event channel, protect loading/audible/active tabs, prune stale activity records, and keep the current native BrowserView destruction/recreation mechanism.

**Tech Stack:** Electron 44, React, TypeScript, Zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-aihub-browser-superpowers.md` (Slice A).

## Global Constraints

- Keep Chromium web security enabled, context isolation enabled, and Node integration disabled for site content.
- Keep tab resource decisions in the renderer's pure policy service; do not add polling or cloud virtualization.
- Never auto-sleep the active tab, a loading tab, or a tab currently playing audible media.
- Keep manual Sleep Tab available and preserve sleeping-tab session restoration.
- Do not add telemetry or collect URLs/page content for performance measurements.
- Validate with focused Vitest tests, `npm run typecheck`, `npm test`, and `npm run build`.

## Review Focus

- A background loading tab must remain awake until its load finishes.
- Audible media must keep a background tab awake, including when playback begins after the initial load.
- The active tab must never be returned by the policy, even if its timestamp is old.
- Stale timestamps for closed tabs must be removed so memory use does not grow with historical tab IDs.
- Browser-owned/internal pages and tabs without a live BrowserView must not be fed into the automatic sleep policy.

---

### Task 1: Pure adaptive tab-sleep policy

**Files:**
- Create: `src/renderer/src/services/tabSleepPolicy.ts`
- Test: `src/renderer/src/services/tabSleepPolicy.test.ts`
- Modify: `src/renderer/src/store/browserStore.ts`
- Test: `src/renderer/src/store/browserStore.test.ts`

**Interfaces:**
- Produces `getTabSleepIdleLimit(tabCount: number): number`, returning 2 hours below 12 tabs, 45 minutes for 12–29 tabs, and 15 minutes for 30 or more tabs.
- Produces `selectTabsToSleep(input): string[]`; input includes tabs, active tab id, live BrowserView ids, per-tab last-use timestamps, and current time. It returns only loaded browser tabs that have a live view, are not active, asleep, loading, or audible, and whose idle age meets the adaptive threshold.
- Produces `pruneTabActivity(lastUse, liveTabIds): Map<string, number>` to discard records for closed tabs.
- Adds optional `isAudible?: boolean` to the renderer `Tab` state; false/undefined means not known to be playing audio.

- [x] **Step 1: Write failing policy tests**

Cover each threshold boundary (11/12/29/30 tabs), the five Review Focus cases, future timestamps, never-used tabs, and activity-map pruning. Use fixed timestamps; do not use real timers.

- [x] **Step 2: Run the focused tests and verify the missing policy fails**

Run: `npx vitest run src/renderer/src/services/tabSleepPolicy.test.ts`
Expected: FAIL because the policy module is not implemented.

- [x] **Step 3: Implement the pure policy and tab audio state type**

Implement finite timestamp handling and use the current time as the baseline for tabs without an activity timestamp, so a newly discovered tab is never immediately slept. Clamp tab count to a non-negative integer before choosing a threshold. Do not mutate input arrays/maps.

- [x] **Step 4: Run policy and store tests**

Run: `npx vitest run src/renderer/src/services/tabSleepPolicy.test.ts src/renderer/src/store/browserStore.test.ts`
Expected: PASS; existing session restoration and wake behavior stays unchanged.

### Task 2: Forward audible-state changes and apply adaptive decisions

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/renderer/src/App.tsx`
- Test: `src/renderer/src/services/tabSleepPolicy.test.ts`

**Interfaces:**
- Consumes `selectTabsToSleep` and `pruneTabActivity` from Task 1.
- Main process emits existing tab event `audio-state-changed` with `{ audible: boolean }` from Electron's `WebContents` `audio-state-changed` event.
- Renderer records each tab's audible state, timestamps activation, and passes live view ids plus current tabs to the policy.

- [x] **Step 1: Add event and decision tests before integration**

Extend policy tests so an audible tab stays active and becomes eligible only after a false audio state is provided and its idle deadline has elapsed. Add an event-handler regression assertion using the existing app event test harness if one exists; otherwise keep the event payload typed at the IPC boundary and test the pure state-to-policy result.

- [x] **Step 2: Run focused tests and verify the new audio transition case fails**

Run: `npx vitest run src/renderer/src/services/tabSleepPolicy.test.ts`
Expected: FAIL on the not-yet-supported audio-state scenario.

- [x] **Step 3: Emit and consume audible-state transitions**

Subscribe once per newly created `WebContents`; forward the event through `sendTabEvent`. In App.tsx, update only the matching tab's `isAudible` value. Do not query page content or poll webContents.

- [x] **Step 4: Replace fixed sleep loop with adaptive policy**

Keep a single interval at the existing five-minute cadence. Each pass prunes activity timestamps for removed tabs, selects eligible ids using current tab count and `createdViewIds`, and calls the existing `store.sleepTab` action. Continue recording the selected tab's use when it becomes active. Remove stale entries when tabs close through pruning; no per-tab timers.

- [x] **Step 5: Run focused tests, typecheck, and inspect the change**

Run: `npx vitest run src/renderer/src/services/tabSleepPolicy.test.ts src/renderer/src/store/browserStore.test.ts`
Run: `npm run typecheck`
Expected: all focused tests and typecheck pass; only the planned tab policy/event files change.

### Task 3: Validate many-tab behavior and deliver Slice A

**Files:**
- Modify: `docs/superpowers/specs/2026-10-09-aihub-browser-superpowers.md` only if acceptance details need correction.
- Test: existing unit tests from Tasks 1–2 plus whole repository suite.

- [x] **Step 1: Run the complete suite and build**

Run: `npm test`
Run: `npm run build`
Expected: all tests pass and Electron main/preload/renderer builds complete.

- [ ] **Step 2: Compare baseline and candidate in the same environment**

Use the same machine, power mode, AIHub build mode, and three sessions of 10/25/50 ordinary browser tabs. For each session record: time to interactive after selecting a sleeping tab, count of live versus sleeping BrowserViews, app responsiveness during tab switching, and Electron/Chromium process memory from the OS process monitor. Repeat each scenario three times and record median values in the SDD progress ledger. Include one session with a loading tab and one with background audio to verify those tabs remain alive. Do not claim a memory improvement if process memory is not lower; report the observed tradeoff accurately.

- [ ] **Step 3: Inspect final diff and commit the slice**

Run: `git diff --check`
Review that no user artifacts or unrelated files are staged. Commit only the files listed in Tasks 1–3 with message `perf: adapt background tab sleeping to tab load`.

## Follow-on plans

After Slice A is reviewed and delivered, write and review separate plans for Slice B (site declutter), Slice C (offline reading and local search), Slice D (context clipboard and macro recorder), Slice E (scheduled workspaces and explicit handoff), and Slice F (OS dock and notification center). Do not combine cloud relay/service provisioning with local-only features without a separate security and infrastructure review.
