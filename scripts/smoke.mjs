// End-to-end smoke test: boots the BUILT game (dist/index.html) in headless
// Chromium and plays the M1 core loop through the same callback paths the UI
// uses — menu → new game → travel → mission encounter → one WEGO round.
// Fails on any console error / pageerror, or if the loop doesn't progress.
//
// Usage: npm run build && npm run smoke [-- --screens]
//   --screens  also dump PNGs of each screen to scratch/ (gitignored path ok)

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const wantShots = process.argv.includes('--screens')
const shotDir = process.env.SMOKE_SHOT_DIR ?? resolve(root, 'scratch-shots')

// Serve dist/ over http so localStorage works (file:// storage is flaky).
const html = await readFile(resolve(root, 'dist/index.html'))
const server = createServer((_req, res) => {
  res.setHeader('content-type', 'text/html')
  res.end(html)
})
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
const port = server.address().port
const url = `http://127.0.0.1:${port}/`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const problems = []
page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`))
page.on('console', (msg) => {
  if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`)
})

const fail = (msg) => {
  console.error(`\nSMOKE FAIL: ${msg}`)
  if (problems.length) console.error(problems.map((p) => `  - ${p}`).join('\n'))
  process.exitCode = 1
}
const shot = async (name) => {
  if (wantShots) await page.screenshot({ path: `${shotDir}/${name}.png` })
}

try {
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForFunction(() => !!window.__sc, undefined, { timeout: 15000 })

  // --- Menu renders
  await page.waitForSelector('text=STARSHIP COMMAND', { timeout: 5000 })
  await shot('1-menu')

  // --- New game via the real button
  const newMission = page.getByText('NEW MISSION', { exact: false }).first()
  await newMission.click()
  await page.waitForFunction(() => window.__sc.view().screen === 'sector', undefined, {
    timeout: 5000,
  })
  await shot('2-sector')

  const seedView = await page.evaluate(() => {
    // Re-run new game with a fixed seed through the callback path so the rest
    // of the smoke run is deterministic (seed 1: no patrols on the route).
    window.__sc.callbacks.onNewGame(1)
    return window.__sc.view().game.seed
  })
  if (seedView !== 1) throw new Error(`seeded new game failed (seed=${seedView})`)

  // --- Travel the known-clear route to Veyra
  for (const hop of ['archer', 'hromi', 'veyra']) {
    await page.evaluate((id) => window.__sc.callbacks.onTravel(id), hop)
    await page.waitForFunction(() => !window.__sc.isBusy(), undefined, { timeout: 5000 })
  }
  const screenAtVeyra = await page.evaluate(() => window.__sc.view().screen)
  if (screenAtVeyra !== 'encounter') {
    throw new Error(`expected mission encounter at Veyra, got screen=${screenAtVeyra}`)
  }
  await page.waitForTimeout(600)
  await shot('3-encounter')

  // --- Execute one WEGO round through the callback path
  const round1 = await page.evaluate(() => window.__sc.view().game.encounter.round)
  await page.evaluate(() => {
    const v = window.__sc.view()
    const ship = v.game.ship
    window.__sc.callbacks.onExecuteRound({
      shipId: ship.id,
      helm: { turn: 0, throttle: 2 },
      tactical: { firePhasers: { targetId: 'enemy', subsystem: null } },
      engineering: { power: { engines: 2, shields: 3, weapons: 4, sensors: 1 }, repair: null },
      science: { scanTargetId: 'enemy' },
    })
  })
  // Round animation can take a few seconds.
  await page.waitForFunction(() => !window.__sc.isBusy(), undefined, { timeout: 30000 })
  const round2 = await page.evaluate(() => window.__sc.view().game.encounter.round)
  if (round2 !== round1 + 1) throw new Error(`round did not advance (${round1} → ${round2})`)
  await shot('4-after-round')

  // --- Log got battle lines; EXECUTE button exists
  const logText = await page.evaluate(
    () => document.querySelector('#app')?.textContent?.length ?? 0,
  )
  if (logText < 100) throw new Error('UI appears empty after a round')

  if (problems.length) {
    fail('console/page errors during run')
  } else {
    console.log('SMOKE PASS: menu → new game → travel×3 → mission encounter → WEGO round, no errors')
  }
} catch (err) {
  await shot('9-failure')
  fail(err.message)
} finally {
  await browser.close()
  server.close()
}
