import { describe, expect, it } from 'vitest'
import { getMissionDef } from '../src/data/missions'
import {
  applyEncounterRound,
  concludeEncounter,
  missionRecord,
  newGame,
  travelTo,
  type GameState,
} from '../src/sim/game'
import { defaultPower } from '../src/sim/ship'
import type { OrderSet } from '../src/sim/types'

function idleOrders(shipId: string): OrderSet {
  return {
    shipId,
    helm: { turn: 0, throttle: 0 },
    tactical: {},
    engineering: { power: defaultPower() },
  }
}

/** A player who cannot survive: sliver of hull, shields collapsed AND emitters dead. */
function doomPlayer(s: GameState): void {
  const player = s.encounter!.ships[0]!
  player.hull = 0.5
  player.shields = { fore: 0, aft: 0, port: 0, starboard: 0 }
  player.subsystems.shields.hp = 0
  s.ship = structuredClone(player)
  // Put the executioner in point-blank arc.
  s.encounter!.ships[1]!.pos = { x: 4, y: 0 }
  s.encounter!.ships[1]!.heading = 8
}

/** Stationary enemy pouring full weapons power into the player. */
function executionerOrders(): OrderSet {
  return {
    ...idleOrders('enemy'),
    tactical: { firePhasers: { targetId: 'player', subsystem: null } },
    engineering: { power: { engines: 0, shields: 0, weapons: 4, sensors: 3 } },
  }
}

/** Force-resolve the active encounter by scripting the enemy's destruction. */
function winEncounter(s: GameState): GameState {
  let cur = structuredClone(s)
  const enemy = cur.encounter!.ships[1]!
  enemy.hull = 0.5
  enemy.shields = { fore: 0, aft: 0, port: 0, starboard: 0 }
  enemy.subsystems.shields.hp = 0 // no regen refilling the arcs mid-script
  enemy.cloaked = false
  enemy.pos = { x: 5, y: 0 } // inside phaser range; spawn distance is ~20
  let rounds = 0
  while (cur.encounter!.status === 'active' && rounds < 30) {
    const orders: OrderSet[] = [
      {
        ...idleOrders('player'),
        tactical: { firePhasers: { targetId: 'enemy', subsystem: null } },
        engineering: { power: { engines: 0, shields: 2, weapons: 4, sensors: 4 } },
      },
      idleOrders('enemy'),
    ]
    cur = applyEncounterRound(cur, orders).state
    rounds++
  }
  if (cur.encounter!.status === 'active') throw new Error('could not finish encounter')
  return cur
}

/** Ride to Veyra and win m1; returns the post-conclude state. Seed 1 is patrol-free. */
function resolveM1(seed = 1): GameState {
  let s = newGame(seed).state
  for (const hop of ['archer', 'hromi', 'veyra']) s = travelTo(s, hop).state
  expect(s.mode).toBe('encounter')
  s = winEncounter(s)
  return concludeEncounter(s).state
}

describe('mission chain', () => {
  it('resolving m1 activates the Fek(lhr hunt with fresh jump count', () => {
    const s = resolveM1()
    expect(missionRecord(s, 'm1-veyra-distress').stage).toBe('resolved')
    const m2 = missionRecord(s, 'm2-fek-lhr')
    expect(m2.stage).toBe('active')
    expect(m2.jumps).toBe(0)
    expect(s.logArchive.join(' ')).toContain('High Council')
  })

  it('the hunter intercepts on the Nth non-starbase arrival', () => {
    const needed = getMissionDef('m2-fek-lhr').trigger
    expect(needed).toEqual({ type: 'intercept-after', jumps: 3 })
    // Search seeds for a clean 3-jump run after m1 (no random patrols en route).
    for (let seed = 1; seed < 60; seed++) {
      let s: GameState
      try {
        s = resolveM1(seed)
      } catch {
        continue // patrol interrupted the m1 run for this seed
      }
      // From Veyra: three jumps. The third non-starbase arrival must be the Fek'lhr.
      let intercepted = false
      let hops = 0
      for (const hop of ['gasko', 'kaleb', 'meridian']) {
        const step = travelTo(s, hop)
        s = step.state
        hops++
        if (s.mode === 'encounter') {
          const ctx = s.encounterContext
          if (ctx?.kind === 'mission' && ctx.defId === 'm2-fek-lhr') {
            intercepted = true
            expect(hops).toBe(3)
            expect(s.encounter!.ships[1]!.name).toBe("IKS Fek'lhr")
            expect(s.encounter!.ships[1]!.classId).toBe('klingon-ktinga')
          }
          break // random patrol: abandon this seed
        }
      }
      if (intercepted) return
    }
    throw new Error('no seed gave a clean intercept run in 60 tries')
  })

  it('starbase arrivals postpone the intercept', () => {
    for (let seed = 1; seed < 60; seed++) {
      let s: GameState
      try {
        s = resolveM1(seed)
      } catch {
        continue
      }
      // Veyra → hromi → archer → sb4: third arrival is a starbase — no ambush.
      let clean = true
      for (const hop of ['hromi', 'archer', 'sb4']) {
        const step = travelTo(s, hop)
        s = step.state
        if (s.mode === 'encounter') {
          clean = false
          break
        }
      }
      if (!clean) continue
      expect(s.galaxy.currentSystemId).toBe('sb4')
      expect(missionRecord(s, 'm2-fek-lhr').jumps).toBeGreaterThanOrEqual(3)
      // Next jump out (tellun is not a starbase): the hunter is waiting.
      const step = travelTo(s, 'tellun')
      expect(step.state.mode).toBe('encounter')
      expect(step.state.encounterContext).toEqual({ kind: 'mission', defId: 'm2-fek-lhr' })
      return
    }
    throw new Error('no clean starbase-postpone run found')
  })
})

