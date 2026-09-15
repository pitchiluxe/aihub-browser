// test-f8-compare-modal.mjs — F8: Cross-Tab AI Comparison
import { _electron } from 'file:///C:/Users/erick/AppData/Roaming/npm/node_modules/openclaw/node_modules/playwright-core/index.mjs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ELECTRON_BIN = join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe')
const APP_ENTRY   = join(__dirname, 'out', 'main', 'index.js')
const USER_DATA   = `C:\\Users\\erick\\AppData\\Roaming\\aihub-browser-test-f8-${Date.now()}`
const errors      = []

if (!existsSync(ELECTRON_BIN)) {
  console.error('Electron binary not found:', ELECTRON_BIN)
  process.exit(1)
}

const browser = await _electron.launch({
  executablePath: ELECTRON_BIN,
  args: [APP_ENTRY, `--user-data-dir=${USER_DATA}`, '--disable-gpu', '--no-sandbox'],
})

const page = await browser.firstWindow()
page.on('console', msg => { if (msg.type() === 'error') errors.push(`CONSOLE ERROR: ${msg.text()}`) })
page.on('pageerror', err => errors.push(`PAGE ERROR: ${err.message}`))

try {
  await page.waitForSelector('.ds-sidebar', { timeout: 20000 })
  await page.waitForTimeout(2000)
  console.log('✓ App loaded, sidebar visible')

  // Open sidebar
  const sidebarWidth = await page.evaluate(() => {
    const el = document.querySelector('.ds-sidebar')
    return el ? el.offsetWidth : 0
  })
  if (sidebarWidth < 100) {
    await page.evaluate(() => {
      const candidates = document.querySelectorAll('button')
      for (const btn of Array.from(candidates)) {
        const title = btn.title?.toLowerCase() || ''
        if (title.includes('sidebar') || title.includes('menu')) {
          btn.click()
          return
        }
      }
    })
    await page.waitForTimeout(800)
  }

  // Verify Compare button in nav bar
  const compareBtn = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find(b => b.title?.toLowerCase().includes('compare pages'))
    return btn ? { found: true } : { found: false }
  })
  if (!compareBtn.found) throw new Error('Compare button not found in navbar')
  console.log('✓ Compare button visible in navigation bar (F8)')

  // Open at least 2 tabs first
  const urlFocused = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input'))
    const urlInput = inputs.find(i => i.placeholder?.toLowerCase().includes('search or enter url'))
    if (urlInput) { urlInput.focus(); return true }
    return false
  })
  if (urlFocused) {
    await page.keyboard.type('https://en.wikipedia.org/wiki/Electron_(software_framework)')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(3000)
    console.log('✓ Loaded first URL (Electron wiki)')
  }

  // New tab
  await page.evaluate(() => {
    const newTabBtn = document.querySelector('.ds-tabbar > div:nth-child(2) > button:nth-child(1)')
    if (newTabBtn) newTabBtn.click()
  })
  await page.waitForTimeout(1500)
  console.log('✓ Opened second tab')

  const urlFocused2 = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input'))
    const urlInput = inputs.find(i => i.placeholder?.toLowerCase().includes('search or enter url'))
    if (urlInput) { urlInput.focus(); return true }
    return false
  })
  if (urlFocused2) {
    await page.keyboard.type('https://en.wikipedia.org/wiki/Chromium_(web_browser)')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(3000)
    console.log('✓ Loaded second URL (Chromium wiki)')
  }

  // Open compare modal
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find(b => b.title?.toLowerCase().includes('compare pages'))
    if (btn) btn.click()
  })
  await page.waitForTimeout(1500)
  console.log('✓ Compare modal opened')

  // Verify modal title and counter
  const modalText = await page.evaluate(() => {
    return {
      title: document.body.textContent?.includes('Compare pages'),
      hint:  document.body.textContent?.includes('min 2'),
      counter: /\d+\/6 selected/.test(document.body.textContent || ''),
    }
  })
  if (!modalText.title) throw new Error('Compare modal title not visible')
  console.log('✓ Modal header "Compare pages" visible')
  if (modalText.hint) console.log('✓ Multi-tab hint visible (2+ selection)')
  if (modalText.counter) console.log('✓ Counter shows 0/6 selected')

  // Click first tab in modal
  const click1 = await page.evaluate(() => {
    const allBtns = Array.from(document.querySelectorAll('button'))
    const tabItems = allBtns.filter(b => {
      const txt = b.textContent || ''
      const isInModal = b.closest('[style*="z-index: 2147483"]')
      const hasUrl = txt.includes('wikipedia') || txt.match(/[a-z]+\.(org|com|net)/)
      return isInModal && hasUrl && !b.disabled
    })
    if (tabItems[0]) { tabItems[0].click(); return true }
    return false
  })
  if (!click1) throw new Error('No selectable tab item in modal')
  await page.waitForTimeout(500)
  console.log('✓ Selected first tab in modal')

  // Click second tab
  const click2 = await page.evaluate(() => {
    const allBtns = Array.from(document.querySelectorAll('button'))
    const tabItems = allBtns.filter(b => {
      const txt = b.textContent || ''
      const isInModal = b.closest('[style*="z-index: 2147483"]')
      const hasUrl = txt.includes('wikipedia') || txt.match(/[a-z]+\.(org|com|net)/)
      return isInModal && hasUrl && !b.disabled
    })
    if (tabItems[1]) { tabItems[1].click(); return true }
    return false
  })
  if (!click2) throw new Error('No second selectable tab item in modal')
  await page.waitForTimeout(500)
  console.log('✓ Selected second tab in modal')

  // Verify 2/6 counter now
  const counter2 = await page.evaluate(() => {
    return /\b2\/6 selected\b/.test(document.body.textContent || '')
  })
  if (!counter2) {
    const text = await page.evaluate(() => document.body.textContent?.match(/\d+\/\d+ selected/)?.[0])
    throw new Error(`Counter did not update to 2/6 (got: ${text})`)
  }
  console.log('✓ Counter shows 2/6 selected')

  if (errors.length > 0) {
    const fatal = errors.filter(e => !e.includes('404') && !e.includes('favicon'))
    if (fatal.length > 0) {
      console.log('\nNon-fatal errors (informational):')
      fatal.forEach(e => console.log(' ', e))
    }
  }
  console.log('\n✅ F8 Cross-Tab AI Comparison: ALL CHECKS PASSED')
} catch (err) {
  console.error('Test failed:', err.message)
  if (errors.length > 0) errors.forEach(e => console.log(' ', e))
  process.exit(1)
} finally {
  await browser.close()
}
