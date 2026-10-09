# Evidence-backed research and portable project capsules

Status: proposed for user review; implementation has not started.

## Goal and scope

Give AIHub users a useful report they can inspect, retain and share: each cited claim opens a saved source passage, its URL and capture date. Someone receiving the exported project can read it in a regular browser and import it into AIHub to continue working.

The user approved proceeding with the audit's first recommendation: evidence-backed research followed by portable capsules. The proposed first delivery combines those into one complete local workflow. It improves the existing Research page. Public hosted links, collaboration rooms, monitored updates and changes to unrelated browser permissions are later work.

Success means the user can complete this flow: choose sources → capture evidence → generate and inspect claims → edit the project → preview an export → share a portable capsule → import and continue it.

## Existing behavior and gap

`ResearchPage.tsx` extracts short AI note cards from a tab and retains a title, URL and note text. Report generation also accepts URLs alone. Original source passages are not saved with the report, and the model can supply note URLs. Generated reports are Markdown strings without a validated claim-to-passage relationship. Research notes are saved in one localStorage collection rather than named projects.

`pageExtractor.ts` captures capped page text and sometimes YouTube transcripts. Page Vault saves MHTML independently, with its own pruning policy. Existing file IPC supports Markdown, text and ZIP exports. Those are useful foundations, but a citation must not depend on a Vault snapshot surviving pruning or on an AI-generated URL being correct.

## User experience

The existing Research destination gains named projects and three clear areas: Sources, Findings, and Report. The layout remains usable on small windows and in light and dark themes.

1. Create a project with a title and optional research question. Existing notes remain accessible; migrating them labels them as user notes, not captured evidence.
2. Select up to ten open web tabs. Each source selection is explicit; unrelated open tabs are not silently included. A pasted URL is a pending source until it is opened and captured. A failed capture remains visibly unavailable and does not become evidence through a title-only fallback.
3. Choose **Capture selected sources**. Before the first capture, explain that selected page text is saved locally and may be sent to the configured AI provider when generation is requested. Display the configured provider near Generate. Capture does not itself call AI.
4. Each source card shows the real captured title and URL, capture date, captured-text length, and any truncation or transcript label. Recapture creates a new immutable version, preserving evidence cited by existing findings.
5. Choose summary, comparison or bibliography and **Generate report**. Show progress and allow cancellation. The model receives captured passages and the research question, rather than relying on a URL list.
6. Findings appear as readable cards. A citation button opens the saved passage with the quote highlighted, source metadata and **Open original**. It works even if the original site changes or goes offline.
7. Show **Matched excerpt** when citation references and quote offsets validate; show **Needs review** for unsupported or invalid citations. Matching a quote is not a declaration that a claim is true. Do not show invented truth percentages.
8. The user can edit findings, add a note, remove a finding or mark it reviewed. Edited claim text becomes **Needs review** until reviewed again. User notes remain visibly separate from captured source evidence.
9. **Export capsule** opens a preview listing the findings, excerpts and source links that will be included. The user can exclude sources or findings and redact exported text. No export occurs before the preview is accepted.
10. **Import capsule** validates a selected file, shows its contents, and creates a separate project on confirmation. It never overwrites an existing project or opens source links automatically.

Existing Markdown report export remains available. Import/export errors preserve the current project and display an actionable message.

## Evidence and report model

A shared, versioned schema describes `ResearchProject`, `CapturedSource`, `ResearchClaim` and `Citation`. A project contains a title, question, timestamps, mode, immutable source versions, claims and user notes. Source IDs and authoritative metadata are assigned by the application, never by AI.

Each captured source contains an ID, captured URL/title, capture time, normalized text, capture type and truncation flag. Citation IDs point to that exact source version and an exact quote. The application locates the quote in the normalized text and records offsets. Offsets are derived locally; AI cannot select an arbitrary file or URL as evidence. Whitespace normalization is documented and applied consistently to capture and validation.

Generated claims may have multiple citations or no citations. Unknown source IDs, empty quotes and quotes absent from captured text become unresolved citations. An AI claim remains readable with a warning rather than gaining fabricated support. A malformed response produces a retryable error and leaves previous findings intact.

Structured AI output supplies claim text, source IDs, quoted passages and optional explanations of disagreements. The report is rendered from validated claim objects. Bibliography entries are derived from captured metadata. Disagreements are labeled as suggested by AI and require review; they are not treated as independently proven contradictions.

Editing a claim, recapturing a page, removing a source and importing an external capsule have explicit validation rules. Old citations continue to refer to their original capture. Imported material is treated as user-supplied content, not authenticated publication evidence.

## Capture, storage and privacy