describe("captain's mercy (permadeath off)", () => {
  it('a lost battle tows the wreck home instead of ending the game', () => {
    for (let seed = 0; seed < 400; seed++) {
      let s = newGame(seed, { permadeath: false }).state
      const step = travelTo(s, 'tellun')
      if (step.state.mode !== 'encounter') continue
      s = structuredClone(step.state)
      doomPlayer(s)
      let rounds = 0
      while (s.encounter!.status === 'active' && rounds < 40) {
        s = applyEncounterRound(s, [idleOrders('player'), executionerOrders()]).state
        rounds++
      }
      if (s.encounter!.status !== 'defeat') continue
      const { state: after, log } = concludeEncounter(s)
      expect(after.mode).toBe('sector')
      expect(after.galaxy.currentSystemId).toBe('sb4')
      expect(after.ship.alive).toBe(true)
      expect(after.ship.hull).toBe(30)
      expect(after.ship.subsystems.weapons.hp).toBe(15)
      expect(log.join(' ')).toContain('tractor beams')
      return
    }
    throw new Error('no defeat scenario found')
  })

  it('permadeath (default) still ends the game', () => {
    for (let seed = 0; seed < 400; seed++) {
      let s = newGame(seed).state
      const step = travelTo(s, 'tellun')
      if (step.state.mode !== 'encounter') continue
      s = structuredClone(step.state)
      doomPlayer(s)
      let rounds = 0
      while (s.encounter!.status === 'active' && rounds < 40) {
        s = applyEncounterRound(s, [idleOrders('player'), executionerOrders()]).state
        rounds++
      }
      if (s.encounter!.status !== 'defeat') continue
      expect(concludeEncounter(s).state.mode).toBe('game-over')
      return
    }
    throw new Error('no defeat scenario found')
  })
})

describe('save v1 migration', () => {
  it('upgrades a v1 save to v2 with defaults', async () => {
    const { deserializeGame } = await import('../src/sim/save')
    // Hand-built v1 save: pre-cloak ship, single mission object, no settings.
    const v1Ship = {
      id: 'player',
      name: 'USS Farragut',
      classId: 'fed-cruiser',
      faction: 'federation',
      pos: { x: 0, y: 0 },
      heading: 0,
      hull: 87,
      maxHull: 100,
      shields: { fore: 40, aft: 40, port: 12, starboard: 40 },
      subsystems: {
        weapons: { hp: 60, maxHp: 60 },
        engines: { hp: 44, maxHp: 60 },
        shields: { hp: 60, maxHp: 60 },
        sensors: { hp: 60, maxHp: 60 },
      },
      power: { engines: 2, shields: 2, weapons: 2, sensors: 2 },
      torpedoes: 6,
      scanLevel: 0,
      alive: true,
      warpedOut: false,
    }
    const v1 = {
      version: 1,
      stardate: 47503.3,
      state: {
        seed: 42,
        rngState: 1234567,
        mode: 'sector',
        ship: v1Ship,
        galaxy: { currentSystemId: 'tellun', stardate: 47503.3, visited: ['sb4', 'tellun'] },
        mission: {
          id: 'm1-veyra-distress',
          title: 'The Veyra Distress Call',
          stage: 'resolved',
          outcome: 'victory',
          targetSystemId: 'veyra',
        },
        encounter: null,
        encounterContext: null,
      },
    }
    const state = deserializeGame(JSON.stringify(v1))
    expect(state.settings).toEqual({ permadeath: true })
    expect(state.logArchive).toEqual([])
    expect(state.ship.cloaked).toBe(false)
    expect(state.ship.cloakCooldown).toBe(0)
    expect(state.ship.hull).toBe(87) // damage preserved
    expect(missionRecord(state, 'm1-veyra-distress')).toMatchObject({
      stage: 'resolved',
      outcome: 'victory',
    })
    // A finished m1 in the old save means the hunt begins in the new version.
    expect(missionRecord(state, 'm2-fek-lhr').stage).toBe('active')
  })
})
