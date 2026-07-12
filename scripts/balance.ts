// Balance harness: plays headless battles across player strategies x enemy
// classes x seeds and reports outcome distributions. Run with:
//   npx tsx scripts/balance.ts [seeds-per-cell]
//
// This is the tuning instrument for src/sim/constants.ts and ship data — the
// deterministic sim makes large-scale automated playtesting nearly free.

import { klingonAI } from '../src/sim/ai'
import { createEncounter, resolveRound } from '../src/sim/encounter'
import { distance, headingDelta, headingToward } from '../src/sim/geometry'
import { createRng } from '../src/sim/rng'
import { createShip } from '../src/sim/ship'
import type { EncounterState, OrderSet, RoundEvent, ShipState } from '../src/sim/types'

const SEEDS = Number(process.argv[2] ?? 60)
const MAX_ROUNDS = 40
const ENEMIES = ['klingon-raptor', 'klingon-bop', 'klingon-ktinga'] as const

interface Policy {
  name: string
  orders(s: EncounterState): OrderSet
}

function player(s: EncounterState): ShipState {
  return s.ships[0]!
}
function enemy(s: EncounterState): ShipState {
  return s.ships[1]!
}

/** Shared helm: steer toward foe; cut throttle if it camps our rear up close. */
function helm(s: EncounterState, aggressive: boolean): { turn: number; throttle: number } {
  const p = player(s)
  const e = enemy(s)
  const turn = headingDelta(p.heading, headingToward(p.pos, e.pos))
  const dist = distance(p.pos, e.pos)
  const behind = Math.abs(turn) >= 4
  let throttle: number
  if (e.cloaked) throttle = 1 // don't sprint blind
  else if (behind && dist < 9) throttle = 0
  else if (dist > 12) throttle = aggressive ? 3 : 2
  else if (dist > 6) throttle = 2
  else throttle = 1
  return { turn, throttle }
}

/** When the enemy is cloaked: max sensors and sweep every round. */
function cloakedResponse(s: EncounterState, base: OrderSet): OrderSet {
  const e = enemy(s)
  if (!e.cloaked) return base
  return {
    ...base,
    tactical: {},
    science: { scanTargetId: e.id },
    engineering: { power: { engines: 1, shields: 3, weapons: 0, sensors: 4 }, repair: base.engineering.repair },
  }
}

const POLICIES: Policy[] = [
  {
    name: 'aggressive',
    orders(s) {
      const e = enemy(s)
      const base: OrderSet = {
        shipId: 'player',
        helm: helm(s, true),
        tactical: {
          firePhasers: { targetId: e.id, subsystem: null },
          ...(distance(player(s).pos, e.pos) > 5 && player(s).torpedoes > 0
            ? { fireTorpedo: { targetId: e.id } }
            : {}),
        },
        science: e.scanLevel < 1 ? { scanTargetId: e.id } : {},
        engineering: { power: { engines: 2, shields: 2, weapons: 4, sensors: 2 }, repair: repairPick(s) },
      }
      return cloakedResponse(s, base)
    },
  },
  {
    name: 'balanced',
    orders(s) {
      const e = enemy(s)
      const base: OrderSet = {
        shipId: 'player',
        helm: helm(s, false),
        tactical: { firePhasers: { targetId: e.id, subsystem: null } },
        science: e.scanLevel < 1 ? { scanTargetId: e.id } : {},
        engineering: { power: { engines: 2, shields: 3, weapons: 4, sensors: 1 }, repair: repairPick(s) },
      }
      return cloakedResponse(s, base)
    },
  },
  {
    name: 'disabler',
    orders(s) {
      const e = enemy(s)
      const scanned = e.scanLevel >= 1
      // Work down the disable list: weapons, then engines (dead systems skipped).
      const disableTarget = (['weapons', 'engines'] as const).find((sys) => e.subsystems[sys].hp > 0)
      const base: OrderSet = {
        shipId: 'player',
        helm: helm(s, false),
        tactical: {
          firePhasers: { targetId: e.id, subsystem: scanned ? (disableTarget ?? null) : null },
        },
        science: !scanned ? { scanTargetId: e.id } : {},
        engineering: { power: { engines: 2, shields: 2, weapons: 4, sensors: 2 }, repair: repairPick(s) },
      }
      return cloakedResponse(s, base)
    },
  },
  {
    name: 'turtle',
    orders(s) {
      const e = enemy(s)
      const base: OrderSet = {
        shipId: 'player',
        helm: { ...helm(s, false), throttle: Math.min(helm(s, false).throttle, 1) },
        tactical: { firePhasers: { targetId: e.id, subsystem: null } },
        science: e.scanLevel < 1 ? { scanTargetId: e.id } : {},
        engineering: { power: { engines: 1, shields: 4, weapons: 3, sensors: 2 }, repair: repairPick(s) },
      }
      return cloakedResponse(s, base)
    },
  },
]

