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
  // A competent captain (mirrors the 'balanced' policy from scripts/balance.ts):
  // steer onto the target, cut throttle when it camps our rear arc, triage
  // repairs, sweep hard when it cloaks. Test-side code may use atan2 freely.
  const executeRound = () =>
    page.evaluate(() => {
      const v = window.__sc.view()
      const ship = v.game.ship
      const me = v.game.encounter.ships.find((s) => s.id === ship.id)
      const enemy = v.game.encounter.ships.find((s) => s.id !== ship.id)
      const cloaked = enemy?.cloaked
      const dx = enemy.pos.x - me.pos.x
      const dy = enemy.pos.y - me.pos.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      const desired = Math.round((Math.atan2(dy, dx) * 8) / Math.PI + 16) % 16
      let turn = desired - me.heading
      while (turn > 8) turn -= 16
      while (turn <= -8) turn += 16
      const behind = Math.abs(turn) >= 4
      let throttle
      if (cloaked) throttle = 1
      else if (behind && dist < 9) throttle = 0
      else if (dist > 12) throttle = 2
      else if (dist > 6) throttle = 2
      else throttle = 1
      const repair =
        ['weapons', 'engines', 'shields', 'sensors'].find(
          (sys) => me.subsystems[sys].hp > 0 && me.subsystems[sys].hp / me.subsystems[sys].maxHp < 0.5,
        ) ?? null
      window.__sc.callbacks.onExecuteRound({
        shipId: ship.id,
        helm: { turn, throttle },
        tactical: cloaked ? {} : { firePhasers: { targetId: 'enemy', subsystem: null } },
        engineering: {
          power: cloaked
            ? { engines: 1, shields: 3, weapons: 0, sensors: 4 }
            : { engines: 2, shields: 3, weapons: 4, sensors: 1 },
          repair,
        },
        science: { scanTargetId: 'enemy' },
      })
    })
  await executeRound()
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

  // --- Fight the battle to a finish through the same path (cap 35 rounds)
  for (let i = 0; i < 35; i++) {
    const status = await page.evaluate(() => window.__sc.view().game.encounter?.status)
    if (status && status !== 'active') break
    await executeRound()
    await page.waitForFunction(() => !window.__sc.isBusy(), undefined, { timeout: 30000 })
  }
  const finalStatus = await page.evaluate(() => window.__sc.view().game.encounter?.status)
  if (!finalStatus || finalStatus === 'active') {
    throw new Error(`battle did not finish in 35 rounds (status=${finalStatus})`)
  }
  if (finalStatus === 'defeat') throw new Error('smoke captain lost to the raider — balance?')
  await shot('5-battle-end')

  // --- Conclude: mission resolves, follow-up mission activates
  await page.evaluate(() => window.__sc.callbacks.onConcludeEncounter())
  const post = await page.evaluate(() => {
    const v = window.__sc.view()
    return {
      screen: v.screen,
      m1: v.game.missions[0]?.stage,
      m2: v.game.missions[1]?.stage,
      archive: v.game.logArchive.length,
    }
  })
  if (post.screen !== 'sector') throw new Error(`expected sector after conclude, got ${post.screen}`)
  if (post.m1 !== 'resolved') throw new Error(`m1 not resolved (${post.m1})`)
  if (post.m2 !== 'active') throw new Error(`m2 did not activate (${post.m2})`)
  if (post.archive < 10) throw new Error('log archive suspiciously empty')
  await shot('6-mission-complete')

  // --- Mute toggle exists and flips state
  const mutedBefore = await page.evaluate(() => window.__sc.view().muted)
  await page.evaluate(() => window.__sc.callbacks.onToggleMute())
  const mutedAfter = await page.evaluate(() => window.__sc.view().muted)
  if (mutedBefore === mutedAfter) throw new Error('mute toggle had no effect')

  // --- Hot-seat skirmish (M2.5): fed cruiser vs cloaked Bird-of-Prey
  await page.evaluate(() => {
    window.__sc.callbacks.onOpenSkirmishSetup()
    window.__sc.callbacks.onStartSkirmish({ seed: 7, shipClassA: 'fed-cruiser', shipClassB: 'klingon-bop' })
  })
  const skirmishStart = await page.evaluate(() => window.__sc.view().screen)
  if (skirmishStart !== 'skirmish') throw new Error(`skirmish did not start (${skirmishStart})`)
  await shot('7-skirmish')

  const seatOrders = (seat) =>
    page.evaluate((seatId) => {
      const v = window.__sc.view()
      const sk = v.skirmish
      const myId = sk.shipIds[seatId]
      const me = sk.encounter.ships.find((s) => s.id === myId)
      const foe = sk.encounter.ships.find((s) => s.id !== myId)
      const hasCloak = me.classId === 'klingon-bop'
      window.__sc.callbacks.onSkirmishOrders({
        shipId: myId,
        // Captain B (BoP) cloaks on round 2+ to exercise POV hiding; A sweeps.
        helm: { turn: 1, throttle: 2, ...(hasCloak && sk.round >= 2 ? { cloak: true } : {}) },
        tactical: foe.cloaked || (hasCloak && sk.round >= 2)
          ? {}
          : { firePhasers: { targetId: foe.id, subsystem: null } },
        science: { scanTargetId: foe.id },
        engineering: {
          power: foe.cloaked
            ? { engines: 1, shields: 3, weapons: 0, sensors: 4 }
            : { engines: 2, shields: 2, weapons: 4, sensors: 2 },
          repair: null,
        },
      })
    }, seat)

  for (let round = 0; round < 3; round++) {
    // Seat A orders (screen: skirmish, seat A)
    await seatOrders('A')
    let scr = await page.evaluate(() => window.__sc.view().screen)
    if (scr !== 'handoff') throw new Error(`expected handoff after A's orders, got ${scr}`)
    if (round === 0) await shot('8-handoff')
    await page.evaluate(() => window.__sc.callbacks.onHandoffReady())
    // Seat B orders → resolve + replay
    await seatOrders('B')
    await page.waitForFunction(() => !window.__sc.isBusy(), undefined, { timeout: 30000 })
    const st = await page.evaluate(() => ({
      screen: window.__sc.view().screen,
      status: window.__sc.view().skirmish?.encounter.status,
      round: window.__sc.view().skirmish?.encounter.round,
    }))
    if (st.status !== 'active') break // early finish is legal
    if (st.screen !== 'handoff') throw new Error(`expected handoff after replay, got ${st.screen}`)
    await page.evaluate(() => window.__sc.callbacks.onHandoffReady())
  }
  // The BoP cloaked from round 2: the public replay must have hidden it — no
  // direct pixel assert here, but the POV path is exercised; console errors fail us.
  const skirmishState = await page.evaluate(() => {
    const v = window.__sc.view()
    return { round: v.skirmish?.encounter.round, cloakedB: v.skirmish?.encounter.ships[1]?.cloaked }
  })
  if (!skirmishState.round || skirmishState.round < 3) {
    throw new Error(`skirmish rounds did not advance (round=${skirmishState.round})`)
  }
  await shot('9-skirmish-late')
  await page.evaluate(() => window.__sc.callbacks.onLeaveSkirmish())
  const backAt = await page.evaluate(() => window.__sc.view().screen)
  if (backAt !== 'menu') throw new Error(`leave skirmish should return to menu, got ${backAt}`)

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
