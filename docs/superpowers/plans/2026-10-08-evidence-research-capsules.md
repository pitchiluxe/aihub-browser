# Evidence Research and Portable Capsules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users capture selected sources, inspect a report's exact supporting passages, and export/import a sanitized research capsule.

**Architecture:** A shared schema and pure evidence/capsule functions define the contracts. A dedicated main-process research service owns capture and normal/private persistence; a typed bridge exposes it to a modular Research UI. AI generates structured claims from captured text; the application derives citation status and renders the report.

**Tech Stack:** Existing Electron, React, TypeScript, Vitest, Playwright, managed JSON store, AI routing and ZIP export; no new dependencies or hosted services.

**Spec:** [Approved design](../specs/2026-10-08-evidence-research-capsules-design.md).

## Global Constraints

- “Initial limits: ten sources per project, 12,000 captured characters per source, fifty findings per project, twenty normal-window projects, and a 5 MB import limit.” Count recaptured versions toward the source limit; never silently evict a cited version.
- “Source IDs and authoritative metadata are assigned by the application, never by AI.”
- “Normal-window projects use a versioned managed JSON store with atomic, debounced writes.”
- “Incognito projects stay in memory, do not read normal projects, and are cleared with the window.”
- “The HTML is a standalone readable report with expandable evidence excerpts, source dates and links. It contains no JavaScript, remote assets, tracking or executable imports.”
- “The first version imports JSON only, avoiding archive extraction and path traversal.”
- “No release or public hosting is part of this implementation request.”
- Preserve existing notes and Markdown export. Do not change unrelated browser permissions or AI routing settings.
- Do not force a cloud fallback, require an account, or add automatic background AI work.

## Review Focus

1. A tab navigates while capture awaits extraction: refuse mixed metadata/text rather than citing the wrong document (Task 2).
2. A repeated phrase appears twice: choose a deterministic exact match and disclose that quote presence does not prove claim truth (Task 1).
3. Redaction removes a citation's evidence: mark it unresolved consistently in both HTML and JSON (Task 6).
4. The selected project changes during generation: late output cannot overwrite the new project or resurrect deleted content (Task 4).
5. An imported source omits its URL/full text: show shared-excerpt provenance, preserve readable citations, and do not invent an original-page link (Tasks 1, 6, 7).

## Files and contracts

Create:

- `src/shared/research/types.ts`: project/source/claim/capsule types and limits.
- `src/shared/research/validation.ts`: schema, URL, size and relationship validation.
- `src/shared/research/evidence.ts`: normalization and derived quote locations.
- `src/shared/research/capsule.ts`: sanitized exports, escaped HTML and import conversion.
- Corresponding `validation.test.ts`, `evidence.test.ts`, `capsule.test.ts` beside those modules.
- `src/main/research/capture.ts`: application-owned capture script and navigation consistency checks.
- `src/main/research/store.ts`: window-scoped repository and managed normal storage.
- `src/main/research/index.ts`: guarded IPC registration, delegating to capture/store.
- Corresponding `capture.test.ts`, `store.test.ts`, `ipc.test.ts`.
- `src/renderer/src/services/researchGeneration.ts` and `.test.ts`: bounded AI input/output and stale-request guard.
- `src/renderer/src/components/research/ResearchWorkspace.tsx`: project workflow and asynchronous state.
- `ProjectPicker.tsx`, `SourcePicker.tsx`, `Findings.tsx`, `EvidenceDrawer.tsx`, `CapsulePreview.tsx`, `ResearchReport.tsx`, `research.css`: focused interface components.
- `ResearchWorkspace.test.tsx` and `CapsulePreview.test.tsx`: behavioral DOM tests.
- `scripts/test-research-capsules-e2e.mjs`: isolated local-page desktop scenario.

Modify:

- `src/main/index.ts`: register service with `ctxFromEvent`, register private cleanup in window closure; no unrelated extraction refactor.
- `src/preload/index.ts` and `src/renderer/src/vite-env.d.ts`: typed research bridge.
- `src/renderer/src/components/pages/ResearchPage.tsx`: compatibility wrapper that renders the new workspace, preserving its navigation prop.
- `src/renderer/src/assets/manual.html`: document the shipped flow and privacy/export semantics.

