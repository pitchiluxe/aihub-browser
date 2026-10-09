# Ranked addition 3: Research that stays current

Status: design for user review. Existing baseline: `d8ef6a9`, branch `codex/evidence-research-capsules`.

## Intent and delivery order

Build the ranked additions from the product audit in order, starting with the highest remaining item. Evidence-backed projects and portable, sanitized capsules are implemented. Hosted capsule previews are a later extension and require their own hosting/access-control design.

The next delivery lets users keep selected research sources under observation, see the exact passages that changed, and identify which saved findings need another review. Preserve the restored compact blue-glass Research layout, left notepad, middle sources and right report. Do not replace existing findings automatically or promise that a detected text change proves a conclusion false.

After this delivery, continue the ranked queue: travel total-cost board; reusable browser routines; lessons from research; personal-context receipts; shared investigations; challenge view; offline project suitcase. Each has distinct dependencies and receives a concrete design before implementation. In particular, verified travel offers require a real permitted data source, and hosted collaboration requires provisioned infrastructure.

## Approaches considered

1. Extend the existing Watch & Ping records directly. This reuses scheduling quickly, but those records are global, have no research-version relationship, and currently use normalization that removes dates and large numbers. Those values can be crucial research evidence.
2. Add a dedicated research-monitor service with explicit source relationships and deterministic impact detection. Recommended: it preserves privacy boundaries and makes changes explainable without background AI calls.
3. Regenerate every report automatically on every page change. This increases AI cost and can overwrite reviewed work or turn advertisements into report changes. Defer automatic rewriting; provide an explicit update proposal instead.

## User experience

Each eligible captured source receives a compact **Keep current** control. Nothing is monitored by default. The setup preview shows the original URL, the public-check limitation, schedule and notification choice. Users choose daily (default), every six hours, or hourly checks. Checks occur only while AIHub is running; restarting performs one overdue check rather than replaying missed intervals.

Public monitoring uses an unauthenticated HTTPS request. It does not reuse website cookies, account sessions or private research text. The first public snapshot is a separate baseline. If a saved quote cannot be found in that baseline, show **Public version differs** and the missing quotes before the user confirms monitoring. Do not silently treat a login page or an empty response as the original captured page.

For signed-in or JavaScript-only pages, offer **Check loaded page** using the existing owning-window capture service. This reads an already open page and does not reload it, navigate it, or disturb an unsaved website draft. The UI explicitly says that this checks the loaded document and cannot establish server freshness. It is a manual alternative, not an automatic public monitor.

The Research header gains a small **Updates** counter. A source shows its last successful check, next due time, paused/error state and whether the captured excerpt was truncated. The Updates drawer contains dated before/after passages, affected findings and the reason for each warning. Notification bodies use a generic project update count; they do not expose private source text or sensitive URLs on the desktop.

Users may check now, pause, resume, stop monitoring or dismiss a change. Dismissing an alert does not mark a finding reviewed. A text change never changes an existing finding or its saved citation.

## Evidence and impact rules

Keep the existing project/source IDs and original captures immutable. Store monitoring baselines and later observations separately. Distinguish **captured page**, **public HTML observation** and **imported shared excerpts** throughout the UI. Imported sources are ineligible for automatic monitoring until the user opens the original URL and captures a local source version.

Normalize whitespace using the existing research evidence rules. Do not use Watch & Ping's volatile-value masking: dates, quantities and prices must remain significant. Use bounded paragraph-level comparisons with explicit additions/removals. Truncation is displayed, and comparison covers only the retained text.

For each finding that cites the monitored source:

- If the exact quote remains in the new observation, show **Quote still present; surrounding source changed**.
- If it is absent, show **Quoted passage missing from latest observation — review needed**, with the old quote and relevant changed passages.
- Existing unmatched citations remain unmatched. An anonymous observation cannot authenticate a saved claim or grant reviewed status.
- No citations to that source means no source-specific impact warning for that finding.

Do not describe these rules as fact checking or contradiction detection. A public-versus-signed-in difference is not proof of a change in the underlying fact.

**Prepare updated report** is an explicit action. It creates a separate unsaved proposal using the latest eligible source observations and the existing configured AI routing. Display provider/cloud-fallback disclosure before generation. Validate structured findings and exact quotations as in the current Research flow. Show the proposal alongside the retained report; the user chooses whether to keep it as a new project. This first delivery does not replace or delete the original project. A new project uses the existing twenty-project limit and fails visibly when capacity is reached.

## Service and storage boundaries

Add a dedicated main-process research-monitor service; do not expand the global Watch & Ping scheduler or duplicate its global persistence into private windows. Keep the existing research project schema and capsule format backward-compatible.

