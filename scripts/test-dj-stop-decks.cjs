// Stage → Stop → Go to the decks must never close the app (built app, isolated profile).
// Repeats the cycle three times, then checks the window is alive, the console is
// on screen, the music is stopped and no renderer error was thrown.
// Usage: npx electron-vite build && node scripts/test-dj-stop-decks.cjs
const path = require('path'), os = require('os'), fs = require('fs')
const { _electron } = require(path.join(os.homedir(), 'node_modules', 'playwright-core'))
const REPO = path.resolve(__dirname, '..')

;(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-stop-'))
  const env = { ...process.env, USERPROFILE: home, HOME: home }; delete env.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({ executablePath: path.join(REPO, 'node_modules/electron/dist/electron.exe'), args: [REPO], cwd: REPO, env })
  let closed = false
  app.on('close', () => { closed = true })
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 300)))
  page.on('crash', () => errors.push('RENDERER CRASHED'))
  await page.waitForTimeout(8000)
  await page.evaluate(() => localStorage.setItem('aihub-dj-debug', '1'))
  await page.locator('text=AIHub DJ').first().click()
  await page.waitForTimeout(3000)
  const results = []
  for (let round = 1; round <= 3; round++) {
    await page.locator('button:has-text("AI DJ stage"), button:has-text("Back to stage")').first().click()
    await page.waitForTimeout(800)
    await page.locator('input[aria-label="Describe the set"]').fill('afrobeats warm-up, 30 min')
    await page.locator('button:has-text("Start the set")').click()
    await page.waitForSelector('.dj-now h2', { timeout: 90000 })
    await page.waitForTimeout(15000)               // music playing
    await page.locator('button.dj-stop').click()
    await page.waitForTimeout(1500)
    const notice = await page.locator('.dj-stage-message').first().innerText().catch(() => '')
    await page.locator('button.dj-stage-decks').click()
    await page.waitForTimeout(10000)               // the moment the app used to close
    const s = await page.evaluate(() => ({
      console: !!document.querySelector('.dj-back-to-stage'),
      playing: !!(window.__aihubDj && Object.values(window.__aihubDj.engine.decks).some(d => d.playing)),
    })).catch(e => ({ err: String(e) }))
    const windows = closed ? 0 : await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && w.isVisible()).length)
    results.push({ round, notice, ...s, windows })
    if (closed || !windows) break
  }
  console.log(JSON.stringify({ results, errors, closed }, null, 2))
  const ok = !closed && !errors.length && results.length === 3 && results.every(r => r.console && r.windows > 0 && r.playing === false)
  if (!closed) await app.close()
  console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
