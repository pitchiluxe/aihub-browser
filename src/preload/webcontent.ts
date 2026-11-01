import { webFrame, ipcRenderer } from 'electron'

// Isolated-world listeners expose no IPC capability to page scripts.
if (process.isMainFrame) {
  let dirtyReported = false
  document.addEventListener('input', event => {
    if (!event.isTrusted || dirtyReported) return
    const target = event.target
    if (!(target instanceof Element) || !target.closest('input,textarea,select,[contenteditable="true"]')) return
    dirtyReported = true
    ipcRenderer.send('tab:dirty')
  }, { passive: true, capture: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  let anchor: HTMLAnchorElement | null = null
  let lastX = 0, lastY = 0, lastTime = 0
  let velocity = 0
  const cancel = () => { clearTimeout(timer); anchor = null }
  document.addEventListener('pointermove', event => {
    if (!event.isTrusted || document.hidden) return
    const now = performance.now()
    const elapsed = now - lastTime
    if (elapsed > 0) velocity = Math.hypot(event.clientX - lastX, event.clientY - lastY) / elapsed
    lastX = event.clientX; lastY = event.clientY; lastTime = now
    const next = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
    if (next === anchor) return
    cancel()
    if (!next || next.hasAttribute('download') || next.relList.contains('noreferrer')) return
    anchor = next
    const href = next.href
    timer = setTimeout(() => {
      if (anchor !== next || next.href !== href || document.hidden || !next.isConnected || velocity > 1.5) return
      ipcRenderer.send('navigation:hover', href)
    }, velocity > 0.5 ? 400 : 200)
  }, { passive: true })
  document.addEventListener('scroll', cancel, { passive: true, capture: true })
  document.addEventListener('pointerout', event => { if (!event.relatedTarget) cancel() }, { passive: true })
  document.addEventListener('visibilitychange', cancel)
  window.addEventListener('pagehide', cancel, { once: true })
}

// ── Web-content preload: restore the browser surface Chrome exposes ─────────
//
// This preload is attached to SITE content (tab BrowserViews and OAuth popup
// windows) — never to the app's own UI, which uses ../preload/index.ts. It
// exposes no IPC and no Node: its single job is to make the page see the same
// `window.chrome` object a real Chrome tab sees.
//
// Why it exists (measured, 2026-08-05, against live accounts.google.com):
//   Chrome  → window.chrome = { loadTimes, csi, app }
//   Electron→ window.chrome = {}          ← empty object, every version
//
// Google's sign-in gate reads that surface. With the empty object, entering an
// email address at accounts.google.com redirects to /v3/signin/rejected —
// "This browser or app may not be secure". With these three members restored,
// the same flow proceeds normally (an unknown address gets the ordinary
// "Couldn't find your Google Account" instead of the rejection). Verified on
// both Chromium 132 (Electron 34) and Chromium 150 (Electron 43), so it is a
// property of Electron itself, not of the engine version — upgrading Electron
// does NOT remove the need for this.
//
// `chrome.loadTimes()` and `chrome.csi()` are deprecated Chrome-only timing
// APIs; `chrome.app` is the vestige of the Chrome Apps platform. No real page
// depends on their values, only on their presence — so the values below are
// computed from the standard Performance Timeline the page could read anyway.
// Nothing here fakes an identity the browser doesn't have: the UA, the client
// hints and navigator.userAgentData all report this app's true Chromium build
// (see CHROME_UA in src/main/index.ts). Claiming a NEWER Chrome than the engine
// actually is gets rejected again — consistency is what the gate checks.

// Runs in the page's MAIN world. A preload with contextIsolation on lives in a
// separate world whose globals the page never sees, so assigning window.chrome
// here would be invisible to site scripts; webFrame.executeJavaScript is the
// supported way across that boundary. It runs before the document's own
// scripts, so detection code always observes the completed surface.
const CHROME_SURFACE = `(() => {
  // Name the functions so Function.prototype.toString and fn.name read like
  // Chrome's own bindings rather than anonymous arrow functions.
  const named = (fn, name) => { Object.defineProperty(fn, 'name', { value: name }); return fn }

  const loadTimes = named(function loadTimes() {
    const t = performance.timing
    const nav = performance.getEntriesByType('navigation')[0]
    const secs = (ms) => ms / 1000
    return {
      requestTime: secs(t.requestStart),
      startLoadTime: secs(t.requestStart),
      commitLoadTime: secs(t.responseStart),
      finishDocumentLoadTime: secs(t.domContentLoadedEventEnd),
      finishLoadTime: secs(t.loadEventEnd),
      firstPaintTime: secs(t.responseEnd),
      firstPaintAfterLoadTime: 0,
      navigationType: nav && nav.type === 'reload' ? 'Reload' : 'Other',
      wasFetchedViaSpdy: !!(nav && nav.nextHopProtocol === 'h2'),
      wasNpnNegotiated: !!(nav && nav.nextHopProtocol),
      npnNegotiatedProtocol: (nav && nav.nextHopProtocol) || 'unknown',
      wasAlternateProtocolAvailable: false,
      connectionInfo: (nav && nav.nextHopProtocol) || 'unknown',
    }
  }, 'loadTimes')

  const csi = named(function csi() {
    const t = performance.timing
    return {
      startE: t.navigationStart,
      onloadT: t.domContentLoadedEventEnd,
      pageT: Date.now() - t.navigationStart,
      tran: 15,
    }
  }, 'csi')

  // Shape mirrors Chrome's chrome.app for a page that is not an installed app.
  const app = {
    isInstalled: false,
    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
    getDetails: named(function getDetails() { return null }, 'getDetails'),
    getIsInstalled: named(function getIsInstalled() { return false }, 'getIsInstalled'),
    runningState: named(function runningState() { return 'cannot_run' }, 'runningState'),
  }

  const chrome = window.chrome || {}
  for (const [key, value] of [['loadTimes', loadTimes], ['csi', csi], ['app', app]]) {
    // Skip anything the engine already provides — never clobber a real binding.
    if (key in chrome) continue
    Object.defineProperty(chrome, key, {
      value, writable: true, enumerable: true, configurable: true,
    })
  }
  window.chrome = chrome
})()`

try {
  webFrame.executeJavaScript(CHROME_SURFACE)
} catch {
  // A frame that refuses script execution (a sandboxed or already-torn-down
  // document) is not worth failing the page load over — the site simply sees
  // the surface Electron gave it.
}
