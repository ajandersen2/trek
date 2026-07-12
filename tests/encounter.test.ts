import { describe, expect, it } from 'vitest'
import { klingonAI } from '../src/sim/ai'
import { WARP_OUT_MIN_RANGE } from '../src/sim/constants'
import { createEncounter, resolveRound } from '../src/sim/encounter'
import { distance } from '../src/sim/geometry'
import { createRng } from '../src/sim/rng'
import { createShip, defaultPower } from '../src/sim/ship'
import type { EncounterState, OrderSet, RoundEvent } from '../src/sim/types'

// --- helpers ---------------------------------------------------------------

function makeEncounter(seed = 1): EncounterState {
  const rng = createRng(seed)
  const player = createShip('player', 'USS Farragut', 'fed-cruiser', { x: 0, y: 0 }, 0)
  const enemy = createShip('bop', 'IKS Vengeance', 'klingon-bop', { x: 0, y: 0 }, 8)
  return createEncounter(player, enemy, rng)
}

function idle(shipId: string): OrderSet {
  return {
    shipId,
    helm: { turn: 0, throttle: 0 },
    tactical: {},
    engineering: { power: defaultPower() },
  }
}

function ofType<T extends RoundEvent['type']>(
  events: RoundEvent[],
  type: T,
): Extract<RoundEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<RoundEvent, { type: T }>[]
}

/** Place ships at exact positions for scripted scenarios. */
function place(
  s: EncounterState,
  playerPos: { x: number; y: number },
  playerHeading: number,
  enemyPos: { x: number; y: number },
  enemyHeading: number,
): void {
  s.ships[0]!.pos = { ...playerPos }
  s.ships[0]!.heading = playerHeading
  s.ships[1]!.pos = { ...enemyPos }
  s.ships[1]!.heading = enemyHeading
}

// --- setup -----------------------------------------------------------------

describe('createEncounter', () => {
  it('is deterministic for a given seed', () => {
    expect(makeEncounter(42)).toEqual(makeEncounter(42))
  })

  it('spawns the enemy 18-24 out, facing the player', () => {
    for (let seed = 0; seed < 20; seed++) {
      const s = makeEncounter(seed)
      const d = distance(s.ships[0]!.pos, s.ships[1]!.pos)
      expect(d).toBeGreaterThanOrEqual(18)
      expect(d).toBeLessThanOrEqual(25)
    }
  })
})

// --- movement --------------------------------------------------------------

describe('helm', () => {
  it('moves at throttle fraction of max speed with nominal power', () => {
    const s = makeEncounter()
    place(s, { x: 0, y: 0 }, 0, { x: 50, y: 50 }, 8)
    const { state, events } = resolveRound(
      s,
      [{ ...idle('player'), helm: { turn: 0, throttle: 4 } }, idle('bop')],
      createRng(1),
    )
    // cruiser maxSpeed 8, engine power 2 → factor 1.0 → 8 units along +X
    expect(state.ships[0]!.pos).toEqual({ x: 8, y: 0 })
    const helm = ofType(events, 'helm').find((e) => e.shipId === 'player')!
    expect(helm.to).toEqual({ x: 8, y: 0 })
  })

  it('clamps turn rate to class agility', () => {
    const s = makeEncounter()
    const { state } = resolveRound(
      s,
      [{ ...idle('player'), helm: { turn: 8, throttle: 0 } }, idle('bop')],
      createRng(1),
    )
    expect(state.ships[0]!.heading).toBe(2) // cruiser agility 2
  })

  it('engine power scales speed', () => {
    const s = makeEncounter()
    place(s, { x: 0, y: 0 }, 0, { x: 50, y: 50 }, 8)
    const orders: OrderSet[] = [
      {
        ...idle('player'),
        helm: { turn: 0, throttle: 4 },
        engineering: { power: { engines: 4, shields: 2, weapons: 2, sensors: 2 } },
      },
      idle('bop'),
    ]
    const { state } = resolveRound(s, orders, createRng(1))
    expect(state.ships[0]!.pos.x).toBe(12) // 8 * 1.5
  })

  it('destroyed engines: no turn, no movement', () => {
    const s = makeEncounter()
    s.ships[0]!.subsystems.engines.hp = 0
    const { state } = resolveRound(
      s,
      [{ ...idle('player'), helm: { turn: 2, throttle: 4 } }, idle('bop')],
      createRng(1),
    )
    expect(state.ships[0]!.heading).toBe(0)
    expect(state.ships[0]!.pos).toEqual(s.ships[0]!.pos)
  })
})

// --- phasers ---------------------------------------------------------------

