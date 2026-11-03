# AIHub Browser — Performance Audit, Feature Blueprint & Agent Doctor

Date: 2026-11-03 · Branch audited: `feat/ai-dj-core` @ d7e472b (v1.96.0)
Method: static read of `src/main`, `src/renderer`, build output in `out/`, plus timing of the real profile files in `~/.aihub-browser` (Node 22, this machine). Every finding below cites a file and line. Anything not measured is marked **unmeasured**.

---

## 0. Scope reality check

AIHub is an Electron 44 shell around Chromium 152. We do not own Blink, V8 or the network stack, so "fastest browser" work splits into two very different jobs:

1. **Stop our own code from blocking Chromium.** The main process services every tab's IPC, view bounds and input routing. Any synchronous work there is felt as lag across *all* tabs. This is where nearly all of the measurable sluggishness lives.
2. **Tune what Chromium exposes** (switches, sessions, preconnect, tab lifecycle). Small, cheap, mostly already done.

Some items in the original brief do not apply and are deliberately not built:

| Request | Why not as stated | What we do instead |
|---|---|---|
| Service Worker caching for browsed sites | A browser cannot install SWs into third-party origins; Chromium's HTTP cache (512 MB, already set) is that layer | Fix the main-thread stalls that delay *our* side of every navigation |
| Forced idle-time GC | `global.gc()` needs `--expose-gc`, causes a full stop-the-world pause, and V8 already does idle-time GC | Release *our* memory: auto-sleep background tabs, unload idle Ollama models, cap stores |
| Full-document prerender from cursor trajectory | Prerendering third-party pages runs their scripts: fires analytics, can hit GET-logout/"confirm" links, leaks intent. `navigationWarmup.ts` intentionally stops at preconnect | Hover-intent **preconnect** (exists) + `<link rel=prefetch>`-style speculation only for *our* pages and the user's own search results |

---

## Phase 1 — Findings, ranked by impact ÷ effort

Measured cost of each profile file (read + `JSON.parse` + `JSON.stringify`):

| File | Size | read | parse | stringify |
|---|---|---|---|---|
| rewind.json | 11.9 MB | 71 ms | 57 ms | 71 ms |
| semantic-index.json | 11.2 MB | 49 ms | 16 ms | 27 ms |
| agents.json | 2.1 MB (pretty) | 10 ms | 12 ms | 12 ms |
| community-data.json | 1.6 MB | 11 ms | 5 ms | 12 ms |

The user's machine is slower than this one (CPU-only Ollama, i3-class), so multiply by ~2–3×.

### P0 — Security (fix before any perf work)

**S1. Chromium sandbox disabled for every web page on Windows** — `src/main/index.ts:136`
`app.commandLine.appendSwitch('no-sandbox')` turns off the renderer sandbox process-wide, so every site the user visits runs in an unsandboxed renderer. A single renderer exploit becomes code execution as the user. The comment says it was added for GPU cache permission errors; that problem is already handled by `gpu-disk-cache-dir` on line 133. Remove `no-sandbox` (keep `disable-gpu-sandbox` only if the GPU process genuinely fails without it, and re-test that separately).

### P1 — Highest impact, easiest