A versioned `research-monitors.json` managed store holds normal-window monitoring records. Each record identifies its project and immutable captured source, its public baseline, latest observation, schedule, status and bounded change history. Observations contain application-generated IDs, requested/final URLs, timestamps, normalized text and truncation flags. Public observations must never be relabeled as locally captured page evidence.

Use a typed preload bridge for listing, creating, confirming a public baseline, checking, pausing, removing and acknowledging monitors. Validate all arguments at the main boundary. Resolve the caller from its actual window; unknown senders fail closed. Creation and proposal application check the project's expected revision. Deleting a project or removing the source stops its monitor and invalidates pending work. Results finishing after cancellation/deletion must not recreate state.

Private windows never read the normal monitor store, create persisted monitors, receive normal-project update events or produce desktop research notifications. Manual loaded-page comparison may remain in private-window memory and is discarded when the window closes. Capsule export omits monitor settings and history, retaining the existing reviewed export workflow.

## Fetching and performance

Implement a bounded public-HTML fetcher using asynchronous network operations. Validate HTTPS URLs without credentials; resolve and reject loopback, private, link-local, reserved and local-network destinations. Pin the validated destination for the request while preserving TLS hostname verification. Validate and pin each redirect separately; allow at most three redirects. No cookies, authentication headers, scripts, subresource requests, browser session reuse or arbitrary renderer-supplied fetch options.

Use a directly declared DOM parser for HTML text extraction, with executable content, form controls, editable containers, hidden attributes and inline-hidden ancestors removed. Public HTML observations do not run page scripts or claim to reproduce computed CSS visibility. Pages without useful public text return an actionable unsupported/error state. Do not create a browser renderer for scheduled checks.

Limits: twenty active public monitors across normal projects; at most ten monitored sources within one project; one fetch at a time globally; fifteen-second request deadline; one MB response-body ceiling; 12,000 retained text characters per observation. Retain a baseline, latest observation and at most ten compact change records per monitor. A global ten-MB monitor-store ceiling pauses additions with a visible capacity message rather than silently dropping records. Never retain unbounded full-page history.

The scheduler wakes once per minute, starts no more than one due job per tick, and deduplicates manual/scheduled checks for the same source. Failed checks do not replace the last successful baseline or generate content-change alerts. Record the attempt/error separately, back off until the selected interval, and pause after three consecutive failures with a visible retry action. Pause/resume and application shutdown invalidate in-flight ownership.

No automatic AI requests during capture, checking, diffing or notification delivery. AI runs only when the user asks for an update proposal. Ignore stale AI results after project edits, project switches, proposal cancellation or monitor deletion.

## UI implementation

Add small source controls and an Updates drawer to the existing Research components and design tokens. Reuse current dialogs, focus/Escape handling, quote inspection and conflict-draft protection. Keep the familiar notepad and source/report panes. Show explicit empty, checking, unchanged, changed, unsupported, paused and failed states in both themes and narrow windows.

An unchanged check stays quiet. A changed observation creates one update event for that distinct version; repeated checks of the same text do not repeat an alert. Updates open the owning normal project rather than an arbitrary first browser window.

## Acceptance and testing

Test deterministic whitespace comparison, changed numbers/dates, removed quotes, repeated quotes, unsupported citations and truncation. Test argument/schema limits, ownership, private isolation, revision conflicts and no resurrection after deletion. Network tests cover redirects, private destinations, pinned resolution, timeout, oversized/chunked bodies, unsupported content types and HTTP failures; use test-injected local transport instead of weakening production restrictions.

Scheduler tests use a controlled clock and injected fetcher: one global job, deduplication, overdue restart, pause/cancel/deletion races, error backoff and notifications only on distinct changes. Parser tests cover form values, editable drafts, hidden ancestors and script/style text. DOM tests exercise setup confirmation, impact explanations, keyboard dialogs, unchanged/error states and stale proposal cancellation.

An isolated Electron scenario serves changing local evidence through an explicitly test-only transport, checks old/new passages and affected findings, verifies unchanged checks remain quiet, preserves the original report, creates an accepted update proposal as a distinct project, and tests restart/private isolation. Run the full regression suite, type checks, production build and many-tab responsiveness scenario. Attempt a real public-source check and configured-provider proposal separately; report external-service limitations honestly.

## Self-review and review decision

The design preserves existing style and immutable evidence, separates public observations from signed-in captures, prevents background AI costs, bounds memory/network work, and keeps private windows out of persistent scheduling. Every new action has an ownership and cancellation rule. No hosted service, release or travel-data provider is introduced.

Review this Rank 3 design before the implementation-plan stage. Recommended execution remains one implementer with one independent final review after tests.
