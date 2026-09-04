const path = require('path');
const os = require('os');
const { _electron } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));

const REPO = path.resolve(__dirname, '..');
const ISOLATED = path.join(os.tmpdir(), 'aihub-test-' + Date.now());
const ELECTRON = path.join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe');

(async () => {
  const env = { ...process.env, USERPROFILE: ISOLATED, HOME: ISOLATED };
  const app = await _electron.launch({ executablePath: ELECTRON, args: [REPO], cwd: REPO, env });
  const page = await app.firstWindow();
  app.process().stdout.on('data', d => process.stdout.write(d));
  await page.waitForTimeout(5000);

  const agentLinks = await page.locator('text=Agent Mode').all();
  console.log('Agent Mode elements found:', agentLinks.length);
  for (let i = 0; i < agentLinks.length; i++) {
    const tag = await agentLinks[i].evaluate(el => el.tagName);
    const cls = await agentLinks[i].getAttribute('class').catch(() => '');
    console.log('  [' + i + '] tag=' + tag + ' class=' + (cls || '').substring(0, 60));
  }

  if (agentLinks.length > 0) {
    await agentLinks[0].click();
    await page.waitForTimeout(3000);
    console.log('\nAfter click, headings:');
    const headings = await page.locator('h1, h2, h3').all();
    for (let i = 0; i < Math.min(15, headings.length); i++) {
      const t = await headings[i].textContent().catch(() => '');
      if (t) console.log('  ', t.trim().substring(0, 80));
    }

    const bodyText = await page.locator('body').textContent();
    console.log('\nHas Data Extractor:', bodyText.includes('Data Extractor'));
    console.log('Has Creative Writer:', bodyText.includes('Creative Writer'));
    console.log('Has Import:', bodyText.includes('Import'));
  }

  await app.close();
})();
