// End-to-end privacy test for Incognito windows, against the REAL built app.
//
//   npm run build && npm run test:incognito
//
// Launches out/ in Electron with an isolated profile (USERPROFILE/HOME point at
// a temp dir — see the userData note in src/main/index.ts), serves a local site
// that sets cookies, signs in, writes localStorage / IndexedDB / Cache Storage,
// registers a service worker and offers a download, and then checks — through
// the pages themselves and through the main process — that nothing crosses
// between normal and private browsing, that the private session is wiped when
// the last Incognito window closes, and that nothing private survives a restart.
//
// Every value a private page produces carries MARK. After the app quits, the
// whole profile directory is scanned for MARK as a final, feature-agnostic net.

import { _electron } from 'playwright-core'
import http from 'http'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'

const REPO = process.cwd()
const ELECTRON = process.platform === 'win32'
  ? path.join(REPO, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin'
    ? path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : path.join(REPO, 'node_modules/electron/dist/electron')

const MARK = `privmark${crypto.randomBytes(5).toString('hex')}`
const NORMAL = `normalmark${crypto.randomBytes(5).toString('hex')}`
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aihub-incognito-e2e-'))
const DOWNLOADS = path.join(HOME, 'Downloads-e2e')
fs.mkdirSync(DOWNLOADS, { recursive: true })

// ── Tiny reporter ──────────────────────────────────────────────────────────
const results = []
function check(area, name, ok, detail = '') {
  results.push({ area, name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${area}] ${name}${!ok && detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function until(fn, { timeout = 20000, interval = 150, label = 'condition' } = {}) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeout) {
    try { last = await fn(); if (last) return last } catch (e) { last = e }
    await sleep(interval)
  }
  throw new Error(`Timed out waiting for ${label}${last instanceof Error ? `: ${last.message}` : ''}`)
}

// ── Local test site ────────────────────────────────────────────────────────
let cacheHits = 0
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1')
  const tag = u.searchParams.get('tag') || ''
  const html = (body, headers = {}) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...headers })
    res.end(`<!doctype html><meta charset="utf-8"><title>${tag || 'e2e'}</title><body>${body}</body>`)
  }
  switch (u.pathname) {
    case '/set': {
      // Cookie + sign-in cookie + localStorage + IndexedDB + Cache Storage + SW.
      const v = u.searchParams.get('v') || ''
      html(`set ${tag}
        <a id="blank" target="_blank" href="/page?tag=${tag}-child">child tab</a>
        <script>
          localStorage.setItem('e2e-ls', '${v}');
          const r = indexedDB.open('e2e', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('kv');
          r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put('${v}', 'k'); tx.oncomplete = () => { document.title = 'ready-${tag}' } };
          caches.open('e2e').then(c => c.put('/cached-entry', new Response('${v}')));
          navigator.serviceWorker && navigator.serviceWorker.register('/sw.js').catch(() => {});
        </script>`, {
        'Set-Cookie': [`e2e_cookie=${v}; Path=/; Max-Age=86400`, `auth_session=${v}; Path=/; HttpOnly; Max-Age=86400`],
      })
      return
    }
    case '/page':
      html(`page ${tag}<a id="blank" target="_blank" href="/page?tag=${tag}-child">child</a>`)
      return
    case '/whoami':
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
      res.end(req.headers.cookie || '')
      return
    case '/cacheable':
      cacheHits++
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=3600' })
      res.end(`cached-${u.searchParams.get('id')}`)
      return
    case '/sw.js':
      res.writeHead(200, { 'Content-Type': 'application/javascript' })
      res.end("self.addEventListener('install', () => self.skipWaiting());")
      return
    case '/file':
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${u.searchParams.get('name')}"`,
      })
      res.end(`download body ${MARK}`)
      return
    default:
      res.writeHead(404); res.end()
  }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const ORIGIN = `http://127.0.0.1:${server.address().port}`

// ── App driving ────────────────────────────────────────────────────────────
function launchApp() {
  const env = { ...process.env, USERPROFILE: HOME, HOME, NODE_ENV: 'production' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  return _electron.launch({ executablePath: ELECTRON, args: [REPO], cwd: REPO, env, timeout: 60000 })
}

const listWindows = (app) => app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows().filter(w => !w.isDestroyed()).map(w => ({
    wcId: w.webContents.id, title: w.getTitle(), url: w.webContents.getURL(),
  })))
