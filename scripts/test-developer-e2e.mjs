import { _electron } from 'playwright-core'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aihub-developer-e2e-'))
const executablePath = path.join(process.cwd(), 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
const seen = []
const server = http.createServer((req, res) => {
  seen.push({ url: req.url, cookie: req.headers.cookie || '' })
  if (req.url.startsWith('/slow')) { setTimeout(() => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('done') }, 800); return }
  if (req.url.startsWith('/redirect')) { res.writeHead(302, { Location: '/redirect-target' }); res.end(); return }
  if (req.url.startsWith('/large')) { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('x'.repeat(1_100_000)); return }
  if (req.url.startsWith('/api')) { res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'secret=do-not-display' }); res.end(JSON.stringify({ path: req.url, cookie: req.headers.cookie || '' })); return }
  res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'browserSession=fixture; Path=/' })
  res.end('<!doctype html><title>Developer fixture</title><main><h1>Local test</h1><input aria-label="Draft"><a href="/next">Next page</a><table><tr><th>Name</th></tr><tr><td>Value</td></tr></table></main>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const origin = `http://127.0.0.1:${port}`
let application
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, label) {
  const start = Date.now()
  while (Date.now() - start < 20_000) { try { const value = await fn(); if (value) return value } catch {} await sleep(100) }
  throw Error(`Timed out: ${label}`)
}
let checks = 0
function check(name, condition) { assert.ok(condition, name); checks++; console.log(`PASS ${name}`) }
try {
  const env = { ...process.env, USERPROFILE: profile, HOME: profile, NODE_ENV: 'production' }
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
  application = await _electron.launch({ executablePath, args: [process.cwd()], cwd: process.cwd(), env, timeout: 60_000 })
  const page = await application.firstWindow()
  page.setDefaultTimeout(15_000)
  await page.waitForFunction(() => !!window.electronAPI?.developer)
  const api = (method, ...args) => page.evaluate(async ({ method, args }) => {
    const [group, name] = method.split('.')
    return window.electronAPI[group][name](...args)
  }, { method, args })
  const value = async (method, ...args) => {
    const result = await api(method, ...args)
    if (!result.ok) throw Error(result.error)
    return result.value
  }
  await api('tabView.create', 'developer-fixture', origin)
  await until(() => application.evaluate(({ webContents }, origin) => webContents.getAllWebContents().some(wc => wc.getURL() === origin + '/'), origin), 'fixture loaded')
  await value('developer.start', 'developer-fixture', false)
  await api('tabView.execJs', 'developer-fixture', "fetch('/api?capture=yes', {headers:{Authorization:'private'}}).then(r=>r.text())")
  const capture = await until(async () => {
    const snapshot = await value('developer.snapshot', 'developer-fixture')
    return snapshot.requests.find(row => row.url.includes('capture=yes') && row.status === 200)
  }, 'request captured')
  check('Native capture observes real fetch and status', capture.method === 'GET')
  check('Capture redacts authorization', !Object.keys(capture.headers).some(name => /authorization/i.test(name)))
  await api('tabView.setActive', null)
  check('Automatic sleep protects a debugger-attached tab', await api('tabView.canSleep', 'developer-fixture') === false)
  await value('developer.stop', 'developer-fixture')
  check('Stopping releases debugger resources', !(await value('developer.snapshot', 'developer-fixture')).recording)
  const replay = await value('developer.replay', { url: origin + '/api?replay=yes', method: 'GET', headers: {} })
  check('Replay runs without browser cookies', replay.status === 200 && JSON.parse(replay.body).cookie === '')
  check('Replay never returns Set-Cookie', !Object.keys(replay.headers).some(name => /set-cookie/i.test(name)))
  const metrics = await application.evaluate(({ app }) => app.getAppMetrics().map(process => ({ pid: process.pid, type: process.type, name: process.name, serviceName: process.serviceName })))
  console.log('Process isolation:', JSON.stringify(metrics))
  check('Developer networking runs in a separate utility process', metrics.some(process => process.type === 'Utility' && (process.name === 'AIHub developer tools' || process.serviceName === 'AIHub developer tools')))
  const heartbeat = application.evaluate(() => new Promise(resolve => {
    let ticks = 0, last = performance.now(), maximumGapMs = 0
    const timer = setInterval(() => { const now = performance.now(); maximumGapMs = Math.max(maximumGapMs, now - last); last = now; ticks++ }, 10)
    setTimeout(() => { clearInterval(timer); resolve({ ticks, maximumGapMs: Math.round(maximumGapMs) }) }, 900)
  }))
  const [responsiveness] = await Promise.all([heartbeat, value('developer.replay', { url: origin + '/slow', method: 'GET', headers: {} })])
  check('Main process remains responsive during network replay', responsiveness.ticks >= 20)
  console.log('Replay responsiveness:', JSON.stringify(responsiveness))
  const redirect = await value('developer.replay', { url: origin + '/redirect', method: 'GET', headers: {} })
  check('Replay does not follow redirects', redirect.status === 302 && !seen.some(request => request.url === '/redirect-target'))
  const large = await value('developer.replay', { url: origin + '/large', method: 'GET', headers: {} })
  check('Large responses are bounded', large.truncated && large.body.length <= 1_000_000)
  await value('developer.save', { url: origin + '/api?token=private&q=okay', method: 'POST', headers: { Authorization: 'private', Accept: 'application/json' }, body: 'password=private' })
  const templates = await value('developer.templates')
  check('Persistent templates omit secrets and bodies', !JSON.stringify(templates).includes('private') && !templates[0].body)
  const services = await value('developer.probe', [port])
  check('Local scanner detects listening fixture', services[0].reachable && services[0].port === port)
  const badLocal = await api('developer.openLocal', 'https://example.com')
  check('Development bridge rejects remote hosts', badLocal.ok === false)
  const local = await value('developer.openLocal', origin)
  check('Local bridge selects isolated development container', local.containerId === 'development')
  await api('tabView.create', 'developer-local', local.url, local.containerId)
  await until(() => application.evaluate(({ webContents }, origin) => webContents.getAllWebContents().filter(wc => wc.getURL() === origin + '/').length >= 2, origin), 'isolated tab loaded')
  const isolated = await application.evaluate(async ({ webContents }, origin) => {
    const contents = webContents.getAllWebContents().filter(wc => wc.getURL() === origin + '/')
    return new Set(contents.map(wc => wc.session)).size === 2
  }, origin)
  check('Development tabs have a separate Chromium session', isolated)
  const otherOrigin = `http://localhost:${port}`
  await value('developer.openLocal', otherOrigin)
  const crossOrigin = JSON.stringify(otherOrigin + '/api?cors=yes')
  const localCors = await api('tabView.execJs', 'developer-local', `fetch(${crossOrigin}, {headers:{'Content-Type':'application/json'}}).then(r=>r.status).catch(()=>0)`)
  check('Local CORS adaptation works between approved loopback origins', localCors.result === 200)
  const normalCors = await api('tabView.execJs', 'developer-fixture', `fetch(${crossOrigin}).then(r=>r.status).catch(()=>0)`)
  check('Local CORS rules do not affect the normal session', normalCors.result === 0)
  await value('developer.start', 'developer-fixture', true)
  await api('tabView.execJs', 'developer-fixture', "void fetch('/api?paused=yes').catch(()=>{})")
  const paused = await until(async () => (await value('developer.snapshot', 'developer-fixture')).requests.find(row => row.paused), 'intercepted request')
  check('Interception pauses before network transmission', !seen.some(request => request.url.includes('paused=yes')))
  await value('developer.resolve', { tabId: 'developer-fixture', id: paused.id, request: { ...paused, url: origin + '/api?edited=yes' } })
  await until(() => seen.some(request => request.url.includes('edited=yes')), 'edited request sent')
  check('Forward applies edited URL', !seen.some(request => request.url.includes('paused=yes')))
  await value('developer.stop', 'developer-fixture')
  await application.evaluate(async ({ webContents }, origin) => {
    const wc = webContents.getAllWebContents().find(wc => wc.getURL() === origin + '/' && wc.session.getStoragePath()?.includes('main'))
    if (!wc) throw Error('Source tab missing')
    await wc.executeJavaScript('document.querySelector("input").focus()')
    wc.sendInputEvent({ type: 'char', keyCode: 'x' })
  }, origin)
  await sleep(100)
  check('Automatic sleep protects a form edited with trusted input', await api('tabView.canSleep', 'developer-fixture') === false)
  await api('tabView.navigate', 'developer-fixture', origin + '/next')
  const graph = await until(async () => {
    const graph = await api('history.graph')
    return graph.edges.some(edge => edge.source === origin + '/' && edge.target === origin + '/next') ? graph : null
  }, 'observed navigation trail')
  check('Graph records actual navigation direction', graph.edges.some(edge => edge.source === origin + '/' && edge.target === origin + '/next'))
  await api('history.clear')
  check('Clearing history also clears discovery trails', (await api('history.graph')).nodes.length === 0)
  await api('tabView.navigate', 'developer-fixture', origin + '/third')
  await until(async () => (await api('history.graph')).edges.length > 0, 'new trail after clear')
  // UI smoke: developer workspace must be reachable through the command palette.
  await api('tabView.destroy', 'developer-fixture'); await api('tabView.destroy', 'developer-local')
  console.log('UI ready:', (await page.locator('body').innerText()).slice(0, 120))
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('app-shortcut', 'command-palette'))
  await page.getByPlaceholder(/Search tabs/).fill('Developer tools')
  await page.getByText('Developer tools — API sandbox and local services', { exact: true }).click()
  await page.getByRole('heading', { name: 'Developer tools', exact: true }).waitFor()
  check('Developer workspace renders through the real app', await page.getByRole('tab', { name: 'API sandbox' }).isVisible())
  await page.getByRole('tab', { name: 'Local services' }).click()
  check('Local services view is usable', await page.getByRole('button', { name: 'Scan ports' }).isVisible())
  fs.mkdirSync(path.join(process.cwd(), 'test-shots'), { recursive: true })
  await page.screenshot({ path: path.join(process.cwd(), 'test-shots/developer-services.png') })
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('app-shortcut', 'open-history'))
  await page.getByRole('heading', { name: 'History', exact: true }).waitFor()
  await page.locator('canvas[aria-label^="Navigation trails"]').waitFor()
  check('History graph renders with real WebGL', await page.locator('canvas[aria-label^="Navigation trails"]').isVisible())
  await page.screenshot({ path: path.join(process.cwd(), 'test-shots/history-discovery.png') })
  const privateWindowPromise = application.waitForEvent('window', { timeout: 15_000 })
  await api('incognito.openWindow')
  const privatePage = await privateWindowPromise
  await privatePage.waitForFunction(() => !!window.electronAPI?.incognito?.isIncognito)
  const privateChecks = await privatePage.evaluate(async () => ({
    templates: await window.electronAPI.developer.templates(),
    graph: await window.electronAPI.history.graph(),
  }))
  check('Incognito cannot read saved API templates', privateChecks.templates.ok === false)
  check('Incognito cannot read normal discovery trails', privateChecks.graph.nodes.length === 0)
  await api('incognito.closeWindows')
  console.log(JSON.stringify({ passed: checks, profile }))
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  if (application) {
    await Promise.race([application.close().catch(() => {}), sleep(5000)])
    if (application.process().exitCode === null) application.process().kill()
  }
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