| # | Finding | Where | Cost today | Fix |
|---|---|---|---|---|
| 1 | Wi-Fi scan runs `execSync('netsh …')` on the main thread, up to **3 calls × 8 s timeout** | `index.ts:4442`, `4448`, `4459`, plus `execFileSync` at `4489`, `4514`, `4532` | Whole browser freezes (Windows "Not Responding") for the duration of each netsh call, typically 0.3–2 s, up to 24 s | `execFile` async (code below) |
| 2 | Agent conversations: every save re-reads, re-parses and pretty-rewrites a 2.1 MB file synchronously | `index.ts:6107–6160`, called per agent turn from `AgentsPage.tsx:435` | ~35–50 ms blocked main per message here, ~100 ms on user's PC | Move to `createJsonStore` (already in repo, `jsonStore.ts`) |
| 3 | `writeJson` is synchronous and pretty-printed; still used by notes, site memory, watches, extensions, agents, data.json | `index.ts:237` and 17 callers | Small per call, but on the IPC path of user actions | Route callers through `createJsonStore`; keep `writeJson` only for quit-time flush |
| 4 | `AIAssistant` (1165 lines, always mounted) subscribes to the **whole** store | `AIAssistant.tsx:57–63` | Re-renders on every tab title, favicon, loading flag, download tick | `useShallow` selector (App.tsx:120 already does this) |
| 5 | Same whole-store pattern in always-mounted `AddBookmarkModal`, and `HomePage` | `AddBookmarkModal.tsx:8`, `HomePage.tsx:39` | Extra renders of the bookmark sphere host on every tab event | Selectors |
| 6 | Two no-op/invalid Chromium switches | `index.ts:156` (`enable-http2`, default since Chrome 41), `index.ts:166` (`host-resolver-rules` takes `MAP`/`EXCLUDE` rules, not TTLs) | None, but the comments promise behaviour that isn't happening | Delete both; DNS caching is the resolver's job (see N2) |

### P2 — High impact, moderate effort

| # | Finding | Where | Fix |
|---|---|---|---|
| 7 | Rewind store at its 3000 cap: every page dwell triggers a 71 ms `JSON.stringify` of 12 MB on the main thread (async write, sync serialize) | `index.ts:4591`, `4681–4697` | Append-only NDJSON log + compaction in a worker (code below) |
| 8 | No automatic tab sleeping — only the manual "Sleep Tab" menu item. The safety predicate already exists | `index.ts:1599` (`tabSleepChecks`), `2969` | Idle-tab scheduler (code below) |
| 9 | No hang detection for tabs: `render-process-gone` is handled (`1759`) but `unresponsive` is not | `index.ts` | Agent Doctor watches it (Phase 4) |
| 10 | Bible save path does `existsSync` + `copyFileSync` + pretty `writeFileSync` + `renameSync` per mark | `index.ts:4885–4890`, `4956–4961`, `5119–5124` | Same store migration; backup on a timer, not per write |

### P3 — Structural

| # | Finding | Fix |
|---|---|---|
| 11 | `src/main/index.ts` is 7270 lines: every IPC domain evaluated at startup, impossible to profile per feature | Split into `src/main/ipc/<domain>.ts` registered lazily; start with wifi, agents, bible, watches, notes (all touched by this audit) |
| 12 | Main-process JSON stores are all whole-file. History, rewind and the semantic index will keep growing | One storage service: SQLite (`node:sqlite`, built into Node 22 / Electron 44) with WAL; FTS5 replaces the linear rewind scan |
| 13 | **Unmeasured:** startup critical path (work before `createWindow()` at `index.ts:2364`) and time-to-first-paint | Run `scripts/probe-freeze.cjs` on the packaged build and add a startup trace (`contentTracing`) before optimizing |

Already good (verified, no action): heavy pages are `lazy()` (App.tsx:24–56); three.js, livekit, Bible data and DJ are separate chunks not in the entry `modulepreload` list; Google Fonts load non-blocking (`media="print"` swap); `net.fetch` replaced blocking Node sockets; `navigationWarmup.ts` preconnect budget; `jsonStore.ts` atomic debounced writes; DJ analysis in a worker.

---

## Phase 2 — Concrete fixes

### 2.1 Wi-Fi: async `netsh` (fixes #1)