The exact shared signatures are:

```ts
export const RESEARCH_LIMITS = {
  sources: 10, sourceChars: 12_000, claims: 50,
  projects: 20, importBytes: 5 * 1024 * 1024,
  titleChars: 200, questionChars: 2_000,
  claimChars: 2_000, quoteChars: 4_000, notes: 100, noteChars: 4_000,
} as const
export type ResearchMode = 'summary' | 'compare' | 'bibliography'
export interface CapturedSource {
  id: string; title: string; url?: string; capturedAt: string;
  text: string; truncated: boolean;
  captureType: 'page' | 'transcript' | 'excerpts';
  provenance: 'captured' | 'imported'; excerpts?: string[];
}
export interface Citation { sourceId: string; quote: string }
export interface ResearchClaim {
  id: string; text: string; citations: Citation[];
  reviewed: boolean; kind: 'finding' | 'suggested-disagreement';
}
export interface ResearchNote { id: string; text: string; createdAt: string }
export interface ResearchProject {
  schemaVersion: 1; id: string; title: string; question: string;
  createdAt: string; updatedAt: string; mode: ResearchMode;
  sources: CapturedSource[]; claims: ResearchClaim[]; notes: ResearchNote[];
}
export interface EvidenceMatch {
  sourceId: string; quote: string; start: number; end: number;
}
export interface CapsuleSource {
  id: string; title: string; url?: string; capturedAt: string;
  excerpts: string[]; truncated: boolean;
}
export interface ResearchCapsule {
  schemaVersion: 1; kind: 'aihub-research-capsule'; title: string;
  question: string; mode: ResearchMode; exportedAt: string;
  sources: CapsuleSource[]; claims: ResearchClaim[];
}
export type ResearchResult<T> = { ok: true; value: T } | { ok: false; error: string }
export function normalizeEvidence(text: string): string
export function safeResearchUrl(value: unknown): boolean
export function validateProject(value: unknown): ResearchResult<ResearchProject>
export function validateCapsule(value: unknown): ResearchResult<ResearchCapsule>
export function matchCitation(source: CapturedSource, citation: Citation): EvidenceMatch | null
export function claimNeedsReview(project: ResearchProject, claim: ResearchClaim): boolean
```

`reviewed` records a user action, not independent fact verification. AI cannot set it. Match offsets are never accepted from AI/import. Validate bounds on all strings and arrays, unique IDs, ISO dates, valid modes and citation relationships. Captured sources require HTTP(S) URLs without credentials; imported excerpt sources may omit a URL. Strip unknown object keys by constructing known fields; do not merge untrusted objects into application state.

## Task 1: Evidence contracts and validation

**Files:** shared types, validation, evidence, and their tests.

**Interfaces:** Produces all shared signatures above. `matchCitation` searches normalized captured text; for imported sources it searches individual excerpts and derives offsets in their display text. It never accepts a match spanning the separator between two imported excerpts.

- [ ] Write the failing behavioral tests, including repeated phrases, normalized whitespace, unknown source IDs, unsafe URLs, duplicate IDs, oversized quotes and imported provenance:

```ts
const source: CapturedSource = {
  id: 's1', title: 'Study', url: 'https://example.org/study',
  capturedAt: '2026-10-08T12:00:00.000Z',
  text: 'A result. A result.', truncated: false,
  captureType: 'page', provenance: 'captured',
}
expect(matchCitation(source, { sourceId: 's1', quote: 'A result.' }))
  .toMatchObject({ start: 0, end: 9 })
expect(matchCitation(source, { sourceId: 's1', quote: 'Invented.' })).toBeNull()
expect(safeResearchUrl('javascript:alert(1)')).toBe(false)
expect(safeResearchUrl('https://user:secret@example.org')).toBe(false)
```

- [ ] Run `npx vitest run src/shared/research` and confirm the new tests fail before implementation.
- [ ] Implement normalization/matching using deterministic exact text, not fuzzy “close enough” support:

```ts
export function normalizeEvidence(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[\t\u00a0 ]+/g, ' ')
    .replace(/ *\n */g, '\n').trim()
}
export function safeResearchUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const u = new URL(value)
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password
  } catch { return false }
}
```

Build validated objects field by field and return `ResearchResult`; reject invalid persistent project references while treating invalid model citations as unresolved in Task 4.
- [ ] Re-run focused tests and type checks. Stage and commit only these files after they pass.

## Task 2: Authoritative capture of selected tabs

**Files:** `src/main/research/capture.ts`, `.test.ts`.

**Interfaces:** Consumes shared limits/normalization. Produces:

```ts
export interface CaptureWebContents {
  isDestroyed(): boolean; getURL(): string; getTitle(): string;
  executeJavaScript(script: string): Promise<unknown>;
}
export function captureResearchSource(wc: CaptureWebContents): Promise<ResearchResult<CapturedSource>>
```

- [ ] Write tests using a stub WebContents: source URL comes from `getURL`, failed execution returns an error, navigation during extraction refuses capture, and input values are excluded by the extraction script.

```ts
const wc = {
  isDestroyed: () => false,
  getURL: vi.fn().mockReturnValueOnce('https://example.org/a')
    .mockReturnValue('https://example.org/b'),
  getTitle: () => 'A',
  executeJavaScript: async () => ({ text: 'Actual page evidence', captureType: 'page', truncated: false }),
}
expect((await captureResearchSource(wc)).ok).toBe(false)
```

- [ ] Run `npx vitest run src/main/research/capture.test.ts` and confirm failure.
- [ ] Implement fixed-script extraction from a cloned readable document. Remove `input,textarea,select,button,script,style,noscript,[contenteditable]`; capture text from `main,article` when present, otherwise the cleaned body. Preserve passage breaks and record truncation before slicing. For supported YouTube pages, label a successfully extracted transcript; use readable page text if transcript extraction fails.

```ts
const beforeUrl = wc.getURL()
if (!safeResearchUrl(beforeUrl)) return { ok: false, error: 'Choose a loaded web page.' }
const capturedAt = new Date().toISOString()
const title = wc.getTitle().slice(0, RESEARCH_LIMITS.titleChars)
// Execute an application-owned constant script, validate its output, then:
if (wc.isDestroyed() || wc.getURL() !== beforeUrl)
  return { ok: false, error: 'The page changed during capture. Capture it again.' }
```

Assign `crypto.randomUUID()` source IDs in main, normalize text once, reject empty readable content, and keep the original captured metadata immutable. This operation performs no AI request or automatic navigation.
- [ ] Run capture tests, including a real jsdom document with a password and draft text whose values must be absent. Commit focused files after checks pass.

## Task 3: Project repository, IPC and private-window isolation

**Files:** main research store/index and tests; minimal registration in `src/main/index.ts`; preload bridge and global types.

**Interfaces:**

```ts
export interface ResearchWindow {
  id: number; incognito: boolean;
  views: Map<string, { webContents: CaptureWebContents }>;
}
export interface ResearchBridge {
  list(): Promise<ResearchResult<ResearchProject[]>>;
  save(project: ResearchProject): Promise<ResearchResult<ResearchProject>>;
  remove(projectId: string): Promise<ResearchResult<null>>;
  capture(tabId: string): Promise<ResearchResult<CapturedSource>>;
}
export function createResearchRepository(appDir: string): {
  list(owner: Pick<ResearchWindow, 'id' | 'incognito'>): ResearchProject[];
  save(owner: Pick<ResearchWindow, 'id' | 'incognito'>, project: unknown): ResearchResult<ResearchProject>;
  remove(owner: Pick<ResearchWindow, 'id' | 'incognito'>, id: string): ResearchResult<null>;
  release(windowId: number): void;
}
export function registerResearchIpc(options: {
  appDir: string;
  resolveWindow(event: Electron.IpcMainInvokeEvent): ResearchWindow | undefined;
}): { release(windowId: number): void }
```

- [ ] Write failing tests for atomic normal persistence, project limit, invalid objects, immutable source IDs, rejection of unknown owners, and normal/private separation:

```ts
const normal = { id: 1, incognito: false }
const privateWindow = { id: 2, incognito: true }
expect(repo.save(normal, project).ok).toBe(true)
expect(repo.list(privateWindow)).toEqual([])
repo.save(privateWindow, { ...project, id: 'private-project' })
repo.release(2)
expect(repo.list(privateWindow)).toEqual([])
expect(repo.list(normal)).toHaveLength(1)
```

- [ ] Run `npx vitest run src/main/research` and observe failure.
- [ ] Use `createManagedJsonStore` for normal storage and an in-memory map keyed by window ID for private storage. Validate/clone objects on read and write; preserve existing captures when an ID is reused. Use `research:list`, `research:save`, `research:remove`, `research:capture`; fail closed when no owning window exists.

```ts
ipcMain.handle('research:capture', async (event, tabId: unknown) => {
  const owner = options.resolveWindow(event)
  if (!owner || typeof tabId !== 'string')
    return { ok: false, error: 'Research window unavailable.' }
  const view = owner.views.get(tabId)
  return view ? captureResearchSource(view.webContents)
    : { ok: false, error: 'Choose a loaded tab in this window.' }
})
```

Call returned `release(winId)` from the existing owning window's close handler. Preload methods invoke the four named channels; type the renderer bridge as `ResearchBridge`.
- [ ] Run IPC/storage tests and type checks; confirm that no regular project file is created by an incognito-only test. Commit only Task 3 files.

## Task 4: Structured generation and request ownership

**Files:** renderer `researchGeneration.ts`, `.test.ts`.

**Interfaces:** Consumes `ResearchProject`, citation validation and the existing `ai.chat`. Produces:

```ts
export type ResearchAI = { chat(messages: { role: string; content: string }[]): Promise<{ content?: string; provider?: string }> }
export function generateResearchClaims(project: ResearchProject, ai: ResearchAI, signal: AbortSignal): Promise<ResearchResult<ResearchClaim[]>>
export function createResearchRunGuard(): {
  begin(projectId: string): { projectId: string; token: number; signal: AbortSignal };
  current(projectId: string, token: number): boolean;
  cancel(): void;
}
```

- [ ] Write failing tests for unknown IDs, invented quotes, malformed JSON, errors with old findings intact, excessive output and cancellation/project switching:

```ts
const guard = createResearchRunGuard()
const first = guard.begin('project-a')
guard.begin('project-b')
expect(first.signal.aborted).toBe(true)
expect(guard.current('project-a', first.token)).toBe(false)
```

- [ ] Run `npx vitest run src/renderer/src/services/researchGeneration.test.ts` and confirm failure.
- [ ] Build a prompt that treats passages as untrusted evidence, includes application IDs/capture dates, and requests JSON `{"claims":[{"text":"...","citations":[{"sourceId":"...","quote":"..."}],"kind":"finding"}]}`. Only captured source text and explicit notes enter the prompt. The total source context is bounded by the shared limits.

```ts
const passages = project.sources.map(s => ({
  sourceId: s.id, title: s.title, capturedAt: s.capturedAt,
  text: s.text.slice(0, RESEARCH_LIMITS.sourceChars), truncated: s.truncated,
}))
```

Parse `content` directly, optionally strip one enclosing JSON fence, validate output shape and generate application IDs. Ignore model-supplied URLs, offsets, reviewed state and metadata. Keep unknown/unmatched citations visible as unresolved; do not fabricate support or discard their claim silently. Cancellation invalidates ownership even if the existing AI bridge cannot stop the provider request.
- [ ] Run focused tests and commit. Do not modify provider fallback policy.

## Task 5: Named projects, selected sources and evidence inspection

**Files:** Research wrapper, workspace/project/source/findings/drawer/report components and CSS, workspace tests.

**Interfaces:** `ResearchWorkspace({onNavigate?: (url:string)=>void})`; child components consume project objects and callbacks, not Electron directly. `ResearchReport({project:ResearchProject})` derives bibliography from project source records and renders escaped text; `EvidenceDrawer({source:CapturedSource,citation:Citation,onClose:()=>void,onNavigate?:...})` uses `matchCitation`.

- [ ] Write DOM tests using a stub typed bridge/AI service. Verify no tabs are selected initially, capture only selected IDs, quote inspection, unsupported findings, edit invalidation, source-version limits and project switching.