describe('phasers', () => {
  function pointBlank(): EncounterState {
    const s = makeEncounter()
    // 4 units apart, player facing the BoP, BoP facing away (player in its aft)
    place(s, { x: 0, y: 0 }, 0, { x: 4, y: 0 }, 0)
    return s
  }

  it('hits reduce the facing shield arc first', () => {
    const s = pointBlank()
    const orders: OrderSet[] = [
      { ...idle('player'), tactical: { firePhasers: { targetId: 'bop', subsystem: null } } },
      idle('bop'),
    ]
    // find a seed that hits (deterministic search)
    for (let seed = 0; seed < 50; seed++) {
      const { state, events } = resolveRound(s, orders, createRng(seed))
      const fire = ofType(events, 'phaser-fire')[0]
      if (!fire?.hit) continue
      expect(fire.arc).toBe('aft') // player is directly behind the BoP
      const bop = state.ships[1]!
      // shields soaked it (25 max, ~12 damage, then regen)
      expect(fire.shieldDamage).toBeGreaterThan(0)
      expect(fire.hullDamage).toBe(0)
      expect(bop.hull).toBe(bop.maxHull)
      return
    }
    throw new Error('no hitting seed found in 50 tries')
  })

  it('is blocked outside the firing arc', () => {
    const s = makeEncounter()
    // BoP directly behind player: outside the cruiser's 270° arc (rear 90° excluded)
    place(s, { x: 0, y: 0 }, 0, { x: -6, y: 0 }, 0)
    const orders: OrderSet[] = [
      { ...idle('player'), tactical: { firePhasers: { targetId: 'bop', subsystem: null } } },
      idle('bop'),
    ]
    const { events } = resolveRound(s, orders, createRng(1))
    expect(ofType(events, 'phaser-blocked')[0]?.reason).toBe('arc')
  })

  it('is blocked beyond range', () => {
    const s = makeEncounter()
    place(s, { x: 0, y: 0 }, 0, { x: 20, y: 0 }, 8)
    const orders: OrderSet[] = [
      { ...idle('player'), tactical: { firePhasers: { targetId: 'bop', subsystem: null } } },
      idle('bop'),
    ]
    const { events } = resolveRound(s, orders, createRng(1))
    expect(ofType(events, 'phaser-blocked')[0]?.reason).toBe('range')
  })

  it('is blocked with destroyed weapons or zero weapons power', () => {
    const s = pointBlank()
    s.ships[0]!.subsystems.weapons.hp = 0
    const fireOrders: OrderSet[] = [
      { ...idle('player'), tactical: { firePhasers: { targetId: 'bop', subsystem: null } } },
      idle('bop'),
    ]
    expect(ofType(resolveRound(s, fireOrders, createRng(1)).events, 'phaser-blocked')[0]?.reason).toBe(
      'weapons-down',
    )

    const s2 = pointBlank()
    const noPower: OrderSet[] = [
      {
        ...idle('player'),
        tactical: { firePhasers: { targetId: 'bop', subsystem: null } },
        engineering: { power: { engines: 3, shields: 4, weapons: 0, sensors: 3 } },
      },
      idle('bop'),
    ]
    expect(ofType(resolveRound(s2, noPower, createRng(1)).events, 'phaser-blocked')[0]?.reason).toBe(
      'no-power',
    )
  })

  it('subsystem targeting requires a scan first, then damages the subsystem through downed shields', () => {
    const s = pointBlank()
    s.ships[1]!.shields = { fore: 0, aft: 0, port: 0, starboard: 0 }
    const orders: OrderSet[] = [
      {
        ...idle('player'),
        tactical: { firePhasers: { targetId: 'bop', subsystem: 'engines' } },
      },
      idle('bop'),
    ]
    // Without scan: downgrades to hull shot
    for (let seed = 0; seed < 50; seed++) {
      const { events } = resolveRound(s, orders, createRng(seed))
      const fire = ofType(events, 'phaser-fire')[0]
      if (!fire?.hit) continue
      expect(fire.targetedSubsystem).toBeNull()
      break
    }
    // With scan: subsystem takes 70% of leak-through
    const scanned = structuredClone(s)
    scanned.ships[1]!.scanLevel = 1
    for (let seed = 0; seed < 50; seed++) {
      const { state, events } = resolveRound(scanned, orders, createRng(seed))
      const fire = ofType(events, 'phaser-fire')[0]
      if (!fire?.hit) continue
      expect(fire.targetedSubsystem).toBe('engines')
      expect(fire.subsystemDamage).toBeGreaterThan(0)
      expect(state.ships[1]!.subsystems.engines.hp).toBeLessThan(45)
      return
    }
    throw new Error('no hitting seed found')
  })

  it('WEGO simultaneity: a ship destroyed this round still fires', () => {
    const s = makeEncounter()
    place(s, { x: 0, y: 0 }, 0, { x: 3, y: 0 }, 8) // nose to nose, both in arc
    s.ships[1]!.hull = 1
    s.ships[1]!.shields = { fore: 0, aft: 0, port: 0, starboard: 0 }
    const orders: OrderSet[] = [
      { ...idle('player'), tactical: { firePhasers: { targetId: 'bop', subsystem: null } } },
      {
        ...idle('bop'),
        tactical: { firePhasers: { targetId: 'player', subsystem: null } },
        // At 1 hull the budget is crushed to 4; route what's left to the guns.
        engineering: { power: { engines: 0, shields: 0, weapons: 3, sensors: 0 } },
      },
    ]
    for (let seed = 0; seed < 100; seed++) {
      const { state, events } = resolveRound(s, orders, createRng(seed))
      const fires = ofType(events, 'phaser-fire')
      const playerShot = fires.find((f) => f.shooterId === 'player')
      const bopShot = fires.find((f) => f.shooterId === 'bop')
      if (!playerShot?.hit || !bopShot?.hit) continue
      // player killed the BoP...
      expect(state.ships[1]!.alive).toBe(false)
      // ...but the BoP's simultaneous shot still landed
      expect(bopShot.shieldDamage + bopShot.hullDamage).toBeGreaterThan(0)
      expect(state.status).toBe('victory')
      return
    }
    throw new Error('no mutual-hit seed found')
  })
})

