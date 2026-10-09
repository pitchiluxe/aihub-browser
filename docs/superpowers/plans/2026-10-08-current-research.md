# Research That Stays Current Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users monitor selected research sources, inspect changes and prepare a separate updated report without altering their original evidence.

**Architecture:** A dedicated main-process monitor service owns public fetches, bounded persistence and scheduling. Pure shared comparison functions explain citation impact; typed owner-scoped IPC exposes this to small controls and drawers within the existing Research workspace. Explicit AI proposals reuse structured research generation and create a distinct project.

**Tech Stack:** Electron, Node HTTPS/DNS, TypeScript, React, Vitest; declare `parse5` directly for non-executing HTML parsing. Inspect the installed parser API before choosing its compatible version; do not depend on a transitive package.

**Spec:** `docs/superpowers/specs/2026-10-08-current-research-design.md` (approved by the user).

## Global Constraints

- Preserve the restored compact blue-glass Research layout, left notepad, middle sources and right report.
- Nothing is monitored by default. Checks occur only while AIHub is running.
- Public monitoring uses an unauthenticated HTTPS request. It does not reuse website cookies, account sessions or private research text.
- Keep the existing project/source IDs and original captures immutable.
- Private windows never read the normal monitor store, create persisted monitors, receive normal-project update events or produce desktop research notifications.
- Limits: twenty active public monitors across normal projects; at most ten monitored sources within one project; one fetch at a time globally; fifteen-second request deadline; one MB response-body ceiling; 12,000 retained text characters per observation.
- Retain a baseline, latest observation and at most ten compact change records per monitor. A global ten-MB monitor-store ceiling pauses additions with a visible capacity message rather than silently dropping records.
- The scheduler wakes once per minute, starts no more than one due job per tick, and deduplicates manual/scheduled checks for the same source.
- Failed checks do not replace the last successful baseline or generate content-change alerts. Pause after three consecutive failures.
- No automatic AI requests during capture, checking, diffing or notification delivery.
- No hosted service, release or travel-data provider is introduced.

## Review Focus

1. A public baseline is a login/consent page rather than the saved evidence: reject obvious authentication-only/empty responses, require explicit mismatch confirmation for missing quotes (Tasks 2, 4, 5).
2. A hostname changes DNS destination or redirects to a local address: validate and pin each actual connection, including IPv4-mapped IPv6 (Task 2).
3. A project is edited/deleted while a check or AI proposal runs: discard stale results and retain unsaved drafts (Tasks 3, 4, 6).
4. A changed passage falls outside the retained text: show truncation, never imply whole-page or factual verification (Tasks 1, 5).
5. Several windows resume/check the same source while many tabs are live: one global fetch, scoped events, deterministic cancellation and responsive UI (Tasks 3, 4, 7).

## File and interface map

Create shared `src/shared/research/monitorTypes.ts`, `monitorValidation.ts`, `monitorDiff.ts`, and matching tests. Create main `src/main/research/monitors/{publicFetch,publicText,store,service,ipc}.ts` with colocated tests. Create renderer `ResearchMonitorSetup.tsx`, `ResearchUpdates.tsx`, `ResearchUpdateProposal.tsx`, and `useResearchMonitors.ts` in `src/renderer/src/components/research/`, with component/hook tests. Modify existing `src/main/research/index.ts`, `src/preload/index.ts`, `src/shared/research/types.ts`, `ResearchWorkspace.tsx`, and `research.css`. Locate the existing Electron API declaration with `rg -n 'ResearchBridge' src` before editing it; extend the existing declaration rather than creating a competing global declaration. Add `scripts/test-research-monitors-e2e.mjs` and `docs/2026-10-08-current-research-verification.md`.

Shared contracts (define these in Task 1, import them elsewhere):