```tsx
await userClick('Generate report')
await waitFor(() => expect(host.textContent).toContain('Actual finding'))
await userClick('View evidence')
expect(host.querySelector('mark')?.textContent).toBe('Actual page evidence')
```

Define `userClick` and `waitFor` locally using existing React `act` test patterns; selectors must target accessible button names rather than implementation details.
- [ ] Run `npx vitest run src/renderer/src/components/research/ResearchWorkspace.test.tsx` and confirm failure.
- [ ] Implement state transitions: loading projects → selected project → source capture → generation → report. Save only explicit edits/capture/generation and keep previous findings until new output validates. Capture at most two tabs concurrently; show separate errors per source. Include cancellation, request tokens, keyboard navigation, dialog focus/Escape handling, and a compact layout for narrow windows.

```tsx
const run = runGuard.begin(project.id)
const result = await generateResearchClaims(project, window.electronAPI.ai, run.signal)
if (!runGuard.current(project.id, run.token)) return
if (result.ok) await saveProject({ ...project, claims: result.value })
```

Also invalidate runs on edits, deletions, source recaptures and unmount; do not use the closed-over project alone to determine ownership.
- [ ] Migrate the existing `aihub-research-notes-v1` array into explicitly labeled user notes once, with validation, limits and preservation of the original key. Do not call normal-project persistence in an incognito window. Keep existing Markdown export via `file.saveMd`.
- [ ] Run UI and generation tests, then type checks. Commit the new flow and wrapper together.

## Task 6: Sanitized capsule transformation and offline HTML

**Files:** shared capsule module/tests.

**Interfaces:**

```ts
export interface CapsuleSelection {
  claimIds: string[]; sourceIds: string[];
  claimText: Record<string, string>;
  sourceUrls: Record<string, string | null>;
  quotes: Record<string, string>; // key: `${claimId}:${citationIndex}`
}
export function buildResearchCapsule(project: ResearchProject, selection: CapsuleSelection): ResearchResult<ResearchCapsule>
export function renderCapsuleHtml(capsule: ResearchCapsule): string
export function importResearchCapsule(raw: string): ResearchResult<ResearchProject>
```

- [ ] Write failing tests covering scripts in titles, malicious URLs, exclusion of full source text/notes, missing URLs, shared-excerpt provenance, over-limit imports and citation redaction:

```ts
const html = renderCapsuleHtml(capsule)
expect(html).not.toContain('<script')
expect(html).not.toContain('<img')
expect(html).toContain('&lt;script&gt;') // supplied title is escaped
const imported = importResearchCapsule(JSON.stringify(capsule))
expect(imported.ok && imported.value.sources.every(s => s.provenance === 'imported')).toBe(true)
```

- [ ] Run `npx vitest run src/shared/research/capsule.test.ts` and confirm failure.
- [ ] Construct an explicit allowlisted export DTO. Include only selected claims and cited excerpts from selected sources; missing/redacted evidence leaves the finding labeled Needs review. Do not export internal IDs that encode paths, full snapshots, notes, provider settings or history. Application-generated IDs may be retained solely for internal citation relationships. Validate edited links, allow omission, clear reviewed status for edited claims.

```ts
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]!))
// Render fixed HTML structure with inline CSS and <details> evidence.
// Source links use rel="noopener noreferrer" and target="_blank".
```

Use a restrictive HTML CSP (`default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`). No script is necessary for expandable passages. Import checks UTF-8 size before JSON parsing, validates the known schema and assigns a fresh project ID. Imported excerpt sources use only the included passages; their citations cannot imply that a complete page was captured locally.
- [ ] Re-run focused tests and commit.

## Task 7: Export preview, JSON import and user documentation

**Files:** capsule preview component/tests, workspace integration, manual.

**Interfaces:** `CapsulePreview({project,onClose,onExport})` produces a validated `ResearchCapsule`; `onExport(capsule)` calls the existing ZIP bridge only after preview acceptance. Import reads a user-selected File, displays a validated preview and persists only after confirmation.