Use a dedicated research IPC service with window ownership checks. A source capture accepts a tab identity, resolves its WebContents inside the calling window and reads the currently loaded document using an application-owned extraction script. Reject destroyed tabs, non-web schemes and URL changes during capture. No generic renderer-provided script or arbitrary filesystem path is required.

Capture readable text, not cookies, request headers, form values, localStorage, password inputs or full HTML. A page can still contain personal text; explicit source selection and export preview are essential. Signed-in pages are not described as safe to share automatically. Do not infer consent from a bookmark or an unrelated page-analysis setting.

Normal-window projects use a versioned managed JSON store with atomic, debounced writes. Incognito projects stay in memory, do not read normal projects, and are cleared with the window. Explicit user-initiated export in Incognito explains that the file persists outside the private session.

Initial limits: ten sources per project, 12,000 captured characters per source, fifty findings per project, twenty normal-window projects, and a 5 MB import limit. Validate all limits at the IPC boundary. Show limits and truncation rather than silently discarding content. Project generation has bounded context, uses the existing AI routing settings, and does not force cloud fallback or install a provider.

Capture runs with bounded concurrency and asynchronous persistence. AI calls are cancelled or ignored when their project/generation is stale. New projects, switched projects and recaptures cannot receive a previous request's results. The new flow must not launch background AI requests for every tab.

## Portable capsule format

Export a ZIP with `index.html` and a versioned `.aihub-research.json` project file. The HTML is a standalone readable report with expandable evidence excerpts, source dates and links. It contains no JavaScript, remote assets, tracking or executable imports. Escape all user and AI text and permit only validated HTTP(S) links; external links use safe new-window attributes.

By default, export only selected findings, cited excerpts and necessary source metadata. Full captured page text, browsing history, cookies, filesystem paths, API settings and AI chat history are excluded. Users review source links, including query strings that may contain personal identifiers, and can omit or edit links. Redaction suggestions are best-effort; preview is not a promise that all sensitive content has been detected.

A recipient opens `index.html` in any browser. Importing the JSON file into AIHub restores a separate project with the shared excerpts. It does not recreate complete pages that were deliberately excluded. Imported citations are checked against the imported excerpts; absence of the full source is clearly labeled. Never imply that the capsule is signed or that a matching excerpt independently authenticates a claim.

Editing export text invalidates any affected evidence-match status until citations are validated against the exported text. A capsule remains internally consistent after filtering or redaction. Import rejects unsupported schemas, oversized fields, invalid references, dangerous URLs and malformed objects. ZIP export uses fixed application-owned paths, not imported path names. The first version imports JSON only, avoiding archive extraction and path traversal.

## Component boundaries

- Shared research schema and validation: stable types and pure validation, quote matching, migration and export transformations.
- Main research service: window-scoped capture, normal/private storage and registered IPC handlers; `index.ts` only registers this service.
- Preload bridge: typed project and capture methods with bounded arguments.
- Renderer research service: AI prompts, structured response parsing and request cancellation without persistence ownership.
- Research UI: project selection, selected-source controls, findings, evidence drawer and export/import previews.
- Capsule renderer: pure escaped HTML generation and sanitized export model, independent of React and Electron.

Page Vault may supply an optional link to an existing local snapshot in a later version. First-version evidence remains self-contained so Vault pruning cannot silently break citations.

## Acceptance criteria

- A real captured page produces a source record with authoritative metadata and a visible capture/truncation state.
- A valid claim citation opens the exact saved quote; an invented quote or source ID never receives matched-excerpt status.
- Pasted URLs that have not been captured cannot be represented as read sources.
- The user can inspect and edit a report, close/reopen the app, and recover the project and evidence.
- Switching projects or cancelling generation cannot overwrite another project's findings.
- The capsule opens offline in a normal browser with no network requests, scripts or remote images until a user explicitly opens a source link.
- Export preview, exclusions and redactions are reflected in both HTML and JSON; private project metadata does not leak into either.
- Import validates limits, creates a separate project, and preserves the open project on failure.
- Incognito projects do not persist or expose normal-window projects.
- Tests cover quote matching, malformed AI output, stale requests, unsafe links/HTML, export filtering, import validation, persistence and private-window behavior.
- An isolated desktop test captures local test pages, generates a deterministic fixture report, inspects evidence, exports, imports and checks navigation remains responsive. A separate manual check uses the user's configured AI provider only with explicitly selected test sources.
- Existing tests, type checks and production build pass. No release or public hosting is part of this implementation request.

## Decision for review

Approve this local-first delivery: evidence-backed named research projects plus previewed portable capsules, using the existing AI settings and Research destination. Hosted share links and real-time collaboration follow only after the local workflow is validated.