const appWindows = async (app) => (await listWindows(app)).filter(w => /index\.html/.test(w.url))
const isIncognitoTitle = (w) => w.title === 'AIHub Browser — Incognito'

async function hostPage(app, incognito, excludeUrls = []) {
  return until(async () => {
    for (const p of app.windows()) {
      if (!/index\.html/.test(p.url())) continue
      try {
        const flag = await p.evaluate(() => !!window.electronAPI?.incognito?.isIncognito)
        const id = await p.evaluate(() => window.__e2eId || (window.__e2eId = Math.random().toString(36).slice(2)))
        if (flag === incognito && !excludeUrls.includes(id)) return { page: p, id }
      } catch {}
    }
    return null
  }, { label: `${incognito ? 'incognito' : 'normal'} host page` })
}

const openTab = (app, wcId, url) =>
  app.evaluate(({ webContents }, [id, u]) => { webContents.fromId(id).send('open-in-new-tab', u) }, [wcId, url])

const findTab = (app, prefix) => app.evaluate(({ webContents }, p) => {
  const wc = webContents.getAllWebContents().find(w => w.getType() === 'browserView' && !w.isDestroyed() && w.getURL().startsWith(p) && !w.isLoading())
  return wc ? { id: wc.id, persistent: wc.session.isPersistent(), storagePath: wc.session.storagePath } : null
}, prefix)

const waitTab = (app, prefix) => until(() => findTab(app, prefix), { label: `tab ${prefix}` })

const inTab = (app, wcId, script) =>
  app.evaluate(({ webContents }, [id, s]) => webContents.fromId(id).executeJavaScript(s, true), [wcId, script])

const tabsAll = (app) => app.evaluate(({ webContents }) => webContents.getAllWebContents()
  .filter(w => w.getType() === 'browserView' && !w.isDestroyed())
  .map(w => ({ id: w.id, url: w.getURL(), persistent: w.session.isPersistent() })))

const READ_IDB = `new Promise(res => { const r = indexedDB.open('e2e', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => { try { const g = r.result.transaction('kv').objectStore('kv').get('k'); g.onsuccess = () => res(g.result ?? null); g.onerror = () => res(null) } catch { res(null) } };
  r.onerror = () => res(null) })`
const READ_CACHE = `caches.match('/cached-entry').then(r => r ? r.text() : null)`
const READ_SW = `navigator.serviceWorker.getRegistrations().then(r => r.length)`
const WHOAMI = `fetch('/whoami', { cache: 'no-store' }).then(r => r.text())`

async function snapshot(app, wcId) {
  return {
    cookie: await inTab(app, wcId, WHOAMI),
    ls: await inTab(app, wcId, `localStorage.getItem('e2e-ls')`),
    idb: await inTab(app, wcId, READ_IDB),
    cache: await inTab(app, wcId, READ_CACHE),
    sw: await inTab(app, wcId, READ_SW),
  }
}

function scanForMark(dir) {
  const hits = []
  const needles = [Buffer.from(MARK, 'latin1'), Buffer.from(MARK, 'utf16le')]
  const walk = (d) => {
    let entries = []
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (p.startsWith(DOWNLOADS)) continue // the user's downloaded FILE is meant to stay
      if (e.isDirectory()) { walk(p); continue }
      if (e.name.includes(MARK)) { hits.push(p); continue }
      try {
        const st = fs.statSync(p)
        if (st.size > 256 * 1024 * 1024) continue
        const buf = fs.readFileSync(p)
        if (needles.some(n => buf.includes(n))) hits.push(p)
      } catch {}
    }
  }
  walk(dir)
  return hits
}

