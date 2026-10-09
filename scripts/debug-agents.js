// Debug script - check what's on the page after clicking Agent Mode
const path = require('path');
const os = require('os');
const { _electron } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));

const REPO = path.resolve(__dirname, '..');
const ISOLATED = path.join(os.tmpdir(), `aihub-debug-${Date.now()}`);
const ELECTRON = path.join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe');

async function main() {
  const env = { ...process.env, USERPROFILE: ISOLATED, HOME: ISOLATED };
  const app = await _electron.launch({
    executablePath: ELECTRON, args: [REPO], cwd: REPO, env,
  });
  const page = await app.firstWindow();

  await page.waitForTimeout(5000);

  // Click Agent Mode
  const agentLink = page.locator('text=Agent Mode').first();
  await agentLink.click({ timeout: 5000, force: true });
  await page.waitForTimeout(3000);

  console.log('URL:', await page.url());

  // Take screenshot
  await page.screenshot({ path: path.join(REPO, 'screenshots', 'debug-agents.png') });

  // Get visible text content
  const bodyText = await page.locator('body').textContent();
  console.log('\n=== Page content (first 1000 chars) ===');
  console.log(bodyText?.substring(0, 1000));

  // Look for any agent-related text
  console.log('\n=== Search results ===');
  console.log('Has "Agent Mode":', bodyText?.includes('Agent Mode'));
  console.log('Has "My Agents":', bodyText?.includes('My Agents'));
  console.log('Has "Creative":', bodyText?.includes('Creative'));
  console.log('Has "Code Reviewer":', bodyText?.includes('Code Reviewer'));
  console.log('Has "Data Extractor":', bodyText?.includes('Data Extractor'));

  // Try to find any element with "agent" text
  const allText = await page.locator('text=/./').allTextContents();
  console.log('\n=== All text elements (first 30) ===');
  allText.slice(0, 30).forEach((t, i) => {
    if (t.trim()) console.log(`  [${i}] ${t.trim()}`);
  });

  await app.close();
}

main().catch(e => { console.error(e); process.exit(1); });
