# Incognito Mode — Architecture and Privacy Model

AIHub Browser's Incognito windows are private at the **browser-engine level**, not only in the UI. This document explains how, what is guaranteed, and what is not.

> Incognito keeps AIHub Browser from remembering what you do in a private window. It does **not** make you anonymous. Websites, the network you are on, your employer or school, your ISP, a VPN/proxy provider and any AI provider you send a request to can still see that activity.

---

## 1. Architecture

| Layer | Normal window | Incognito window |
|---|---|---|
| Window | `BrowserWindow` + renderer UI (`createAppWindow`) | Same component, created with `{ incognito: true }` |
| Window identity | `AppWin.incognito = false` | `AppWin.incognito = true` — set by the main process only |
| Tab content | `BrowserView` on `persist:main` (or `persist:container-*`) | `BrowserView` on the in-memory partition `aihub-incognito-<generation>` |
| OAuth / scripted popups | Same partition as the opening tab | Same private partition; closed when the private session ends |
| Window UI (`localStorage`) | Shared app storage on `defaultSession` | Copy-on-write in-memory overlay; reads shared prefs, never writes them |
| Persistence IPC | Allowed | Refused in the main process (`handlePersistent`) |

Key files:

- `src/main/incognito.ts` — session lifecycle manager (no Electron import; unit-tested with a fake session), the list of blocked persistence channels, and the cross-window move rule.
- `src/main/index.ts` — window creation, tab-session routing, the IPC guards, downloads, proxy, context menus, shortcuts.
- `src/preload/index.ts` — `electronAPI.incognito` (open/close/status/menu plus a presentation-only `isIncognito` flag).
- `src/renderer/src/services/privateStorage.ts` — the copy-on-write `localStorage` overlay.
- `src/renderer/src/services/incognitoMode.ts` + `src/renderer/src/incognitoBoot.ts` — boots a private window before any app module runs.
- `src/renderer/src/components/homepage/IncognitoHomePage.tsx` — the private new-tab page.

## 2. Browser / session implementation

The app runs on Electron 34 (Chromium 132). Electron creates an **in-memory StoragePartition** for any partition name without the `persist:` prefix, which is Chromium's off-the-record storage backend.

- **One private session is shared by every open Incognito window**, like Chrome's single off-the-record profile. Signing in inside one Incognito window is visible in the others. It is never visible to a normal window.
- The partition name includes a **generation number**. When the last Incognito window closes, the manager clears the session and moves to a new generation. The next Incognito window then gets a partition that has never existed before. Electron has no API to free a `Session` object, so the new generation guarantees a fresh start even if a clear step failed.
- The manager **refuses any partition that reports `isPersistent() === true`**, and window creation fails rather than falling back to the normal jar.
- The private session is configured by the same `configureContentSession` as every other jar: user agent, client hints, ad/tracker filter, focus-mode rules and permission policy. A private session that behaved differently would be easy to fingerprint.
- Every privacy decision reads `AppWin.incognito`, which only the main process writes. The renderer's `isIncognito` flag comes from a command-line switch (`--aihub-incognito-window`) that main adds when it creates the window. The UI uses it for presentation only; **main never reads it back**.

### Decision: shared vs per-window private session

One session shared by all Incognito windows was chosen over one session per window:

- It matches Chrome, Edge and Firefox, so users' expectations hold (a sign-in in one private window works in another).
- It gives a single, easy-to-reason-about lifecycle: the data lives until the last private window closes.
- The existing **burner tab** feature (Ctrl+K → "Open a burner tab") already offers per-tab throwaway sessions for anyone who wants stricter separation.

## 3. Storage isolation

In an Incognito window, all of the following live only in the in-memory partition:

- cookies (including `HttpOnly` sign-in cookies)
- `localStorage`, `sessionStorage` and IndexedDB
- Cache Storage, service workers, WebSQL and file systems
- the HTTP cache, HTTP auth cache, host-resolver cache and code cache
- network connections

**Window UI storage.** The app's own UI runs on `defaultSession` in every window, so all windows share one `localStorage`. Some features write browsing activity there (Focus Mode, for example, records seconds per host and the last URL for each host). In an Incognito window, `window.localStorage` is replaced before any app module evaluates with an overlay that:

- reads through to the real storage, so themes, extension toggles and other preferences work
- keeps writes, removals and `clear()` in memory for that window only

If the engine ever refused the swap, the private new-tab page says so instead of claiming isolation.