```ts
type IntervalHours = 1 | 6 | 24
type Observation = {
  id: string; requestedUrl: string; finalUrl: string; checkedAt: string
  text: string; truncated: boolean; kind: 'public-html' | 'loaded-page'
}
type Impact = { claimId: string; quote: string; status: 'present' | 'missing' | 'already-unmatched' }
type PassageChange = { before: string; after: string }
type MonitorChange = {
  id: string; observedAt: string; version: string; passages: PassageChange[]
  impacts: Impact[]; truncated: boolean; acknowledged: boolean
}
type ResearchMonitor = {
  id: string; projectId: string; sourceId: string; intervalHours: IntervalHours
  notifications: boolean; status: 'active' | 'paused'; failures: number
  lastAttemptAt?: string; nextDueAt: string; error?: string
  baseline: Observation; latest: Observation; changes: MonitorChange[]
}
type MonitorPreview = { token: string; observation: Observation; missingQuotes: string[]; expiresAt: string }
type MonitorInput = { projectId: string; sourceId: string; expectedUpdatedAt: string }
type MonitorAction = { projectId: string; monitorId: string }
type ResearchMonitorBridge = {
  list(projectId: string): Promise<ResearchResult<ResearchMonitor[]>>
  preview(input: MonitorInput): Promise<ResearchResult<MonitorPreview>>
  confirm(input: MonitorInput & { token: string; intervalHours: IntervalHours; notifications: boolean; acceptMismatch: boolean }): Promise<ResearchResult<ResearchMonitor>>
  check(input: MonitorAction): Promise<ResearchResult<ResearchMonitor>>
  setPaused(input: MonitorAction & { paused: boolean }): Promise<ResearchResult<ResearchMonitor>>
  remove(input: MonitorAction): Promise<ResearchResult<void>>
  acknowledge(input: MonitorAction & { changeId: string }): Promise<ResearchResult<void>>
  compareLoaded(input: MonitorInput & { tabId: string }): Promise<ResearchResult<{ observation: Observation; impacts: Impact[]; passages: PassageChange[] }>>
  onChanged(listener: (event: { projectId: string }) => void): () => void
}
```

## Task 1: Bounded contracts and deterministic evidence comparison

**Files:** Shared monitor files and tests listed above. Modify `src/shared/research/types.ts` only to expose `monitors: ResearchMonitorBridge` on the existing research bridge; keep project/capsule schema unchanged.

**Interfaces:** `validateMonitorInput(raw: unknown): ResearchResult<MonitorInput>`; `compareObservation(project: ResearchProject, sourceId: string, before: Observation, after: Observation): { passages: PassageChange[]; impacts: Impact[]; version: string; truncated: boolean }`. Use `normalizeEvidence` and `matchCitation` from `evidence.ts`; SHA-256 version hashing belongs in main, so pure comparison returns normalized text as its version key and main hashes that key before storing.

- [ ] Write failing tests including the following fixture; also cover whitespace-only equality, repeated paragraphs, already-unmatched quotes, no unrelated claim warnings, truncation and deterministic capped paragraph changes (maximum twenty pairs, each side maximum 1,000 characters).

```ts
const old = { ...observation, text: 'Price $120 on 2026-10-08' }
const next = { ...observation, text: 'Price $150 on 2026-10-09' }
const result = compareObservation(project, source.id, old, next)
expect(result.passages).not.toHaveLength(0)
expect(result.impacts.find(i => i.claimId === quotedClaim.id)?.status).toBe('missing')
expect(project.claims).toEqual(originalClaims)
```

- [ ] Run `npx vitest run src/shared/research/monitorDiff.test.ts src/shared/research/monitorValidation.test.ts --maxWorkers=2 --minWorkers=1`; verify new behavior fails before implementation.
- [ ] Implement strict length/date/enum validation and bounded paragraph matching using normalized text; avoid an unbounded quadratic diff. Classify original unmatched citations before checking latest text. Return no passages for normalized equality.

```ts
const original = project.sources.find(s => s.id === sourceId)
const relevant = project.claims.flatMap(c => c.citations.filter(q => q.sourceId === sourceId).map(q => ({ c, q })))
const impacts = relevant.map(({ c, q }) => ({ claimId: c.id, quote: q.quote,
  status: !original || !matchCitation(original, q) ? 'already-unmatched' as const
    : normalizeEvidence(after.text).includes(normalizeEvidence(q.quote)) ? 'present' as const : 'missing' as const }))
```

- [ ] Rerun focused tests and type checks; commit only these shared files as `feat(research): define source monitoring and evidence impact rules`.

## Task 2: Safe asynchronous public observations

**Files:** `publicFetch.ts`, `publicText.ts`, their tests, `package.json`, `package-lock.json`.

**Interfaces:** `fetchPublicObservation(url: string, signal: AbortSignal): Promise<Observation>`; `extractPublicText(html: string): { text: string; truncated: boolean }`. Export testable `assertPublicAddress(address: string): void`; inject DNS/request/clock through a factory `createPublicFetcher(deps): typeof fetchPublicObservation` with production defaults that cannot be configured by renderer IPC.

- [ ] Write network tests with injected transport for HTTPS-only/no credentials, redirects (three permitted, fourth rejected), all resolved addresses validated, mapped IPv6, TLS hostname retained, pinned lookup, 15-second deadline, aborted/chunked responses, 1MB ceiling, non-HTML/HTTP errors and no cookies/auth headers. Parser fixtures include hidden ancestors, form/editable drafts, script/style text and login-only content.

