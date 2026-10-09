// Run after npm run build. Uses an isolated profile and local pages only.
import { _electron } from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

let requests = 0
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/page/')) requests++
  res.setHeader('Content-Type', 'text/html')
  res.end(`<title>Local test ${req.url}</title><body style="background:#346ab4"><input id="draft"><script>window.framesSeen=0;function draw(){framesSeen++;requestAnimationFrame(draw)}draw()</script>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aihub-responsiveness-'))
const data = path.join(profile, '.aihub-browser')
fs.mkdirSync(data, { recursive: true })
fs.writeFileSync(path.join(data, 'sessions.json'), JSON.stringify({ last: { tabs: Array.from({ length: 40 }, (_, i) => ({ url: `${base}/page/${i}`, title: `Restored ${i}`, pageType: 'browser' })), activeIndex: 0, savedAt: Date.now() }, previous: null, workspaces: [] }))
const env = { ...process.env, USERPROFILE: profile, HOME: profile, NODE_ENV: 'production' }
delete env.ELECTRON_RUN_AS_NODE
const executablePath = path.join(process.cwd(), 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron')
const started = Date.now()
const app = await _electron.launch({ executablePath, args: [process.cwd()], env })
const testProcess = app.process()
try {
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), data)
  const page = await app.firstWindow()
  await page.getByText('Restored 39', { exact: true }).waitFor({ state: 'attached', timeout: 30000 })
  await page.waitForTimeout(1500)
  assert.equal(requests, 1, 'Forty restored tabs must load only the selected page')
  console.log(`Forty-tab session ready in ${Date.now() - started}ms; 1 website loaded.`)
  const selectTab = async title => {
    // Horizontal overflow can hide tab labels; invoke the actual React click
    // target after locating the label, without depending on window dimensions.
    await page.getByText(title, { exact: true }).evaluate(label => {
      const tab = label.closest('[data-tabid]') || label.parentElement
      tab.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }
  await selectTab('Restored 9')
  await page.waitForTimeout(1500)
  assert.equal(requests, 2, 'Selecting a deferred tab loads it on demand')
  const contents = await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(w => w.getURL().includes('/page/')).map(w => ({ id: w.id, url: w.getURL(), throttled: w.getBackgroundThrottling() })))
  assert.equal(contents.length, 2)
  assert.ok(contents.every(w => w.throttled), 'Background throttling must be enabled')
  const first = contents.find(w => w.url.endsWith('/0')).id
  const second = contents.find(w => w.url.endsWith('/9')).id
  const frameCount = id => app.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript('window.framesSeen'), id)
  await app.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript('document.querySelector("#draft").value="Keep my unsaved draft"'), second)
  const before = await frameCount(first)
  await page.waitForTimeout(1000)
  assert.ok((await frameCount(first)) - before < 5, 'Hidden tab animation must rest')
  for (let i = 0; i < 5; i++) {
    await selectTab('Local test /page/0')
    await selectTab('Local test /page/9')
  }
  const draft = await app.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript('document.querySelector("#draft").value'), second)
  assert.equal(draft, 'Keep my unsaved draft')
  const visible = await app.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript('document.visibilityState'), second)
  assert.equal(visible, 'visible', 'Returning tab must wake without reload')
  const activeBefore = await frameCount(second)
  await page.waitForTimeout(500)
  assert.ok((await frameCount(second)) - activeBefore > 5, 'Returning tab must resume animation')
  assert.equal(requests, 2, 'Switching tabs must preserve the loaded pages')
  await page.evaluate(async base => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => window.electronAPI.tabView.create(`stress-${i}`, `${base}/page/stress-${i}`)))
  }, base)
  await page.waitForTimeout(1500)
  const probeStarted = Date.now()
  await page.evaluate(() => window.electronAPI.tabView.getNavState('stress-0'))
  assert.ok(Date.now() - probeStarted < 2000, 'Browser controls must respond with many live tab views')
  const hiddenViews = await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(w => w.getURL().includes('/page/stress-')).map(w => ({ id: w.id, throttled: w.getBackgroundThrottling() })))
  assert.equal(hiddenViews.length, 20)
  assert.ok(hiddenViews.every(w => w.throttled))
  console.log('PASS: forty-tab restore, twenty additional live views, responsive controls, hidden animation throttling, repeated switching and unsaved form preservation.')
} finally {
  await Promise.race([app.close(), new Promise(resolve => setTimeout(resolve, 5000))])
  if (testProcess.exitCode === null) testProcess.kill()
  server.close()
}
