// Targeted test for new agent/AI features.
const path = require('path')
const os = require('os')

const REPO = path.resolve(__dirname, '..')
const ISOLATED = path.join(os.tmpdir(), `aihub-smoke-${Date.now()}`)
const ELECTRON = path.join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe')

const { _electron } = require(path.join(REPO, 'node_modules', 'playwright-core'))

async function main() {
  const env = { ...process.env, USERPROFILE: ISOLATED, HOME: ISOLATED }
  const app = await _electron.launch({
    executablePath: ELECTRON, args: [REPO], cwd: REPO, env,
  })
  const page = await app.firstWindow()
  app.process().stdout.on('data', d => process.stdout.write(d))
  app.process().stderr.on('data', d => process.stderr.write(d))

  await page.waitForTimeout(4000)

  // Look for Settings link in the sidebar or page
  console.log('\n=== Step 1: Look for Settings link in sidebar ===')
  // The app's UI may have a settings icon - let's find it
  const allButtons = await page.locator('button, a, [role="button"]').count()
  console.log(`Total clickable elements: ${allButtons}`)

  // Take a screenshot of the home page
  await page.screenshot({ path: path.join(REPO, 'screenshots', 'smoke-home.png') })

  // Try clicking on Settings
  const settingsLink = page.locator('text=/Settings/i').first()
  const settingsCount = await page.locator('text=/Settings/i').count()
  console.log(`Settings links found: ${settingsCount}`)
  if (settingsCount > 0) {
    try {
      await settingsLink.click({ timeout: 3000 })
      await page.waitForTimeout(2000)
      console.log('Clicked Settings')
    } catch (e) {
      console.log('Failed to click Settings:', e.message)
    }
  }

  // Take a screenshot to see what state we're in
  await page.screenshot({ path: path.join(REPO, 'screenshots', 'smoke-step1.png') })

  // Look for Claude API Key
  console.log('\n=== Step 2: Check for Claude API Key field ===')
  const claudeCount = await page.locator('text=Claude API Key').count()
  const chatGptCount = await page.locator('text=ChatGPT API Key').count()
  const claudeStatus = await page.locator('text=/Claude:.*Configured|Claude:.*Not set/').count()
  const chatGptStatus = await page.locator('text=/ChatGPT:.*Configured|ChatGPT:.*Not set/').count()

  console.log(`Claude API Key label: ${claudeCount > 0 ? 'FOUND' : 'MISSING'}`)
  console.log(`ChatGPT API Key label: ${chatGptCount > 0 ? 'FOUND' : 'MISSING'}`)
  console.log(`Claude status indicator: ${claudeStatus > 0 ? 'FOUND' : 'MISSING'}`)
  console.log(`ChatGPT status indicator: ${chatGptStatus > 0 ? 'FOUND' : 'MISSING'}`)

  // Now navigate to Agents
  console.log('\n=== Step 3: Navigate to Agents ===')
  const agentLink = page.locator('text=/Agent Mode|Agent/i').first()
  const agentCount = await page.locator('text=/Agent Mode|Agent/i').count()
  console.log(`Agent links found: ${agentCount}`)
  if (agentCount > 0) {
    try {
      await agentLink.click({ timeout: 3000 })
      await page.waitForTimeout(2000)
      console.log('Clicked Agent')
    } catch (e) {
      console.log('Failed to click Agent:', e.message)
    }
  }

  await page.waitForTimeout(2000)
  await page.screenshot({ path: path.join(REPO, 'screenshots', 'smoke-agents.png') })

  // Check for new agent names
  const newAgentCount = await page.locator('text=Creative Writer').count()
  const codeReviewerCount = await page.locator('text=Code Reviewer').count()
  const finAnalystCount = await page.locator('text=Financial Analyst').count()
  const dataExtractorCount = await page.locator('text=Data Extractor').count()
  const webResearcherCount = await page.locator('text=Web Researcher').count()

  console.log(`Creative Writer: ${newAgentCount > 0 ? 'FOUND' : 'MISSING'}`)
  console.log(`Code Reviewer: ${codeReviewerCount > 0 ? 'FOUND' : 'MISSING'}`)
  console.log(`Financial Analyst: ${finAnalystCount > 0 ? 'FOUND' : 'MISSING'}`)
  console.log(`Data Extractor: ${dataExtractorCount > 0 ? 'FOUND' : 'MISSING'}`)
  console.log(`Web Researcher: ${webResearcherCount > 0 ? 'FOUND' : 'MISSING'}`)

  // Check for export/import buttons
  const exportBtn = await page.locator('[title*="Export" i]').count()
  const importBtn = await page.locator('[title*="Import" i]').count()
  console.log(`\nExport button: ${exportBtn > 0 ? 'FOUND' : 'MISSING'}`)
  console.log(`Import button: ${importBtn > 0 ? 'FOUND' : 'MISSING'}`)

  console.log('\n=== Done ===')
  await app.close()
}

main().catch(e => { console.error(e); process.exit(1) })
