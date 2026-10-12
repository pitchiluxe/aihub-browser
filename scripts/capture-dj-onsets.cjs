// Captures real onset curves for detectBpm regression tests: each song is
// played on a hidden YouTube scan player at 2× (keyLock off, so the capture is
// an exact time compression), converted to the song's own timeline and stored
// as a 100 fps onset curve (90 s from the middle, 3 decimals).
// Usage: npx electron-vite build && node scripts/capture-dj-onsets.cjs
const path = require('path'), os = require('os'), fs = require('fs'), cp = require('child_process')
const { _electron } = require(path.join(os.homedir(), 'node_modules', 'playwright-core'))
const REPO = path.resolve(__dirname, '..')
const OUT = path.join(REPO, 'src/renderer/src/components/dj/engine/__fixtures__/onsets.json')
const SONGS = [
  { name: 'get-lucky', q: 'Daft Punk Get Lucky official audio', bpm: 116 },
  { name: 'shape-of-you', q: 'Ed Sheeran Shape of You official music video', bpm: 96 },
  { name: 'levitating', q: 'Dua Lipa Levitating official music video', bpm: 103 },
  { name: 'happy', q: 'Pharrell Williams Happy official music video', bpm: 160 },
  { name: 'blinding-lights', q: 'The Weeknd Blinding Lights official audio', bpm: 171 },
]
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-onsets-'))
cp.execFileSync(process.execPath, [path.join(REPO, 'node_modules/esbuild/bin/esbuild'),
  path.join(REPO, 'src/renderer/src/components/dj/engine/analysis.ts'), '--bundle', '--platform=node', '--format=cjs',
  `--outfile=${path.join(TMP, 'analysis.cjs')}`, '--log-level=error'])
const A = require(path.join(TMP, 'analysis.cjs'))

;(async () => {
  const home = path.join(TMP, 'home'); fs.mkdirSync(home)
  const env = { ...process.env, USERPROFILE: home, HOME: home }; delete env.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({ executablePath: path.join(REPO, 'node_modules/electron/dist/electron.exe'), args: [REPO], cwd: REPO, env })
  const page = await app.firstWindow()
  await page.waitForTimeout(8000)
  await page.locator('text=AIHub DJ').first().click()
  await page.waitForTimeout(4000)
  const out = {}
  for (const s of SONGS) {
    const res = await page.evaluate(async ({ q }) => {
      const dj = window.electronAPI.dj
      const hit = ((await dj.youtubeSearch(q, 1))?.videos || [])[0]
      if (!hit) return null
      await dj.yt.load('C-scan', hit.id)
      await dj.yt.cmd('C-scan', 'keyLock', false)
      const sid = await dj.yt.streamId('C-scan')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: sid } }, video: false })
      const ctx = new AudioContext(); const src = ctx.createMediaStreamSource(stream); const proc = ctx.createScriptProcessor(4096, 1, 1)
      const chunks = []; proc.onaudioprocess = e => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
      src.connect(proc); proc.connect(ctx.destination)
      await dj.yt.cmd('C-scan', 'play'); await dj.yt.cmd('C-scan', 'rate', 2)
      const start = Date.now(); let lastT = -1, stuck = 0
      while (Date.now() - start < 80000) {
        await new Promise(r => setTimeout(r, 1000))
        const st = await dj.yt.state('C-scan'); const t = st?.t ?? 0
        if (st?.paused && !st?.ended && !st?.ad) void dj.yt.cmd('C-scan', 'play')
        if (st?.ended || (st?.d && t >= st.d - 1)) break
        if (Math.abs(t - lastT) < 0.01) { if (++stuck > 20) break } else stuck = 0
        lastT = t
      }
      proc.disconnect(); src.disconnect(); stream.getTracks().forEach(t => t.stop()); await dj.yt.unload('C-scan')
      const sr = ctx.sampleRate; await ctx.close()
      const total = chunks.reduce((n, c) => n + c.length, 0); const pcm = new Float32Array(Math.floor(total / 4))
      let k = 0, acc = 0, n = 0
      for (const c of chunks) for (let i = 0; i < c.length; i++) { acc += c[i]; if (++n === 4) { pcm[k++] = acc / 4; acc = 0; n = 0 } }
      const bytes = new Uint8Array(pcm.buffer, 0, k * 4); let bin = ''
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
      return { b64: btoa(bin), captureRate: sr / 4 }
    }, { q: s.q })
    if (!res) { console.log('no hit', s.name); continue }
    const buf = Buffer.from(res.b64, 'base64')
    const pcm = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4)
    const onset = A.onsetCurve(A.buildEnvelope(pcm, res.captureRate / 2))
    const span = Math.min(onset.length, 9000), from = Math.floor((onset.length - span) / 2)
    out[s.name] = { bpm: s.bpm, onset: Array.from(onset.subarray(from, from + span), v => Math.round(v * 1000) / 1000) }
    console.log(s.name, 'frames', span, 'detectBpm now:', A.detectBpm(onset))
  }
  await app.close()
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(out))
  console.log('wrote', OUT)
})().catch(e => { console.error(e); process.exit(1) })
