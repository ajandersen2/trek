import { describe, expect, it } from 'vitest'
import { klingonAI } from '../src/sim/ai'
import { CLOAK_COOLDOWN_ROUNDS, SWEEP_RANGE } from '../src/sim/constants'
import { createEncounter, resolveRound } from '../src/sim/encounter'
import { createRng } from '../src/sim/rng'
import { createShip, defaultPower } from '../src/sim/ship'
import type { EncounterState, OrderSet, RoundEvent } from '../src/sim/types'

function makeEncounter(seed = 1): EncounterState {
  const rng = createRng(seed)
  const player = createShip('player', 'USS Farragut', 'fed-cruiser', { x: 0, y: 0 }, 0)
  const enemy = createShip('bop', 'IKS Vengeance', 'klingon-bop', { x: 0, y: 0 }, 8)
  const s = createEncounter(player, enemy, rng)
  s.ships[1]!.cloakCooldown = 0 // most tests want the device ready immediately
  return s
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

describe('cloak engage', () => {
  it('completes at end of round, drops shields, blocks own fire that round', () => {
    const s = makeEncounter()
    const orders: OrderSet[] = [
      idle('player'),
      {
        ...idle('bop'),
        helm: { turn: 0, throttle: 0, cloak: true },
        tactical: { firePhasers: { targetId: 'player', subsystem: null } },
      },
    ]
    const { state, events } = resolveRound(s, orders, createRng(2))
    expect(ofType(events, 'cloak')).toHaveLength(1)
    expect(ofType(events, 'phaser-blocked')[0]?.reason).toBe('self-cloaked')
    const bop = state.ships[1]!
    expect(bop.cloaked).toBe(true)
    expect(bop.shields).toEqual({ fore: 0, aft: 0, port: 0, starboard: 0 })
  })

  it('is blocked by cooldown and by dead engines', () => {
    const s = makeEncounter()
    s.ships[1]!.cloakCooldown = 1
    const cloakOrder: OrderSet[] = [
      idle('player'),
      { ...idle('bop'), helm: { turn: 0, throttle: 0, cloak: true } },
    ]
    const r1 = resolveRound(s, cloakOrder, createRng(3))
    expect(ofType(r1.events, 'cloak-blocked')[0]?.reason).toBe('cooldown')
    expect(r1.state.ships[1]!.cloaked).toBe(false)

    const s2 = makeEncounter()
    s2.ships[1]!.subsystems.engines.hp = 0
    const r2 = resolveRound(s2, cloakOrder, createRng(3))
    expect(ofType(r2.events, 'cloak-blocked')[0]?.reason).toBe('engines')
  })

  it('is silently ignored for ships without a cloaking device', () => {
    const s = makeEncounter()
    const orders: OrderSet[] = [
      { ...idle('player'), helm: { turn: 0, throttle: 0, cloak: true } },
      idle('bop'),
    ]
    const { state, events } = resolveRound(s, orders, createRng(4))
    expect(state.ships[0]!.cloaked).toBe(false)
    expect(ofType(events, 'cloak')).toHaveLength(0)
    expect(ofType(events, 'cloak-blocked')).toHaveLength(0)
  })
})

describe('cloaked ships are untargetable', () => {
  function cloakedSetup(): EncounterState {
    const s = makeEncounter()
    s.ships[1]!.cloaked = true
    s.ships[1]!.shields = { fore: 0, aft: 0, port: 0, starboard: 0 }
    return s
  }

  it('phasers and torpedoes are blocked with target-cloaked', () => {
    const s = cloakedSetup()
    const orders: OrderSet[] = [
      {
        ...idle('player'),
        tactical: {
          firePhasers: { targetId: 'bop', subsystem: null },
          fireTorpedo: { targetId: 'bop' },
        },
      },
      { ...idle('bop'), helm: { turn: 0, throttle: 0, cloak: true } },
    ]
    const { events } = resolveRound(s, orders, createRng(5))
    expect(ofType(events, 'phaser-blocked')[0]?.reason).toBe('target-cloaked')
    expect(ofType(events, 'torpedo-blocked')[0]?.reason).toBe('target-cloaked')
  })

  it('torpedoes in flight lose lock when the target cloaks', () => {
    const s = makeEncounter()
    // Park the BoP far ahead and launch a torpedo at it.
    s.ships[0]!.pos = { x: 0, y: 0 }
    s.ships[0]!.heading = 0
    s.ships[1]!.pos = { x: 30, y: 0 }
    const launch: OrderSet[] = [
      { ...idle('player'), tactical: { fireTorpedo: { targetId: 'bop' } } },
      idle('bop'),
    ]
    const r1 = resolveRound(s, launch, createRng(6))
    expect(r1.state.torpedoes).toHaveLength(1)
    // Target cloaks: the fish self-destructs on its next update.
    const r2 = resolveRound(
      r1.state,
      [idle('player'), { ...idle('bop'), helm: { turn: 0, throttle: 0, cloak: true } }],
      createRng(7),
    )
    const r3 = resolveRound(r2.state, [idle('player'), { ...idle('bop') }], createRng(8))
    expect(ofType(r3.events, 'torpedo-expired')).toHaveLength(1)
    expect(r3.state.torpedoes).toHaveLength(0)
  })
})

describe('decloak', () => {
  it('is immediate: the classic decloak-and-alpha-strike works', () => {
    const s = makeEncounter()
    const bop = s.ships[1]!
    bop.cloaked = true
    bop.pos = { x: 5, y: 0 }
    bop.heading = 8 // facing the player
    const orders: OrderSet[] = [
      idle('player'),
      {
        ...idle('bop'),
        helm: { turn: 0, throttle: 0, cloak: false },
        tactical: { firePhasers: { targetId: 'player', subsystem: null } },
        engineering: { power: { engines: 0, shields: 0, weapons: 4, sensors: 0 } },
      },
    ]
    const { state, events } = resolveRound(s, orders, createRng(9))
    expect(ofType(events, 'decloak')[0]).toMatchObject({ shipId: 'bop', forced: false })
    expect(ofType(events, 'phaser-fire').filter((e) => e.shooterId === 'bop')).toHaveLength(1)
    expect(state.ships[1]!.cloakCooldown).toBeGreaterThan(0)
  })

  it('cooldown enforces two visible rounds before re-engaging', () => {
    const s = makeEncounter()
    s.ships[1]!.cloaked = true
    // Round 1: voluntary decloak.
    let cur = resolveRound(
      s,
      [idle('player'), { ...idle('bop'), helm: { turn: 0, throttle: 0, cloak: false } }],
      createRng(10),
    )
    expect(cur.state.ships[1]!.cloakCooldown).toBe(CLOAK_COOLDOWN_ROUNDS - 1) // ticked once at end of round
    // Round 2: re-engage attempt is blocked.
    cur = resolveRound(
      cur.state,
      [idle('player'), { ...idle('bop'), helm: { turn: 0, throttle: 0, cloak: true } }],
      createRng(11),
    )
    expect(ofType(cur.events, 'cloak-blocked')[0]?.reason).toBe('cooldown')
    // Round 3: cooldown has cleared; engage succeeds.
    cur = resolveRound(
      cur.state,
      [idle('player'), { ...idle('bop'), helm: { turn: 0, throttle: 0, cloak: true } }],
      createRng(12),
    )
    expect(ofType(cur.events, 'cloak')).toHaveLength(1)
    expect(cur.state.ships[1]!.cloaked).toBe(true)
  })

  it('dead engines force an immediate decloak', () => {
    const s = makeEncounter()
    s.ships[1]!.cloaked = true
    s.ships[1]!.subsystems.engines.hp = 0
    const { state, events } = resolveRound(s, [idle('player'), idle('bop')], createRng(13))
    expect(ofType(events, 'decloak')[0]).toMatchObject({ shipId: 'bop', forced: true })
    expect(state.ships[1]!.cloaked).toBe(false)
  })
})

describe('tachyon sweep', () => {
  function sweepSetup(dist: number): EncounterState {
    const s = makeEncounter()
    s.ships[1]!.cloaked = true
    s.ships[1]!.pos = { x: dist, y: 0 }
    return s
  }

  const sweepOrders: OrderSet[] = [
    {
      ...idle('player'),
      science: { scanTargetId: 'bop' },
      engineering: { power: { engines: 1, shields: 2, weapons: 1, sensors: 4 } },
    },
    { ...idle('bop'), helm: { turn: 0, throttle: 0, cloak: true } },
  ]

  it('can force a decloak inside sweep range (seeded search)', () => {
    for (let seed = 0; seed < 60; seed++) {
      const { state, events } = resolveRound(sweepSetup(6), sweepOrders, createRng(seed))
      const decloaks = ofType(events, 'decloak')
      if (decloaks.length === 0) continue
      expect(decloaks[0]).toMatchObject({ shipId: 'bop', forced: true })
      expect(state.ships[1]!.cloaked).toBe(false)
      expect(state.ships[1]!.scanLevel).toBe(1)
      // Forced out in phase 3: the ship is targetable this very round.
      return
    }
    throw new Error('no seed forced a decloak in 60 tries at 57% chance — sweep broken?')
  })

  it('never succeeds beyond sweep range but may leak a ghost bearing', () => {
    for (let seed = 0; seed < 40; seed++) {
      const { events } = resolveRound(sweepSetup(SWEEP_RANGE + 2), sweepOrders, createRng(seed))
      expect(ofType(events, 'decloak')).toHaveLength(0)
      const scan = ofType(events, 'scan')[0]!
      expect(scan.success).toBe(false)
      expect(scan.ghostBearing).toBe(0) // target dead ahead: bearing quantizes to 0
    }
  })

  it('yields no bearing beyond hint range', () => {
    const { events } = resolveRound(sweepSetup(20), sweepOrders, createRng(1))
    const scan = ofType(events, 'scan')[0]!
    expect(scan.success).toBe(false)
    expect(scan.ghostBearing).toBeNull()
  })
})

describe('cloaking AI', () => {
  it('a healthy cloaked knife-fighter stalks in and decloaks for an alpha strike', () => {
    let s = makeEncounter(21)
    s.ships[1]!.cloaked = true
    const rng = createRng(31)
    const aiRng = createRng(32)
    let sawDecloak = false
    let sawFire = false
    for (let i = 0; i < 10 && s.status === 'active'; i++) {
      const orders = [idle('player'), klingonAI(s, 'bop', aiRng)]
      const r = resolveRound(s, orders, rng)
      s = r.state
      if (ofType(r.events, 'decloak').some((e) => e.shipId === 'bop')) sawDecloak = true
      if (ofType(r.events, 'phaser-fire').some((e) => e.shooterId === 'bop')) sawFire = true
      if (sawDecloak && sawFire) break
    }
    expect(sawDecloak).toBe(true)
    expect(sawFire).toBe(true)
  })

  it('replays deterministically against a cloaking opponent', () => {
    const run = () => {
      let s = makeEncounter(77)
      s.ships[1]!.cloaked = true
      const rng = createRng(88)
      const aiRng = createRng(99)
      const all: RoundEvent[] = []
      for (let i = 0; i < 12 && s.status === 'active'; i++) {
        const playerOrders: OrderSet = {
          ...idle('player'),
          helm: { turn: 1, throttle: 1 },
          science: { scanTargetId: 'bop' },
          engineering: { power: { engines: 1, shields: 3, weapons: 2, sensors: 4 } },
        }
        const r = resolveRound(s, [playerOrders, klingonAI(s, 'bop', aiRng)], rng)
        s = r.state
        all.push(...r.events)
      }
      return { s, all }
    }
    const a = run()
    const b = run()
    expect(a.s).toEqual(b.s)
    expect(a.all).toEqual(b.all)
  })
})