```ts
// src/main/wifi.ts
import { execFile } from 'child_process'
import { promisify } from 'util'

const run = promisify(execFile)

async function netsh(args: string[], timeout = 8000): Promise<string> {
  const { stdout } = await run('netsh', args, { encoding: 'utf8', timeout, windowsHide: true })
  return stdout
}

export async function currentWifiSsid(): Promise<string> {
  try {
    const raw = await netsh(['wlan', 'show', 'interfaces'])
    if (!/^\s*State\s*:\s*connected/im.test(raw)) return ''
    return raw.match(/^\s*SSID\s*:\s*(.+)$/im)?.[1].trim() ?? ''
  } catch { return '' }
}

export async function scanWifi() {
  // The three netsh calls are independent — run them together.
  const [networksRaw, profilesRaw, ssid] = await Promise.all([
    netsh(['wlan', 'show', 'networks', 'mode=bssid']),
    netsh(['wlan', 'show', 'profiles']).catch(() => ''),
    currentWifiSsid(),
  ])
  const saved = new Set([...profilesRaw.matchAll(/(?:All User Profile|User Profile)\s*:\s*(.+)/g)].map(m => m[1].trim()))
  const networks = parseWifiNetworks(networksRaw).map(n => ({ ...n, saved: saved.has(n.ssid) }))
  return { networks, connectedSsid: ssid }
}
```

`execFile` also removes the shell, so SSIDs can never be interpreted as shell syntax. The registry block at `index.ts:2422` should move to `execFile('reg', [...args])` for the same reason.

### 2.2 Agents store (fixes #2)

```ts
// index.ts — replaces readAgentsStore / writeJson(AGENTS_FILE, …)
const agentsStore = createJsonStore<{ customAgents: any[]; conversations: any[] }>(
  AGENTS_FILE, () => ({ customAgents: [], conversations: [] }), { debounceMs: 2000 })

let agentsPruned = false
function agents() {
  if (!agentsPruned) {
    agentsPruned = true
    const cutoff = Date.now() - THREE_MONTHS_MS
    agentsStore.update(s => {
      s.customAgents  = Array.isArray(s.customAgents)  ? s.customAgents  : []
      s.conversations = (Array.isArray(s.conversations) ? s.conversations : [])
        .filter(c => (c.updatedAt || c.createdAt || 0) > cutoff)
    })
  }
  return agentsStore.get()
}

ipcMain.handle('agents:saveConversation', (_e, convo: any) => {
  if (!convo?.id) return false
  agentsStore.update(s => {
    s.conversations = [convo, ...s.conversations.filter(c => c.id !== convo.id)]
  })
  return true
})
// …and add agentsStore.flush() to the existing before-quit flush list.
```

Per-message cost drops from a full parse + stringify to an array splice; the write happens once per 2 s burst, off the IPC path.

### 2.3 Whole-store subscriptions (fixes #4, #5)

```tsx
// AIAssistant.tsx
import { useShallow } from 'zustand/react/shallow'

const {
  isAIPanelOpen, toggleAIPanel, aiMessages, addAIMessage, clearAIMessages, setAIMessages,
  isAILoading, setAILoading, ollamaStatus, setOllamaStatus, bookmarks, addTab,
} = useBrowserStore(useShallow(s => ({
  isAIPanelOpen: s.isAIPanelOpen, toggleAIPanel: s.toggleAIPanel,
  aiMessages: s.aiMessages, addAIMessage: s.addAIMessage,
  clearAIMessages: s.clearAIMessages, setAIMessages: s.setAIMessages,
  isAILoading: s.isAILoading, setAILoading: s.setAILoading,
  ollamaStatus: s.ollamaStatus, setOllamaStatus: s.setOllamaStatus,
  bookmarks: s.bookmarks, addTab: s.addTab,
})))
```

Then render nothing heavy while `!isAIPanelOpen`. Verify with React DevTools Profiler: switching tabs should no longer highlight `AIAssistant`.

### 2.4 Rewind as an append log (fixes #7)

Layout: `rewind/log.ndjson` (one entry per line, appended), compacted into `rewind/base.ndjson` by a `utilityProcess` when the log passes ~2 MB.

