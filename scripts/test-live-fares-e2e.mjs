// Real search in the built app against live sites. Isolated profile; asserts
// merged results, at least two sources, and no main-process freeze.
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { _electron } = require(path.join(os.homedir(), 'node_modules', 'playwright-core'))

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..')
const HOME = path.join(os.tmpdir(), 'aihub-fares-e2e')
fs.rmSync(HOME, { recursive: true, force: true }); fs.mkdirSync(HOME, { recursive: true })
const env = { ...process.env, USERPROFILE: HOME, HOME }
delete env.ELECTRON_RUN_AS_NODE

const depart = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
const ret = new Date(Date.now() + 37 * 86400000).toISOString().slice(0, 10)
const app = await _electron.launch({ executablePath: path.join(REPO, 'node_modules/electron/dist/electron.exe'), args: [REPO], cwd: REPO, env })
const userData = await app.evaluate(({ app }) => app.getPath('userData'))
if (!path.normalize(userData).startsWith(path.normalize(HOME))) throw new Error(`not isolated: ${userData}`)
const page = await app.firstWindow()
await page.waitForTimeout(8000)
await app.evaluate(() => { const g = globalThis; g.__lag = []; let l = Date.now(); g.__t = setInterval(() => { const n = Date.now(); g.__lag.push(n - l - 50); l = n }, 50) })

const t0 = Date.now()
const result = await page.evaluate(async ({ depart, ret }) => {
  const api = window.electronAPI.fares
  const events = []
  const off = api.onProgress(p => events.push({ site: p.site, status: p.status, n: p.offers.length }))
  const { searchId } = await api.search({ from: 'ATL', to: 'LAX', depart, ret, adults: 1, currency: 'USD' })
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    const finals = new Set(events.filter(e => e.status !== 'loading').map(e => e.site))
    if (finals.size >= 3) break
    await new Promise(r => setTimeout(r, 500))
  }
  off()
  return { searchId, events }
}, { depart, ret })
const lag = await app.evaluate(() => { clearInterval(globalThis.__t); return globalThis.__lag })
await app.close()

const done = result.events.filter(e => e.status === 'done')
const total = done.reduce((n, e) => n + e.n, 0)
const report = { seconds: Math.round((Date.now() - t0) / 1000), sites: result.events.filter(e => e.status !== 'loading'), offers: total, maxStallMs: Math.max(...lag) }
console.log(JSON.stringify(report, null, 2))
const ok = done.length >= 2 && total >= 10 && report.seconds <= 60 && report.maxStallMs <= 250
console.log(ok ? 'PASS' : 'FAIL')
process.exit(ok ? 0 : 1)
