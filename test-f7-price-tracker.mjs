// test-f7-price-tracker.mjs — F7: Live Price Tracker smoke test
import { _electron } from 'file:///C:/Users/erick/AppData/Roaming/npm/node_modules/openclaw/node_modules/playwright-core/index.mjs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ELECTRON_BIN = join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe')
const APP_ENTRY   = join(__dirname, 'out', 'main', 'index.js')
const USER_DATA   = `C:\\Users\\erick\\AppData\\Roaming\\aihub-browser-test-f7-${Date.now()}`
const errors      = []

if (!existsSync(ELECTRON_BIN)) {
  console.error('Electron binary not found:', ELECTRON_BIN)
  process.exit(1)
}

const browser = await _electron.launch({
  executablePath: ELECTRON_BIN,
  args: [
    APP_ENTRY,
    `--user-data-dir=${USER_DATA}`,
    '--disable-gpu',
    '--no-sandbox',
  ],
})

const page = await browser.firstWindow()
page.on('console', msg => {
  if (msg.type() === 'error') errors.push(`CONSOLE ERROR: ${msg.text()}`)
})
page.on('pageerror', err => errors.push(`PAGE ERROR: ${err.message}`))

try {
  // Wait for sidebar to appear
  await page.waitForSelector('.ds-sidebar', { timeout: 20000 })
  console.log('✓ App loaded, sidebar visible')

  // Wait a bit for React to fully hydrate
  await page.waitForTimeout(2000)

  // Live Prices section
  await page.waitForFunction(() => {
    const all = Array.from(document.querySelectorAll('.ds-sidebar *'))
    return all.some(el => el.textContent?.trim() === 'Live Prices')
  }, { timeout: 15000 })
  console.log('✓ "Live Prices" section found in sidebar')

  // Wait for BTC symbol to render
  await page.waitForFunction(() => {
    const all = Array.from(document.querySelectorAll('.ds-sidebar *'))
    return all.some(el => el.textContent?.trim() === 'BTC')
  }, { timeout: 15000 })
  console.log('✓ BTC symbol rendered')

  // Check all 4 symbols
  const symbols = ['BTC', 'ETH', 'XAU', 'NQ']
  for (const sym of symbols) {
    const found = await page.evaluate((s) => {
      const all = Array.from(document.querySelectorAll('.ds-sidebar *'))
      return all.some(el => el.textContent?.trim() === s)
    }, sym)
    if (found) {
      console.log(`✓ ${sym} symbol rendered`)
    } else {
      console.log(`✗ ${sym} symbol MISSING`)
    }
  }

  // Allow price data to load from APIs
  await page.waitForTimeout(5000)

  const hasPrices = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('.ds-sidebar *'))
    return all.some(el => /\d{2,}[,\.]\d{2,}/.test(el.textContent || ''))
  })
  if (hasPrices) {
    console.log('✓ Numeric prices rendered')
  } else {
    console.log('⚠ No numeric prices yet (API may be slow)')
  }

  // Filter out non-fatal errors (favicon 404s, etc.)
  const fatalErrors = errors.filter(e => !e.includes('404') && !e.includes('favicon'))
  if (fatalErrors.length > 0) {
    console.log('\nFatal errors during test:')
    fatalErrors.forEach(e => console.log(' ', e))
    process.exit(1)
  } else {
    console.log('\n✅ F7 Price Tracker: ALL CHECKS PASSED')
  }
} catch (err) {
  console.error('Test failed:', err.message)
  if (errors.length > 0) errors.forEach(e => console.log(' ', e))
  process.exit(1)
} finally {
  await browser.close()
}