// --- torpedoes ---------------------------------------------------------------

describe('torpedoes', () => {
  it('launches, tracks over rounds, and detonates on proximity', () => {
    const s = makeEncounter()
    place(s, { x: 0, y: 0 }, 0, { x: 30, y: 0 }, 8)
    const launchOrders: OrderSet[] = [
      { ...idle('player'), tactical: { fireTorpedo: { targetId: 'bop' } } },
      idle('bop'),
    ]
    const r1 = resolveRound(s, launchOrders, createRng(1))
    expect(ofType(r1.events, 'torpedo-launch')).toHaveLength(1)
    expect(r1.state.torpedoes).toHaveLength(1)
    expect(r1.state.ships[0]!.torpedoes).toBe(7)

    // Next round: torpedo covers 18 units toward a stationary target 30 away — no hit yet.
    const r2 = resolveRound(r1.state, [idle('player'), idle('bop')], createRng(2))
    expect(ofType(r2.events, 'torpedo-move')).toHaveLength(1)
    expect(ofType(r2.events, 'torpedo-hit')).toHaveLength(0)

    // Round after: closest approach passes within proximity → detonation.
    const r3 = resolveRound(r2.state, [idle('player'), idle('bop')], createRng(3))
    const hit = ofType(r3.events, 'torpedo-hit')[0]
    expect(hit).toBeDefined()
    expect(hit!.targetId).toBe('bop')
    expect(hit!.shieldDamage + hit!.hullDamage).toBeGreaterThan(0)
    expect(r3.state.torpedoes).toHaveLength(0)
  })

  it('expires when fuel runs out chasing a faster target', () => {
    const s = makeEncounter()
    place(s, { x: 0, y: 0 }, 0, { x: 20, y: 0 }, 0) // BoP facing away, will flee
    let cur = resolveRound(
      s,
      [
        { ...idle('player'), tactical: { fireTorpedo: { targetId: 'bop' } } },
        {
          ...idle('bop'),
          helm: { turn: 0, throttle: 4 },
          engineering: { power: { engines: 4, shields: 2, weapons: 0, sensors: 0 } },
        },
      ],
      createRng(1),
    )
    // BoP at engines 4 → 11 * 1.5 = 16.5/round vs torpedo 18 with a 20-unit head
    // start and 4 rounds of fuel: the fish falls short and fizzles.
    let expired = false
    for (let i = 0; i < 6 && !expired; i++) {
      cur = resolveRound(
        cur.state,
        [
          idle('player'),
          {
            ...idle('bop'),
            helm: { turn: 0, throttle: 4 },
            engineering: { power: { engines: 4, shields: 2, weapons: 0, sensors: 0 } },
          },
        ],
        createRng(10 + i),
      )
      if (ofType(cur.events, 'torpedo-hit').length > 0) throw new Error('torpedo should not catch')
      expired = ofType(cur.events, 'torpedo-expired').length > 0
    }
    expect(expired).toBe(true)
  })

  it('is blocked outside the launch arc and without ammo', () => {
    const s = makeEncounter()
    place(s, { x: 0, y: 0 }, 0, { x: 0, y: 10 }, 8) // target abeam: outside 60° arc
    const orders: OrderSet[] = [
      { ...idle('player'), tactical: { fireTorpedo: { targetId: 'bop' } } },
      idle('bop'),
    ]
    expect(ofType(resolveRound(s, orders, createRng(1)).events, 'torpedo-blocked')[0]?.reason).toBe('arc')

    const s2 = makeEncounter()
    place(s2, { x: 0, y: 0 }, 0, { x: 10, y: 0 }, 8)
    s2.ships[0]!.torpedoes = 0
    expect(ofType(resolveRound(s2, orders, createRng(1)).events, 'torpedo-blocked')[0]?.reason).toBe('ammo')
  })
})

