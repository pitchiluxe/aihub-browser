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
  app.process().stderr.on('data', d => process.stderr.write(d));
  await page.waitForTimeout(5000);

  const settingsLinks = await page.locator('text=Settings').all();
  console.log('Settings elements found:', settingsLinks.length);
  for (let i = 0; i < settingsLinks.length; i++) {
    const tag = await settingsLinks[i].evaluate(el => el.tagName);
    const cls = await settingsLinks[i].getAttribute('class').catch(() => '');
    console.log('  [' + i + '] tag=' + tag + ' class=' + (cls || '').substring(0, 80));
  }

  if (settingsLinks.length > 0) {
    console.log('\nClicking first Settings...');
    await settingsLinks[0].click();
    await page.waitForTimeout(3000);
    console.log('After click, headings:');
    const headings = await page.locator('h1, h2, h3').all();
    for (let i = 0; i < Math.min(15, headings.length); i++) {
      const t = await headings[i].textContent().catch(() => '');
      if (t) console.log('  ', t.trim().substring(0, 80));
    }

    const bodyText = await page.locator('body').textContent();
    console.log('\nHas Claude API Key:', bodyText.includes('Claude API Key'));
    console.log('Has ChatGPT API Key:', bodyText.includes('ChatGPT API Key'));
    console.log('Has OpenRouter:', bodyText.includes('OpenRouter'));
    console.log('Has Ollama:', bodyText.includes('Ollama'));
  }

  await app.close();
})();