```ts
// src/main/rewindLog.ts
import fs from 'fs/promises'

export function createRewindLog(dir: string, cap: number) {
  const log = `${dir}/log.ndjson`
  let index: Map<string, RewindEntry> | null = null   // url -> latest entry
  let queue = Promise.resolve()

  async function load() {
    if (index) return index
    index = new Map()
    for (const f of ['base.ndjson', 'log.ndjson']) {
      const raw = await fs.readFile(`${dir}/${f}`, 'utf8').catch(() => '')
      for (const line of raw.split('\n')) {
        if (!line) continue
        try { const e = JSON.parse(line) as RewindEntry; index.set(e.url, e) } catch { /* torn tail line */ }
      }
    }
    return index
  }

  return {
    async add(e: RewindEntry) {
      const idx = await load()
      idx.delete(e.url); idx.set(e.url, e)           // Map keeps insertion order = recency
      while (idx.size > cap) idx.delete(idx.keys().next().value!)
      // Serialize ONE entry (~6 KB), not 12 MB. Writes are chained so lines never interleave.
      queue = queue.then(() => fs.appendFile(log, JSON.stringify(e) + '\n')).catch(() => {})
    },
    async all() { return [...(await load()).values()].reverse() },
  }
}
```

A torn last line after a crash is skipped on load, so the log is crash-safe without temp files. Compaction (rewrite `base.ndjson` from the in-memory map, truncate `log.ndjson`) runs in a `utilityProcess` so the 12 MB serialize never touches the main thread. Migrate once from `rewind.json` on first load.

### 2.5 Automatic tab sleep (fixes #8)

The safety predicate already exists (`tabSleepChecks`, `index.ts:1599`: no dirty form, no media, no capture, no devtools). Add a scheduler around it:

```ts
// src/main/tabLifecycle.ts
export interface SleepPolicy { idleMs: number; maxAwake: number }

export function createTabSleeper(
  policy: SleepPolicy,
  deps: {
    tabs: () => { id: number; lastActive: number; active: boolean; pinned: boolean }[]
    canSleep: (id: number) => boolean
    sleep: (id: number) => void
    memoryPressure: () => boolean     // from powerMonitor / process.getSystemMemoryInfo
  },
) {
  return function tick(now = Date.now()) {
    const awake = deps.tabs().filter(t => !t.active && !t.pinned)
      .sort((a, b) => a.lastActive - b.lastActive)     // oldest first
    const pressure = deps.memoryPressure()
    let excess = awake.length - policy.maxAwake
    for (const t of awake) {
      const idle = now - t.lastActive
      const due = idle >= policy.idleMs || excess > 0 || (pressure && idle >= 60_000)
      if (due && deps.canSleep(t.id)) { deps.sleep(t.id); excess-- }
    }
  }
}
// Wire: setInterval(tick, 60_000) with { idleMs: 30 * 60_000, maxAwake: 12 }, exposed in Settings.
```

Pure function with injected deps, so it gets a unit test next to `navigationWarmup.test.ts`.

### 2.6 Network layer (honest version)

- **N1 — keep:** QUIC, 512 MB disk cache, hover preconnect (`tabview:preconnect`, `index.ts:3262`), first-load preconnect (`index.ts:1929`).
- **N2 — add:** enable Chromium's built-in async DNS + DoH via `app.configureHostResolver({ enableBuiltInResolver: true, secureDnsMode, secureDnsServers })` driven by the existing `dohProvider` setting. This is the supported replacement for the invalid `host-resolver-rules` switch, and the built-in resolver caches per TTL.
- **N3 — add:** speculation for the omnibox only: when the top suggestion is a history hit the user has opened ≥3 times, `session.preconnect({ numSockets: 2 })` on keystroke. No document fetch, so no side effects.

---

## Phase 3 — Five new features

Each one reuses something already in the codebase, so none starts from zero.

### F1. Revisit Diff
**Concept.** Open a page you read last week and the changed paragraphs are highlighted: price changes, edited docs, rewritten terms of service, updated release notes. No mainstream browser shows you what changed since *your* last visit.
**Architecture.** Rewind already stores readable text per URL (`rewind:add`). `watchDiff.ts` already diffs text for Watches. On `did-finish-load`, main looks up the previous rewind entry; if older than 1 h, the tab's isolated-world script receives the old text and marks changed blocks.
**Implementation.** `rewind:previous(url)` IPC → paragraph-level diff (normalize whitespace, hash paragraphs, LCS over hashes) → isolated-world `contextBridge` function wraps changed nodes in `<mark data-aihub-diff>`. Opt-out per site. Zero network.