**Tab movement.** Tabs cannot move between normal and Incognito windows. `window:sendTabTo` and `windows:mergeAllInto` check `canMoveBetweenWindows` in main, and `windows:list` only lists windows in the caller's own mode. "Move Tab to New Window" (including dragging a tab out of the window) keeps the source window's mode.

**Raw webContents access.** `webview:execScript` and `webview:capture` resolve a `webContents` id only among the sender's own tab views. No window can script or capture another window's page, in either direction.

## 4. Cookie isolation

- Normal cookies are never sent from Incognito, and Incognito cookies never reach the normal jar. They are separate Chromium partitions; nothing copies cookies between them.
- When the last Incognito window closes, `clearStorageData()` removes every private cookie, and the partition is retired.
- Main-process fetches made on behalf of a window (`pdf:extract`, preconnect) use **that window's** session: `tabSessionFor(ctx)`.

## 5. History behavior

These channels are registered through `handlePersistent()`. It refuses them for private windows **and for any sender that is not a known app window**:

| Channel | What it would have persisted | Private result |
|---|---|---|
| `history:add` | browsing history + AI brain visit profile | `false` |
| `rewind:add` | page text + semantic embeddings | `{ ok: false, private: true }` |
| `session:save` | crash/restart recovery | `null` |
| `session:getLast` / `session:getPrevious` | (read) normal session into a private window | `null` |
| `chat:save` / `chat:load` / `chat:clear` | AI assistant conversation | not saved / `[]` / normal chat left untouched |
| `agents:saveConversation` | agent transcript archive | `false` |
| `siteMemory:set` | per-origin AI memory (the model can write it) | refused |
| `trading:saveMemory` | Trading Coach per-symbol memory | not saved |

Also:

- `favicon:get` / `favicon:getMany` never write the host-keyed on-disk favicon cache for private windows.
- `vault:capture` ignores automatic (`origin: 'auto'`) captures from private windows. The automatic copy taken on bookmarking would otherwise archive a signed-in private page.
- The renderer does not even send private URLs for history, Rewind or session restore.
- Search history and address-bar suggestions: the app has no separate search-history store. Searches are navigations, so they go through `history:add` and are refused. Suggestions read bookmarks and existing history, and Incognito adds to neither.

`incognito.test.ts` reads `src/main/index.ts` and fails if any of these channels is registered with a plain `ipcMain.handle`.

## 6. Download behavior

- Files download to the normal Downloads folder (sorted into sub-folders if that setting is on). **Files are never deleted by Incognito.**
- The **record** of a private download is kept in memory by the incognito manager, never in `downloads.json`. It is sent only to Incognito windows. Normal windows never see it, and private windows never see the persistent list.
- Closing the last Incognito window clears the private download list. Downloads still in progress are cancelled, because their session is being wiped. A confirmation dialog appears first, and the user can keep the window open instead.
- A transfer cancelled by the session ending can still report "done" afterwards. That late event is dropped, so it can't reappear in the next private session.

## 7. AI feature behavior

- **AI assistant:** starts empty in a private window. The conversation lives in renderer memory, is never written to `chat-history.json`, and "Clear chat" there cannot erase the normal conversation. A notice in the panel says so. It also says messages still go to the configured provider, which may be a cloud one.
- **Automatic page analysis** (the background 3-bullet summary) is **off** in Incognito. It would send private page text to the AI provider without the user asking. Summarize, Attach Page and questions still work when the user asks.
- **Rewind** capture, **site memory** and **agent/Trading Coach** memory are not written (see §5).
- **Bookmarks, notes, Recall, Obsidian clips, watches and workspaces** are explicit "save this" actions. As with bookmarks in Chrome's Incognito, they are allowed and persist. The private new-tab page lists them under "What stays on this computer".
- **Telemetry:** the app has no analytics, telemetry or crash-reporting SDK. Main-process logs never include URLs. The only private-session log line is `[aihub] private session ended; incomplete clear steps: …`, and it names clear steps, never sites.

## 8. Security considerations

- **Trust boundary:** the renderer is never trusted to say it is private. Every guard derives privacy from the `AppWin` entry that main created. Unknown senders are refused persistence (fail closed).
- **VPN / proxy:** the live private session is included in `trafficSessions()`. A private session created while a proxy is active gets the proxy applied at creation, so Incognito traffic cannot bypass the VPN.
- **Ad-block statistics** from private tabs are counted separately and reset when the session ends. The global tally shown in Settings would otherwise list trackers seen on private pages.
- **External links** (the OS opening a URL in AIHub) always go to a normal window, never a private one.
- **App-global dialogs** (`mainWindow`) prefer a normal window.
- **Transparency / glass:** private windows keep a solid background.

