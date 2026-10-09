// npm run build && node scripts/test-flights-rentals-e2e.mjs
// Isolated Electron profile. AI replies are deterministic test fixtures;
// destination images load from the real Wikimedia service.
import { _electron } from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repo = process.cwd()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aihub-flights-e2e-'))
const screenshots = path.join(repo, 'test-shots')
fs.mkdirSync(screenshots, { recursive: true })
const executablePath = process.platform === 'win32' ? path.join(repo, 'node_modules/electron/dist/electron.exe') : process.platform === 'darwin' ? path.join(repo, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron') : path.join(repo, 'node_modules/electron/dist/electron')
const env = { ...process.env, USERPROFILE: profile, HOME: profile, NODE_ENV: 'production' }
delete env.ELECTRON_RUN_AS_NODE
const app = await _electron.launch({ executablePath, args: [repo], cwd: repo, env })
try {
  const userData = await app.evaluate(({ app }) => app.getPath('userData'))
  assert.equal(path.resolve(userData), path.join(profile, '.aihub-browser'), 'Test must never touch the real user profile')
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) { window.hide(); window.webContents.setBackgroundThrottling(false) } })
  page.on('pageerror', error => console.error('Renderer error:', error.message))
  page.on('console', msg => { if (msg.type() === 'error') console.error('Renderer console:', msg.text().slice(0, 500)) })
  await page.getByRole('button', { name: 'Flights & Rentals', exact: true }).click({ timeout: 30000 })
  await page.locator('.fare-airport input').first().waitFor()
  const origin = page.getByRole('combobox', { name: 'From', exact: true })
  await origin.fill('KJFK')
  await page.getByRole('option').filter({ hasText: 'KJFK' }).click()
  assert.match(await origin.inputValue(), /^JFK · /)
  const destination = page.getByRole('combobox', { name: 'Destination', exact: true })
  await destination.fill('LFPG')
  await page.getByRole('option').filter({ hasText: 'LFPG' }).click()
  assert.match(await destination.inputValue(), /^CDG · /)
  const start = new Date(); start.setDate(start.getDate() + 30)
  const end = new Date(start); end.setDate(end.getDate() + 7)
  const day = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  await page.getByLabel('Departure', { exact: true }).fill(day(start))
  await page.getByLabel('Return', { exact: true }).fill(day(end))
  await page.locator('.fare-fields select').first().selectOption('2')
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('ai:webSearch')
    ipcMain.handle('ai:webSearch', () => ({ success: true, results: [{ title: 'Airport directory', url: 'https://ourairports.com/data/', snippet: 'Airport identifiers and locations.' }] }))
    ipcMain.removeHandler('ai:chat')
    ipcMain.handle('ai:chat', () => ({ provider: 'test fixture', content: '## Best options to compare\n\n| Provider | What to check |\n| --- | --- |\n| Airline direct | Baggage and changes |\n| Comparison site | Final total |\n\n## Ways to save\n\n- Compare nearby airports.\n- Check dates on either side.\n\n## Before booking\n\nConfirm **baggage fees** and the final total. [1]' }))
  })
  await page.getByRole('button', { name: 'AI deal research', exact: true }).click()
  await page.getByRole('heading', { name: 'Best options to compare', exact: true }).waitFor()
  assert.equal(await page.locator('.fare-brief table').count(), 1)
  assert.equal(await page.locator('.fare-brief li').count(), 2)
  await page.locator('.fare-gallery').scrollIntoViewIfNeeded()
  await page.waitForFunction(() => [...document.querySelectorAll('.fare-gallery img')].some(img => img.complete && img.naturalWidth > 0), undefined, { timeout: 25000 })
  await page.screenshot({ path: path.join(screenshots, 'flights-rentals-desktop.png'), fullPage: true })
  await page.evaluate(() => document.body.classList.add('light-mode'))
  await page.screenshot({ path: path.join(screenshots, 'flights-rentals-light.png'), fullPage: true })
  await page.evaluate(() => { Math.random = () => 0 }) // Deterministic provider choice in this test only.
  await page.getByRole('button', { name: 'Compare providers', exact: true }).click()
  const expected = `https://www.kayak.com/flights/JFK-CDG/${day(start)}/${day(end)}/2adults?sort=price_a&currency=USD`
  const deadline = Date.now() + 20000
  let found = false
  while (Date.now() < deadline) {
    found = await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(w => w.getURL() === url), expected)
    if (found) break
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  assert.ok(found, 'Compare must open a prefilled provider search in the app')
  console.log('PASS: home button, ICAO selection, formatted AI results, real destination photos, light theme and prefilled provider tab.')
} catch (error) {
  const page = await app.firstWindow()
  await page.screenshot({ path: path.join(screenshots, 'flights-rentals-failure.png') }).catch(() => {})
  console.error((await page.locator('body').innerText()).slice(-3500))
  throw error
} finally { await app.close() }
