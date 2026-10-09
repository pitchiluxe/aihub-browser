# AIHub Browser: product audit and growth opportunities

Date: October 8, 2026. Baseline: v1.75.1, commit 67214eb.

## Recommendation

Make AIHub the browser that turns browsing into reusable, verifiable work. Lead with research projects that retain their evidence, stay current, and can be shared. Keep specialty features available through optional packs rather than making every new user learn them all.

Initial audience hypothesis: students, researchers, consultants and independent professionals who routinely compare information across websites. This is a recommendation to validate with users, not a claim that this audience has already adopted AIHub.

Scope: product-wide source inventory, navigation and representative implementation review, plus current official competitor documentation. This is not a line-by-line review of every source file, a penetration test, or an instrumented usability study. No product code was changed. The preceding release validation passed 2,014 tests, type checks, builds and desktop scenarios; those checks do not establish demand or prove security.

## What the app already offers

| Area | Existing capability | Opportunity or limitation |
|---|---|---|
| Browser shell | Native tabs, split views, groups, workspaces, history, downloads and restored sessions | Benchmark real workloads and make migration straightforward |
| Home | Search, quick apps, bookmarks, graph, focus and specialty entry points | Too many possible starting points; offer a short guided first task |
| AI | Ollama, OpenRouter, routing, streaming and page assistance | Explain which provider receives page data and what requests cost |
| Research | Source cards, notes, comparison reports, bibliography and Markdown export | Add deterministic links from each claim to captured source passages |
| Knowledge | Obsidian, Markdown graph, Page Vault, Rewind, semantic history and Recall | Connect these into one project history rather than separate destinations |
| Automation | Agent templates, page scanning, form filling and clicking | Add enforced permissions, action previews and reusable execution records |
| Monitoring | Watch & Ping, change detection and notifications | Add structured comparisons, freshness and decision-specific alerts |
| Daily work | Morning Brief, Gmail, calendar integration and receipt Ledger | Prefer explicit setup and useful defaults over requiring many integrations |
| Community | Messaging, public/private reading lists and live communication infrastructure | Share useful work that recipients can view before installing AIHub |
| Travel | Destination exploration, airport directory, photos, AI research and prefilled booking searches | Current searches are not live, normalized fare comparisons |
| Learning | Recall, Bible Study, courses, quizzes and review scheduling | Generalize learning workflows beyond one subject |
| Creative tools | DJ, annotations, screen pen, recordings and generated extensions | Treat these as optional capabilities for specific audiences |
| Privacy/security | Incognito, isolated containers, encrypted secrets, blocking and backups | Some broad defaults need tightening before strong privacy claims |
| Distribution | GitHub releases, cross-platform packages and updater | Signed releases and simple setup can reduce adoption friction |

Sources reviewed include `src/shared/pageTypes.ts`, `Sidebar.tsx`, `CommandPalette.tsx`, the built-in page components, renderer services, `src/main/index.ts`, session and secret stores, and release/updater configuration.

## Findings to address before promoting widely

1. **Remaining freeze paths.** WiFi scanning and connecting call synchronous OS commands in the Electron main process with 8–12 second timeouts. Scanning can execute several commands in sequence. This is a confirmed blocking path, although it does not prove it caused the user's many-tab freezes. Replace it with asynchronous commands and test control responsiveness during a delayed scan. See `src/main/index.ts`, WiFi IPC handlers.
2. **Page-data consent.** `App.tsx` starts page analysis automatically after normal-tab loads. `parallelIntel.ts` prefers local processing, but the app itself acknowledges the configured provider may be cloud-based. A local preference is not an enforceable local-only guarantee. Add a clear opt-in, site exclusions, an actual local-only mode and visible provider disclosure.
3. **Permission defaults.** The session permission handler approves a fixed list without origin-specific user approval. It includes media, geolocation and clipboard reading. Replace sensitive blanket permissions with per-site prompts and revocable grants. The Windows startup also sets `no-sandbox`; investigate the original compatibility issue and restore process sandboxing with regression tests. These are implementation findings, not demonstrated exploits.
4. **Agent action enforcement.** The generic `click_element` executor directly clicks its target. Some templates instruct the model to ask before submission, but that instruction is not equivalent to a central action-policy check. Add runtime approval for consequential actions and enforce it regardless of which template generated the action. Not every website action is reversible.
5. **AI grouping mismatch.** `tabCurator.ts` sends numbered titles and URLs, asks for exact tab IDs, then rejects returned IDs that do not match the store. Actual IDs are absent from that input. Valid-looking model output can therefore yield empty groups. Include the IDs and fall back when parsed groups are unusable.
6. **Discoverability.** Navigation exposes many unrelated activities. This is a product judgment, not a measured usability failure. Present three main journeys—Browse, Research, Automate—and allow users to enable specialty packs.
7. **Travel expectations.** Booking links carry search fields; AI research does not produce verified bookable offers. Random provider selection cannot establish the cheapest deal. Keep those descriptions accurate and make true cost comparison a distinct future capability.
8. **Architecture and release trust.** The main entry point contains thousands of lines of unrelated functionality. Modular IPC services would make safety policies and performance testing easier. The current unsigned macOS package requires manual updates. Evaluate signing on every supported platform before a broad consumer launch.

## Competitive reality

Generic summaries, browser chat, tab-aware answers, workspaces, price comparison and local models are not sufficient differentiators:

- [Comet](https://www.perplexity.ai/comet/gettingstarted) documents tab-aware assistance and research workflows.
- [Edge](https://support.microsoft.com/en-us/microsoft-copilot/getting-started-with-copilot-in-microsoft-edge) documents page, video and PDF assistance; [Browse with Copilot](https://support.microsoft.com/en-us/microsoft-copilot/browse-with-copilot) documents browser actions.
- [Dia](https://www.diabrowser.com/) promotes synthesis across tabs and connected work tools.
- [Brave Leo](https://brave.com/leo/) supports bring-your-own models, including local models.
- [Vivaldi](https://vivaldi.com/features/) offers workspaces, notes and extensive browser customization.
- [Arc](https://resources.arc.net/hc/en-us/articles/19228534606743-Share-Spaces-Folders-Splits-with-Anyone) already documents sharing spaces and splits. Sharing links alone is not a new category.
- [Microsoft Shopping](https://www.microsoft.com/en-us/shopping) documents price comparison and price history.
- Atlas is a historical reference rather than an active browser target: [OpenAI's notice](https://help.openai.com/en/articles/20001371-evolving-atlas-into-chatgpt-for-browser-based-agentic-work) schedules its shutdown for August 9, 2026 and moves browser work into ChatGPT and Codex.

The proposals below are differentiation hypotheses. A review of these vendors' documentation cannot prove that no browser, extension or separate app offers a similar feature. The opportunity is a better integrated workflow, particularly using AIHub's existing knowledge and community foundations.

## Ranked additions

| Rank | Proposal | Concrete user experience | Existing foundation | Effort / dependency | Growth hypothesis |
|---|---|---|---|---|---|
| 1 | Evidence-backed research projects | Select tabs → obtain a report where each claim opens the exact supporting passage, capture date and source; separate conflicting evidence and missing information | Research, Vault, notes, Obsidian | Medium–high; capture and provenance model | Students and professionals can demonstrate the value with a useful output |
| 2 | Shareable project capsules | Share a sanitized package of conclusions, citations, annotations and unresolved questions; recipients preview it in a normal browser and optionally continue it in AIHub | Community Lists, research export, workspaces | High; public preview hosting, permissions and redaction | Useful outputs expose AIHub to collaborators without requiring installation first |
| 3 | Research that stays current | “Keep this comparison up to date.” Track selected sources and show exactly which conclusions changed and why | Watch & Ping, diffing, research | Medium–high; reliable structured extraction | Recurring useful alerts give users a reason to return |
| 4 | Travel total-cost board | Compare flight, baggage, airport transfer, hotel taxes and rental insurance in one dated trip total; mark unknown fees rather than guessing | Flights & Rentals, structured research | High; licensed data or permitted extraction, normalization and freshness | A transparent comparison is easier to recommend than a random booking link |
| 5 | Teach AI a reusable browser routine | Record a supported workflow, replace personal fields with variables, test it, and rerun with a visible action preview and budget | Agent tools, templates | High; recorder, resilient selectors and central approval policy | Repeated business tasks support daily use and shareable templates |
| 6 | Learn from any research project | Turn captured evidence into editable lessons, quizzes and spaced review cards, each linked to its source | Recall, study engine, research | Medium; generalization and quality checks | Students can share course packs and return for scheduled reviews |
| 7 | Personal context with a receipt | For an answer, show which saved facts were used, where they came from, when they were captured and how to edit or delete them | Site memory, history, Obsidian | Medium–high; unified permissions and provenance | Control and transparency could attract users reluctant to use cloud-only memory |
| 8 | Shared investigation room | Collaborators work on one evidence board with comments, roles and a visible unresolved-question queue; each keeps their own login session | Community, live infrastructure, research | High; document synchronization and access controls | Invitations bring collaborators into a useful ongoing project |
| 9 | A challenge view for AI answers | Run an optional second model to identify unsupported claims and disagreements; verify against sources rather than presenting consensus as truth | Multi-model routing, research | Medium; cost limits and evaluation set | A memorable demo for users who care about answer quality |
| 10 | Offline project suitcase | Export sources the user may save, notes, citations and review cards into a portable project that still works offline and can be restored | Vault, Markdown export, local models | Medium; format and content-rights boundaries | Fits travel, unreliable connections and knowledge ownership |

Ranks reflect judgment about audience value, fit with existing code and opportunities for repeat use or sharing—not measured demand. Source-backed research and project capsules are the recommended first pair. They must improve on the current report and public reading-list features, not simply rename them.

## First experiment and delivery order

Start with a comparison project for a student or independent professional: ten selected pages become one editable evidence board and report. Every supported claim opens a captured passage; missing evidence is visible. Export works without an account. In the first version, keep sharing as a sanitized export rather than building a new backend immediately.

Recruit a small set of people who already perform this task and observe whether they can produce a useful result without help. Measure completion, correction effort and whether they choose to repeat the task. If that works, add browser-accessible capsule previews and track whether recipients open, reuse and recommend them.

Suggested sequence:

1. Fix the consent, permission, blocking-command and curator issues; simplify first-run navigation.
2. Ship one evidence-backed research journey with an editable export and a clear first-run example.
3. Validate repeat use, then add sanitized capsules and change-aware research.
4. Pursue travel comparison or reusable routines when usage shows which audience values AIHub most.

Measure first-session task completion, time to first useful result, seven-day return rate, completed projects, share-open-to-reuse conversion, freezes per active user and AI cost per completed task. Any usage measurement should be transparent, optional and exclude page contents and credentials. Do not invent target percentages without a baseline.

Keep basic browsing, import/export and a meaningful research example accessible. Consider charging for costly monitored projects, collaboration or managed automation only after users demonstrate repeat value. Disclose sponsored travel placement separately from ranking.

No proposed feature guarantees large user growth. A clear promise, easy migration, reliable daily browsing and an output worth sharing are the most credible combination to test.