### F2. Tab Afterlife
**Concept.** Sleeping tabs (F-2.5) cost zero memory but stay fully *searchable and previewable*: hover shows a crisp snapshot, Ctrl+K finds text inside them, and the AI can answer questions across them without waking any.
**Architecture.** Just before sleep: `wc.capturePage()` → WebP thumbnail in `~/.aihub-browser/afterlife/<tabId>.webp`; readable text → Rewind (reuses the existing capture path). Command palette queries rewind + semantic index filtered to sleeping tab URLs.
**Implementation.** Hook into the `sleep` dep of `createTabSleeper`; `nativeImage.toJPEG/…` at 40 % quality; delete on tab close. Main-thread cost is one `capturePage` (GPU readback, async).

### F3. Form Lifeboat
**Concept.** Never lose a long comment, application answer or email draft to a crash, accidental close or session timeout. Text in any `<textarea>`/contenteditable is recoverable per page for 7 days.
**Architecture.** Preload in an isolated world listens to `input` (debounced 1 s), excludes `type=password`, `autocomplete=cc-*`, `one-time-code` and fields inside `[data-sensitive]`, and sends `{origin, path, fieldKey, text}` to main. Stored encrypted with `safeStorage` (same pattern as `secretStore.ts`); never written in incognito (reuse the `handlePersistent` guard).
**Implementation.** `fieldKey` = stable hash of `form action + name/id + DOM path`. On page load with matching drafts, a small chip offers "Restore draft". Cleared on successful submit (`submit` event) or after 7 days.

### F4. Fingerprint Mirror
**Concept.** A per-site live readout of which fingerprinting surfaces the page actually read (canvas `toDataURL`/`getImageData`, `AudioContext` rendering, WebGL `readPixels`/debug renderer info, font enumeration via measureText bursts, `navigator.hardwareConcurrency`, battery) with a one-click "add noise" toggle.
**Architecture.** Main-world script injected via `wc.executeJavaScript` at `dom-ready` wraps those prototypes, counts calls and posts counts to the isolated world. Findings join the existing `security-findings` tab event.
**Implementation.** Noise mode: deterministic per-(site, session) seed adds ±1 LSB to canvas/audio reads. Off by default on sites in the adblock allowlist so banking sites don't break.

### F5. Dev-Server Cockpit
**Concept.** When the active tab is `localhost:*`, a slim bar shows the dev server's state (up, compiling, crashed), the last build error and one-click actions. Ties directly into Agent Doctor's recovery.
**Architecture.** Main polls the tab's origin with `net.fetch` HEAD at 2 s while focused; reads Next.js/Vite error overlays from the DOM; maps the port to a PID with `netstat -ano` (async `execFile`) and the PID to a working directory.
**Implementation.** Actions: reload on recover, open the failing file in the editor (`code -g file:line`), and the Doctor recipes below. The user's project folder is only touched with explicit consent per action.

---

## Phase 4 — Agent Doctor

### 4.1 Architecture

```
┌─────────────── main process ───────────────┐
│  Sensors (cheap, always on)                │
│   • loopLag: perf_hooks.monitorEventLoopDelay
│   • appMetrics: app.getAppMetrics() / 10 s │
│   • tab events: unresponsive, responsive,  │
│     render-process-gone, did-fail-load     │
│   • ai: Ollama /api/ps (already probed)    │
│   • renderer longtasks (PerformanceObserver│
│     in host renderer → IPC, batched)       │
│            │ Signal                        │
│            ▼                               │
│  Diagnosis rules (pure, unit-tested)       │
│            │ Finding {kind, target, evidence}
│            ▼                               │
│  Remedy registry                           │
│   auto:    safe + reversible  → act, toast │
│   consent: anything touching user files or │
│            closing visible work → ask      │
│            │                               │
│  Journal (ring buffer, doctor.ndjson)      │
└────────────┼───────────────────────────────┘
             ▼ IPC 'doctor:event'
     Renderer: status dot in nav bar + aihub://doctor page
```

