# Security Center Implementation Plan

**Goal:** Ship the approved first security release with local Ollama analysis, Defender controls, download protection, phishing checks, and local HTML inspection.

**Architecture:** Main-process security service owns evidence and enforcement. Fixed Defender commands run without shell interpolation. Ollama receives bounded evidence over loopback only and cannot invoke tools or change protection settings. Renderer gets typed results through owner-checked IPC.

**Tech Stack:** Existing Electron, React, TypeScript, Vitest, Node filesystem/crypto, Windows Defender PowerShell module, Ollama chat API.

## Constraints and review focus

- Existing HTML opening fix travels in this release. Preserve unrelated workspace files.
- No arbitrary commands, antivirus exclusions, disabling protection, cloud fallback, deletion, or AI remediation.
- Unknown, failed, or pending scans never count as clean; opening an unverified download needs an explicit native confirmation. Confirmed threats are blocked.
- Files must be rescanned when changed; Windows unavailable, passive Defender, timeout, malformed output and missing files are explicit errors.
- Incognito findings stay in memory and never enter the normal security timeline.
- HTML inspection is static and bounded, never executes HTML. Findings are indicators, not malware verdicts.

## Tasks

- [x] Define shared security types and pure phishing/HTML/agent response validators. Write regression tests, run red, implement, run green.
- [x] Add Defender adapter with fixed encoded scripts, path passed as environment data, status/detection parsing, serialized scan service, and tests for failures/injection/modified files.
- [x] Add owner-checked Security IPC, download completion scanning and guarded opening, local HTML navigation inspection and web-page evidence collection.
- [x] Add Security Center page, local agent report, scan controls, live timeline, download scan status, sidebar and navigation links. Test unavailable/error states.
- [x] Run focused and full tests, typecheck, build, real Defender/Ollama smoke checks and app UI smoke check where supported. Incognito end-to-end regression: 71/71 checks passed.
- [ ] Update version/release notes, review diff, commit only task files, push branch/tag, monitor release workflow and verify published assets.

## Product decisions

The first release uses one loaded Ollama model for evidence analysis. File/folder scans use Defender's custom report-only mode, which ignores exclusions without changing settings; ambiguous threat/error codes block opening. Quick/full scans follow existing Windows policy. Automatic phishing checks produce visible warnings and evidence; they do not claim comprehensive threat detection. Advanced process monitoring and firewall control are later work, as proposed.
