// Run after npm run build. Uses a fresh profile and harmless local fixtures.
import { _electron } from 'playwright-core'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import http from 'http'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'url'

const repo = process.cwd()
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'aihub-security-e2e-'))
const fixture = path.join(profile, 'hello #1%.html')
await fs.writeFile(fixture, '<!doctype html><title>HTML launch verified</title><h1>HTML launch verified</h1>')
const server = http.createServer((req, res) => {
  if (req.url === '/download') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="aihub-harmless.txt"' })
    res.end('AIHub harmless download test.')
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<!doctype html><title>Security test</title><form action="/submit"><input type="password"></form>')
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const env = { ...process.env, USERPROFILE: profile, HOME: profile, NODE_ENV: 'production' }
delete env.ELECTRON_RUN_AS_NODE
const exe = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron'
let app
const until = async (fn, label, timeout = 60_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 250)) }
  throw Error(`Timed out: ${label}`)
}
try {
  app = await _electron.launch({ executablePath: path.join(repo, 'node_modules/electron/dist', exe), args: [repo, fixture], cwd: repo, env, timeout: 60_000 })
  await app.evaluate(({ app }, dir) => app.setPath('downloads', dir), profile)
  const page = await app.firstWindow()
  await page.waitForFunction(() => !!window.electronAPI?.security)
  const open = url => app.evaluate(({ BrowserWindow }, target) => { const win = BrowserWindow.getAllWindows().find(w => w.getTitle().includes('AIHub')); win.webContents.send('open-in-new-tab', target) }, url)
  await until(() => app.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(w => !w.isDestroyed() && w.getURL() === url && w.getTitle() === 'HTML launch verified'), pathToFileURL(fixture).href), 'cold-start HTML file').catch(async error => { console.log(await app.evaluate(({ webContents }) => webContents.getAllWebContents().map(w => ({ url: w.getURL(), title: w.getTitle(), type: w.getType() })))); throw error })
  console.log('PASS: cold-start HTML path with reserved characters')
  await page.getByRole('button', { name: 'Open Security Center', exact: true }).click()
  await page.getByRole('heading', { name: 'Security Center', exact: true }).waitFor()
  const snapshot = await page.evaluate(() => window.electronAPI.security.snapshot())
  assert.equal(snapshot.ok, true)
  assert.equal(typeof snapshot.value.defender.available, 'boolean')
  console.log('PASS: Security Center and real status IPC')

  await open(base)
  await until(() => page.getByRole('button', { name: 'Security warning: review this page' }).count(), 'insecure password warning')
  console.log('PASS: automatic phishing indicator and visible toolbar warning')

  const suspicious = path.join(profile, 'password.html')
  await fs.writeFile(suspicious, '<!doctype html><input type="password"><h1>Inspect before loading</h1>')
  await app.evaluate(({ dialog }) => { globalThis.__securityWarnings = []; dialog.showMessageBox = async (_window, options) => { globalThis.__securityWarnings.push(options.title); return { response: 0, checkboxChecked: false } } })
  await open(pathToFileURL(suspicious).href)
  await until(() => app.evaluate(() => globalThis.__securityWarnings.includes('Review this local HTML file')), 'HTML preflight warning')
  assert.equal(await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(w => !w.isDestroyed() && w.getURL() === url), pathToFileURL(suspicious).href), false)
  console.log('PASS: cancelling HTML warning prevents document execution')

  await app.evaluate(({ webContents }, url) => { const tab = webContents.getAllWebContents().find(w => w.getURL().startsWith('http://127.0.0.1:')); if (!tab) throw Error('Test browser tab not found'); tab.downloadURL(url) }, `${base}/download`)
  const download = await until(async () => {
    const rows = await page.evaluate(() => window.electronAPI.downloads.getAll())
    return rows.find(row => row.filename === 'aihub-harmless.txt' && row.state === 'completed' && row.security && !['pending', 'scanning'].includes(row.security.state))
  }, 'automatic download scan', 120_000)
  assert.ok(['no-threats-found', 'unavailable', 'failed'].includes(download.security.state))
  console.log(`PASS: automatic real download scan (${download.security.state})`)

  await page.getByRole('button', { name: /Open Security Center|Security warning: review this page/ }).click()
  await page.getByRole('heading', { name: 'Security Center', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await until(async () => { const result = await page.evaluate(() => window.electronAPI.security.snapshot()); return result.ok && !result.value.busy }, 'scan queue settled')
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.getByText('Defender has scans queued or running…', { exact: true }).waitFor({ state: 'hidden' })
  await fs.mkdir(path.join(repo, 'test-shots'), { recursive: true })
  await page.screenshot({ path: path.join(repo, 'test-shots/security-center.png') })
  console.log('PASS: Security Center screenshot saved')
} finally {
  if (app) await app.close()
  await new Promise(resolve => server.close(resolve))
  // This exact path was returned by mkdtemp; never remove an inferred profile.
  assert.ok(profile.startsWith(path.join(os.tmpdir(), 'aihub-security-e2e-')))
  await fs.rm(profile, { recursive: true, force: true })
}
