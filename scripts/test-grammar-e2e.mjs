import { _electron } from 'playwright-core'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = process.cwd()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aihub-grammar-e2e-'))
const modelCalls = []
const server = http.createServer((req, res) => {
  if (req.url === '/api/tags') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ models: [{ name: 'grammar-fixture:1b', details: { parameter_size: '1B' } }] })); return }
  if (req.url === '/api/version') { res.end('{"version":"fixture"}'); return }
  if (req.url === '/api/chat') {
    let body = ''; req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      const data = JSON.parse(body); modelCalls.push(data)
      const grammar = data.messages.some(message => message.content?.includes('Correct only grammar'))
      res.setHeader('Content-Type', 'application/x-ndjson')
      res.end(JSON.stringify({ message: { role: 'assistant', content: grammar ? 'I have an apple.' : 'Fixture' }, done: true }) + '\n')
    }); return
  }
  res.setHeader('Content-Type', 'text/html')
  res.end('<!doctype html><title>Grammar fixture</title><style>textarea,input,[contenteditable]{display:block;margin:30px;padding:15px;width:600px;min-height:80px;font-size:18px}</style><textarea id="draft">I has a apple.</textarea><input id="password" type="password" value="fixture-secret"><div id="rich" contenteditable="true"><b>Before</b> I has a apple. <i>After</i></div><p id="article">I has a apple.</p>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const executablePath = process.platform === 'darwin' ? path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron') : path.join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
