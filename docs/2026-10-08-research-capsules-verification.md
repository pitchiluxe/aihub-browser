# Research workspace and capsule verification

Completed October 8, 2026 on `codex/evidence-research-capsules`. Baseline: `67214eb`; implementation and review fixes through `abae028`.

## Delivered

The original compact blue-glass Research design is restored: a yellow-accented notepad on the left, sources in the middle, and the report on the right. Named projects, explicit page selection, dated immutable captures, exact quote inspection, editable/removable findings, user review, Markdown export, and previewed portable capsules are integrated into that layout. Both dark and light themes were inspected.

Capture excludes form fields, editable drafts, hidden elements and hidden ancestors. Work is bounded and reads at most two selected pages concurrently. Main-process ownership determines which window may capture a tab. Private research is memory-only and is released when its owning window closes.

Normal projects use revision-checked saves with server-monotonic timestamps. Stale windows cannot overwrite newer work or resurrect deleted projects. Conflicts retain the local draft, offer a complete private JSON backup including notes and captured text, and provide an explicit reload action.

Capsules include only selected findings and supported excerpts from included sources. Excluding a source also removes its citation quotes. HTML has no scripts or remote assets and uses a restrictive CSP. Import validates JSON and creates a separate project with new source IDs and shared-excerpt provenance. All original legacy notes remain accessible in the paginated Previous notepad, including entries beyond the new limits.

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test -- --maxWorkers=2 --minWorkers=1` | 140 files, 2,049 tests passed |
| `npm run build` | Passed |
| `node scripts/test-research-capsules-e2e.mjs` | Passed against the final build |
| `node scripts/test-responsiveness-e2e.mjs` | Passed: 40 restored tabs, 20 additional live views, responsive controls and preserved drafts |
| Dark/light Research screenshots | Visually inspected |
| `git diff --check` | Passed |

The desktop scenario uses an isolated profile, actual local web pages and deterministic AI fixtures. It verifies selection and consent, capture exclusions, matched/unmatched quotes, review resets, native ZIP output, offline HTML in a separate Edge context with no HTTP requests, JSON import, private isolation, and restart persistence. It does not exercise the user's personal profile.

A separate live-provider check was attempted with local Ollama `llama3.2:3b`, a selected public Electron documentation page, and cloud fallback disabled in an isolated profile. Capture succeeded, but AI generation did not finish within 150 seconds. A shorter public-page diagnostic could not load its page within the test deadline. Live AI generation is therefore **unverified** on this machine; fixture-based desktop success is not represented as real-provider success. The optional `scripts/test-research-live-ai.mjs` reproduces the check when Ollama and public-page access are available.

## Independent review

One independent whole-change review found six Important issues and no Critical or Minor findings. Every issue was reproduced by a failing regression test, fixed in one pass, and covered by the final green suite:

1. Excluded-source quotations removed from both export files.
2. Hidden ancestors excluded during capture.
3. Stale saves and deleted-project resurrection rejected.
4. Overflow and long legacy notes remain accessible after reopening.
5. Individual findings can be removed and stay removed after reopening.
6. Empty model quotations become unsupported findings instead of rejecting the whole report.

Conflict-draft backup preservation also has a failing-then-passing test confirming that unsaved notes are exported. No deferred minor findings remain.

## Execution decisions

- Use the existing writable checkout on a dedicated feature branch to preserve dependencies and the approved design files. Cost if wrong: unfinished changes could appear in the development app; verification used isolated profiles.
- Use Windows-native task bookkeeping instead of POSIX helper scripts. Cost if wrong: a missed ledger entry would require checking commit history.
- Retain unresolved citation references in local reports, without granting matched status. Cost if wrong: unsupported findings remain available for review. Excluded-source quotations are omitted from capsules.
- Limit test execution to two workers after the initial default-worker baseline stalled on shutdown. Cost if wrong: checks run more slowly; production behavior is unchanged.
- Implement the pure capsule transformation before its UI consumers. Cost if wrong: commit order differs from the original plan; runtime behavior is unchanged.
- Assign fresh imported source IDs and remap citations. Cost if wrong: original internal identifiers are not retained; immutable captured-source collisions are avoided.
- Keep the completed feature branch locally within the approved no-release scope. Cost if wrong: separate integration is needed before distribution.

The implementation does not add hosted sharing, provider accounts, dependencies, or a release. Existing unrelated untracked workspace files were preserved.