// --- support systems ---------------------------------------------------------

describe('repairs, scans, shields', () => {
  it('engineering repairs restore subsystem hp and can revive a dead system', () => {
    const s = makeEncounter()
    s.ships[0]!.subsystems.engines.hp = 0
    const orders: OrderSet[] = [
      { ...idle('player'), engineering: { power: defaultPower(), repair: 'engines' } },
      idle('bop'),
    ]
    const { state, events } = resolveRound(s, orders, createRng(1))
    expect(state.ships[0]!.subsystems.engines.hp).toBe(12)
    expect(ofType(events, 'repair')[0]?.subsystem).toBe('engines')
  })

  it('scan marks the target and enables full readout', () => {
    const s = makeEncounter()
    const orders: OrderSet[] = [
      { ...idle('player'), science: { scanTargetId: 'bop' } },
      idle('bop'),
    ]
    const { state, events } = resolveRound(s, orders, createRng(1))
    expect(ofType(events, 'scan')[0]?.success).toBe(true)
    expect(state.ships[1]!.scanLevel).toBe(1)
  })

  it('scan fails with destroyed sensors', () => {
    const s = makeEncounter()
    s.ships[0]!.subsystems.sensors.hp = 0
    const orders: OrderSet[] = [
      { ...idle('player'), science: { scanTargetId: 'bop' } },
      idle('bop'),
    ]
    const { state, events } = resolveRound(s, orders, createRng(1))
    expect(ofType(events, 'scan')[0]?.success).toBe(false)
    expect(state.ships[1]!.scanLevel).toBe(0)
  })

  it('shields regenerate with power, capped at class max', () => {
    const s = makeEncounter()
    s.ships[0]!.shields.fore = 10
    const { state } = resolveRound(s, [idle('player'), idle('bop')], createRng(1))
    expect(state.ships[0]!.shields.fore).toBe(16) // +6 regen at nominal power
    expect(state.ships[0]!.shields.aft).toBe(40) // capped
  })

  it('destroyed shield emitter collapses all arcs and stops regen', () => {
    const s = makeEncounter()
    s.ships[0]!.subsystems.shields.hp = 0
    s.ships[0]!.shields = { fore: 0, aft: 0, port: 0, starboard: 0 }
    const { state } = resolveRound(s, [idle('player'), idle('bop')], createRng(1))
    expect(state.ships[0]!.shields).toEqual({ fore: 0, aft: 0, port: 0, starboard: 0 })
  })
})

// --- warp out ----------------------------------------------------------------

describe('warp out', () => {
  it('fails when an enemy is too close', () => {
    const s = makeEncounter()
    place(s, { x: 0, y: 0 }, 0, { x: 5, y: 0 }, 8)
    const orders: OrderSet[] = [
      { ...idle('player'), helm: { turn: 0, throttle: 0, warpOut: true } },
      idle('bop'),
    ]
    const { state, events } = resolveRound(s, orders, createRng(1))
    expect(ofType(events, 'warp-out-failed')[0]?.reason).toBe('too-close')
    expect(state.status).toBe('active')
  })

  it('succeeds at range and ends the encounter as withdrawn', () => {
    const s = makeEncounter()
    place(s, { x: 0, y: 0 }, 0, { x: WARP_OUT_MIN_RANGE + 5, y: 0 }, 8)
    const orders: OrderSet[] = [
      { ...idle('player'), helm: { turn: 0, throttle: 0, warpOut: true } },
      idle('bop'),
    ]
    const { state, events } = resolveRound(s, orders, createRng(1))
    expect(ofType(events, 'warp-out')).toHaveLength(1)
    expect(state.status).toBe('withdrawn')
  })
})

// --- outcomes ----------------------------------------------------------------

