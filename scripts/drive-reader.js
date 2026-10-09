// drive-reader.js — Playwright-driven smoke test of F1 Reading Mode.
const path = require('path')
const os = require('os')

const REPO = path.resolve(__dirname, '..')
const ISOLATED = path.join(os.tmpdir(), `aihub-reader-test-${Date.now()}`)
const ELECTRON = path.join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe')

const { _electron } = require(path.join(REPO, 'node_modules', 'playwright-core'))

async function main() {
  const env = { ...process.env, USERPROFILE: ISOLATED, HOME: ISOLATED }
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [REPO],
    cwd: REPO,
    env,
  })
  console.log('app launched')
  const win = await app.firstWindow()
  win.on('console', msg => {
    const text = msg.text()
    // Filter out the noisy security warnings
    if (!text.includes('Electron Security Warning')) {
      console.log('[page]', msg.type(), text)
    }
  })
  win.on('pageerror', err => console.log('[page error]', err.message, err.stack?.split('\n').slice(0, 3).join('\n')))

  // Wait for React to mount
  await win.waitForFunction(() => document.querySelectorAll('#root > *').length > 0, { timeout: 30000 })
  console.log('React mounted')

  // URL bar present?
  await win.waitForSelector('input[placeholder*="Search or enter URL"]', { timeout: 10000 })
  console.log('URL bar visible')

  // Navigate to Wikipedia
  const urlBar = win.locator('input[placeholder*="Search or enter URL"]')
  await urlBar.click()
  await urlBar.fill('https://en.wikipedia.org/wiki/Electron_(software_framework)')
  await urlBar.press('Enter')
  console.log('navigating to Wikipedia…')

  // Wait for the page to settle
  await win.waitForTimeout(8000)

  // Check what page we ended up on
  const currentUrl = await win.evaluate(() => {
    return {
      urlBar: document.querySelector('input[placeholder*="Search or enter URL"]')?.value,
      title: document.title,
    }
  })
  console.log('After navigation:', currentUrl)

  // Find the BookOpen button
  const readerBtn = win.locator('button[title*="clean mode"]')
  await readerBtn.waitFor({ timeout: 5000 })
  console.log('Reader button visible, clicking…')
  // Check button is visible and enabled
  const btnInfo = await win.evaluate(() => {
    const btns = document.querySelectorAll('button[title*="clean mode"]')
    if (btns.length === 0) return null
    const b = btns[0]
    const r = b.getBoundingClientRect()
    return { count: btns.length, x: r.x, y: r.y, w: r.width, h: r.height, title: b.title }
  })
  console.log('Button info:', btnInfo)
  const isEnabled = await readerBtn.isEnabled()
  console.log('Button enabled:', isEnabled)
  await readerBtn.click()
  // Wait longer for the lazy component to load
  await win.waitForTimeout(4000)
  // Check what's on screen now
  const postClick = await win.evaluate(() => {
    return {
      bodyText: document.body.innerText.slice(0, 300),
      hasReaderClass: !!document.querySelector('[class*="reader"]'),
      hasReaderContent: !!document.querySelector('.reader-content'),
      readerContentEl: document.querySelectorAll('div').length,
      allButtons: Array.from(document.querySelectorAll('button[title]')).slice(0, 15).map(b => b.title).filter(Boolean),
    }
  })
  console.log('Post-click state:', postClick)

  // Wait for the reader to extract the article
  await win.waitForTimeout(5000)

  // Check state
  const state = await win.evaluate(() => {
    const error = document.body.innerText.includes("Can't read this page")
    const loading = document.body.innerText.includes('Extracting')
    // Title h1 is rendered before .reader-content inside the article
    const title = document.querySelector('article h1')?.textContent
    const wordCount = document.querySelectorAll('.reader-content p').length
    const readerVisible = !!document.querySelector('.reader-content')
    return { error, loading, title, paragraphs: wordCount, readerVisible }
  })
  console.log('Reader state:', state)

  if (state.title && state.paragraphs > 3) {
    console.log('PASS: Reading Mode extracted and rendered an article')
    console.log('  title:', state.title)
    console.log('  paragraphs:', state.paragraphs)
  } else if (state.error) {
    console.log('PARTIAL: reader opened but the page is not an article')
  } else if (state.loading) {
    console.log('PARTIAL: still loading after 5s')
  } else {
    console.log('UNKNOWN: reader did not produce expected output')
  }

  await win.screenshot({ path: path.join(REPO, 'reader-test.png') })
  console.log('screenshot saved to reader-test.png')

  await app.close()
  process.exit(0)
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
