// Final verification script
const path = require('path');
const os = require('os');
const { _electron } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));

const REPO = path.resolve(__dirname, '..');
const ISOLATED = path.join(os.tmpdir(), `aihub-verify-${Date.now()}`);
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

  // ===== Test 1: Settings page =====
  console.log('\n=== TEST 1: Settings page ===');
  const settingsLink = page.locator('text=Settings').first();
  const settingsCount = await settingsLink.count();
  console.log(`Settings links found: ${settingsCount}`);

  if (settingsCount > 0) {
    await settingsLink.click({ timeout: 5000, force: true });
    await page.waitForTimeout(5000);
    console.log('Clicked Settings');

    await page.screenshot({ path: path.join(REPO, 'screenshots', 'settings-page.png') });

    const bodyText = await page.locator('body').textContent();
    console.log('Has "Claude API Key":', bodyText?.includes('Claude API Key'));
    console.log('Has "ChatGPT API Key":', bodyText?.includes('ChatGPT API Key'));
    console.log('Has "OpenRouter":', bodyText?.includes('OpenRouter'));
    console.log('Has "Ollama":', bodyText?.includes('Ollama'));
  }

  // ===== Test 2: Agent Mode page =====
  console.log('\n=== TEST 2: Agent Mode page ===');
  const agentLink = page.locator('text=Agent Mode').first();
  const agentCount = await agentLink.count();
  console.log(`Agent Mode links found: ${agentCount}`);

  if (agentCount > 0) {
    await agentLink.click({ timeout: 5000, force: true });
    await page.waitForTimeout(5000);
    console.log('Clicked Agent Mode');

    await page.screenshot({ path: path.join(REPO, 'screenshots', 'agents-final.png') });

    const bodyText = await page.locator('body').textContent();

    const agents = [
      'Creative Writer',
      'Code Reviewer',
      'Financial Analyst',
      'Data Extractor',
      'Web Researcher',
    ];

    console.log('\n--- New agents ---');
    for (const name of agents) {
      const found = bodyText?.includes(name);
      console.log(`${name}: ${found ? '✓ FOUND' : '✗ MISSING'}`);
    }

    console.log('\n--- Export/Import ---');
    console.log('Has "Import agents from a file":', bodyText?.includes('Import agents from a file'));
    console.log('Has "Export":', bodyText?.includes('Export'));

    // Check for buttons with specific titles
    const exportTitle = await page.locator('button[title*="Export" i]').count();
    const importTitle = await page.locator('button[title*="Import" i]').count();
    console.log(`Export buttons: ${exportTitle}`);
    console.log(`Import buttons: ${importTitle}`);
  }

  console.log('\n=== DONE ===');
  await app.close();
}

main().catch(e => { console.error(e); process.exit(1); });