- [ ] Write failing tests for exclusion/redaction, cancelled dialogs, unsafe edited links, import without original URLs and private export disclosure. Verify export is never called before the explicit final button.

```ts
expect(saveZip).not.toHaveBeenCalled()
await userClick('Export capsule')
expect(saveZip.mock.calls[0][0].files.map(f => f.path))
  .toEqual(['index.html', 'project.aihub-research.json'])
```

- [ ] Run `npx vitest run src/renderer/src/components/research/CapsulePreview.test.tsx` and confirm failure.
- [ ] Wire only fixed archive entry paths; preserve the user's project on cancelled save or invalid import:

```ts
await window.electronAPI.file.saveZip({
  filename: 'research-capsule.zip',
  files: [
    { path: 'index.html', content: renderCapsuleHtml(capsule) },
    { path: 'project.aihub-research.json', content: JSON.stringify(capsule, null, 2) },
  ],
})
```

Reject files by `File.size` before `File.text`; parse only JSON, never an archive or embedded executable content. Show data disclosure/capture consent and provider information; explain that quote matching is not fact verification. Default exports omit full text; preview links and excerpts explicitly for signed-in pages. Clarify manual URL removal and that automatic suggestions cannot guarantee redaction.
- [ ] Document capture, matching, imported provenance, limits, capsule contents and offline opening in the manual. Run all research tests and type checks; commit focused files.

## Task 8: Desktop verification and completion

**Files:** `scripts/test-research-capsules-e2e.mjs`; plan checkboxes and documentation.

- [ ] Create an isolated profile and local HTTP server with two evidence pages, a deliberately changing page and a page containing sensitive form values. Use deterministic AI fixtures only in the isolated test, as existing desktop scripts do. Include an invented citation in the fixture so unresolved status is exercised.
- [ ] Exercise actual UI: create project, select/capture tabs, inspect valid/invalid citations, edit a claim, save/restart, export through a stubbed native save path, open HTML in a separate browser context, import JSON and confirm a distinct project.

```js
const requests = []
previewPage.on('request', request => requests.push(request.url()))
await previewPage.goto(exportedHtmlUrl)
await previewPage.waitForTimeout(500)
assert.equal(requests.filter(url => /^https?:/.test(url)).length, 0)
assert.equal(await previewPage.locator('script').count(), 0)
```

Test the preview using local `file://` content; the exported HTML does not load the local test server until a source link is explicitly clicked. Verify credentials/input values are absent from capture/export, and a private project disappears after its window closes. Only test-owned processes may be closed.
- [ ] Run `npm run typecheck`, `npm test`, and `npm run build`. Run `node scripts/test-research-capsules-e2e.mjs` against the completed build. Run the existing responsiveness desktop check once to guard against heavy capture/generation work blocking controls.
- [ ] Perform one explicit configured-provider check using selected public test sources if a provider is available; if unavailable, report that limitation rather than presenting the deterministic fixture as a live AI check.
- [ ] Review the full diff against the approved spec, including every Review Focus case. Fix failures before completion. Record the commands/results and any limitations in the handoff. Do not tag, push or publish a new release.

## Plan self-review

Capture selection/consent and authoritative metadata: Tasks 2, 3, 5. Exact citations, immutable versions and review semantics: Tasks 1, 3, 4, 5. Persisted named projects and private isolation: Tasks 3, 5. Offline sanitized capsules, redaction consistency and JSON imports: Tasks 6, 7. Cancellation, bounded work and real desktop verification: Tasks 4, 5, 8. Existing notes/Markdown, themes, accessibility and documentation: Tasks 5, 7. No hosted sharing or release: Global Constraints and Task 8.

The five Review Focus cases each have tests in their owning task. Every produced function and type referenced by subsequent tasks is defined in a preceding interface block. The plan does not require a new backend, dependency, provider account or a change to unrelated browser features.

## Execution choice for user review

Recommended: **Native** implementation in this session, followed by one independent whole-change review. These tasks share tightly coupled schema contracts; one implementer can keep them consistent efficiently. The alternative is **Subagent-driven**, with an independent implementer/reviewer cycle for each task and a final whole-change review.

Implementation begins after the user reviews this plan and selects the execution approach.