function repairPick(s: EncounterState): 'weapons' | 'engines' | 'shields' | 'sensors' | null {
  const p = player(s)
  for (const sys of ['weapons', 'engines', 'shields', 'sensors'] as const) {
    const sub = p.subsystems[sys]
    if (sub.hp > 0 && sub.hp / sub.maxHp < 0.5) return sys
  }
  return null
}

interface CellStats {
  wins: number
  disables: number
  enemyFled: number
  losses: number
  stalemates: number
  rounds: number[]
  hullLeft: number[]
  playerShots: number
  playerHits: number
  enemyShots: number
  enemyHits: number
}

function runBattle(policy: Policy, enemyClass: string, seed: number, stats: CellStats): void {
  const rng = createRng(seed)
  const p = createShip('player', 'USS Farragut', 'fed-cruiser', { x: 0, y: 0 }, 0)
  const e = createShip('enemy', 'IKS Target', enemyClass, { x: 0, y: 0 }, 8)
  let s = createEncounter(p, e, rng)
  const aiRng = createRng(seed ^ 0xabcdef)
  let rounds = 0
  while (s.status === 'active' && rounds < MAX_ROUNDS) {
    const orders = [policy.orders(s), klingonAI(s, 'enemy', aiRng)]
    const result = resolveRound(s, orders, rng)
    s = result.state
    tally(result.events, stats)
    rounds++
  }
  stats.rounds.push(rounds)
  switch (s.status) {
    case 'victory':
      stats.wins++
      stats.hullLeft.push(player(s).hull)
      break
    case 'enemy-disabled':
      stats.disables++
      stats.hullLeft.push(player(s).hull)
      break
    case 'enemy-withdrawn':
      stats.enemyFled++
      stats.hullLeft.push(player(s).hull)
      break
    case 'defeat':
      stats.losses++
      break
    default:
      stats.stalemates++
  }
}

function tally(events: RoundEvent[], stats: CellStats): void {
  for (const ev of events) {
    if (ev.type === 'phaser-fire') {
      if (ev.shooterId === 'player') {
        stats.playerShots++
        if (ev.hit) stats.playerHits++
      } else {
        stats.enemyShots++
        if (ev.hit) stats.enemyHits++
      }
    }
  }
}

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${Math.round((100 * n) / d)}%`
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

console.log(`Balance sweep: ${POLICIES.length} policies x ${ENEMIES.length} enemies x ${SEEDS} seeds\n`)
const header = ['policy', 'enemy', 'win', 'disable', 'fled', 'loss', 'stale', 'medRnd', 'medHull', 'pHit', 'eHit']
console.log(header.map((h) => h.padEnd(10)).join(''))
for (const policy of POLICIES) {
  for (const enemyClass of ENEMIES) {
    const stats: CellStats = {
      wins: 0,
      disables: 0,
      enemyFled: 0,
      losses: 0,
      stalemates: 0,
      rounds: [],
      hullLeft: [],
      playerShots: 0,
      playerHits: 0,
      enemyShots: 0,
      enemyHits: 0,
    }
    for (let seed = 1; seed <= SEEDS; seed++) runBattle(policy, enemyClass, seed * 101, stats)
    const row = [
      policy.name,
      enemyClass.replace('klingon-', ''),
      pct(stats.wins, SEEDS),
      pct(stats.disables, SEEDS),
      pct(stats.enemyFled, SEEDS),
      pct(stats.losses, SEEDS),
      pct(stats.stalemates, SEEDS),
      String(median(stats.rounds)),
      String(Math.round(median(stats.hullLeft))),
      pct(stats.playerHits, stats.playerShots),
      pct(stats.enemyHits, stats.enemyShots),
    ]
    console.log(row.map((c) => c.padEnd(10)).join(''))
  }
}
console.log(
  '\nSuccess = win+disable+fled. Targets: balanced vs raptor ~85%, vs bop ~70%, vs ktinga ~55%;',
  '\nmedian rounds 8-16; enemy hit rate 35-60%; no stalemates.',
)
