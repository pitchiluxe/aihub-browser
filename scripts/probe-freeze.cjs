// Where does the main process block? Runs the BUILT app on a COPY of the real
// profile's JSON stores (never the profile itself), loads two local tracks on the
// DJ decks and plays them, then reports every main-thread stall > 150 ms and a
// CPU profile of the main process.
// Usage: npm run build && node scripts/probe-freeze.cjs <musicDir> <trackA> <trackB> [seconds=120]
const path = require('path'), os = require('os'), fs = require('fs')
const { _electron } = require(path.join(os.homedir(), 'node_modules', 'playwright-core'))
const REPO = path.resolve(__dirname, '..')
const [dir, nameA, nameB] = process.argv.slice(2)
const SECONDS = Number(process.argv[5] || 120)

function topSelf(prof, n = 25) {
  const byId = new Map(prof.nodes.map(x => [x.id, x])); const counts = new Map(); const self = new Map()
  prof.samples.forEach((id, i) => counts.set(id, (counts.get(id) || 0) + (prof.timeDeltas[i] || 0)))
  for (const [id, us] of counts) {
    const cf = byId.get(id).callFrame
    const k = `${cf.functionName || '(anon)'} ${cf.url.split(/[\\/]/).pop()}:${cf.lineNumber + 1}`
    self.set(k, (self.get(k) || 0) + us)
  }
  return [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, us]) => `${(us / 1000).toFixed(0).padStart(6)} ms  ${k}`)
}

;(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'freeze-probe-'))
  const src = path.join(os.homedir(), '.aihub-browser'), dst = path.join(home, '.aihub-browser')
  fs.mkdirSync(dst)
  for (const f of fs.readdirSync(src)) {
    const p = path.join(src, f)
    if (fs.statSync(p).isFile() && /\.json$/.test(f)) fs.copyFileSync(p, path.join(dst, f))
  }
  const env = { ...process.env, USERPROFILE: home, HOME: home }; delete env.ELECTRON_RUN_AS_NODE
  const t0 = Date.now()
  const app = await _electron.launch({ executablePath: path.join(REPO, 'node_modules/electron/dist/electron.exe'), args: [REPO], cwd: REPO, env })
  await app.evaluate(async () => {
    const g = globalThis
    g.__stalls = []; let last = Date.now(); const start = Date.now()
    g.__mon = setInterval(() => { const n = Date.now(); const d = n - last - 25; if (d > 150) g.__stalls.push({ atMs: n - start, ms: d }); last = n }, 25)
    const inspector = process.getBuiltinModule('inspector')
    g.__ses = new inspector.Session(); g.__ses.connect()
    const post = (m, p) => new Promise((res, rej) => g.__ses.post(m, p || {}, (e, r) => e ? rej(e) : res(r)))
    g.__post = post
    await post('Profiler.enable'); await post('Profiler.setSamplingInterval', { interval: 500 }); await post('Profiler.start')
  })
  const page = await app.firstWindow()
  await page.waitForTimeout(8000)
  await page.evaluate(() => localStorage.setItem('aihub-dj-debug', '1'))
  await page.reload(); await page.waitForTimeout(8000)
  if (!(await page.evaluate(() => !!window.__aihubDj))) await page.locator('text=AIHub DJ').first().click()
  await page.waitForFunction(() => !!window.__aihubDj, null, { timeout: 30000 })
  await page.waitForTimeout(2000)
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__unresp = []
    for (const w of BrowserWindow.getAllWindows()) w.on('unresponsive', () => globalThis.__unresp.push(Date.now()))
  })
  await page.evaluate(() => {
    window.__long = []; const t0 = performance.now()
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push({ at: Math.round(e.startTime - t0), ms: Math.round(e.duration) }) }).observe({ type: 'longtask', buffered: false })
    // Also a heartbeat: the longtask API misses work in nested event loops.
    window.__beat = []; let last = performance.now()
    setInterval(() => { const n = performance.now(); if (n - last > 250) window.__beat.push({ at: Math.round(n - t0), ms: Math.round(n - last) }); last = n }, 50)
  })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start')
  const loaded = await page.evaluate(async ({ dir, nameA, nameB }) => {
    const { tracks } = await window.electronAPI.dj.list(dir)
    const a = tracks.find(t => t.name === nameA), b = tracks.find(t => t.name === nameB)
    const e = window.__aihubDj.engine
    await e.decks.A.load(a); void e.decks.A.play()
    await new Promise(r => setTimeout(r, 4000))
    await e.decks.B.load(b)
    return [a?.name, b?.name]
  }, { dir, nameA, nameB })
  await page.waitForTimeout(SECONDS * 1000)
  const { profile: rprof } = await cdp.send('Profiler.stop')
  console.log('RENDERER TOP\n' + topSelf(rprof).join('\n'))
  const renderer = await page.evaluate(() => ({ long: window.__long.filter(x => x.ms > 200), beat: window.__beat }))
  const unresponsive = await app.evaluate(() => globalThis.__unresp.length)
  console.log('RENDERER', JSON.stringify({ unresponsive, ...renderer }))
  const res = await app.evaluate(async () => {
    const g = globalThis
    clearInterval(g.__mon)
    const { profile } = await g.__post('Profiler.stop')
    return { stalls: g.__stalls, profile: JSON.stringify(profile) }
  })
  await app.close()
  const out = path.join(os.tmpdir(), 'main-freeze.cpuprofile')
  fs.writeFileSync(out, res.profile)
  // Top self-time functions.
  const prof = JSON.parse(res.profile)
  const self = new Map(); const byId = new Map(prof.nodes.map(n => [n.id, n]))
  const dt = prof.timeDeltas; const counts = new Map()
  prof.samples.forEach((id, i) => counts.set(id, (counts.get(id) || 0) + (dt[i] || 0)))
  for (const [id, us] of counts) {
    const n = byId.get(id); const cf = n.callFrame
    const k = `${cf.functionName || '(anon)'} ${cf.url.split(/[\\/]/).pop()}:${cf.lineNumber + 1}`
    self.set(k, (self.get(k) || 0) + us)
  }
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, us]) => `${(us / 1000).toFixed(0).padStart(6)} ms  ${k}`)
  console.log(JSON.stringify({ loaded, seconds: Math.round((Date.now() - t0) / 1000), stalls: res.stalls, worstMs: Math.max(0, ...res.stalls.map(s => s.ms)), profile: out }, null, 1))
  console.log(top.join('\n'))
})().catch(e => { console.error(e); process.exit(1) })