```ts
expect(() => assertPublicAddress('127.0.0.1')).toThrow()
expect(() => assertPublicAddress('::ffff:127.0.0.1')).toThrow()
expect(extractPublicText('<main><p>Evidence</p><div hidden><p>secret</p></div><input value="secret"><div contenteditable>draft</div></main>').text).toBe('Evidence')
```

- [ ] Run both new test files and record failures. Inspect parser declarations and add a direct compatible `parse5` dependency; no product dependency installation before this plan is approved.
- [ ] Implement `https.request` with validated DNS results and a pinned `lookup` callback, URL hostname preserved for SNI/certificate checks, no automatic redirects and one request deadline covering DNS and all redirects. Cancel requests/readers on all failure paths; bound bytes before decoding. Reject localhost/local suffixes and non-public address ranges (including reserved/documentation/multicast/unspecified). Use a vetted address classification dependency if needed, declared directly and tested for mapped addresses.

```ts
const options = { hostname: url.hostname, servername: url.hostname, path: url.pathname + url.search,
  headers: { Accept: 'text/html, application/xhtml+xml' },
  lookup: (_host: string, _opts: unknown, callback: Function) => callback(null, pinned.address, pinned.family) }
// Never disable TLS certificate verification. Re-resolve and validate every redirect URL.
```

- [ ] Parse inert HTML into a bounded node walk, skip excluded subtrees, prefer article/main then body, retain paragraph boundaries, cap 50,000 visited nodes and 12,000 characters with explicit truncation. Empty/login-only pages return an unsupported error; ordinary missing saved quotes are handled by setup confirmation.
- [ ] Run focused tests and type checks; commit `feat(research): fetch bounded public evidence safely`.

## Task 3: Persistence, cancellation and scheduling

**Files:** Main monitor `store.ts`, `service.ts`, tests; use the existing managed JSON store pattern from `src/main/research/store.ts`.

**Interfaces:** `createMonitorStore(appDir: string)` exposes `list(): ResearchMonitor[]` and `replace(records: ResearchMonitor[]): void`; rejects malformed/oversized writes. `createMonitorService(deps)` exposes `list(projectId)`, `preview(owner,input)`, `confirm(owner,input)`, `check(owner,action)`, `setPaused(owner,input)`, `remove(owner,action)`, `acknowledge(owner,input)`, `reconcile(projects)`, `release(windowId)`, `tick()`, `dispose()`. Owners use existing `ResearchWindow`; dependencies include `getProject(owner,id)`, public fetcher, clock, scoped event and notification callbacks. Persisted normal checks continue after setup window closes; pending previews/manual operations do not.

- [ ] Write fake-clock/store tests for restart overdue work, twenty active/ten per-project limits, baseline/latest/ten event retention, 10MB rejection without data loss, malformed persisted records, deduplication, one global in-flight request, pause/shutdown cancellation, failure backoff/pause at three, unchanged silence and distinct-version notifications. Include delete/edit-during-fetch cases.

```ts
const pending = service.check(owner, action)
service.reconcile([])
fetchDeferred.resolve(newObservation)
await pending
expect(service.list(project.id)).toEqual([])
expect(notify).not.toHaveBeenCalled()
```

- [ ] Run new store/service tests to demonstrate failures.
- [ ] Implement validated versioned storage; fetch results commit only after checking operation generation, project/source existence and expected project revision. Use monotonic generation counters and AbortController, not only mounted flags. Hash normalized versions with Node SHA-256; compare latest observation against new observation, preserve initial baseline. Mark attempt errors separately; next due is attempt time plus selected interval; resume clears failures and schedules one new check. Serialize fetch queue globally and prioritize queued manual requests without bypassing limits.

```ts
const generation = generations.get(id)
const observation = await fetcher(url, controller.signal)
if (controller.signal.aborted || generations.get(id) !== generation || !currentProjectHasSource()) return
// Persist only after these checks; emit only after successful bounded persistence.
```

- [ ] Limit previews to one per owner/source, expire at five minutes, bind tokens to owner/project/source/revision and invalidate on release. Require explicit mismatch acceptance; no monitoring before confirmation. Reconcile source/project deletions immediately. Notifications contain generic counts only; repeated identical latest text is quiet.
- [ ] Run tests and type checks; commit `feat(research): schedule bounded source monitors with cancellation`.

## Task 4: Owner-scoped desktop integration

**Files:** `monitors/ipc.ts`, tests; existing research `index.ts`, preload `index.ts`, existing Electron API declaration and main `index.ts` integration site.

