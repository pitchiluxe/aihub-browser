// Driver: verify the Trading Coach bot is wired up and works end-to-end.
const path = require('path')
const os = require('os')
const fs = require('fs')

const REPO = path.resolve(__dirname, '..')
const ISOLATED = path.join(os.tmpdir(), `aihub-trading-coach-${Date.now()}`)
const ELECTRON = path.join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe')
const SHOTS = path.join(REPO, 'screenshots')
fs.mkdirSync(SHOTS, { recursive: true })

const { _electron } = require(path.join(REPO, 'node_modules', 'playwright-core'))

async function step(name, fn) {
  console.log(`\n=== ${name} ===`)
  try {
    await fn()
    console.log(`  -> OK`)
  } catch (e) {
    console.log(`  -> FAIL: ${e.message}`)
  }
}

async function main() {
  const env = { ...process.env, USERPROFILE: ISOLATED, HOME: ISOLATED }
  const app = await _electron.launch({
    executablePath: ELECTRON, args: [REPO], cwd: REPO, env,
  })
  const page = await app.firstWindow()
  app.process().stdout.on('data', d => process.stdout.write('[main] ' + d))
  app.process().stderr.on('data', d => process.stderr.write('[main-err] ' + d))

  await page.waitForTimeout(3500)
  await page.screenshot({ path: path.join(SHOTS, 'tc-01-home.png') })

  // Step 1: Confirm Trading Coach does NOT appear on the home screen
  await step('1. Trading Coach button hidden on home', async () => {
    const onHome = await page.evaluate(() => {
      return !!document.querySelector('button[title*="Trading Coach" i]')
    })
    if (onHome) throw new Error('Trading Coach button should be hidden on home but is visible')
  })

  // Step 2: Open a TradingView chart URL
  // The app's URL bar is React-controlled and the Ctrl+L accelerator only works
  // for events the main process can intercept — Playwright's keyboard events
  // don't always reach the React handler reliably. The most reliable path is:
  //   1. Click into the URL bar directly (it's an <input> at the top)
  //   2. Use the keyboard's fill-and-submit pattern
  await step('2. Navigate to TradingView XAUUSD chart', async () => {
    const url = 'https://www.tradingview.com/chart/jftSCV6E/'
    // The URL bar input lives inside the NavigationBar with placeholder text
    // "Search or enter web address" or similar. Find it and operate on it.
    const ok = await page.evaluate((u) => {
      // 1) Find the URL bar input
      const sel = [
        'input[placeholder*="address" i]',
        'input[placeholder*="url" i]',
        'input[placeholder*="search" i]',
        'input[type="text"][value*="http"]',
        'input[type="text"]:not([readonly])',
        'input[type="search"]',
      ]
      let input = null
      for (const s of sel) {
        const cands = [...document.querySelectorAll(s)]
        // The URL bar is the input at the top of the page (smallest top)
        cands.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
        if (cands.length) { input = cands[0]; break }
      }
      if (!input) return 'NO_INPUT'

      // 2) Focus and select
      input.focus()
      input.select()
      // 3) Replace value via the native setter so React picks it up
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, u)
      input.dispatchEvent(new Event('input',  { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      // 4) Submit the form (URL bar is in a <form>)
      const form = input.closest('form')
      if (form) {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        if (typeof form.requestSubmit === 'function') form.requestSubmit()
        return 'OK_FORM'
      }
      // Fallback: press Enter by dispatching a keydown
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
      return 'OK_KEYDOWN'
    }, url)
    console.log(`  url-bar submit: ${ok}`)
    if (ok === 'NO_INPUT') throw new Error('URL bar input not found')
    await page.waitForTimeout(7000)  // chart load
    await page.screenshot({ path: path.join(SHOTS, 'tc-02-tradingview.png') })

    // Verify we are no longer on the home page
    const stillHome = await page.evaluate(() => {
      return !!document.querySelector('button[title*="Trading Coach" i]') === false
          && document.body.innerText.includes('Quick Access') === true
    })
    if (stillHome) throw new Error('Still on home page after navigation')
  })

  // Step 3: Verify Trading Coach button appeared
  await step('3. Trading Coach button visible on chart', async () => {
    // Wait up to 8s for the button to appear (chart may still be loading)
    let found = 0
    for (let i = 0; i < 16; i++) {
      found = await page.locator('button[title*="Trading Coach" i]').count()
      if (found > 0) break
      await page.waitForTimeout(500)
    }
    if (found === 0) throw new Error('Trading Coach button not visible after navigating to TradingView')
    console.log(`  buttons with Trading Coach title: ${found}`)
  })

  // Step 4: Click the button to open the panel
  await step('4. Open the panel', async () => {
    await page.locator('button[title*="Trading Coach" i]').first().click({ force: true })
    await page.waitForTimeout(800)
    await page.screenshot({ path: path.join(SHOTS, 'tc-03-panel-open.png') })
  })

  // Step 5: Verify panel contents — header, symbol badge, quick actions
  await step('5. Panel has expected UI', async () => {
    const title = await page.locator('text=Trading Coach').count()
    const badge = await page.locator('text=GOLD · NASDAQ').count()
    const fullAnalysis = await page.locator('text=Full Analysis').count()
    const trendCheck = await page.locator('text=Trend Check').count()
    const keyLevels = await page.locator('text=Key Levels').count()
    const setAlerts = await page.locator('text=Set Alerts').count()
    console.log(`  header: ${title}, badge: ${badge}`)
    console.log(`  chips: Full Analysis=${fullAnalysis}, Trend Check=${trendCheck}, Key Levels=${keyLevels}, Set Alerts=${setAlerts}`)
    if (title === 0) throw new Error('Header missing')
    if (badge === 0) throw new Error('Expert badge missing')
    if (fullAnalysis === 0 || trendCheck === 0 || keyLevels === 0 || setAlerts === 0) {
      throw new Error('Some quick action chips are missing')
    }
  })

  // Step 6: Click "Full Analysis" and wait for the response
  await step('6. Click Full Analysis chip → wait for response', async () => {
    await page.locator('button:has-text("Full Analysis")').first().click({ force: true })
    await page.waitForTimeout(25000)
    await page.screenshot({ path: path.join(SHOTS, 'tc-04-full-analysis.png') })
    const assistantText = await page.evaluate(() => {
      const all = [...document.querySelectorAll('div')]
        .map(d => d.innerText)
        .filter(t => t && (t.includes('XAUUSD') || t.includes('GOLD') || t.includes('trend') || t.includes('Bias')))
      return all.slice(0, 3)
    })
    console.log(`  assistant content snippets: ${JSON.stringify(assistantText).slice(0, 400)}`)
  })

  // Step 7: Type a freeform question and send it
  await step('7. Type a freeform question', async () => {
    const ta = page.locator('textarea[placeholder*="Gold" i]').first()
    const exists = await ta.count()
    if (exists === 0) throw new Error('Composer textarea not found')
    await ta.fill('What is the key level to watch today?')
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(20000)
    await page.screenshot({ path: path.join(SHOTS, 'tc-05-freeform.png') })
  })

  // Step 8: Close the panel
  await step('8. Close the panel', async () => {
    await page.locator('button[title="Close"]').first().click({ force: true })
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(SHOTS, 'tc-06-closed.png') })
  })

  // Step 9: Navigate away — button should disappear
  await step('9. Navigate away — button should hide', async () => {
    const ok = await page.evaluate(() => {
      const sel = [
        'input[placeholder*="address" i]',
        'input[placeholder*="url" i]',
        'input[placeholder*="search" i]',
        'input[type="text"][value*="http"]',
        'input[type="text"]:not([readonly])',
        'input[type="search"]',
      ]
      let input = null
      for (const s of sel) {
        const cands = [...document.querySelectorAll(s)]
        cands.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
        if (cands.length) { input = cands[0]; break }
      }
      if (!input) return 'NO_INPUT'
      input.focus()
      input.select()
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, 'https://www.google.com')
      input.dispatchEvent(new Event('input',  { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      const form = input.closest('form')
      if (form) {
        if (typeof form.requestSubmit === 'function') form.requestSubmit()
        return 'OK_FORM'
      }
      return 'OK_NO_FORM'
    })
    console.log(`  url-bar submit: ${ok}`)
    await page.waitForTimeout(5000)
    await page.screenshot({ path: path.join(SHOTS, 'tc-07-away.png') })
    const stillVisible = await page.locator('button[title*="Trading Coach" i]').count()
    if (stillVisible > 0) throw new Error('Trading Coach button still visible on a non-chart page')
  })

  console.log('\n=== ALL STEPS COMPLETE ===')
  console.log(`Screenshots: ${SHOTS}`)
  await app.close()
}

main().catch(e => { console.error(e); process.exit(1) })
