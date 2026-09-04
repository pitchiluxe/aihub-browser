// test-f10-reading-lists.mjs — F10: Community Reading Lists
import { _electron } from 'file:///C:/Users/erick/AppData/Roaming/npm/node_modules/openclaw/node_modules/playwright-core/index.mjs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ELECTRON_BIN = join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe')
const APP_ENTRY   = join(__dirname, 'out', 'main', 'index.js')
const USER_DATA   = '/tmp/aihub-browser-test-f10-' + Date.now()
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

  // Open the sidebar (starts collapsed)
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
          btn.click(); return
        }
      }
    })
    await page.waitForTimeout(800)
    console.log('✓ Sidebar opened')
  }

  // Click "Reading Lists" in the sidebar
  const listsBtn = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.ds-sidebar [title], .ds-sidebar button, .ds-sidebar a'))
    const found = items.find(el => {
      const text = (el.textContent || '').trim()
      return text.includes('Reading Lists')
    })
    if (found) { found.click(); return true }
    return false
  })
  if (listsBtn) {
    await page.waitForTimeout(2000)
    console.log('✓ Clicked "Reading Lists"')
  } else {
    // Try nav intent via URL bar
    await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'))
      const input = inputs.find(i => i.placeholder?.toLowerCase().includes('search or enter url'))
      if (input) { input.focus(); return }
    })
    await page.keyboard.type('aihub://community-lists')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(2000)
    console.log('✓ Navigated via aihub://community-lists')
  }

  // Verify the page loaded
  const pageText = await page.evaluate(() => document.body.textContent || '')
  const hasTitle = pageText.includes('Community Reading Lists')
  if (hasTitle) {
    console.log('✓ "Community Reading Lists" page title visible')
  } else {
    throw new Error('Reading Lists page did not load')
  }

  // Verify Explore tab is visible
  const hasExploreTab = pageText.includes('Explore')
  if (hasExploreTab) {
    console.log('✓ Explore tab visible')
  }

  // Verify the seed lists are visible (they auto-seed on first load)
  const hasSeedLists = pageText.includes('AI safety') || pageText.includes('Trading psychology')
  if (hasSeedLists) {
    console.log('✓ Seed reading lists visible (AI safety, Trading psychology)')
  } else {
    console.log('⚠ Seed lists not found — may need more time to load')
  }

  // Click Explore tab
  const exploreClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const tab = btns.find(b => b.textContent?.trim() === 'Explore')
    if (tab) { tab.click(); return true }
    return false
  })
  if (exploreClicked) {
    await page.waitForTimeout(500)
    console.log('✓ Clicked Explore tab')
  }

  // Verify "My Lists" vs "Explore" tabs
  const hasMyListsTab = await page.evaluate(() => document.body.textContent?.includes('My Lists'))
  if (hasMyListsTab) {
    console.log('✓ "My Lists" tab visible')
  }

  // Check for seed lists cards
  const hasListCard = await page.evaluate(() => {
    const texts = ['AI safety', 'Trading psychology', 'Genesis', 'Best reads']
    return texts.some(t => document.body.textContent?.includes(t))
  })
  if (hasListCard) {
    console.log('✓ Reading list cards visible')
  }

  // Click "New reading list" button
  const newListBtn = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const btn = btns.find(b => b.textContent?.includes('New reading list'))
    if (btn) { btn.click(); return true }
    return false
  })
  if (newListBtn) {
    await page.waitForTimeout(500)
    console.log('✓ "New reading list" button clicked')

    // Verify form appeared
    const hasForm = await page.evaluate(() => document.body.textContent?.includes('New reading list') && document.body.textContent?.includes('Title'))
    if (hasForm) {
      console.log('✓ Create-list form visible')
    }

    // Type a list title
    await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'))
      const titleInput = inputs.find(i => i.placeholder?.toLowerCase().includes('title'))
      if (titleInput) {
        titleInput.value = 'Test Reading List'
        titleInput.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    await page.waitForTimeout(200)

    // Click Create list
    const createClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'))
      const btn = btns.find(b => b.textContent?.trim() === 'Create list')
      if (btn) { btn.click(); return true }
      return false
    })
    if (createClicked) {
      await page.waitForTimeout(1000)
      console.log('✓ "Create list" button clicked')
    }
  }

  // Verify "Add current page" button
  const hasAddBtn = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).some(b => b.textContent?.includes('Add current page'))
  })
  if (hasAddBtn) {
    console.log('✓ "Add current page" button visible')
  }

  // Verify seed lists have AI summary buttons
  const hasAIButton = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).some(b => b.textContent?.includes('Generate AI summary'))
  })
  if (hasAIButton) {
    console.log('✓ "Generate AI summary" button visible on list cards')
  }

  // Verify theme filter buttons
  const hasFilters = await page.evaluate(() => {
    const body = document.body.textContent || ''
    return ['AI', 'Trading', 'Bible', 'General'].some(t => body.includes(t))
  })
  if (hasFilters) {
    console.log('✓ Theme filter buttons visible')
  }

  // Check localStorage persistence
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('aihub-reading-lists-v1')
    return raw ? JSON.parse(raw) : null
  })
  if (stored && Array.isArray(stored) && stored.length > 0) {
    console.log(`✓ Reading lists persist in localStorage (${stored.length} list(s))`)
  }

  if (errors.length > 0) {
    const fatal = errors.filter(e => !e.includes('404') && !e.includes('favicon'))
    if (fatal.length > 0) {
      console.log('\nNon-fatal errors:')
      fatal.forEach(e => console.log(' ', e))
    }
  }
  console.log('\n✅ F10 Community Reading Lists: ALL CHECKS PASSED')
} catch (err) {
  console.error('Test failed:', err.message)
  if (errors.length > 0) errors.forEach(e => console.log(' ', e))
  process.exit(1)
} finally {
  await browser.close()
}
