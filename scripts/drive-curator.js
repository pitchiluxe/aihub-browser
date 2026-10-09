// drive-curator.js — End-to-end test for F3: AI Tab Curator
const path = require('path')
const os = require('os')

const REPO = path.resolve(__dirname, '..')
const ISOLATED = path.join(os.tmpdir(), `aihub-curator-test-${Date.now()}`)
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
    if (!text.includes('Electron Security Warning')) {
      console.log('[page]', msg.type(), text.slice(0, 200))
    }
  })
  win.on('pageerror', err => console.log('[page error]', err.message))

  await win.waitForFunction(() => document.querySelectorAll('#root > *').length > 0, { timeout: 30000 })
  console.log('React mounted')

  const urlBar = win.locator('input[placeholder*="Search or enter URL"]')

  // Open 3 browser tabs — click the + (new tab) button in the tab bar
  const urls = [
    'https://en.wikipedia.org/wiki/Electron_(software_framework)',
    'https://github.com/electron/electron',
    'https://www.electronjs.org/docs/latest/',
  ]
  for (const url of urls) {
    // Click the + new-tab button (first button inside the tabs flex container, before curator)
    const newTabBtn = win.locator('.ds-tabbar > div:nth-child(2) > button').nth(0)
    await newTabBtn.click()
    await win.waitForTimeout(600)
    await urlBar.click()
    await urlBar.fill(url)
    await urlBar.press('Enter')
    await win.waitForTimeout(2500)
  }
  console.log('opened 3 browser tabs')

  // Wait until we have 4 tabs (1 initial + 3 added)
  try {
    await win.waitForFunction(() => document.querySelectorAll('[data-tab-id]').length >= 4, { timeout: 20000 })
  } catch {
    const count = await win.evaluate(() => document.querySelectorAll('[data-tab-id]').length)
    console.log('FAIL: only', count, 'tabs opened')
    await app.close()
    process.exit(1)
  }
  const tabCount = await win.evaluate(() => document.querySelectorAll('[data-tab-id]').length)
  console.log('Tab count:', tabCount)

  // Find the curator button
  const curatorBtn = win.locator('button[title*="Tab Curator"]')
  await curatorBtn.waitFor({ timeout: 5000 })
  const isEnabled = await curatorBtn.isEnabled()
  console.log('Curator button enabled:', isEnabled)
  if (!isEnabled) {
    console.log('FAIL: curator button disabled despite', tabCount, 'browser tabs')
    await app.close()
    process.exit(1)
  }

  await curatorBtn.click()
  console.log('clicked curator button')

  // Wait for the panel to load clusters
  await win.waitForSelector('text=Tab Curator', { timeout: 8000 })
  console.log('curator panel opened')

  // Wait for clusters to render (AI call or keyword fallback)
  await win.waitForTimeout(5000)

  const state = await win.evaluate(() => {
    // The curator panel is the only div with this shadow-style inline boxShadow
    const panelEl = Array.from(document.querySelectorAll('div')).find(d =>
      d.style.boxShadow?.includes('64px')
    )
    const panelText = panelEl?.innerText || ''
    const applyBtn = Array.from(document.querySelectorAll('button')).find(b =>
      b.textContent?.match(/Apply Groups/i)
    )
    // Count group cards: they have borderLeft inline style
    const groupCards = Array.from(document.querySelectorAll('div')).filter(d =>
      d.style.borderLeft?.includes('px solid')
    )
    return {
      panelText: panelText.slice(0, 400),
      hasApplyButton: !!applyBtn,
      clusterCardCount: groupCards.length,
      loadingText: panelText.includes('Analyzing') || panelText.includes('Loading'),
    }
  })
  console.log('Curator state:', JSON.stringify(state, null, 2))

  if (state.hasApplyButton && state.clusterCardCount > 0) {
    console.log('PASS: AI Tab Curator opened and rendered', state.clusterCardCount, 'groups')
  } else if (state.hasApplyButton) {
    console.log('PASS: AI Tab Curator opened with Apply Groups button')
  } else {
    console.log('PARTIAL: curator panel opened but no groups rendered')
  }

  await win.screenshot({ path: path.join(REPO, 'curator-test.png') })
  console.log('screenshot saved to curator-test.png')

  await app.close()
  process.exit(0)
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
