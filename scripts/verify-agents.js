// Targeted test for agents page and settings page features.
const path = require('path');
const os = require('os');
const { _electron } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));

const REPO = path.resolve(__dirname, '..');
const ISOLATED = path.join(os.tmpdir(), `aihub-smoke-${Date.now()}`);
const ELECTRON = path.join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe');

async function main() {
  const env = { ...process.env, USERPROFILE: ISOLATED, HOME: ISOLATED };
  const app = await _electron.launch({
    executablePath: ELECTRON, args: [REPO], cwd: REPO, env,
  });
  const page = await app.firstWindow();
  app.process().stdout.on('data', d => process.stdout.write(d));
  app.process().stderr.on('data', d => process.stderr.write(d));

  console.log('Waiting for app to load...');
  await page.waitForTimeout(5000);

  console.log('\n=== Step 1: Find Agent Mode link ===');
  // Try clicking agent mode via sidebar
  const agentLink = page.locator('text=Agent Mode').first();
  const agentCount = await agentLink.count();
  console.log(`Agent Mode links: ${agentCount}`);

  if (agentCount > 0) {
    try {
      await agentLink.click({ timeout: 5000, force: true });
      await page.waitForTimeout(3000);
      console.log('Clicked Agent Mode');
    } catch (e) {
      console.log('Click failed:', e.message);
    }
  }

  // Take screenshot of agent page
  await page.screenshot({ path: path.join(REPO, 'screenshots', 'agents-page.png') });

  console.log('\n=== Step 2: Check for new agents ===');
  const agents = [
    'Creative Writer',
    'Code Reviewer',
    'Financial Analyst',
    'Data Extractor',
    'Web Researcher',
  ];

  for (const name of agents) {
    const count = await page.locator(`text=${name}`).count();
    console.log(`${name}: ${count > 0 ? 'FOUND' : 'MISSING'}`);
  }

  console.log('\n=== Step 3: Check for export/import buttons ===');
  // Look for any buttons with title containing Export or Import
  const allButtons = await page.locator('button[title]').all();
  console.log(`Total buttons with title: ${allButtons.length}`);
  for (const btn of allButtons.slice(0, 20)) {
    const title = await btn.getAttribute('title');
    const text = await btn.textContent();
    if (title && (title.includes('Export') || title.includes('Import'))) {
      console.log(`  Button: title="${title}" text="${text}"`);
    }
  }

  console.log('\n=== Done ===');
  await app.close();
}

main().catch(e => { console.error(e); process.exit(1); });
