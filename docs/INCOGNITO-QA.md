# Incognito Mode — Manual QA Checklist

Run this against a **built** app (`npm run build`, then `npm run preview`, or a packaged build).
The automated suite runs first: `npm test` and `npm run test:incognito`.

Mark each item ✅ / ❌ and note the build version. "Normal window" means any non-private window.

Useful test sites: any site that sets cookies (e.g. a news site's consent banner), a site you can sign in to, and a page with a downloadable file.

Profile location (for disk checks): `~/.aihub-browser` (Windows: `C:\Users\<you>\.aihub-browser`).

---

## A. Opening Incognito

- [ ] **Tab-strip button:** a normal window shows **New Incognito window** beside the window controls (icon only in narrow windows) and clicking it opens a private window.
- [ ] **Keyboard shortcut:** Ctrl+Shift+N (Windows/Linux) or ⌘+Shift+N (macOS) opens a new Incognito window. Try it with focus in the address bar **and** with focus inside a web page.
- [ ] **Command palette:** Ctrl+K → "New Incognito Window" opens one. The hint shows the shortcut.
- [ ] **Tab context menu:** right-click a tab → "New Incognito Window".
- [ ] **Link context menu:** right-click a link in a normal window → "Open Link in Incognito Window" opens that page in a private window.
- [ ] **Settings:** Settings → Privacy & Data → "Open Incognito Window" button.
- [ ] **External launch:** with only an Incognito window open, open a link from another app (AIHub set as default browser). It opens in a **normal** window, not the private one.

## B. Incognito window appearance

- [ ] Taskbar / Alt+Tab title reads **"AIHub Browser — Incognito"**.
- [ ] Dark neutral (Graphite) look, whatever theme normal windows use. The tab strip is darker, with a dashed divider.
- [ ] The **Incognito** badge (mask icon plus the word "Incognito") sits beside the window controls. Its tooltip and screen-reader label say you're browsing privately.
- [ ] Clicking the badge shows: "New Incognito Window", "Close This Incognito Window", and "Close All N Incognito Windows" when more than one is open.
- [ ] Glass/transparency settings don't make the private window translucent.
- [ ] The normal window has no badge and keeps its theme.

## C. New tab page

- [ ] Shows "You're browsing privately" with a working search/URL box.
- [ ] "AIHub Browser won't save" lists history, searches, AI conversations, and cookies/site data after all Incognito windows close.
- [ ] "Your activity might still be visible to" lists websites, employer/school, ISP/VPN, and the AI provider.
- [ ] "What stays on this computer" mentions downloads, explicit saves and settings.
- [ ] States that Incognito **doesn't make you anonymous**.
- [ ] "Close Incognito windows" button closes every private window.

## D. Tabs and navigation

- [ ] Ctrl+T in an Incognito window opens a tab in **that** window. Its new-tab page is the private one.
- [ ] Ctrl+L focuses the address bar. Typing a URL or search navigates normally.
- [ ] Ctrl+W closes the current tab.
- [ ] Ctrl+Shift+T reopens a tab closed **in this Incognito window** during this session. After closing and reopening Incognito, nothing from the old session can be reopened.
- [ ] Back, Forward, Reload and Stop work.
- [ ] A `target="_blank"` link opens as a new tab in the same Incognito window.
- [ ] "Open Link in New Tab" (context menu) stays in the Incognito window.
- [ ] "Open Link in New Incognito Window" (context menu inside Incognito) opens another private window, never a normal one.
- [ ] A sign-in popup (e.g. "Sign in with Google" on a third-party site) opens and completes inside the private session.
- [ ] Drag a private tab out of the strip → it becomes a new **Incognito** window.
- [ ] Right-click a private tab → "Move Tab to Window" lists **only** other Incognito windows. From a normal tab, it lists only normal windows.
- [ ] "Bring All Tabs Here" in a normal window doesn't pull tabs from Incognito windows, and vice versa.
- [ ] Ctrl+K in Incognito has no "Open a burner tab" and no "Reopen my previous session", and has "Close Incognito Windows".

## E. Cookies

- [ ] In a normal window, visit a site and accept its cookie banner. Open Incognito, visit the same site → the banner appears again.
- [ ] In Incognito, accept the banner on a new site. In a normal window, visit it → the banner is still there.
- [ ] Close **all** Incognito windows, open a new one, visit the site → the banner appears again (private cookies gone).

## F. Local storage, IndexedDB, cache, service workers

In DevTools (right-click → Inspect Element) → Application:

- [ ] In an Incognito tab, Local Storage / IndexedDB / Cache Storage / Service Workers for a site you used normally are **empty**.
- [ ] Data created in Incognito doesn't appear in the same site's normal tab.
- [ ] After closing all Incognito windows and reopening, the site's private data is gone.
- [ ] A service worker registered by a site in Incognito isn't listed for that site in a normal window.

## G. Authentication

- [ ] Sign in to a site (e.g. GitHub) in a normal window. Open it in Incognito → you are **signed out**.
- [ ] Sign in to a **different** account in Incognito. The normal window stays on the first account after a reload.
- [ ] Close all Incognito windows, open a new one, visit the site → signed out.
- [ ] The normal window is still signed in after the Incognito session ends and after an app restart.

## H. History, search history, suggestions

- [ ] Visit several pages and run a Google search in Incognito.
- [ ] History page (in a normal window) shows none of them.
- [ ] Rewind (search what you've read) finds none of them.
- [ ] Address-bar suggestions and the home search box don't suggest any Incognito URL or query.
- [ ] Morning Brief / recommendations don't reflect Incognito sites.
- [ ] Disk: open `history.json`, `rewind.json` and `browsing-brain.json` → no Incognito URLs.

## I. Downloads

- [ ] Download a PDF in Incognito. The file appears in Downloads/Documents on disk.
- [ ] The Incognito downloads panel is titled "Incognito downloads" and lists it. The Downloads page shows the note that files stay on your computer.
- [ ] A **normal** window's downloads panel/page does **not** list it.
- [ ] Close all Incognito windows → the file is **still on disk**.
- [ ] New Incognito window → its download list is empty.
- [ ] Start a large download in Incognito and close the last Incognito window mid-transfer → a confirmation appears. "Keep window open" keeps it; "Cancel downloads and close" cancels it.
- [ ] Disk: `downloads.json` has no Incognito entry.

## J. Bookmarks

- [ ] Add a bookmark from Incognito (star / Ctrl+D). It appears in the sphere in normal windows (bookmarks are explicit and persistent).
- [ ] Page Vault (in a normal window) has **no** automatic snapshot of that page.
- [ ] The bookmark's stored data has no cookies or session tokens: check `data.json`.

## K. AI features

- [ ] Open the AI panel in Incognito. It starts **empty**, even if the normal window has a conversation.
- [ ] The Incognito notice appears in the panel. With Ollama off, it says requests go to the cloud provider.
- [ ] Chat in Incognito, close the window, open the normal window's AI panel → none of the Incognito messages are there.
- [ ] "Clear chat" in Incognito doesn't clear the normal window's conversation.
- [ ] The "Memory" (site memory) button is disabled in Incognito, with an explanatory tooltip.
- [ ] Browsing in Incognito doesn't produce the automatic bottom summary card. "Summarize" still works when clicked.
- [ ] Agent Mode in Incognito: the conversation doesn't appear in a normal window's agent history after closing.
- [ ] Trading Coach on a chart in Incognito: after closing and opening the coach in a normal window, the Incognito exchange isn't remembered.
- [ ] Disk: `chat-history.json`, `agents.json`, `site-memory.json` and `trading-memory/` hold nothing from Incognito.

## L. Multiple Incognito windows

- [ ] Open two Incognito windows. Sign in to a site in window 1 → window 2 is signed in too (shared private session).
- [ ] Close window 1 → window 2 stays signed in.
- [ ] Close window 2 → a new Incognito window is signed out.

## M. Normal → Incognito and Incognito → Normal isolation

- [ ] A cookie, sign-in or local data from normal browsing is never visible in Incognito.
- [ ] A cookie, sign-in or local data from Incognito is never visible in normal browsing.
- [ ] Changing the theme in a normal window doesn't change the Incognito look. UI preferences changed inside Incognito (e.g. reader font) don't carry over to normal windows.

## N. VPN / proxy

- [ ] Turn the VPN on in a normal window, then open Incognito and visit an IP-check site → it shows the **VPN** IP.
- [ ] With Incognito open, turn the VPN on → Incognito tabs switch to the VPN IP after a reload.
- [ ] Turn the VPN off → both return to the direct IP.

## O. Restart and crash

- [ ] With a normal window and an Incognito window open, quit the app. Relaunch → only the normal window returns, with its tabs. No Incognito window or tab is restored.
- [ ] Disk: `sessions.json` has no Incognito URLs.
- [ ] Crash: with Incognito open, end the AIHub process in Task Manager. Relaunch → no Incognito window or tab is restored, and normal session restore still works.
- [ ] Disk: `~/.aihub-browser/Partitions` has **no** folder containing "incognito".

## P. DevTools, logs, telemetry

- [ ] Inspect Element works on Incognito tabs. The Application panel shows only private data.
- [ ] Run the app from a terminal and use Incognito. The console output contains no Incognito URLs. The only private-session line is the "private session ended" notice, and only if a clear step failed.
- [ ] No network requests to analytics or telemetry endpoints (the app has none). Check with a proxy tool if needed.

## Q. Closing the final Incognito window

- [ ] Close the last Incognito window with the window button → the private session ends (verify via E and G).
- [ ] Use "Close Incognito windows" from the new-tab page, the Ctrl+K palette, or the badge menu → every private window closes.
- [ ] Any sign-in popup opened from Incognito closes with the last Incognito window.
- [ ] Downloaded files are untouched.

## R. Normal browsing regression

In a normal window, confirm these still work:

- [ ] Tabs, windows, detaching and moving tabs between normal windows
- [ ] Navigation, back/forward, reload
- [ ] Bookmarks and the sphere
- [ ] History, and Rewind capture after a 5 s dwell
- [ ] Downloads list
- [ ] Search
- [ ] AI assistant with persistent chat (Ollama and OpenRouter)
- [ ] Automatic page summaries
- [ ] Settings
- [ ] Shortcuts (Ctrl+T/W/L/K/R/D/H/J/F)
- [ ] DevTools
- [ ] Session restore after restart
- [ ] Burner tabs
- [ ] Containers
- [ ] VPN
- [ ] Glass/transparency
