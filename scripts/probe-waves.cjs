// What do the deck waveforms show while songs play? Loads a YouTube song on A
// and a local file on B (built app, isolated profile), plays both, then reports
// each deck's waveform source and saves a screenshot.
// Usage: npm run build && node scripts/probe-waves.cjs <localDir> <localFile> [youtubeQuery]
const path = require('path'), os = require('os'), fs = require('fs')
const { _electron } = require(path.join(os.homedir(), 'node_modules', 'playwright-core'))
const REPO = path.resolve(__dirname, '..')
const [dir, file, query = 'Burna Boy Last Last'] = process.argv.slice(2)

;(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waves-'))
  const env = { ...process.env, USERPROFILE: home, HOME: home }; delete env.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({ executablePath: path.join(REPO, 'node_modules/electron/dist/electron.exe'), args: [REPO], cwd: REPO, env })
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center() })
  await page.waitForTimeout(7000)
  await page.evaluate(() => localStorage.setItem('aihub-dj-debug', '1'))
  await page.locator('text=AIHub DJ').first().click()
  await page.waitForFunction(() => !!window.__aihubDj, null, { timeout: 30000 })
  if (process.env.NO_PLAY) await page.evaluate(() => { window.__noPlay = true })
  await page.evaluate(async ({ dir, file, query }) => {
    const e = window.__aihubDj.engine
    const yt = await window.electronAPI.dj.youtube?.search?.(query, 5).catch(() => null)
    window.__ytSearch = yt
    const { tracks } = await window.electronAPI.dj.list(dir)
    await e.decks.B.load(tracks.find(t => t.name === file)); void e.decks.B.play()
  }, { dir, file, query })
  // YouTube through the conductor's own search (the same helper the library uses).
  console.log('YT', await page.evaluate(async (query) => {
    const { conductor, engine } = window.__aihubDj
    const [t] = await conductor.deps.pool.search(query, 5)
    if (!t) return 'no result'
    await engine.decks.A.load(t); if (!window.__noPlay) void engine.decks.A.play()
    return t.title
  }, query))
  const state = async () => page.evaluate(() => {
    const out = {}
    for (const [id, d] of Object.entries(window.__aihubDj.engine.decks)) {
      if (id !== 'A' && id !== 'B') continue
      out[id] = { title: d.track?.title || null, yt: !!d.track?.youtubeId, playing: d.playing, time: Math.round(d.time), duration: Math.round(d.duration),
        analysis: !!d.analysis, analyzing: !!d.analyzing, liveEnv: !!d.liveEnv, scan: d.scanProgress, hasScan: !!d.wave?.hasScan }
    }
    return out
  })
  console.log('API', JSON.stringify(await page.evaluate(() => Object.keys(window.electronAPI.dj))))
  for (const s of [10, 30, 60]) { await page.waitForTimeout(s === 10 ? 10000 : s === 30 ? 20000 : 30000); console.log(s, 's', JSON.stringify(await state())) }
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(x => x.isVisible()).webContents.capturePage()).toPNG().toString('base64'))
  const out = path.join(os.tmpdir(), 'waves.png'); fs.writeFileSync(out, Buffer.from(png, 'base64')); console.log('shot', out)
  await app.close()
})().catch(e => { console.error(e); process.exit(1) })