let app
try {
  // ════════════════════════════════════════════════════════════════════════
  // Run 1
  // ════════════════════════════════════════════════════════════════════════
  app = await launchApp()
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
  const norm = (p) => path.resolve(p).toLowerCase()
  if (!norm(userData).startsWith(norm(HOME))) throw new Error(`Refusing to run: userData ${userData} is not inside the temp profile`)
  await app.evaluate(({ app: a }, dir) => a.setPath('downloads', dir), DOWNLOADS)

  const normalHost = await hostPage(app, false)
  await normalHost.page.waitForSelector('.ds-tabbar', { timeout: 30000 })
  const normalWin = (await appWindows(app)).find(w => !isIncognitoTitle(w))

  // Normal browsing: cookie, sign-in, storage.
  await openTab(app, normalWin.wcId, `${ORIGIN}/set?tag=n1&v=${NORMAL}`)
  const n1 = await waitTab(app, `${ORIGIN}/set?tag=n1`)
  await until(() => inTab(app, n1.id, `document.title === 'ready-n1'`), { label: 'normal storage written' })
  await sleep(500)
  check('Session Isolation', 'normal tabs use the persistent session', n1.persistent === true && !!n1.storagePath)
  const normalBefore = await snapshot(app, n1.id)
  check('Cookies', 'normal site cookie set in normal window', normalBefore.cookie.includes(`e2e_cookie=${NORMAL}`), normalBefore.cookie)
  // Host-UI localStorage is shared by every window; seed a value to prove the
  // Incognito overlay cannot overwrite it.
  await normalHost.page.evaluate(v => localStorage.setItem('e2e-host', v), NORMAL)

  // ── Open Incognito via the renderer API ─────────────────────────────────
  await normalHost.page.evaluate(() => window.electronAPI.incognito.openWindow())
  const incogWin1 = await until(async () => (await appWindows(app)).find(isIncognitoTitle), { label: 'incognito window' })
  const incogHost = await hostPage(app, true)
  await incogHost.page.waitForSelector('.ds-tabbar', { timeout: 30000 })
  check('UI', 'Incognito window is titled as private', incogWin1.title === 'AIHub Browser — Incognito')
  check('UI', 'private new-tab page explains private browsing',
    await incogHost.page.locator('text=You\'re browsing privately').first().isVisible().catch(() => false))
  check('UI', 'Incognito badge is shown', await incogHost.page.locator('.ds-incognito-badge').isVisible().catch(() => false))
  check('UI', 'normal window has no Incognito badge', !(await normalHost.page.locator('.ds-incognito-badge').count()))

  // Navigate from the private new-tab page's own search box (real UI path).
  await incogHost.page.locator('main input').first().fill(`${ORIGIN}/page?tag=i1-${MARK}`)
  await incogHost.page.locator('main input').first().press('Enter')
  const i1 = await waitTab(app, `${ORIGIN}/page?tag=i1-${MARK}`)
  check('Session Isolation', 'Incognito tab session is in-memory (isPersistent=false, no storagePath)', i1.persistent === false && i1.storagePath === null)
  const privateView = await snapshot(app, i1.id)
  check('Cookies', 'normal cookies are not visible in Incognito', !privateView.cookie.includes(NORMAL), privateView.cookie)
  check('Authentication', 'normal sign-in (HttpOnly) is not sent from Incognito', !privateView.cookie.includes('auth_session'), privateView.cookie)
  check('Local Storage', 'normal localStorage is not visible in Incognito', privateView.ls === null, String(privateView.ls))
  check('IndexedDB', 'normal IndexedDB is not visible in Incognito', privateView.idb === null, String(privateView.idb))
  check('Cache', 'normal Cache Storage is not visible in Incognito', privateView.cache === null, String(privateView.cache))
  check('Cache', 'normal service worker is not registered in Incognito', privateView.sw === 0, String(privateView.sw))

  // Private browsing writes its own state.
  await openTab(app, incogWin1.wcId, `${ORIGIN}/set?tag=i2-${MARK}&v=${MARK}`)
  const i2 = await waitTab(app, `${ORIGIN}/set?tag=i2-${MARK}`)
  await until(() => inTab(app, i2.id, `document.title === 'ready-i2-${MARK}'`), { label: 'private storage written' })
  await sleep(500)
  const privateAfter = await snapshot(app, i2.id)
  check('Cookies', 'Incognito cookie is set inside Incognito', privateAfter.cookie.includes(`e2e_cookie=${MARK}`), privateAfter.cookie)
  check('Authentication', 'Incognito sign-in works inside Incognito', privateAfter.cookie.includes(`auth_session=${MARK}`))
  check('Session Isolation', 'every Incognito tab shares the private session', (await snapshot(app, i1.id)).cookie.includes(MARK))

  const normalAfter = await snapshot(app, n1.id)
  check('Cookies', 'Incognito cookie does not appear in the normal window', !normalAfter.cookie.includes(MARK), normalAfter.cookie)
  check('Authentication', 'normal sign-in is unchanged by the Incognito sign-in', normalAfter.cookie.includes(`auth_session=${NORMAL}`), normalAfter.cookie)
  check('Local Storage', 'normal localStorage keeps its own value', normalAfter.ls === NORMAL, String(normalAfter.ls))
  check('IndexedDB', 'normal IndexedDB keeps its own value', normalAfter.idb === NORMAL, String(normalAfter.idb))
  check('Cache', 'normal Cache Storage keeps its own value', normalAfter.cache === NORMAL, String(normalAfter.cache))

  // HTTP cache is partitioned too. The URL is deliberately NOT marked private:
  // the normal tab requests it as well (that is the check), so the normal
  // cache legitimately stores it — a MARK here would trip the final disk scan
  // on data the normal window fetched itself.
  const cacheUrl = `/cacheable?id=shared-${crypto.randomBytes(4).toString('hex')}`
  await inTab(app, i2.id, `fetch('${cacheUrl}').then(r => r.text())`)
  await inTab(app, i2.id, `fetch('${cacheUrl}').then(r => r.text())`)
  const hitsAfterPrivate = cacheHits
  await inTab(app, n1.id, `fetch('${cacheUrl}').then(r => r.text())`)
  check('Cache', 'normal window does not reuse the Incognito HTTP cache', cacheHits === hitsAfterPrivate + 1, `hits ${hitsAfterPrivate} → ${cacheHits}`)

  // Host-UI storage overlay: the private window's UI cannot write shared storage.
  const hostSeen = await incogHost.page.evaluate(() => localStorage.getItem('e2e-host'))
  await incogHost.page.evaluate(v => { localStorage.setItem('e2e-host', v); localStorage.setItem('e2e-host-private', v) }, MARK)
  check('Local Storage', 'Incognito UI reads app preferences from normal storage', hostSeen === NORMAL, String(hostSeen))
  check('Local Storage', 'Incognito UI writes never reach shared app storage',
    (await normalHost.page.evaluate(() => [localStorage.getItem('e2e-host'), localStorage.getItem('e2e-host-private')]))
      .every((v, i) => (i === 0 ? v === NORMAL : v === null)))

  // Links opened in a new tab stay private.
  await inTab(app, i1.id, `document.getElementById('blank').click()`)
  const child = await waitTab(app, `${ORIGIN}/page?tag=i1-${MARK}-child`)
  check('Session Isolation', 'target=_blank link from Incognito opens in the private session', child.persistent === false)
  // Ctrl+T → new private tab (same code path as the keyboard, via main).
  const tabsBefore = await incogHost.page.locator('.ds-tab').count()
  await app.evaluate(({ webContents }, id) => webContents.fromId(id).send('app-shortcut', 'new-tab'), incogWin1.wcId)
  await until(async () => (await incogHost.page.locator('.ds-tab').count()) === tabsBefore + 1, { label: 'Ctrl+T tab' })
  check('UI', 'Ctrl+T opens a tab in the Incognito window', true)

  // ── Main-process enforcement: a private renderer calling persistence APIs directly ──
  const spoofUrl = `https://spoof-${MARK}.example/`
  const spoof = await incogHost.page.evaluate(async ({ url, mark }) => {
    const api = window.electronAPI
    return {
      history: await api.history.add({ url, title: mark }),
      session: await api.session.save([{ url, title: mark, pageType: 'browser' }], 0),
      getLast: await api.session.getLast(),
      chatSave: await api.chat.save([{ role: 'user', content: mark }]),
      chatLoad: await api.chat.load(),
      rewind: await api.rewind.add({ url, title: mark, text: mark.repeat(40) }),
      siteMemory: await api.siteMemory.set(url, mark, mark),
      trading: await api.trading.saveMemory(mark, [{ role: 'user', content: mark }]),
      agent: await api.agents.saveConversation({ id: mark, title: mark, messages: [], updatedAt: Date.now() }),
    }
  }, { url: spoofUrl, mark: MARK })
  check('History', 'history:add from an Incognito renderer is refused by main', spoof.history === false)
  check('Crash Recovery', 'session:save from an Incognito renderer is refused by main', spoof.session === null)
  check('Crash Recovery', 'Incognito window does not receive the saved normal session', spoof.getLast === null)
  check('AI History', 'chat:save from Incognito is refused; Incognito chat starts empty', spoof.chatSave === false && Array.isArray(spoof.chatLoad) && spoof.chatLoad.length === 0)
  check('History', 'rewind:add (page text + embeddings) refused from Incognito', spoof.rewind?.ok === false)
  check('AI History', 'site memory refused from Incognito', spoof.siteMemory?.ok === false)
  check('AI History', 'Trading Coach memory not written from Incognito', spoof.trading?.private === true)
  check('AI History', 'agent conversation not archived from Incognito', spoof.agent === false)

  const n1Wc = n1.id
  const cross = await incogHost.page.evaluate(async ({ normalId, wcId, url }) => {
    const api = window.electronAPI
    const list = await api.window.list()
    return {
      listed: list.map(w => w.id),
      send: await api.window.sendTabTo(normalId, { url }),
      exec: await api.webview.execScript(wcId, 'document.cookie'),
      capture: await api.webview.capture(wcId),
    }
  }, { normalId: normalWin.wcId, wcId: n1Wc, url: `${ORIGIN}/page?tag=moved-${MARK}` })
  check('Session Isolation', 'Incognito window list never offers normal windows', !cross.listed.includes(normalWin.wcId))
  check('Session Isolation', 'moving a private tab into a normal window is refused', cross.send?.success === false)
  check('Session Isolation', 'private window cannot script a normal tab by id', cross.exec?.ok === false)
  check('Session Isolation', 'private window cannot capture a normal tab by id', cross.capture === null)
  const normalCross = await normalHost.page.evaluate(({ wcId }) => window.electronAPI.webview.execScript(wcId, 'document.cookie'), { wcId: i2.id })
  check('Session Isolation', 'normal window cannot script a private tab by id', normalCross?.ok === false)

  // ── Downloads ───────────────────────────────────────────────────────────
  // A type the app files automatically (Documents/). An unrecognised type would
  // raise the normal "Save as" dialog, which is app behaviour, not Incognito's.
  const fileName = `${MARK}-report.txt`
  await openTab(app, incogWin1.wcId, `${ORIGIN}/file?name=${fileName}`)
  const savedFile = await until(() => {
    const found = []
    const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === fileName) found.push(p) } }
    walk(DOWNLOADS)
    return found[0]
  }, { label: 'private download file' })
  await until(async () => (await incogHost.page.evaluate(() => window.electronAPI.downloads.getAll())).some(d => d.filename === fileName && d.state === 'completed'), { label: 'private download listed' })
  check('Downloads', 'private download is listed in the Incognito window', true)
  const normalDl = await normalHost.page.evaluate(() => window.electronAPI.downloads.getAll())
  check('Downloads', 'private download is not in the normal download list', !normalDl.some(d => String(d.filename).includes(MARK)))

  // ── Second Incognito window via the real keyboard shortcut ──────────────
  const before = (await appWindows(app)).filter(isIncognitoTitle).length
  await app.evaluate(({ webContents }, id) => {
    const wc = webContents.fromId(id)
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers: ['control', 'shift'] })
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'N', modifiers: ['control', 'shift'] })
  }, normalWin.wcId)
  let shortcutOk = false
  try {
    await until(async () => (await appWindows(app)).filter(isIncognitoTitle).length === before + 1, { timeout: 10000, label: 'Ctrl+Shift+N window' })
    shortcutOk = true
  } catch {}
  check('UI', 'Ctrl+Shift+N opens a new Incognito window', shortcutOk)
  const incogWin2 = (await appWindows(app)).filter(isIncognitoTitle).find(w => w.wcId !== incogWin1.wcId)
  if (incogWin2) {
    await sleep(1500)
    await openTab(app, incogWin2.wcId, `${ORIGIN}/page?tag=w2-${MARK}`)
    const w2 = await waitTab(app, `${ORIGIN}/page?tag=w2-${MARK}`)
    check('Session Isolation', 'second Incognito window shares the private session', (await inTab(app, w2.id, WHOAMI)).includes(MARK) && w2.persistent === false)

    // Close the FIRST private window: the session must survive.
    await app.evaluate(({ webContents, BrowserWindow }, id) => BrowserWindow.fromWebContents(webContents.fromId(id))?.close(), incogWin1.wcId)
    await until(async () => !(await appWindows(app)).some(w => w.wcId === incogWin1.wcId), { label: 'first incognito window closed' })
    await sleep(800)
    check('Session Isolation', 'private session survives while another Incognito window is open', (await inTab(app, w2.id, WHOAMI)).includes(MARK))
  }

  // ── Close every Incognito window → private session destroyed ────────────
  await normalHost.page.evaluate(() => window.electronAPI.incognito.closeWindows())
  await until(async () => (await normalHost.page.evaluate(() => window.electronAPI.incognito.status())).windowCount === 0, { label: 'all incognito closed' })
  await sleep(1500)
  check('Downloads', 'downloaded file stays on disk after the private session ends', fs.existsSync(savedFile))
  check('Session Isolation', 'no private tab views remain after closing Incognito', (await tabsAll(app)).every(t => t.persistent))

  await normalHost.page.evaluate(() => window.electronAPI.incognito.openWindow())
  const incogWin3 = await until(async () => (await appWindows(app)).find(isIncognitoTitle), { label: 'fresh incognito window' })
  await sleep(1500)
  await openTab(app, incogWin3.wcId, `${ORIGIN}/page?tag=i4-${MARK}`)
  const i4 = await waitTab(app, `${ORIGIN}/page?tag=i4-${MARK}`)
  const fresh = await snapshot(app, i4.id)
  check('Cookies', 'Incognito cookies are gone after the last Incognito window closed', !fresh.cookie.includes(MARK), fresh.cookie)
  check('Authentication', 'Incognito sign-in is gone after the private session ended', !fresh.cookie.includes('auth_session'))
  check('Local Storage', 'Incognito localStorage is gone after the private session ended', fresh.ls === null, String(fresh.ls))
  check('IndexedDB', 'Incognito IndexedDB is gone after the private session ended', fresh.idb === null, String(fresh.idb))
  check('Cache', 'Incognito Cache Storage and service workers are gone', fresh.cache === null && fresh.sw === 0, JSON.stringify(fresh))
  const hitsBeforeFresh = cacheHits
  await inTab(app, i4.id, `fetch('${cacheUrl}').then(r => r.text())`)
  check('Cache', 'Incognito HTTP cache is gone after the private session ended', cacheHits === hitsBeforeFresh + 1)
  const freshHost = await hostPage(app, true)
  const freshDl = await freshHost.page.evaluate(() => window.electronAPI.downloads.getAll())
  check('Downloads', 'private download list is cleared with the session', !freshDl.some(d => String(d.filename).includes(MARK)))

  const normalStill = await snapshot(app, n1.id)
  check('Session Isolation', 'normal browsing data is untouched by the private session ending',
    normalStill.cookie.includes(`auth_session=${NORMAL}`) && normalStill.ls === NORMAL && normalStill.idb === NORMAL)

  // History as the app sees it.
  const hist = await normalHost.page.evaluate(() => window.electronAPI.history.getAll())
  check('History', 'normal visit is in history', hist.some(h => String(h.url).includes('tag=n1')))
  check('History', 'no Incognito visit is in history', !hist.some(h => JSON.stringify(h).includes(MARK)))
  const rewind = await normalHost.page.evaluate(q => window.electronAPI.rewind.search(q), MARK)
  check('History', 'no Incognito page is in Rewind', Array.isArray(rewind) && rewind.length === 0)

  // Leave a private window OPEN when the app quits: it must not come back.
  await app.close()
  app = null

  // ════════════════════════════════════════════════════════════════════════
  // On disk, between runs
  // ════════════════════════════════════════════════════════════════════════
  const profile = path.join(HOME, '.aihub-browser')
  const read = f => { try { return fs.readFileSync(path.join(profile, f), 'utf-8') } catch { return '' } }
  check('History', 'history.json has the normal visit and no private visit', read('history.json').includes('tag=n1') && !read('history.json').includes(MARK))
  check('Crash Recovery', 'sessions.json holds no private tab', !read('sessions.json').includes(MARK))
  check('AI History', 'chat-history.json holds nothing private', !read('chat-history.json').includes(MARK))
  check('Downloads', 'downloads.json holds no private download', !read('downloads.json').includes(MARK))
  const partitions = (() => { try { return fs.readdirSync(path.join(profile, 'Partitions')) } catch { return [] } })()
  check('Session Isolation', 'no on-disk partition was ever created for Incognito', !partitions.some(p => /incognito/i.test(p)), partitions.join(', '))
  const hits = scanForMark(HOME)
  check('Restart Persistence', 'no file anywhere in the profile contains private data', hits.length === 0, hits.join('; '))

  // ════════════════════════════════════════════════════════════════════════
  // Run 2 — restart
  // ════════════════════════════════════════════════════════════════════════
  app = await launchApp()
  const host2 = await hostPage(app, false)
  await host2.page.waitForSelector('.ds-tabbar', { timeout: 30000 })
  await sleep(4000) // let session restore run
  const wins2 = await appWindows(app)
  check('Restart Persistence', 'no Incognito window is restored after restart', wins2.length === 1 && !wins2.some(isIncognitoTitle), JSON.stringify(wins2.map(w => w.title)))
  const tabs2 = await tabsAll(app)
  check('Restart Persistence', 'no private tab is restored after restart', !tabs2.some(t => t.url.includes(MARK)), JSON.stringify(tabs2.map(t => t.url)))
  const normalCookie = await app.evaluate(async ({ session }) => (await session.fromPartition('persist:main').cookies.get({ name: 'auth_session' })).map(c => c.value))
  check('Restart Persistence', 'normal sign-in cookie survives restart (normal persistence unaffected)', normalCookie.includes(NORMAL), JSON.stringify(normalCookie))
  check('Crash Recovery', 'normal session tabs are restored after restart', tabs2.some(t => t.url.includes('tag=n1')), JSON.stringify(tabs2.map(t => t.url)))

  // ════════════════════════════════════════════════════════════════════════
  // Run 3 — crash with a private window open (process killed, no quit hooks)
  // ════════════════════════════════════════════════════════════════════════
  await host2.page.evaluate(() => window.electronAPI.incognito.openWindow())
  const crashWin = await until(async () => (await appWindows(app)).find(isIncognitoTitle), { label: 'incognito before crash' })
  await sleep(1500)
  await openTab(app, crashWin.wcId, `${ORIGIN}/page?tag=crash-${MARK}`)
  await waitTab(app, `${ORIGIN}/page?tag=crash-${MARK}`)
  await sleep(7000) // longer than the session-save debounces, so a leak would have been written
  // Kill the whole tree, as a real crash does: killing only the main process
  // leaves Chromium children holding the single-instance lock.
  const crashedPid = app.process().pid
  if (process.platform === 'win32') {
    const { execFileSync } = await import('child_process')
    try { execFileSync('taskkill', ['/PID', String(crashedPid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
  } else {
    try { process.kill(-crashedPid, 'SIGKILL') } catch { try { process.kill(crashedPid, 'SIGKILL') } catch {} }
  }
  await until(() => { try { process.kill(crashedPid, 0); return false } catch { return true } }, { label: 'crashed app to exit' })
  await sleep(3000)
  app = null
  check('Crash Recovery', 'sessions.json holds no private tab after a crash', !read('sessions.json').includes(MARK))

  app = await launchApp()
  const host3 = await hostPage(app, false)
  await host3.page.waitForSelector('.ds-tabbar', { timeout: 30000 })
  await sleep(4000)
  const wins3 = await appWindows(app)
  const tabs3 = await tabsAll(app)
  check('Crash Recovery', 'no Incognito window or tab is restored after a crash',
    !wins3.some(isIncognitoTitle) && !tabs3.some(t => t.url.includes(MARK)), JSON.stringify({ wins: wins3.map(w => w.title), tabs: tabs3.map(t => t.url) }))
  check('Crash Recovery', 'normal crash recovery still restores normal tabs', tabs3.some(t => t.url.includes('tag=n1')), JSON.stringify(tabs3.map(t => t.url)))
  await app.close()
  app = null
  const crashHits = scanForMark(HOME)
  check('Restart Persistence', 'no file in the profile contains private data after crash + relaunch', crashHits.length === 0, crashHits.join('; '))
} catch (err) {
  check('Harness', 'test run completed', false, err?.stack || String(err))
} finally {
  if (app) {
    // A failed run can leave a modal open; never leave Electron behind.
    const proc = app.process()
    await Promise.race([app.close().catch(() => {}), sleep(10000)])
    try { if (proc.exitCode === null) proc.kill() } catch {}
  }
  try { server.closeAllConnections(); server.close() } catch {}
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (!failed.length) { try { fs.rmSync(HOME, { recursive: true, force: true }) } catch {} }
else console.log(`Profile kept for inspection: ${HOME}`)
process.exit(failed.length ? 1 : 0)
