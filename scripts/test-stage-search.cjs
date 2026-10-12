// Stage search in the built app: type an artist → a list of their songs;
// "Next" queues one; a style ("R&B") becomes a sticking rule.
// Usage: npm run build && node scripts/test-stage-search.cjs [artist=Wizkid]
const path = require('path'), os = require('os'), fs = require('fs')
const { _electron } = require(path.join(os.homedir(), 'node_modules', 'playwright-core'))
const REPO = path.resolve(__dirname, '..')
const ARTIST = process.argv[2] || 'Wizkid'

;(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-search-'))
  const env = { ...process.env, USERPROFILE: home, HOME: home }; delete env.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({ executablePath: path.join(REPO, 'node_modules/electron/dist/electron.exe'), args: [REPO], cwd: REPO, env })
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center() })
  const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)))
  await page.waitForTimeout(7000)
  await page.evaluate(() => localStorage.setItem('aihub-dj-debug', '1'))
  await page.locator('text=AIHub DJ').first().click()
  await page.waitForTimeout(3000)
  await page.locator('button:has-text("AI DJ stage")').click()
  await page.locator('input[aria-label="Describe the set"]').fill('afrobeats warm-up, 30 min')
  await page.locator('button:has-text("Start the set")').click()
  // From here the script only types: any pointer press is a person touching the window.
  await page.evaluate(() => document.addEventListener('pointerdown', e => { (window.__clicks = window.__clicks || []).push(String(e.target?.className || e.target?.tagName).slice(0, 50)) }, true))
  globalThis.__diag = async () => {
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(x => x.isVisible()).webContents.capturePage()).toPNG().toString('base64'))
    fs.writeFileSync(path.join(os.tmpdir(), 'stage-search.png'), Buffer.from(png, 'base64'))
    console.log('DIAG clicks:', JSON.stringify(await page.evaluate(() => window.__clicks || [])), '| stage:', (await page.locator('.dj-host').innerText().catch(() => '')).slice(0, 300).replace(/\n/g, ' | '), '| errors:', JSON.stringify(errors))
  }
  const ask = async t => { const i = page.locator('input[aria-label="Tell the DJ"]'); await i.fill(t); await i.press('Enter') }
  await page.waitForSelector('input[aria-label="Tell the DJ"]', { timeout: 60000 })
  try { await ask(ARTIST) } catch (e) {
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(x => x.isVisible()).webContents.capturePage()).toPNG().toString('base64'))
    fs.writeFileSync(path.join(os.tmpdir(), 'stage-search.png'), Buffer.from(png, 'base64'))
    console.log('ASK FAILED; stage text:', (await page.locator('.dj-host').innerText().catch(() => '')).slice(0, 400).replace(/\n/g, ' | '))
    throw e
  }
  await page.waitForSelector('.dj-results li', { timeout: 30000 }).catch(() => {})
  const rows = await page.locator('.dj-results li .dj-results-title b').allInnerTexts()
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(x => x.isVisible()).webContents.capturePage()).toPNG().toString('base64'))
  fs.writeFileSync(path.join(os.tmpdir(), 'stage-search.png'), Buffer.from(png, 'base64'))
  let nextMsg = ''
  if (rows.length) {
    await page.locator('.dj-results li').nth(1).locator('button:has-text("Next")').click()
    await page.waitForTimeout(800)
    nextMsg = await page.locator('.dj-stage-message').first().innerText().catch(() => '')
  }
  await page.locator('[aria-label="Close results"]').click().catch(() => {})
  await ask('R&B')
  await page.waitForTimeout(1500)
  const chips = await page.locator('.dj-rule').allInnerTexts()
  // 🎵 Songs pulls the last list back up.
  await page.locator('.dj-dock button:has-text("Songs")').click()
  const reopened = await page.locator('.dj-results li').count()
  // 🎚 Mixer: bass on deck A follows the slider.
  await page.locator('.dj-dock button:has-text("Mixer")').click()
  await page.locator('input[aria-label="Deck A bass"]').fill('80')
  await page.waitForTimeout(300)
  const bass = await page.evaluate(() => window.__aihubDj?.engine?.decks.A.eq.low ?? null).catch(() => null)
  const shot = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(x => x.isVisible()).webContents.capturePage()).toPNG().toString('base64'))
  fs.writeFileSync(path.join(os.tmpdir(), 'stage-mixer.png'), Buffer.from(shot, 'base64'))
  await app.close()
  const report = { rows: rows.length, first: rows.slice(0, 5), nextMsg, chips, reopened, bass, errors }
  console.log(JSON.stringify(report, null, 1))
  const ok = rows.length >= 5 && reopened >= 5 && Math.abs((bass ?? 0) - 0.8) < 0.01 && /up next/i.test(nextMsg) && chips.some(c => /only r&b/i.test(c)) && !errors.length
  console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1)
})().catch(async e => { console.error(String(e).slice(0, 200)); await globalThis.__diag?.().catch(() => {}); process.exit(1) })