The LLM is **not** in the healing loop. Rules decide; the model only explains findings in plain language on the Doctor page and drafts suggestions. That keeps healing deterministic, fast, and working when Ollama itself is the problem.

### 4.2 Core types and sensor loop

```ts
// src/main/doctor/types.ts
export type Severity = 'info' | 'warn' | 'critical'

export interface Signal {
  at: number
  source: 'loop' | 'process' | 'tab' | 'renderer' | 'ai' | 'devserver'
  name: string
  value: number
  target?: { tabId?: number; pid?: number; origin?: string }
}

export interface Finding {
  id: string
  kind: 'main-stall' | 'tab-hung' | 'tab-memory' | 'tab-cpu' | 'ai-models-piled' | 'devserver-down' | 'devserver-corrupt'
  severity: Severity
  target?: Signal['target']
  evidence: Signal[]
}

export interface Remedy {
  kind: Finding['kind']
  consent: 'auto' | 'ask'
  label: string
  apply(f: Finding): Promise<{ ok: boolean; detail: string }>
}
```

```ts
// src/main/doctor/sensors.ts
import { monitorEventLoopDelay } from 'perf_hooks'
import { app } from 'electron'

export function startSensors(emit: (s: Signal) => void) {
  const lag = monitorEventLoopDelay({ resolution: 20 })
  lag.enable()

  const timer = setInterval(() => {
    const now = Date.now()
    emit({ at: now, source: 'loop', name: 'p99-ms', value: lag.percentile(99) / 1e6 })
    lag.reset()
    for (const m of app.getAppMetrics()) {
      emit({ at: now, source: 'process', name: 'cpu-pct', value: m.cpu.percentCPUUsage, target: { pid: m.pid } })
      emit({ at: now, source: 'process', name: 'mem-mb', value: (m.memory.workingSetSize ?? 0) / 1024, target: { pid: m.pid } })
    }
  }, 10_000)
  timer.unref()

  return () => { clearInterval(timer); lag.disable() }
}

// Per tab, next to the existing render-process-gone handler (index.ts:1759):
//   wc.on('unresponsive', () => emit({ at: Date.now(), source: 'tab', name: 'unresponsive', value: 1, target: { tabId } }))
//   wc.on('responsive',   () => emit({ at: Date.now(), source: 'tab', name: 'unresponsive', value: 0, target: { tabId } }))
```

### 4.3 Diagnosis rules

Rules are pure functions over a sliding window, so each one gets a unit test with recorded signals.

```ts
// src/main/doctor/rules.ts
type Window = (name: string, filter?: (s: Signal) => boolean) => Signal[]

export const rules: ((w: Window, now: number) => Finding | null)[] = [
  // Main thread: p99 loop delay > 250 ms in 3 consecutive 10 s samples.
  (w) => {
    const s = w('p99-ms').slice(-3)
    return s.length === 3 && s.every(x => x.value > 250)
      ? { id: 'main-stall', kind: 'main-stall', severity: 'critical', evidence: s } : null
  },
  // Tab hung for > 8 s (Chromium fires 'unresponsive' after ~5 s of no input ack).
  (w, now) => {
    const hung = w('unresponsive').filter(s => s.value === 1 && now - s.at > 8_000)
    const last = hung.at(-1)
    return last && !w('unresponsive').some(s => s.value === 0 && s.at > last.at && s.target?.tabId === last.target?.tabId)
      ? { id: `hung-${last.target!.tabId}`, kind: 'tab-hung', severity: 'critical', target: last.target, evidence: [last] } : null
  },
  // Background renderer > 40 % CPU for 60 s.
  (w) => { /* group cpu-pct by pid, require 6 samples > 40, map pid→tab via wc.getOSProcessId() */ return null },
]
```

