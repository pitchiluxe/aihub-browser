# AIHub Browser: Persistent, Local-First, Contextual Browser — Product and Architecture Spec

## Status

Approved by the product owner on 2026-10-09. Implementation is staged into separately reviewed, testable slices.

## Goal

Make AIHub Browser stay useful and responsive across large tab sets, interruptions, repeated workflows, and device changes, while keeping user actions visible, local data under user control, and cross-site automation bounded by explicit permissions.

## User and product outcomes

- A large browsing session should not make the computer or the browser unresponsive.
- Users should be able to revisit useful pages when disconnected, with a clear indication of what is a saved snapshot versus a live app.
- Users should be able to reduce page clutter and find browser/local content from one search surface.
- Repeated browser tasks and workspace changes should be automatable, inspectable, reversible, and opt-in.
- Background presence, notification collection, indexing, and device synchronization must be visible, configurable, and stoppable.
- Features requiring a remote service, privileged OS integration, site-specific API, or account must not be represented as available until that dependency exists and is configured.

## Existing foundation and constraints

The application uses Electron 44, Chromium BrowserViews, React, and TypeScript. Renderer state already represents sleeping browser tabs (`asleep`) and releases their native views; users can manually sleep tabs and an idle policy sleeps background tabs. Local workspace/session concepts and IPC boundaries already exist. The application has an auto-update build/release pipeline.

The inspected code does not establish an existing general-purpose encrypted cloud-sync service, browser-wide notification ingestion, local filesystem indexer, reliable cross-device presence channel, or OS shell replacement. Those are new security and operational subsystems. Electron BrowserViews are separate native web contents; a renderer-only DOM/CSS feature cannot be assumed to persist styling in site content. Web apps can use service workers, IndexedDB, background sync, and server-side state in ways a generic browser snapshot cannot safely reproduce.

## Experience principles

1. **Local-first and explicit:** Local capabilities work without account creation. Network sync and external integrations are separate, opt-in capabilities.
2. **Truthful offline behavior:** A saved page is labeled with its capture time and is read-only unless the owning application has a supported offline protocol. Never silently queue arbitrary form submissions or claim they were delivered.
3. **Visible automation:** Before a macro runs, show the sites/actions/data it may use; pause for credentials, payments, destructive changes, CAPTCHAs, or other sensitive actions. Stop is always available.
4. **User-controlled persistence:** Dock/background mode, scheduled workspace switching, notifications, indexing, and sync each have independent settings and clear pause/quit paths.
5. **Performance budget:** Background services are event-driven, bounded, and lazy. No continuous page polling, all-drive indexing, or hidden tab cloud migration by default.
6. **Cross-platform honesty:** Windows/macOS/Linux support is specified per capability; platform-specific integrations degrade gracefully and are never implied to work identically.

## Feature requirements

### 1. Persistent desktop dock / background mode

- Provide an optional compact companion surface and a tray/menu-bar entry point where supported.
- Closing the main window may hide it only after the user enables this behavior. Tray/menu entry must offer Show, Pause background activity, and Quit.
- Background mode must not claim to replace desktop wallpaper or the operating system shell. A borderless overlay, if retained after prototype validation, is a separate user-invoked window with normal close/escape behavior and platform tests.
- Do not keep Chromium page renderers alive solely to simulate persistence; saved app state and tab sleeping remain the default.

### 2. Local-first offline browsing and synthetic sync

- Add an explicit **Save for offline** action for eligible pages. Save sanitized main-content snapshots, title, source URL, capture timestamp, and optional user notes in the local vault with size limits and deletion controls.
- On navigation failure due to connectivity, offer the matching saved snapshot. Clearly mark it offline, stale, and read-only; provide Retry and Open saved copy actions.
- Never replay arbitrary HTML form actions, credentials, mail sends, purchases, or third-party app edits after reconnection.
- A future site-specific connector may queue mutations only when its supported API defines idempotency, conflict handling, and user-visible confirmation. “Synthetic sync” is not generic browser behavior.

### 3. Cross-site shared state clipboard