describe('encounter outcomes', () => {
  it('enemy with weapons and engines destroyed is disabled (non-lethal win)', () => {
    const s = makeEncounter()
    s.ships[1]!.subsystems.weapons.hp = 0
    s.ships[1]!.subsystems.engines.hp = 0
    const { state, events } = resolveRound(s, [idle('player'), idle('bop')], createRng(1))
    expect(state.status).toBe('enemy-disabled')
    expect(ofType(events, 'ship-disabled')[0]?.shipId).toBe('bop')
    expect(ofType(events, 'encounter-end')[0]?.status).toBe('enemy-disabled')
  })

  it('player destruction is defeat', () => {
    const s = makeEncounter()
    place(s, { x: 0, y: 0 }, 0, { x: 3, y: 0 }, 8)
    s.ships[0]!.hull = 1
    s.ships[0]!.shields = { fore: 0, aft: 0, port: 0, starboard: 0 }
    const orders: OrderSet[] = [
      idle('player'),
      { ...idle('bop'), tactical: { firePhasers: { targetId: 'player', subsystem: null } } },
    ]
    for (let seed = 0; seed < 100; seed++) {
      const { state } = resolveRound(s, orders, createRng(seed))
      if (state.ships[0]!.alive) continue
      expect(state.status).toBe('defeat')
      return
    }
    throw new Error('no hitting seed found')
  })
})

// --- determinism (the load-bearing property) ----------------------------------

describe('determinism', () => {
  it('same seed + same orders → identical states and events over a full battle', () => {
    const run = () => {
      let s = makeEncounter(777)
      const rng = createRng(31337)
      const aiRng = createRng(555)
      const allEvents: RoundEvent[] = []
      for (let round = 0; round < 15 && s.status === 'active'; round++) {
        const playerOrders: OrderSet = {
          ...idle('player'),
          helm: { turn: 1, throttle: 3 },
          tactical: { firePhasers: { targetId: 'bop', subsystem: null } },
          science: { scanTargetId: 'bop' },
        }
        const bopOrders = klingonAI(s, 'bop', aiRng)
        const result = resolveRound(s, [playerOrders, bopOrders], rng)
        s = result.state
        allEvents.push(...result.events)
      }
      return { s, allEvents }
    }
    const a = run()
    const b = run()
    expect(a.s).toEqual(b.s)
    expect(a.allEvents).toEqual(b.allEvents)
  })

  it('resolveRound does not mutate its inputs', () => {
    const s = makeEncounter(9)
    const frozen = structuredClone(s)
    const orders: OrderSet[] = [
      {
        ...idle('player'),
        helm: { turn: 2, throttle: 4 },
        tactical: { firePhasers: { targetId: 'bop', subsystem: null } },
      },
      idle('bop'),
    ]
    const frozenOrders = structuredClone(orders)
    resolveRound(s, orders, createRng(5))
    expect(s).toEqual(frozen)
    expect(orders).toEqual(frozenOrders)
  })
})

// --- AI ------------------------------------------------------------------------

describe('klingonAI', () => {
  it('is deterministic', () => {
    const s = makeEncounter(3)
    const a = klingonAI(s, 'bop', createRng(7))
    const b = klingonAI(s, 'bop', createRng(7))
    expect(a).toEqual(b)
  })

  it('closes distance in attack mode', () => {
    let s = makeEncounter(3)
    const rng = createRng(11)
    const aiRng = createRng(12)
    const d0 = distance(s.ships[0]!.pos, s.ships[1]!.pos)
    for (let i = 0; i < 3; i++) {
      const orders = [idle('player'), klingonAI(s, 'bop', aiRng)]
      s = resolveRound(s, orders, rng).state
    }
    expect(distance(s.ships[0]!.pos, s.ships[1]!.pos)).toBeLessThan(d0)
  })

  it('flees and eventually warps out when hull is critical', () => {
    let s = makeEncounter(3)
    s.ships[1]!.hull = 10 // < 30%
    const rng = createRng(21)
    const aiRng = createRng(22)
    for (let i = 0; i < 8 && s.status === 'active'; i++) {
      const orders = [idle('player'), klingonAI(s, 'bop', aiRng)]
      s = resolveRound(s, orders, rng).state
    }
    expect(s.status).toBe('enemy-withdrawn')
  })

  it('fires on the player when guns bear at range', () => {
    const s = makeEncounter(3)
    place(s, { x: 0, y: 0 }, 0, { x: 6, y: 0 }, 8) // BoP facing player, close
    const orders = klingonAI(s, 'bop', createRng(1))
    expect(orders.tactical.firePhasers?.targetId).toBe('player')
  })
})
