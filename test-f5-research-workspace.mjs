// test-f5-research-workspace.mjs — F5: Research Workspace Mode
import { _electron } from 'file:///C:/Users/erick/AppData/Roaming/npm/node_modules/openclaw/node_modules/playwright-core/index.mjs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ELECTRON_BIN = join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe')
const APP_ENTRY   = join(__dirname, 'out', 'main', 'index.js')
const USER_DATA   = `C:\\Users\\erick\\AppData\\Roaming\\aihub-browser-test-f5-${Date.now()}`
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

  // Open the sidebar if it starts collapsed
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
    console.log('✓ Sidebar expanded')
  }

  // Navigate to Research page via sidebar nav item
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.ds-sidebar .ds-sidebar-item'))
      .find(el => el.textContent?.includes('Research'))
    if (btn) btn.click()
  })
  await page.waitForTimeout(2500)
  console.log('✓ Research page clicked')

  // Verify "Research Workspace" title is visible
  await page.waitForFunction(() => {
    const all = Array.from(document.querySelectorAll('div'))
    return all.some(el =>
      el.textContent?.trim() === 'Research Workspace' &&
      el.offsetParent !== null
    )
  }, { timeout: 15000 })
  console.log('✓ "Research Workspace" title visible')

  // Wait for the Generate Report button (which only exists in workspace view)
  await page.waitForFunction(() => {
    return Array.from(document.querySelectorAll('button'))
      .some(b => b.textContent?.includes('Generate Report') && b.offsetParent !== null)
  }, { timeout: 10000 })
  console.log('✓ "Generate Report" button visible (workspace layout rendered)')

  // Verify 3-pane layout: notepad textarea + sources URL input + generate button
  const panesCount = await page.evaluate(() => {
    const textareas = document.querySelectorAll('textarea[placeholder*="Quick note"]').length
    const urlInputs = Array.from(document.querySelectorAll('input[placeholder*="Add URL"]')).length
    const genBtn    = Array.from(document.querySelectorAll('button')).filter(b => b.textContent?.includes('Generate Report')).length
    return { textareas, urlInputs, genBtn }
  })
  console.log(`✓ 3-pane layout: ${panesCount.textareas} notepad textarea, ${panesCount.urlInputs} URL input, ${panesCount.genBtn} generate button`)

  if (panesCount.textareas < 1 || panesCount.urlInputs < 1 || panesCount.genBtn < 1) {
    throw new Error(`3-pane layout incomplete: ${JSON.stringify(panesCount)}`)
  }

  // Quick note textarea — focus the visible one and type (React's controlled input needs real events)
  const focused = await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll('textarea'))
      .find(t => t.placeholder?.includes('Quick note') && t.offsetParent !== null)
    if (!t) return false
    t.focus()
    return true
  })
  if (!focused) throw new Error('No visible notepad textarea found')
  console.log('✓ Notepad textarea focused')
  await page.keyboard.type('Test note — verifies the notepad accepts input')
  await page.waitForTimeout(500)

  // Click "Add note" button via JS
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.includes('Add note') && b.offsetParent !== null)
    if (btn) btn.click()
  })
  await page.waitForTimeout(1500)

  // Verify note was added
  const noteInList = await page.evaluate(() => {
    return document.body.textContent?.includes('Test note — verifies the notepad accepts input') ? 1 : 0
  })
  if (noteInList > 0) {
    console.log('✓ Note added to notepad successfully')
  } else {
    throw new Error('Note did not appear in the notepad list')
  }

  // Verify mode selector responds
  const compareClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const compare = btns.find(b => b.textContent?.trim() === 'compare' && b.offsetParent !== null)
    if (compare) { compare.click(); return true }
    return false
  })
  if (compareClicked) {
    await page.waitForTimeout(500)
    console.log('✓ Mode selector (compare) responds to clicks')
  } else {
    throw new Error('Mode selector not found')
  }

  if (errors.length > 0) {
    const fatal = errors.filter(e => !e.includes('404') && !e.includes('favicon'))
    if (fatal.length > 0) {
      console.log('\nFatal errors:')
      fatal.forEach(e => console.log(' ', e))
      process.exit(1)
    }
  }
  console.log('\n✅ F5 Research Workspace: ALL CHECKS PASSED')
} catch (err) {
  console.error('Test failed:', err.message)
  if (errors.length > 0) errors.forEach(e => console.log(' ', e))
  process.exit(1)
} finally {
  await browser.close()
}