- Add an opt-in local **Browser Context** record set. Users explicitly capture selected fields from a page or paste structured data into the local vault, review/edit it, then invoke field suggestions on another site.
- Field suggestions are initiated by the user and scoped to the active origin/form; no silent page scanning or auto-submit.
- Sensitive fields (passwords, payment data, government identifiers, health data) are excluded by default and never added to context without a distinct secure flow.
- Show source page, capture time, and destination fields before filling. User confirms fill; submission remains a separate action.

### 4. Dynamic resource reallocation / many-tab performance

- Evolve the existing sleeping-tab policy rather than add remote tab virtualization. Prioritize active tab, audible/media tabs, in-progress downloads, form state, pinned tabs, and recently used tabs as protected from automatic sleep.
- Use bounded concurrency and idle/debounce windows for snapshots, metadata, AI tasks, and tab wakeups. Avoid synchronous renderer work and duplicate webContents work.
- Add diagnostics sufficient to compare open/sleeping tab counts, wake latency, and responsiveness without recording page contents or URLs by default.
- Automatic memory-pressure integration is platform-gated and advisory; no guarantee of “zero lag.” Remote execution/cloud migration is explicitly out of scope absent a separately approved secure remote-browser architecture.

### 5. Unified inbox and notification center

- Implement as an opt-in notification aggregation surface with per-origin subscriptions and clear notification permission status.
- Prefer supported site APIs or standard browser notifications. Do not scrape logged-in pages in the background or store credentials to imitate APIs.
- Reply actions are available only through an authorized provider API/deep link; otherwise open the source app. Keep notification history local by default, with per-site mute and clear controls.
- No service/API provider is selected in this spec; integration discovery and privacy review precede implementation.

### 6. Dynamic site reskinning / de-clutter

- Add a per-origin element-hiding editor for user-selected page elements. Persist selector/rule data locally, apply only to matching origins, and allow preview, undo, pause, export, and delete.
- Prefer resilient user-selected selectors and report rules that stop matching; avoid broad AI-generated destructive rules without preview.
- Inject only through the existing isolated/per-tab content-script boundary, with strict IPC validation and origin scoping. Do not alter browser chrome or bypass website security controls.

### 7. Universal local search (web + local files)

- Extend the browser command/search surface to query tabs, history, bookmarks, saved research, offline snapshots, and user-approved local folders.
- Folder indexing is opt-in, local-only initially, incremental, bounded by file types/size, cancellable, and supports remove/reindex. Ignore OS/system folders and secrets by default.
- Show result source/type and open-with controls. Do not upload local file content to AI providers unless the user explicitly submits it to a configured provider.
- OS-wide replacement of Windows Search/Spotlight is not part of the first implementation; provide in-app search and optional, platform-specific shortcuts only.

### 8. Native browser-wide macro recorder

- Allow recording supported user-visible browser actions across tabs and origins, with sensitive input redaction and explicit site scope.
- Macros are editable step sequences with variables, dry-run/preview, bounded timeouts, stop control, and an execution log. Store local-only in the first release.
- Require confirmation for submit/send, purchase/payment, account/security changes, file upload, deletion, or other sensitive/destructive action. Never capture passwords, OTPs, private/incognito contents, or hidden browser secrets.
- Validate selectors at playback and pause when the page differs; no autonomous retry loop that could repeat side effects.

### 9. Context-aware smart workspaces

- Add user-authored workspace rules based on explicit schedules or manual triggers, with timezone, enabled days, and a preview of tabs/apps that would change.
- Start in notify/suggest mode. User can opt into automatic workspace switching after reviewing exact behavior. Never close/discard a workspace; save and restore it with existing workspace/session mechanisms.
- Keep rules local; show a persistent status indicator and quick pause. No activity surveillance or inference about work/leisure from page contents.

### 10. Multi-device session handoff

- Provide an explicit “Send workspace” flow that packages selected URLs, workspace metadata, and optionally scroll/media position when the site permits; user chooses destination device and confirms.
- Do not use movement detection, smartwatch proximity, or pixel-perfect live projection by default. Handoff must not include cookies, passwords, form contents, incognito tabs, or authenticated session tokens.
- Requires a separately provisioned, encrypted sync/relay service or a user-controlled pairing protocol, device authorization/revocation, expiring payloads, and end-to-end encryption. Until that dependency is designed and reviewed, local export/import is the only supported transport.
- The incoming request text ended at “active video playback timesta…”. This spec includes only the described workspace/session handoff; additional omitted requirements need a follow-up revision.

