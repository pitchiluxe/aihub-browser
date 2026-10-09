// Run after npm run build. Real Electron UI, isolated profile, local evidence,
// deterministic AI fixture. No test data enters the user's profile.
import { _electron, chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { inflateRawSync } from 'node:zlib'
const repo = process.cwd(), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aihub-research-'))
const data = path.join(profile, '.aihub-browser'), output = path.join(profile, 'capsule.zip')
fs.mkdirSync(data, { recursive: true })
const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<title>Evidence ${req.url}</title><main><h1>Evidence ${req.url}</h1><p>${req.url === '/one' ? 'Solar storage lasts eight hours.' : 'Solar storage lasts six hours.'}</p><input value="PRIVATE_FORM_VALUE"><textarea>PRIVATE_DRAFT</textarea><div contenteditable>PRIVATE_EDITOR</div><p hidden>PRIVATE_HIDDEN</p></main>`) })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
fs.writeFileSync(path.join(data, 'sessions.json'), JSON.stringify({ last: { tabs: [{ url: base + '/one', title: 'Evidence one', pageType: 'browser' }, { url: base + '/two', title: 'Evidence two', pageType: 'browser' }], activeIndex: 0, savedAt: Date.now() }, previous: null, workspaces: [] }))
const env = { ...process.env, USERPROFILE: profile, HOME: profile, NODE_ENV: 'production' }; delete env.ELECTRON_RUN_AS_NODE
const executablePath = path.join(repo, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron')
let app, testProcess, browser
const launch = async () => {
  app = await _electron.launch({ executablePath, args: [repo], cwd: repo, env }); testProcess = app.process()
  assert.equal(path.resolve(await app.evaluate(({ app }) => app.getPath('userData'))), data)
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) { w.hide(); w.webContents.setBackgroundThrottling(false) } })
  return page
}
const close = async () => { if (app) { await Promise.race([app.close(), new Promise(resolve => setTimeout(resolve, 5000))]); if (testProcess.exitCode === null) testProcess.kill(); app = null } }
try {
  let page = await launch()
  await page.getByText('Evidence two', { exact: true }).waitFor({ state: 'attached' })
  await page.getByText('Evidence two', { exact: true }).evaluate(el => (el.closest('[data-tabid]') || el.parentElement).dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await page.getByText('Evidence /two', { exact: true }).waitFor({ state: 'attached' })
  await page.getByTitle('Toggle sidebar', { exact: true }).click()
  await page.getByRole('button', { name: 'Research', exact: true }).click()
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await page.getByLabel('Project name', { exact: true }).fill('Solar evidence study')
  await page.getByLabel('Research question', { exact: true }).fill('How do the storage estimates differ?')
  const boxes = page.locator('.research-tab input[type=checkbox]'); assert.equal(await boxes.count(), 2)
  for (let i = 0; i < 2; i++) { assert.equal(await boxes.nth(i).isChecked(), false); await boxes.nth(i).check() }
  await page.getByRole('button', { name: 'Capture selected', exact: true }).click()
  assert.equal(await page.locator('.research-source').count(), 0)
  await page.getByRole('button', { name: 'Allow capture', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.research-source').length === 2)
  const saved = await page.evaluate(() => window.electronAPI.research.list()); assert.ok(saved.ok)
  const project = saved.value.find(p => p.title === 'Solar evidence study'); assert.ok(project)
  assert.ok(project.sources.every(s => !s.text.includes('PRIVATE_')))
  await app.evaluate(({ ipcMain, dialog }, output) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: output })
    ipcMain.removeHandler('ai:chat'); ipcMain.handle('ai:chat', (_e, messages) => {
      const sources = JSON.parse(messages[1].content).sources
      return { provider: 'deterministic test fixture', content: JSON.stringify({ claims: [{ text: 'The first source reports eight hours.', citations: [{ sourceId: sources[0].sourceId, quote: 'Solar storage lasts eight hours.' }], kind: 'finding' }, { text: 'The sources give different estimates.', citations: [{ sourceId: sources[1].sourceId, quote: 'Solar storage lasts six hours.' }], kind: 'suggested-disagreement' }, { text: 'Unsupported fixture claim.', citations: [{ sourceId: sources[0].sourceId, quote: 'Invented quote' }], kind: 'finding' }] }) }
    })
  }, output)
  await page.getByRole('button', { name: 'Generate report', exact: true }).click()
  await page.getByLabel('Finding 1', { exact: true }).waitFor()
  await page.getByRole('button', { name: /View evidence.*Excerpt matched/ }).first().click()
  assert.equal(await page.locator('mark').innerText(), 'Solar storage lasts eight hours.')
  await page.getByRole('button', { name: 'Close evidence', exact: true }).click()
  await page.getByRole('button', { name: /View evidence.*Unmatched quote/ }).click()
  assert.equal(await page.locator('mark').count(), 0)
  await page.getByRole('button', { name: 'Close evidence', exact: true }).click()
  await page.getByRole('button', { name: 'Mark reviewed', exact: true }).first().click()
  await page.getByLabel('Finding 1', { exact: true }).fill('Edited finding about eight hours.')
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  await page.waitForFunction(async () => { const r = await window.electronAPI.research.list(); return r.ok && r.value.some(p => p.claims[0]?.text === 'Edited finding about eight hours.' && !p.claims[0]?.reviewed) })
  await page.getByRole('button', { name: 'Share capsule', exact: true }).click()
  assert.equal(fs.existsSync(output), false)
  await page.getByLabel('Shared URL for Evidence /one', { exact: true }).fill('')
  await page.getByRole('button', { name: 'Export capsule', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[aria-label="Preview research capsule"]'))
  assert.ok(fs.existsSync(output))
  const zip = fs.readFileSync(output), files = {}; let offset = 0
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8), size = zip.readUInt32LE(offset + 18), nameLength = zip.readUInt16LE(offset + 26), extraLength = zip.readUInt16LE(offset + 28)
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString(), start = offset + 30 + nameLength + extraLength
    const bytes = zip.subarray(start, start + size); files[name] = (method === 8 ? inflateRawSync(bytes) : bytes).toString(); offset = start + size
  }
  assert.deepEqual(Object.keys(files), ['index.html', 'project.aihub-research.json'])
  assert.ok(!JSON.stringify(files).includes('PRIVATE_')); assert.ok(!files['project.aihub-research.json'].includes('"text": "Evidence'))
  const capsule = JSON.parse(files['project.aihub-research.json']); assert.equal(capsule.sources[0].url, undefined)
  const htmlFile = path.join(profile, 'index.html'), jsonFile = path.join(profile, 'project.aihub-research.json')
  fs.writeFileSync(htmlFile, files['index.html']); fs.writeFileSync(jsonFile, files['project.aihub-research.json'])
  const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p))
  assert.ok(edge, 'An installed Chromium browser is required for the offline capsule check')
  browser = await chromium.launch({ executablePath: edge, headless: true }); const context = await browser.newContext(), preview = await context.newPage(), requests = []
  preview.on('request', r => requests.push(r.url())); await preview.goto(pathToFileURL(htmlFile).href); await preview.waitForTimeout(500)
  assert.equal(requests.filter(u => /^https?:/.test(u)).length, 0); assert.equal(await preview.locator('script,img').count(), 0)
  await preview.getByText(/Excerpt matched/).first().click(); assert.ok((await preview.locator('blockquote').first().innerText()).includes('Solar storage'))
  await browser.close(); browser = null
  await page.locator('.research-file input[type=file]').setInputFiles(jsonFile)
  await page.getByRole('button', { name: 'Import project', exact: true }).click()
  await page.waitForFunction(async () => { const r = await window.electronAPI.research.list(); return r.ok && r.value.length === 2 })
  const imported = await page.evaluate(() => window.electronAPI.research.list()); assert.ok(imported.value.some(p => p.id !== project.id && p.sources.every(s => s.provenance === 'imported')))
  await page.screenshot({ path: path.join(repo, 'test-shots/research-workspace.png') })
  await page.evaluate(() => document.body.classList.add('light-mode')); await page.screenshot({ path: path.join(repo, 'test-shots/research-workspace-light.png') })
  const privateWindow = app.waitForEvent('window')
  await page.evaluate(() => window.electronAPI.incognito.openWindow())
  const privatePage = await privateWindow; await privatePage.waitForLoadState()
  await privatePage.evaluate(() => window.electronAPI.research.list()).then(r => assert.deepEqual(r, { ok: true, value: [] }))
  const privateMark = 'PRIVATE_RESEARCH_ONLY', when = new Date().toISOString()
  const privateProject = { schemaVersion: 1, id: 'private-project', title: privateMark, question: '', mode: 'summary', createdAt: when, updatedAt: when, sources: [], claims: [], notes: [] }
  assert.ok((await privatePage.evaluate(p => window.electronAPI.research.save(p), privateProject)).ok)
  await privatePage.evaluate(() => window.electronAPI.incognito.closeWindows()).catch(error => { if (!String(error).includes('closed')) throw error })
  assert.ok(!(await page.evaluate(() => window.electronAPI.research.list())).value.some(p => p.title === privateMark))
  await close(); assert.ok(!fs.readFileSync(path.join(data, 'research-projects.json'), 'utf8').includes(privateMark))
  page = await launch(); const restored = await page.evaluate(() => window.electronAPI.research.list())
  assert.equal(restored.value.length, 2); assert.ok(restored.value.some(p => p.claims[0]?.text === 'Edited finding about eight hours.'))
  console.log('PASS: selected real-page capture, form exclusion, valid/invalid citations, review edits, native ZIP, offline HTML in separate browser, import, private isolation and restart persistence.')
} catch (error) {
  if (app) { const p = await app.firstWindow(); console.error((await p.locator('body').innerText()).slice(-4500)); await p.screenshot({ path: path.join(repo, 'test-shots/research-failure.png') }).catch(() => {}) }
  throw error
} finally { if (browser) await browser.close(); await close(); server.close() }
