// drive-bible-month-voice.js — the Study room's monthly reading, and the
// natural reading voice end to end: install from Settings, then Listen.
const path = require('path')
const os = require('os')
const fs = require('fs')

const REPO = path.resolve(__dirname, '..')
const ISOLATED = path.join(os.tmpdir(), `aihub-month-voice-${Date.now()}`)
const SHOTS = path.join(REPO, 'test-shots')
const ELECTRON = path.join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe')
const { _electron } = require(path.join(os.homedir(), 'node_modules', 'playwright-core'))

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true })
  const env = { ...process.env, USERPROFILE: ISOLATED, HOME: ISOLATED }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({ executablePath: ELECTRON, args: [REPO], cwd: REPO, env })
  app.process().stdout.on('data', d => { const s = String(d); if (/voice|tts|kokoro/i.test(s)) process.stdout.write('[main] ' + s) })
  app.process().stderr.on('data', d => { const s = String(d); if (/voice|tts|kokoro/i.test(s)) process.stdout.write('[main:err] ' + s) })
  const win = await app.firstWindow()
  win.on('pageerror', err => console.log('[page error]', err.message))
  await win.waitForFunction(() => document.querySelectorAll('#root > *').length > 0, { timeout: 30000 })

  const go = async url => {
    const bar = win.locator('input[placeholder*="right-click for Paste"]')
    await bar.click(); await bar.fill(url); await bar.press('Enter')
  }

  // aihub:// typed into the omnibox becomes a Google search; the sidebar is
  // the user's own way in. It starts collapsed.
  const openStudy = async () => {
    // The sidebar entry, not the home page's app tile of the same name.
    const sidebarEntry = () => win.evaluate(() => {
      const el = [...document.querySelectorAll('span')].find(e => e.textContent === 'Bible Study' && e.getBoundingClientRect().left < 200 && e.getBoundingClientRect().width > 0)
      if (el) (el.closest('button') || el).click()
      return !!el
    })
    if (!(await sidebarEntry())) { await win.mouse.click(26, 66); await win.waitForTimeout(500); await sidebarEntry() }
    await win.waitForSelector('text=A verse a day', { timeout: 10000 })
  }

  // ── Study room → Study → this month ───────────────────────────────────
  await openStudy()
  await win.locator('button:has-text("Study")').filter({ hasText: /^\s*Study\s*$/ }).first().click()
  const monthTab = win.locator('button', { hasText: / reading\s*$/ }).first()
  console.log('month tab:', await monthTab.textContent())
  await win.waitForSelector('text=A Season of Harvest', { timeout: 10000 })
  console.log('October theme shown')
  await win.waitForTimeout(800)
  await win.screenshot({ path: path.join(SHOTS, 'month-october.png') })

  await win.locator('button[title="Next month"]').click()
  await win.waitForSelector('text=A Grateful Heart', { timeout: 5000 })
  await win.waitForTimeout(800)
  await win.screenshot({ path: path.join(SHOTS, 'month-november.png') })
  console.log('November theme shown')

  // Mark day 1 read and check the progress count moves.
  await win.locator('button', { hasText: /^\s*Mark November 1 read/ }).click()
  await win.waitForSelector('text=1/30 days', { timeout: 3000 })
  console.log('progress recorded: 1/30')

  // ── Natural voice: nobody installs it — a Listen button on screen does ──
  const status = await win.evaluate(() => window.electronAPI.voice.status())
  console.log('voice on a fresh profile, page open:', status.installed ? 'installed' : status.installing ? 'downloading by itself' : 'NOT STARTED')
  if (!status.installed && !status.installing) throw new Error('natural voice download did not start on its own')

  // Count every utterance handed to the system (robotic) voice.
  await win.evaluate(() => {
    window.__systemUtterances = 0
    const original = window.speechSynthesis.speak.bind(window.speechSynthesis)
    window.__systemTexts = []
    window.speechSynthesis.speak = u => { window.__systemUtterances++; window.__systemTexts.push(u.text); return original(u) }
  })

  // ── Listen on the month verse, pressed straight away ─────────────────
  const listen = win.locator('button', { hasText: /^\s*Listen\s*$/ }).first()
  await listen.waitFor({ timeout: 10000 })
  let t = Date.now()
  await listen.click()
  const preparing = await win.locator('button', { hasText: /Preparing voice/ }).first().isVisible().catch(() => false)
  console.log('button while downloading:', preparing ? '"Preparing voice …%"' : '(already installed)')
  await win.locator('button', { hasText: /^\s*Stop\s*$/ }).first().waitFor({ timeout: 300000 })
  console.log('Listen → playing after', (Date.now() - t) + 'ms')
  const systemUtterances = await win.evaluate(() => window.__systemUtterances)
  console.log('utterances sent to the system voice:', systemUtterances)
  if (systemUtterances) {
    console.log('system voice read:', JSON.stringify(await win.evaluate(() => window.__systemTexts)))
    console.log('direct speak now:', JSON.stringify(await win.evaluate(async () => { const r = await window.electronAPI.voice.speak('Always rejoice.', 'af_heart', 0.92); return { error: r.error, n: r.samples && r.samples.length } })))
  }
  if (systemUtterances !== 0) throw new Error('fell back to the robotic system voice')
  await win.waitForTimeout(4000)
  await win.locator('button', { hasText: /^\s*Stop\s*$/ }).first().click()
  await win.locator('button', { hasText: /^\s*Listen\s*$/ }).first().waitFor({ timeout: 3000 })
  console.log('stopped cleanly')

  // ── Louis Segond in the main reader: the French natural voice, not the
  //    robotic English one (this machine has no French system voice) ────
  await win.evaluate(() => { window.__systemUtterances = 0 })
  const bibleEntry = () => win.evaluate(() => {
    const el = [...document.querySelectorAll('span')].find(e => e.textContent === 'Bible' && e.getBoundingClientRect().left < 200 && e.getBoundingClientRect().width > 0)
    if (el) (el.closest('button') || el).click()
    return !!el
  })
  if (!(await bibleEntry())) { await win.mouse.click(26, 66); await win.waitForTimeout(500); await bibleEntry() }
  const version = win.locator('select[title="Bible version"]')
  await win.waitForTimeout(1500)
  if (!(await version.isVisible().catch(() => false))) {
    // The Bible opens on its closed cover; clicking the book opens it.
    const box = await win.evaluate(() => {
      const r = [...document.querySelectorAll('div')].find(d => /HOLY|Holy Bible/.test(d.textContent || '') && d.getBoundingClientRect().width > 300 && d.getBoundingClientRect().width < 900)?.getBoundingClientRect()
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null
    })
    await win.mouse.click(box?.x ?? 840, box?.y ?? 480)
    await win.waitForTimeout(2500)
  }
  await version.selectOption('LSG', { timeout: 15000 })
  await win.waitForTimeout(1500)
  t = Date.now()
  await win.locator('button[data-listen="idle"]:visible').first().click()
  await win.locator('button[data-listen="playing"]:visible').first().waitFor({ timeout: 60000 })
  console.log('LSG main reader Listen → playing after', (Date.now() - t) + 'ms')
  await win.waitForTimeout(3000)
  const frenchSystem = await win.evaluate(() => window.__systemUtterances)
  console.log('LSG utterances sent to the system voice:', frenchSystem)
  if (frenchSystem !== 0) throw new Error('French reading fell back to the robotic system voice')
  await win.locator('button[data-listen="playing"]:visible').first().click()

  // ── One language: with Louis Segond open, no English in the Bible screens ──
  // Words from the Bible's own interface that must not survive in French.
  const ENGLISH = ['Read it', 'Listen', 'Monthly reading', 'Reading plans', 'Saved', 'Highlighted',
    'Today', 'Classroom', 'Progress', 'Verse for today', 'Meditate', 'Learn by heart', 'Search',
    'Study', 'Graph', 'Ask', 'Mark', 'days', 'Finding it', 'courses', 'lessons', 'Badges',
    'Nothing', 'verse for the month', 'Previous', 'Next', 'Generate', 'Drill', 'Known by heart']
  const englishOnScreen = () => win.evaluate(words => {
    const pages = [...document.querySelectorAll('.page-enter, .bg-aihub-bg')].filter(e => e.getBoundingClientRect().width > 0)
    const text = pages.map(p => p.innerText).join('\n')
    return words.filter(w => new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, 'u').test(text))
  }, ENGLISH)
  const report = async where => {
    const found = await englishOnScreen()
    console.log(`${where}: ${found.length ? 'ENGLISH LEFT → ' + found.join(', ') : 'all French'}`)
    return found.length
  }
  let leftovers = await report('reader (Louis Segond)')
  const studyEntry = () => win.evaluate(() => {
    const el = [...document.querySelectorAll('span')].find(e => e.textContent === 'Bible Study' && e.getBoundingClientRect().left < 200 && e.getBoundingClientRect().width > 0)
    if (el) (el.closest('button') || el).click()
    return !!el
  })
  if (!(await studyEntry())) { await win.mouse.click(26, 66); await win.waitForTimeout(500); await studyEntry() }
  await win.waitForTimeout(1500)
  for (const room of ['Aujourd’hui', 'Étude', 'Classe', 'Labo', 'Progrès']) {
    await win.locator('button:visible', { hasText: room }).first().click()
    await win.waitForTimeout(1200)
    leftovers += await report(`study: ${room}`)
    if (room === 'Étude') {
      await win.screenshot({ path: path.join(SHOTS, 'study-french.png') })
      await win.locator('button:visible', { hasText: 'Plans de lecture' }).first().click()
      await win.waitForTimeout(800)
      leftovers += await report('study: plans de lecture')
    }
  }
  if (leftovers) throw new Error('English left in the French Bible')

  await app.close()
  fs.rmSync(ISOLATED, { recursive: true, force: true })
}

main().catch(err => { console.error('FAILED', err); process.exit(1) })
