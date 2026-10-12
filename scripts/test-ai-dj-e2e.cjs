// Live AI DJ check in the built app (isolated profile):
//  1. instructions: typed requests produce the right confirmation and chips
//  2. a set plays: >= 3 tracks, >= 2 transitions, no silence > 2 s
//  3. no main-process stall > 250 ms
// Usage: npx electron-vite build && node scripts/test-ai-dj-e2e.cjs [minutes=20]
const path = require('path'), os = require('os'), fs = require('fs')
const { _electron } = require(path.join(os.homedir(), 'node_modules', 'playwright-core'))
const REPO = path.resolve(__dirname, '..')
const MINUTES = Number(process.argv[2] || 20)

;(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dj-e2e-'))
  const env = { ...process.env, USERPROFILE: home, HOME: home }; delete env.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({ executablePath: path.join(REPO, 'node_modules/electron/dist/electron.exe'), args: [REPO], cwd: REPO, env })
  const page = await app.firstWindow()
  const errors = []
  page.on('console', m => { if (m.type() === 'error' || m.text().includes('[dj-view]')) errors.push(m.text().slice(0, 900)) })
  page.on('pageerror', e => errors.push('PAGEERROR ' + String(e.message || e).slice(0, 300)))
  await page.waitForTimeout(8000)
  await app.evaluate(() => { const g = globalThis; g.__lag = []; g.__stalls = []; const t0 = Date.now(); let l = Date.now(); g.__t = setInterval(() => { const n = Date.now(); const d = n - l - 50; g.__lag.push(d); if (d > 150) g.__stalls.push({ atS: Math.round((n - t0) / 1000), ms: d }); l = n }, 50) })
  await page.evaluate(() => localStorage.setItem('aihub-dj-debug', '1'))
  await page.locator('text=AIHub DJ').first().click()
  await page.waitForTimeout(3000)
  // Log every conductor state change and every next() answer (debug handle).
  await page.evaluate(() => {
    const { conductor: c } = window.__aihubDj; const t0 = Date.now(); const log = window.__djLog = []
    const at = () => Math.round((Date.now() - t0) / 1000)
    let last = ''
    c.subscribe(() => {
      const s = c.state
      const line = JSON.stringify({ active: s.active, paused: s.paused, msg: s.message, up: s.upNext.map(u => u.candidate.track.title.slice(0, 24)), played: s.played.length, pool: c.pool.length, tent: s.tentative?.candidate.track.title.slice(0, 24) || null })
      if (line !== last) { last = line; log.push(at() + ' ' + line) }
    })
    const next = c.next.bind(c)
    c.next = () => { const t = next(); log.push(at() + ' next() -> ' + (t ? t.title.slice(0, 30) : 'UNDEFINED') + ' pool=' + c.pool.length + ' ' + JSON.stringify(c.pool.map(p => [p.track.title.slice(0, 18), (window.__aihubDj.conductor.deps.analysis.known(p.track) || {}).playable]))); return t }
  })
  // The DJ opens on the console; the AI stage is one click away.
  await page.locator('button:has-text("AI DJ stage")').click()
  await page.waitForTimeout(1000)
  await page.locator('input[aria-label="Describe the set"]').fill(`afrobeats warm-up, ${MINUTES} min`)
  await page.locator('button:has-text("Start the set")').click()

  const ask = async t => { const i = page.locator('input[aria-label="Tell the DJ"]'); await i.fill(t); await i.press('Enter'); await page.waitForTimeout(800) }
  await page.waitForSelector('input[aria-label="Tell the DJ"]', { timeout: 60000 })
  await ask("don't play drake")
  await ask('no more slow songs')
  // From here the script only reads: any click is a person touching the test window.
  await page.evaluate(() => document.addEventListener('pointerdown', e => { (window.__clicks = window.__clicks || []).push(String(e.target?.className || e.target?.tagName).slice(0, 60)) }, true))
  const chips = await page.locator('.dj-rule').allInnerTexts()
  const msg = await page.locator('.dj-stage-message').innerText().catch(() => '')

  const titleLog = [], trace = []; let tick = 0
  const titles = new Set(); let silentSince = 0, longestSilence = 0, transitions = 0, lastTitle = ''
  const end = Date.now() + MINUTES * 60_000
  while (Date.now() < end) {
    await page.waitForTimeout(1000)
    const s = await page.evaluate(() => ({ title: document.querySelector('.dj-now h2')?.textContent || '', left: document.querySelector('.dj-now-left')?.textContent || '' }))
    if (s.title && s.title !== lastTitle) { if (lastTitle) transitions++; titles.add(s.title); lastTitle = s.title; titleLog.push({ atS: Math.round((Date.now() - (end - MINUTES * 60_000)) / 1000), title: s.title }) }
    const meter = await page.evaluate(() => { const g = document.querySelector('.dj-backdrop-glow'); return g ? getComputedStyle(g).getPropertyValue('--level') : 'missing' })
    if (meter === 'missing') {
      const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(x => x.isVisible()).webContents.capturePage()).toPNG().toString('base64'))
      fs.writeFileSync(path.join(os.tmpdir(), 'ai-dj-missing.png'), Buffer.from(png, 'base64'))
      const clicks = await page.evaluate(() => window.__clicks || [])
      console.log('STAGE MISSING at', Math.round((Date.now() - (end - MINUTES * 60_000)) / 1000), 's; errors:', JSON.stringify(errors.slice(-6)), '; clicks in window:', JSON.stringify(clicks))
      break
    }
    if (Number(meter) < 0.02) { silentSince ||= Date.now(); longestSilence = Math.max(longestSilence, Date.now() - silentSince) } else silentSince = 0
    if (++tick % 15 === 0) trace.push(await page.evaluate(() => ({
      now: document.querySelector('.dj-now h2')?.textContent || null,
      left: document.querySelector('.dj-now-left')?.textContent || null,
      msg: document.querySelector('.dj-stage-message')?.textContent || null,
      next: (document.querySelector('.dj-next')?.textContent || '').slice(0, 160),
      start: !!document.querySelector('input[aria-label="Describe the set"]'),
      level: getComputedStyle(document.querySelector('.dj-backdrop-glow') || document.body).getPropertyValue('--level'),
    })).then(s => ({ atS: tick, ...s })).catch(e => ({ atS: tick, err: String(e) })))
  }
  const djLog = await page.evaluate(() => window.__djLog || []).catch(() => [])
  const lag = await app.evaluate(() => { clearInterval(globalThis.__t); return globalThis.__lag })
  const stalls = await app.evaluate(() => globalThis.__stalls)
  await app.close()
  const report = { errors: errors.slice(-8), chips, msg, tracks: titles.size, transitions, longestSilenceMs: longestSilence, maxStallMs: Math.max(...lag), stalls, titleLog, trace, djLog }
  console.log(JSON.stringify(report, null, 2))
  const ok = chips.some(c => /no drake/i.test(c)) && chips.some(c => /slow/i.test(c)) && titles.size >= 3 && transitions >= 2 && longestSilence <= 2000 && report.maxStallMs <= 250
  console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