### 4.4 Remedies

| Finding | Remedy | Consent |
|---|---|---|
| `tab-cpu` (background) | Sleep the tab via existing sleep path (respects `tabSleepChecks`) | auto, toast with Undo (wakes tab) |
| `tab-memory` > 1.5 GB background | Same | auto |
| `tab-hung` | `wc.forcefullyCrashRenderer()` then reload — **foreground tab: ask**, background tab: auto. Form Lifeboat (F3) makes this safe for typed text | ask / auto |
| `ai-models-piled` (>1 model resident, CPU-only) | `keep_alive: 0` on all but the most recent model (logic already exists for timeouts) | auto |
| `main-stall` | Capture a 5 s inspector CPU profile (as `probe-freeze.cjs` does) into the journal; nothing auto-fixed — main-thread stalls are bugs, the profile is the bug report | auto (record only) |
| `devserver-down` | Show the Cockpit bar with "Restart dev server" | ask |
| `devserver-corrupt` (Next.js: `ENOENT …/.next/…manifest.json`, `Cannot find module './chunks/…'` in overlay) | Stop server PID → delete only `<project>/.next` → restart the project's own `dev` script | **ask, always** — it deletes a folder in the user's project |

```ts
// src/main/doctor/remedies/devServer.ts — the consent-gated recipe
export const repairNextCache: Remedy = {
  kind: 'devserver-corrupt',
  consent: 'ask',
  label: 'Clear the Next.js build cache and restart the dev server',
  async apply(f) {
    const proj = await projectForPort(f.target!.origin!)            // netstat -ano → pid → cwd
    if (!proj || !(await isNextProject(proj.cwd))) return { ok: false, detail: 'Not a Next.js project' }
    const cache = path.join(proj.cwd, '.next')
    if (path.dirname(cache) !== proj.cwd) return { ok: false, detail: 'Refusing path outside project' }
    await killTree(proj.pid)
    await fs.rm(cache, { recursive: true, force: true })            // .next is a build artefact, regenerated on start
    await spawnDetached(proj.packageManager, ['run', 'dev'], proj.cwd)
    return { ok: true, detail: `Restarted ${proj.name}` }
  },
}
```

### 4.5 User assistance without interruption

- **Status dot** in the nav bar: green / amber / red. No modals, ever. Auto remedies show a 4 s toast with Undo.
- **aihub://doctor**: live charts (main loop lag, per-tab CPU/mem), journal of findings and actions, "Explain this" button that sends a finding's evidence to the local model for a plain-language summary.
- **Context shortcuts** (suggested in the dot's popover, never auto-run): "You have 23 tabs from 3 days ago — sleep all?"; "Ollama has 3 models loaded on CPU — free 9 GB?"; on localhost tabs, the Cockpit actions.

### 4.6 Build order

1. Sensors + journal + `aihub://doctor` read-only page (observability first: it tells us whether later fixes worked).
2. Tab sleep scheduler (2.5) — the Doctor's first remedy.
3. Hung-tab and Ollama remedies.
4. Dev-Server Cockpit + Next.js recipe.
5. Renderer longtask sensor and "Explain this".

---

## Implementation priority (single list)

1. **S1** remove `no-sandbox` — 1 line, security.
2. **#1** async netsh — 1 file, removes the worst freeze in the app.
3. **#2** agents store — ~40 lines, per-message stall gone.
4. **#4/#5** store selectors — 3 components, fewer renders on every tab event.
5. **#6** delete dead switches; **N2** `configureHostResolver`.
6. **#8** automatic tab sleep — biggest memory win.
7. **#3/#10** remaining `writeJson` callers onto `createJsonStore`.
8. **#7** Rewind append log + worker compaction.
9. Agent Doctor phases 1–3.
10. **#11/#12** split `index.ts`; SQLite storage service.
11. Features F1–F5 (F2 and F3 first: they make tab sleep and hung-tab recovery lossless).
