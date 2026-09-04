// drive-parallel-intel.js — End-to-end test for F4: Parallel Page Intelligence
const path = require('path')
const os = require('os')

const REPO = path.resolve(__dirname, '..')
const ISOLATED = path.join(os.tmpdir(), `aihub-parallel-test-${Date.now()}`)
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
    if (!text.includes('Electron Security Warning') && !text.includes('Sentry')) {
      console.log('[page]', msg.type(), text.slice(0, 180))
    }
  })
  win.on('pageerror', err => console.log('[page error]', err.message))

  await win.waitForFunction(() => document.querySelectorAll('#root > *').length > 0, { timeout: 30000 })
  console.log('React mounted')

  const urlBar = win.locator('input[placeholder*="Search or enter URL"]')
  await urlBar.click()
  await urlBar.fill('https://en.wikipedia.org/wiki/Electron_(software_framework)')
  await urlBar.press('Enter')
  console.log('navigating to Wikipedia…')

  // Wait for the page to fully load (did-finish-load fires when DOM is done)
  await win.waitForTimeout(8000)

  // The summary card has text "AI Summary" in its header
  // Wait up to 20s for the AI to summarize (local model may take time)
  let found = false
  for (let i = 0; i < 20; i++) {
    const has = await win.evaluate(() => document.body.innerText.includes('AI Summary'))
    if (has) { found = true; break }
    await win.waitForTimeout(1000)
  }
  console.log('AI Summary text found:', found)

  if (!found) {
    console.log('FAIL: AI Summary card did not appear')
    await app.close()
    process.exit(1)
  }

  // Check that bullets are present
  const state = await win.evaluate(() => {
    const card = Array.from(document.querySelectorAll('div')).find(d =>
      d.textContent?.includes('AI Summary') &&
      d.style?.position === 'fixed'
    )
    if (!card) return { found: false }
    const allText = card.innerText
    return {
      found: true,
      cardText: allText.slice(0, 400),
      hasArticleBadge: allText.includes('article') || allText.includes('other') || allText.includes('documentation'),
      hasBullets: allText.split('•').length >= 2,
    }
  })
  console.log('Card state:', JSON.stringify(state, null, 2))

  if (state.hasBullets) {
    console.log('PASS: Parallel Page Intelligence produced a summary card with bullets')
  } else {
    console.log('PARTIAL: card found but bullets missing')
  }

  await win.screenshot({ path: path.join(REPO, 'parallel-intel-test.png') })
  console.log('screenshot saved to parallel-intel-test.png')

  await app.close()
  process.exit(0)
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
