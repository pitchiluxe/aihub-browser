import { _electron } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = process.cwd(), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aihub-originals-e2e-'))
const executablePath = process.platform === 'darwin' ? path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron') : path.join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let app, page, processHandle, passed = 0
function check(label, value) { assert.ok(value, label); passed++; console.log('PASS ' + label) }
try {
  const env = { ...process.env, USERPROFILE: profile, HOME: profile, NODE_ENV: 'production' }
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
  app = await _electron.launch({ executablePath, args: [root], cwd: root, env, timeout: 60_000 })
  processHandle = app.process(); page = await app.firstWindow(); page.setDefaultTimeout(20_000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('button', { name: 'Game room', exact: true }).last().click()
  await page.getByRole('button', { name: 'Originals', exact: true }).click()
  for (const title of ['Echo Heist', 'Orbit Auction', 'Rulequake']) check(`${title} is in Originals`, await page.getByRole('button', { name: `Play ${title}`, exact: true }).isVisible())
  check('Originals filter excludes other games', await page.getByRole('button', { name: 'Play Solitaire', exact: true }).count() === 0)
  fs.mkdirSync(path.join(root, 'test-shots'), { recursive: true })
  await page.screenshot({ path: path.join(root, 'test-shots/originals-library.png') })
  await page.getByRole('button', { name: 'Play Echo Heist', exact: true }).click()
  const code = page.getByLabel('Echo Heist challenge code', { exact: true })
  await code.fill('RQ-0000001'); await page.getByRole('button', { name: 'Play code', exact: true }).click()
  check('Wrong-game code is rejected', await page.getByRole('alert').filter({ hasText: 'Enter a code' }).isVisible())
  await code.fill('EH-0000016'); await page.getByRole('button', { name: 'Play code', exact: true }).click()
  const firstBoard = await page.getByTestId('echo-board').innerHTML()
  for (const direction of ['right', 'up', 'left', 'down']) await page.getByRole('button', { name: `Heist ${direction}`, exact: true }).click()
  check('Echo actually collides after a four-move loop', await page.getByText('Echo collision! One heart and 150 points lost.', { exact: true }).isVisible())
  await page.getByRole('button', { name: 'Play code', exact: true }).click()
  check('Same challenge resets to identical crystal positions', firstBoard === await page.getByTestId('echo-board').innerHTML())
  await page.getByRole('button', { name: 'Heist up', exact: true }).click()
  check('Heist touch control moves the player', (await page.getByTestId('echo-board').getAttribute('aria-label')).includes('row 3, column 4'))
  await page.keyboard.press('ArrowRight')
  check('Heist keyboard control moves the player', (await page.getByTestId('echo-board').getAttribute('aria-label')).includes('row 3, column 5'))
  await page.screenshot({ path: path.join(root, 'test-shots/originals-echo.png') })
  await page.getByRole('button', { name: 'Random setup', exact: true }).click()
  check('Random setup generates a new valid code', /^EH-[0-9A-Z]{7}$/.test(await code.inputValue()) && await code.inputValue() !== 'EH-0000016')
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copiedChallenge = text } } }) })
  await page.getByRole('button', { name: 'Copy challenge', exact: true }).click()
  check('Sharing copies a usable challenge rather than a fake URL', await page.evaluate(() => window.__copiedChallenge.includes('Echo Heist · EH-') && window.__copiedChallenge.includes('Game room')))
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await page.getByRole('button', { name: 'Play Orbit Auction', exact: true }).click()
  await page.getByLabel('Orbit Auction challenge code', { exact: true }).fill('OA-0000000')
  await page.getByRole('button', { name: 'Play code', exact: true }).click()
  await page.getByRole('button', { name: 'Reverse ←', exact: true }).click()
  check('Orbit reverses direction and spends fuel', (await page.getByRole('img', { name: /^Orbit Auction/ }).getAttribute('aria-label')).includes('Ship at 12'))
  await page.getByRole('button', { name: 'Play code', exact: true }).click()
  for (let i = 0; i < 8; i++) {
    await page.getByRole('button', { name: 'Coast →', exact: true }).click()
    if (Number((await page.getByRole('img', { name: /^Orbit Auction/ }).getAttribute('aria-label')).match(/cargo (\d+)/)[1]) > 0) break
  }
  const cargo = Number((await page.getByRole('img', { name: /^Orbit Auction/ }).getAttribute('aria-label')).match(/cargo (\d+)/)[1])
  check('Orbit captures stars into real cargo', cargo > 0)
  await page.getByRole('button', { name: 'Bank cargo ↓', exact: true }).click()
  check('Banking ends round with all collected cargo', (await page.locator('.gr-result').innerText()).includes(`${cargo} points secured`))
  check('Original best score persists locally', await page.evaluate(score => JSON.parse(localStorage.getItem('aihub-game-room-scores-v1')).orbit === score, cargo))
  await page.getByRole('button', { name: 'Copy challenge', exact: true }).click()
  check('Finished challenge includes score and seed', await page.evaluate(score => window.__copiedChallenge.includes(`I scored ${score}`) && window.__copiedChallenge.includes('OA-0000000'), cargo))
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await page.getByRole('button', { name: 'Play Rulequake', exact: true }).click()
  await page.getByRole('button', { name: 'Start round', exact: true }).click()
  const initialRule = await page.locator('.gr-quake-rule strong').innerText()
  // Find a correct AND tile by its accessible description, not hidden game state.
  const [color, shape] = initialRule.split(' AND ')
  await page.getByRole('button', { name: new RegExp(`^${color} ${shape} `) }).first().click()
  check('Rulequake scores a correct logical match', await page.getByText('Correct. New board, new rule!', { exact: true }).isVisible())
  check('Rulequake rotates to exclusive OR', (await page.locator('.gr-quake-rule strong').innerText()).includes('but NOT both'))
  const seconds = page.locator('.gr-stats>div').filter({ has: page.getByText('Seconds', { exact: true }) }).locator('strong')
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  const time = await seconds.innerText(); await sleep(700)
  check('Paused Rulequake timer does not advance', time === await seconds.innerText())
  await page.getByRole('button', { name: 'Resume game', exact: true }).click()
  await sleep(400)
  check('Resuming restarts the countdown', Number(await seconds.innerText()) < Number(time))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('app-shortcut', 'new-tab'))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('app-shortcut', 'prev-tab'))
  await page.getByRole('button', { name: 'Resume game', exact: true }).waitFor()
  check('Tab changes pause Originals too', await page.locator('.gr-pause-cover').isVisible())
  await page.getByRole('button', { name: 'Resume game', exact: true }).click()
  await page.screenshot({ path: path.join(root, 'test-shots/originals-rulequake.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 900))
  await sleep(200)
  check('Original game fits a narrow desktop window', await page.locator('.game-room').evaluate(element => element.scrollWidth <= element.clientWidth + 1))
  await page.screenshot({ path: path.join(root, 'test-shots/originals-narrow.png') })
  for (let mistake = 0; mistake < 3; mistake++) {
    const rule = await page.locator('.gr-quake-rule strong').innerText()
    const labels = await page.locator('.gr-quake-tile').evaluateAll(tiles => tiles.map(tile => tile.getAttribute('aria-label')))
    const wrong = labels.findIndex(label => {
      const [color, shape, number] = label.split(' ')
      if (rule.startsWith('NOT ')) {
        const forbidden = rule.split(' ')[1]
        return !(shape !== forbidden && (Number(number.replace(',', '')) % 2 === 0) === rule.includes('even'))
      }
      if (rule.includes('but NOT both')) {
        const [wantedColor, , wantedShape] = rule.split(' ')
        return (color === wantedColor) === (shape === wantedShape)
      }
      const [wantedColor, , wantedShape] = rule.split(' ')
      return !(color === wantedColor && shape === wantedShape)
    })
    assert.ok(wrong >= 0, 'A wrong tile is available for the error path')
    await page.locator('.gr-quake-tile').nth(wrong).click()
  }
  check('Three mistakes end Rulequake and preserve the earned score', (await page.locator('.gr-result').innerText()).includes('120 points'))
  check('Finished Rulequake score is saved locally', await page.evaluate(() => JSON.parse(localStorage.getItem('aihub-game-room-scores-v1')).rulequake === 120))
  check('No renderer exceptions during Originals gameplay', errors.length === 0)
  console.log(JSON.stringify({ passed, profile }))
} catch (error) {
  console.error(error); process.exitCode = 1
  if (page) await page.screenshot({ path: path.join(root, 'test-shots/originals-error.png') }).catch(() => {})
} finally {
  if (app) { await Promise.race([app.close().catch(() => {}), sleep(5000)]); if (processHandle?.exitCode === null) processHandle.kill() }
}