**Interfaces:** `registerMonitorIpc({ resolveWindow, repo, captures, appDir, events, notify })` returns service lifecycle hooks; preload nests monitor methods under `electronAPI.research.monitors`. Events use `research:monitors-changed` and payload `{ projectId }`. Existing research save/remove handlers call reconcile after successful mutations; application quit disposes scheduler. Existing release hook releases private comparisons/previews and owner work.

- [ ] Write IPC tests for unknown sender, private list (empty without reading disk), forbidden private public creation/checks, imported source rejection, malformed IDs/revisions/tokens, owning-tab-only loaded capture, changed project revision and deleted source; assert normal events never target incognito webContents.

```ts
const result = await invoke('research:monitors-preview', privateEvent, input)
expect(result.ok).toBe(false)
expect(publicFetcher).not.toHaveBeenCalled()
expect(monitorStore.list).not.toHaveBeenCalled()
```

- [ ] Run failing IPC tests. Wire handlers using the existing fail-closed research wrapper and validated bridge contracts. Resolve original source URL from stored project, never from renderer-provided replacement URL. Manual loaded-page comparison uses existing owner capture and verifies the loaded tab URL corresponds to the selected source (credentials rejected); keep private comparison results in memory.

```ts
ipcRenderer.on('research:monitors-changed', listener)
return () => ipcRenderer.removeListener('research:monitors-changed', listener)
```

- [ ] Route desktop notification clicks to an available normal window that has opened the project; otherwise open it explicitly in a normal window. Expose a targeted project-open event and handle it in ResearchWorkspace; never pick an arbitrary private window. Add lifecycle/event tests.
- [ ] Run monitor IPC plus existing research IPC/store tests and type checks; commit `feat(research): expose private-safe monitoring controls`.

## Task 5: Familiar source controls and change inspection

**Files:** `useResearchMonitors.ts`, `ResearchMonitorSetup.tsx`, `ResearchUpdates.tsx`, tests, `ResearchWorkspace.tsx`, `research.css`.

**Interfaces:** Hook takes `{ project, privateWindow, bridge }`, returns `{ monitors, loading, error, refresh }`; setup takes `{ project, source, bridge, onClose, onCreated }`; updates takes `{ project, monitors, bridge, onClose, onPrepareProposal }`. Reuse `ResearchDialog.tsx` focus/Escape behavior. Keep styles under existing Research selectors and tokens.

- [ ] Write DOM tests for default-off selection, daily default, baseline missing-quote confirmation, unsupported/imported/private alternatives, explicit public/loaded limitations, last/next check, truncated observation labels, error/retry/pause/remove/acknowledge controls, empty/unchanged/changed states, focus/Escape cleanup and project-switch late-response suppression.

```tsx
expect(screen.queryByText('Monitoring active')).toBeNull()
await user.click(screen.getByRole('button', { name: 'Keep current' }))
expect(screen.getByText('Public version differs')).toBeTruthy()
expect(screen.getByRole('button', { name: 'Start monitoring' }).hasAttribute('disabled')).toBe(true)
```

- [ ] Run failing UI tests. Implement small per-source button/status plus header Updates count; present before/after and per-finding impact explanations in drawer. Acknowledge event without setting claim.reviewed. Maintain baseline comparison previews and staged confirmation; private windows show only manual loaded-page action. Loaded-page comparisons visibly state that server freshness is unknown.

```tsx
<span>{impact.status === 'missing' ? 'Quoted passage missing from latest observation — review needed'
  : impact.status === 'present' ? 'Quote still present; surrounding source changed'
  : 'Original citation remains unmatched'}</span>
```

- [ ] Preserve notepad/source/report arrangement and draft-save conflict protections. Test both themes, narrow width and event subscriptions/unsubscriptions; run existing workspace tests alongside new tests and type checks; commit `feat(research): inspect current-source changes in the existing workspace`.

## Task 6: Explicit updated-report proposals

**Files:** `ResearchUpdateProposal.tsx`, tests; `ResearchWorkspace.tsx`, existing `src/renderer/src/services/researchGeneration.ts` only if needed for shared helpers; add main proposal preparation/acceptance handlers and bridge methods in monitor files.

**Interfaces:** Add `prepareProposal(input: MonitorInput): Promise<ResearchResult<{ token: string; project: ResearchProject; monitorVersions: Record<string,string> }>>` and `acceptProposal(input: { token: string; expectedUpdatedAt: string; claims: ResearchClaim[] }): Promise<ResearchResult<ResearchProject>>` to monitor bridge. Preparation is local, not an AI call: main creates registered fresh source IDs for public observations, with explicit `captureType: 'excerpts', provenance: 'imported'` until a future project-schema observation kind exists; UI labels these as public observations via returned metadata. Include complete latest retained text as a single excerpt, never pretend it is locally captured evidence. Imported proposal sources remain automatically ineligible for monitoring. Register token-owned immutable proposal sources main-side; normal project validation and capacity rules still apply. Token expires after five minutes; private proposals can use only private loaded comparisons and remain private.

