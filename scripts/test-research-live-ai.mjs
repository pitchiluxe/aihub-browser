// Optional integration check: requires local Ollama llama3.2:3b and internet.
// Uses a public Electron documentation page and an isolated application profile.
import { _electron } from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const repo = process.cwd(), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aihub-research-live-')), data = path.join(profile, '.aihub-browser')
fs.mkdirSync(data, { recursive: true })
const url = new URL(process.argv[2] ?? 'https://www.electronjs.org/docs/latest/tutorial/security').href
fs.writeFileSync(path.join(data, 'sessions.json'), JSON.stringify({ last: { tabs: [{ url, title: 'Electron security', pageType: 'browser' }], activeIndex: 0, savedAt: Date.now() }, previous: null, workspaces: [] }))
const env = { ...process.env, USERPROFILE: profile, HOME: profile, NODE_ENV: 'production' }; delete env.ELECTRON_RUN_AS_NODE
const executablePath = path.join(repo, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron')
const app = await _electron.launch({ executablePath, args: [repo], cwd: repo, env }), testProcess = app.process()
try {
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), data)
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) { w.hide(); w.webContents.setBackgroundThrottling(false) } })
  await page.evaluate(() => window.electronAPI.settings.setAIConfig({ primaryProvider: 'ollama', fallbackEnabled: false, fallbackProvider: 'none', ollamaUrl: 'http://localhost:11434', aiModel: 'llama3.2:3b' }))
  await app.evaluate(async ({ webContents }, url) => {
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) { const wc = webContents.getAllWebContents().find(w => w.getURL() === url); if (wc && !wc.isLoading()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
    throw Error('Public documentation page did not load.')
  }, url)
  await page.getByTitle('Toggle sidebar', { exact: true }).click()
  await page.getByRole('button', { name: 'Research', exact: true }).click()
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await page.getByLabel('Research question', { exact: true }).fill('Return exactly one short finding about this page, with one exact quote from the captured passage.')
  await page.locator('.research-tab input[type=checkbox]').check()
  await page.getByRole('button', { name: 'Capture selected', exact: true }).click()
  await page.getByRole('button', { name: 'Allow capture', exact: true }).click()
  await page.locator('.research-source').waitFor()
  await page.getByRole('button', { name: 'Generate report', exact: true }).click()
  await page.getByLabel('Finding 1', { exact: true }).waitFor({ timeout: 150000 })
  const result = await page.evaluate(() => window.electronAPI.research.list()); assert.ok(result.ok)
  const p = result.value[0], normalize = s => s.replace(/\r\n?/g, '\n').replace(/[\t\u00a0 ]+/g, ' ').replace(/ *\n */g, '\n').trim()
  assert.ok(p.claims.some(c => c.citations.some(q => { const source = p.sources.find(s => s.id === q.sourceId); return source && normalize(source.text).includes(normalize(q.quote)) })), 'Live model must supply at least one matched quote')
  assert.ok(p.claims.every(c => !c.reviewed)); assert.equal(p.sources[0].url, url)
  console.log(`PASS: live Ollama llama3.2:3b produced ${p.claims.length} structured finding(s) with matched public-page evidence; cloud fallback disabled.`)
} catch (error) { console.error(error); const page = await app.firstWindow(); if (await page.locator('.research-workspace').count()) console.error((await page.locator('.research-workspace').innerText()).slice(-2500)); throw error }
finally { await Promise.race([app.close(), new Promise(resolve => setTimeout(resolve, 5000))]); if (testProcess.exitCode === null) testProcess.kill() }
