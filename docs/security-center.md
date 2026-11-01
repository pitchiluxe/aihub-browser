# Security Center

Open **Security Center** from the sidebar or shield button in the address toolbar.

## Protection and scans

The dashboard reads Microsoft Defender status directly on Windows. File and folder scans use Defender's custom scan interface with remediation disabled. Microsoft documents that this mode ignores file exclusions and scans archives; no exclusion or protection setting is changed. Ambiguous scan exit codes block download opening rather than being interpreted as clean.

Quick and full scans use Windows Defender's scan controls and your existing Windows policy. Review findings and any Windows-managed remediation in **Windows Security**. AIHub cannot disable protection, create exclusions, restore quarantined items, or run arbitrary administrator commands.

Downloads scan automatically. Opening through AIHub verifies the current file hash, uses only recent matching evidence, and rescans changed files. Files can still be opened outside AIHub using the operating system; AIHub is a browser protection layer, not a replacement for system antivirus.

## Local analyst

Choose an installed local Ollama model in **Settings**. The Ollama endpoint must be loopback (`localhost`, `127.0.0.1`, or `::1`). The selected model must appear in the local model list and must not be a remote/cloud model. Security analysis does not use the app's cloud fallback routing.

Qwen 2.5 Coder 1.5B was used for the live integration test. Model quality, available memory, and local server load affect results. Offline, slow, or malformed responses produce an error; they never invent a scan result or execute an action. The analyst sends the local Defender status, your question, and recent security events to the local Ollama service only.

## Browser checks and privacy

Password-form and URL checks are indicators collected after page load. Dynamic forms and malicious behavior may evade these heuristics. Local HTML inspection is static, limited to regular files up to 2 MB, and does not fetch or execute resources. Larger or unreadable HTML files remain unverified.

Normal browsing retains up to 200 security events in the local app profile. Incognito findings are held in memory for that window and discarded on close. Windows Defender has separate operating-system logs and may use its configured cloud protection; AIHub does not change those settings.

## Verification

Normal tests: `npm test`, `npm run typecheck`, `npm run build`.

Built-app smoke test: `node scripts/test-security-e2e.mjs`. It uses a temporary profile and harmless local fixtures.

Opt-in Windows integration test: set `AIHUB_SECURITY_LIVE=1`, optionally `AIHUB_SECURITY_TEST_MODEL` and `AIHUB_SECURITY_TEST_BASE`, then run `npx vitest run src/main/security/live.test.ts`. This performs a real harmless-file scan and a local model request; normal CI skips these tests.

References: [Defender command-line scans](https://learn.microsoft.com/en-us/defender-endpoint/command-line-arguments-microsoft-defender-antivirus), [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs).