- [ ] Write failing tests for explicit provider disclosure, AI errors retaining original report, cancellation/project edits/switches/deletion/monitor changes discarding results, malformed AI quotes staying unmatched, accepting a proposal as a new project, main revision/token/source verification, twenty-project capacity and capsules retaining imported provenance.

```ts
await acceptProposal({ token, expectedUpdatedAt: project.updatedAt, claims })
expect(repo.list(owner).find(p => p.id === project.id)).toEqual(project)
expect(repo.list(owner)).toHaveLength(2)
expect(repo.list(owner).find(p => p.id !== project.id)?.sources[0].provenance).toBe('imported')
```

- [ ] Implement a side-by-side unsaved proposal modal, configured-provider/cloud fallback disclosure before the explicit Generate action, and existing structured generation validation. Gate acceptance on token/project revision/monitor versions and source equality; accept with fresh project ID/title and reviewed=false, without changing original project. Reject stale/capacity cases visibly. Source labels distinguish public HTML observation from imported shared excerpts, using explicit metadata in proposal display; after saving use a clear source title prefix `Public HTML observation: ` to preserve that distinction without changing the backward-compatible schema.

```ts
const operation = ++generationRef.current
const generated = await generateResearchClaims(proposalProject, window.electronAPI.ai, signal)
if (signal.aborted || generationRef.current !== operation || currentRevision !== initialRevision) return
if (!generated.ok) { setError(generated.error); return }
setProposal({ ...proposalProject, claims: generated.value.map(c => ({ ...c, reviewed: false })) })
```

- [ ] Import `generateResearchClaims` from the existing research generation service and preserve its abort/error protections. Run proposal UI/main tests, existing generation/capsule/workspace tests and type checks; commit `feat(research): prepare separate updated reports from observations`.

## Task 7: Desktop acceptance and independent review

**Files:** `scripts/test-research-monitors-e2e.mjs`, verification document, task checkboxes in this plan.

- [ ] Extend the isolated-profile pattern in `scripts/test-research-capsules-e2e.mjs`; add a test-only injected transport that returns controlled changing HTML. Production code must not accept a renderer switch that disables safe-address checks. Test baseline preview/confirm, changed numeric quote, before/after warning, quiet unchanged checks, original report retention and distinct accepted proposal; use deterministic AI only within the isolated test process and label it accordingly.

```js
assert.equal(savedOriginal.claims[0].text, originalClaimText)
assert.notEqual(acceptedProject.id, savedOriginal.id)
assert.equal(notificationsAfterUnchanged, notificationsAfterChange)
assert.equal(privatePersistedMonitorCount, 0)
```

- [ ] Restart the isolated app to verify persistence/one overdue check, test private-window isolation, capture dark/light/narrow screenshots and inspect them. Close only verified test-owned processes; never use the general dev launcher because it can terminate another development session.
- [ ] Run `npm test -- --maxWorkers=2 --minWorkers=1`, `npm run typecheck`, `npm run build`, `node scripts/test-research-monitors-e2e.mjs`, existing capsule Electron scenario and `node scripts/test-responsiveness-e2e.mjs`. Record exact results and limitations. Repeat only after relevant fixes.
- [ ] Attempt a real public HTTPS check and one explicit configured-provider proposal separately from deterministic fixtures. Record unavailable/timeout service results honestly; never mark fixture output as real-provider verification.
- [ ] Use the executing-plans required final independent reviewer on the complete branch. Fix concrete issues with regression tests, rerun affected and required verification, then record review outcome and all checked tasks in the verification document. No release/push is part of this delivery.

## Self-review and handoff

Coverage: evidence rules/limits in Task 1; safe fetching/parser in Task 2; persistence/scheduler/races in Task 3; ownership/privacy/lifecycle in Task 4; existing style/change inspection in Task 5; explicit AI/new-project acceptance in Task 6; real desktop/many-tab/external-provider verification in Task 7. The proposal representation preserves the existing project schema and visibly labels public observations; main acceptance must not trust renderer provenance. All five Review Focus cases have tests in their owning tasks. No implementation has begun.

Recommended execution: **Native**, preserving the previously delegated expert choice. One implementer keeps the coupled service/IPC/proposal contracts consistent; one fresh final reviewer checks the complete change. User review of this written plan remains required before implementation.
