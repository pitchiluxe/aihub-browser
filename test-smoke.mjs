// test-smoke.mjs — basic app smoke test (loads sidebar, no errors)
import { _electron } from 'file:///C:/Users/erick/AppData/Roaming/npm/node_modules/openclaw/node_modules/playwright-core/index.mjs'
import { join } from 'path'
import { existsSync } from 'fs'

const BIN = join(process.cwd(), 'node_modules/electron/dist/electron.exe')
const APP = join(process.cwd(), 'out/main/index.js')
const UD  = '/tmp/aihub-smoke-' + Date.now()
const errors = []

if (!existsSync(BIN)) { console.error('No electron binary'); process.exit(1) }

const browser = await _electron.launch({
  executablePath: BIN,
  args: [APP, '--user-data-dir=' + UD, '--disable-gpu', '--no-sandbox'],
})
const page = await browser.firstWindow()
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(e.message))

await page.waitForSelector('.ds-sidebar', { timeout: 20000 })
await page.waitForTimeout(3000)
console.log('App loaded successfully')

const fatal = errors.filter(e =>
  !e.includes('404') &&
  !e.includes('favicon') &&
  !e.includes('net::ERR_') &&
  !e.includes('ERR_NAME_NOT_RESOLVED') &&
  !e.includes('Failed to load resource')
)
if (fatal.length > 0) {
  console.log('Errors:')
  fatal.forEach(e => console.log(' ', e))
  await browser.close()
  process.exit(1)
}
console.log('No fatal errors')
await browser.close()
process.exit(0)