## 9. Session lifecycle

```
Normal browser
   │  Ctrl/Cmd+Shift+N · Ctrl+K "New Incognito Window" · tab menu · link menu · Settings
   ▼
incognito.acquire(windowId) ── first window? → create aihub-incognito-<n>
   │                                           assert !isPersistent()
   │                                           configureContentSession + proxy
   ├─ Incognito window(s): tabs, popups, downloads, cookies, storage — all in memory
   │
   ▼  window closes → incognito.release(windowId)
   other Incognito windows open? ── yes → session kept
   │ no
   ▼
endSession():
   current = null (next window gets generation n+1 immediately)
   close tracked private popups · cancel private downloads · drop private download list
   clearStorageData · clearCache · clearAuthCache · clearHostResolverCache
   clearCodeCaches · closeAllConnections
   reset private ad-block stats
```

Crash and restart: private windows and tabs are never written to `sessions.json`, and only a normal window is created at launch. Nothing private can be restored. If the app crashes, the in-memory partition dies with the process.

## 10. Known limitations

Stated honestly:

1. **Not anonymity.** IP address, DNS lookups (unless encrypted DNS is on), and traffic visible to networks, ISPs, employers, VPN/proxy providers and websites are unaffected.
2. **Downloaded files remain on disk** and may appear in OS "recent files" lists.
3. **Explicit saves persist:** bookmarks, notes, Recall items, Obsidian clips, watches, workspaces, "Save Page As", screenshots and recordings.
4. **Cloud AI:** anything the user sends to a cloud AI provider leaves the machine under that provider's policy.
5. **Window UI preferences** kept in `localStorage` and changed from a private window (for example reader font or VPN profiles) last only until that window closes. Settings saved through the main process do persist.
6. **Memory:** Electron cannot free a `Session` object, so each ended private generation keeps a small, emptied session object until the app quits. Its data is cleared.
7. **DevTools** may be opened on private tabs. Private partition data stays in memory, and the end-to-end profile scan found no private data on disk. DevTools UI preferences themselves belong to Electron, and nothing sensitive should be typed into the DevTools console.
8. **OS-level artefacts** outside the browser's control: swap/hibernation files, OS DNS cache, clipboard history, screenshots taken by the OS.
9. **Download prompt when closing several Incognito windows at once** ("Close All Incognito Windows"): the cancel-downloads confirmation is shown when the window being closed is the last registered private window. Windows closed in the same instant can unregister after the check, so the prompt may not appear. The downloads are still cancelled and their finished files still kept.
10. **Google OAuth / Gmail / Drive integration** runs through the system browser and the app's own token store, not a tab session. Connecting Google from an Incognito window connects the app, not the private session.

## 11. Testing strategy

- **Unit tests (Vitest)**
  - `src/main/incognito.test.ts`: partition naming and collision safety, refusal of persistent sessions, shared session across windows, survival while any window remains, full wipe on the last close, a new generation after, no reuse of a session mid-teardown, reporting of failed clear steps, popup disposal, in-memory download list with cancel on end, cross-window move rule, and **static wiring checks** that every persistence channel is guarded and tabs route through the private session.
  - `src/renderer/src/services/privateStorage.test.ts`: copy-on-write semantics, property access, `clear`/`remove` shadowing, and swapping `window.localStorage`.
  - `src/shared/windowRole.test.ts`: private windows never own session restore.
- **End-to-end (real Electron):** `npm run build && npm run test:incognito` (`scripts/test-incognito-e2e.mjs`). It uses an isolated profile and a local test site. It covers:
  - cookies, sign-in, localStorage, IndexedDB, Cache Storage, service workers and the HTTP cache, in both directions
  - host-UI storage overlay
  - private new-tab search, `target=_blank`, Ctrl+T and Ctrl+Shift+N
  - IPC spoofing from a private renderer, cross-window tab moves and scripting
  - downloads
  - multiple windows and survival of the first close
  - wipe on the last close
  - history and Rewind
  - on-disk JSON stores and partition directories
  - a full-profile byte scan for private markers
  - restart: no private window or tab restored, while normal cookies and normal session restore still work
- **Manual QA:** `docs/INCOGNITO-QA.md`.