## Delivery slices

These are independent projects; they must receive separate implementation plans and can be prioritized/reviewed separately after this umbrella spec is approved.

### Slice A — Responsive core and tab resource policy

Improve and instrument existing tab sleeping, wake behavior, and background-work scheduling. Deliver measurable many-tab behavior without OS integrations or new network services.

### Slice B — Site declutter rules

Local per-origin element-hiding preview/editor, persistence, safe injection, controls, and tests.

### Slice C — Offline reading and local search

Explicit snapshots, offline fallback UX, limits/deletion, and unified in-app search across already-local browser data; folder indexing follows as a separately permissioned increment if architecture review confirms bounded handling.

### Slice D — Context clipboard and macro recorder

User-reviewed structured context fill and visible, permissioned macro authoring/playback. These share a permissions/audit surface but must remain separately toggleable.

### Slice E — Scheduled workspaces and explicit handoff

Local schedules and export/import handoff first. Encrypted remote relay is a separately approved infrastructure project.

### Slice F — OS dock and notification center

Platform-specific background lifecycle, tray/menu bar, and notifications; provider/API discovery and permission model first. No generic credential scraping.

## Security and privacy requirements

- All new IPC methods validate arguments, lengths, origin, and permission at the main-process boundary.
- Incognito/private tabs are excluded from snapshots, indexing, macros, context records, notifications, scheduled workspace history, and device handoff unless a specific one-time action is explicitly supported and confirmed; default is exclusion.
- Local data has bounded quotas, clear/delete/export controls, and is excluded from telemetry by default.
- Remote sync requires threat modeling, encrypted transport and storage, device revocation, retention limits, and independent security review before release.
- Use Electron context isolation and existing navigation restrictions; never enable Node integration for site content.

## Performance and quality gates

- Establish repeatable baseline scenarios at 10, 25, and 50 tabs, including background media and downloads; record startup responsiveness, active-tab input latency, wake latency, and renderer/process memory where available.
- No feature may add continuous background polling by default. Search/indexing, snapshotting, notifications, and AI extraction must have explicit quotas and cancellation.
- Run focused unit/integration tests for each slice, `npm run typecheck`, `npm test`, and `npm run build` before marking the slice complete.
- UI retains AIHub's existing visual language and keyboard accessibility. New persistent/background states must be visible and discoverable.

## Acceptance criteria for the umbrella initiative

1. Each delivery slice has its own reviewed plan, tests, and feature controls; one subsystem failure does not disable normal browsing.
2. Offline fallback never labels a stale snapshot as a live app and never submits queued arbitrary mutations.
3. Per-site page rules cannot execute on another origin and can be previewed, paused, and deleted.
4. Sensitive/private data never enters automation, context fill, indexing, notifications, or handoff without an explicit, reviewed exception.
5. Background mode and scheduled behaviors can be paused and fully quit by the user on each supported platform.
6. Local search/indexing operates only over selected/approved data and stays cancellable and bounded.
7. Automation visibly previews scope and stops before sensitive side effects; failure to identify a changed page pauses instead of repeating actions.
8. Multi-device sync is not announced as available until the relay/pairing security requirements pass review.
9. Performance claims are supported by recorded before/after measurements on the same test scenarios.

## Open decisions for review

- Confirm staged delivery is acceptable; this initiative cannot safely ship all ten subsystems as one feature or one release.
- Confirm local-only first for snapshots, context records, rules, macros, search indexes, and schedules.
- Choose which slice should receive the first implementation plan. Recommended: Slice A (many-tab responsiveness), then Slice B (site declutter), then Slice C (offline reading/search).
- Device handoff description is truncated in the request; confirm the visible scope above or provide the remaining text in a later spec revision.
- OS-specific packaging and behavior will require verification on real Windows/macOS/Linux environments before claiming parity.