let app, testPage, sourceTabId, childProcess, passed = 0
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
function check(label, value) { assert.ok(value, label); passed++; console.log('PASS ' + label) }
try {
  const env = { ...process.env, USERPROFILE: profile, HOME: profile, NODE_ENV: 'production', OLLAMA_HOST: origin }
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
  app = await _electron.launch({ executablePath, args: [root], cwd: root, env, timeout: 60_000 })
  childProcess = app.process()
  const page = await app.firstWindow(); testPage = page; page.setDefaultTimeout(15_000)
  await page.waitForFunction(() => !!window.electronAPI?.grammar)
  await page.evaluate(origin => window.electronAPI.settings.set({ ollamaUrl: origin, aiModel: 'grammar-fixture:1b', primaryProvider: 'ollama', fallbackEnabled: false, fallbackProvider: 'none' }), origin)
  const address = page.getByPlaceholder(/Search or enter URL/)
  await address.fill(origin)
  await address.press('Enter')
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    sourceTabId = (await page.evaluate(() => window.electronAPI.tabView.getLayout()))?.activeId
    const loaded = sourceTabId ? await page.evaluate(id => window.electronAPI.tabView.execJs(id, 'document.readyState === "complete" && !!document.getElementById("draft")'), sourceTabId) : {}
    if (loaded.result) break
    await sleep(100)
  }
  assert.ok(sourceTabId, 'Fixture navigation must create an active tab')
  console.log('Source:', await app.evaluate(({ webContents }) => webContents.getAllWebContents().map(wc => ({ id: wc.id, url: wc.getURL() }))))
  await app.evaluate(({ Menu }) => {
    globalThis.__grammarAutoClick = true
    Menu.prototype.popup = function () {
      globalThis.__grammarMenuLabels = this.items.map(item => item.label)
      if (globalThis.__grammarAutoClick) this.items.find(item => item.label === 'Correct grammar…')?.click()
    }
  })
  const source = script => page.evaluate(({ script, id }) => window.electronAPI.tabView.execJs(id, script), { script, id: sourceTabId })
  const rightClick = async (selector, selection = 'all') => {
    await page.evaluate(id => window.electronAPI.tabView.setActive(id), sourceTabId)
    await page.evaluate(() => window.electronAPI.tabView.setBounds({ x: 0, y: 100, width: 1100, height: 650 }))
    const rect = (await source(`(() => {
      const el=document.querySelector(${JSON.stringify(selector)}); el.focus();
      if (el.select) el.select();
      else { const range=document.createRange(); ${selection === 'rich' ? 'range.setStart(el.childNodes[1],1);range.setEnd(el.childNodes[1],15);' : 'range.selectNodeContents(el);'} const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range) }
      const rect=${selection === 'rich' ? 'window.getSelection().getRangeAt(0).getBoundingClientRect()' : 'el.getBoundingClientRect()'};return {x:Math.round(rect.left+${selection === 'rich' ? 5 : 35}),y:Math.round(rect.top+${selection === 'rich' ? 5 : 25})}
    })()`)).result
    await app.evaluate(({ webContents }, { origin, rect }) => {
      const wc = webContents.getAllWebContents().find(contents => contents.getURL() === origin + '/')
      wc.focus(); wc.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...rect }); wc.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...rect })
    }, { origin, rect })
  }
  await rightClick('#draft')
  await sleep(300)
  console.log('Native menu:', await app.evaluate(() => globalThis.__grammarMenuLabels))
  await page.getByRole('dialog', { name: 'Correct grammar', exact: true }).waitFor()
  await page.getByLabel('Corrected text').waitFor()
  check('Native right-click menu includes grammar correction', await app.evaluate(() => globalThis.__grammarMenuLabels.includes('Correct grammar…')))
  check('Correction is previewed before changing the field', (await source('document.getElementById("draft").value')).result === 'I has a apple.')
  check('Configured provider returns the correction', await page.getByLabel('Corrected text').inputValue() === 'I have an apple.')
  fs.mkdirSync(path.join(root, 'test-shots'), { recursive: true })
  await page.screenshot({ path: path.join(root, 'test-shots/grammar-preview.png') })
  await page.getByRole('button', { name: 'Replace selection', exact: true }).click()
  await page.getByRole('dialog', { name: 'Correct grammar', exact: true }).waitFor({ state: 'detached' })
  check('Replace updates the original textarea', (await source('document.getElementById("draft").value')).result === 'I have an apple.')
  await source('document.getElementById("draft").value="I has a apple."')
  await rightClick('#draft')
  await page.getByLabel('Corrected text').waitFor()
  await source('document.getElementById("draft").value="New draft typed while correction was open."')
  await page.getByRole('button', { name: 'Replace selection', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'original text changed' }).waitFor()
  check('Stale correction cannot overwrite a newer draft', (await source('document.getElementById("draft").value')).result === 'New draft typed while correction was open.')
  await page.getByRole('button', { name: 'Close grammar correction' }).click()
  await rightClick('#rich', 'rich')
  await page.getByLabel('Corrected text').waitFor()
  await page.getByRole('button', { name: 'Replace selection', exact: true }).click()
  await page.getByRole('dialog', { name: 'Correct grammar', exact: true }).waitFor({ state: 'detached' })
  const rich = (await source('({text:document.getElementById("rich").textContent,bold:document.querySelector("#rich b")?.textContent,italic:document.querySelector("#rich i")?.textContent})')).result
  console.log('Rich-text result:', JSON.stringify(rich))
  check('Rich-text replacement preserves surrounding markup', rich.text.replace(/\u00a0/g, ' ') === 'Before I have an apple. After' && rich.bold === 'Before' && rich.italic === 'After')
  await app.evaluate(() => { globalThis.__grammarAutoClick = false })
  await rightClick('#password')
  await sleep(200)
  check('Password fields have no grammar action', !(await app.evaluate(() => globalThis.__grammarMenuLabels.includes('Correct grammar…'))))
  const grammarCalls = modelCalls.filter(call => call.messages.some(message => message.content?.includes('Correct only grammar')))
  check('Only the requested text is sent to the provider', grammarCalls.length === 3 && grammarCalls.every(call => !JSON.stringify(call.messages).includes('fixture-secret')))
  console.log(JSON.stringify({ passed, profile }))
} catch (error) { console.error(error); if (testPage) await testPage.screenshot({ path: path.join(root, 'test-shots/grammar-error.png') }).catch(() => {}); process.exitCode = 1 }
finally {
  if (app) { await Promise.race([app.close().catch(() => {}), sleep(5000)]); if (childProcess?.exitCode === null) childProcess.kill() }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
}
