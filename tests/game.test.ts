import { describe, expect, it } from 'vitest'
import { klingonAI } from '../src/sim/ai'
import {
  applyEncounterRound,
  concludeEncounter,
  dock,
  newGame,
  travelTo,
  type GameState,
} from '../src/sim/game'
import { distance, headingDelta, headingToward } from '../src/sim/geometry'
import { createRng } from '../src/sim/rng'
import { defaultPower } from '../src/sim/ship'
import type { OrderSet } from '../src/sim/types'

function idleOrders(shipId: string): OrderSet {
  return { shipId, helm: { turn: 0, throttle: 0 }, tactical: {}, engineering: { power: defaultPower() } }
}

describe('newGame', () => {
  it('is deterministic for a seed and starts at Starbase 4 with the briefing', () => {
    const a = newGame(123)
    const b = newGame(123)
    expect(a.state).toEqual(b.state)
    expect(a.state.galaxy.currentSystemId).toBe('sb4')
    expect(a.state.mission.stage).toBe('active')
    expect(a.log.length).toBeGreaterThan(2)
  })
})

describe('travel', () => {
  it('moves along warp lanes and advances the stardate', () => {
    const { state } = newGame(1)
    const { state: s2, log } = travelTo(state, 'tellun')
    expect(s2.galaxy.currentSystemId).toBe('tellun')
    expect(s2.galaxy.stardate).toBeCloseTo(47501.8)
    expect(s2.galaxy.visited).toContain('tellun')
    expect(log[0]).toContain('arrived at Tellun')
  })

  it('rejects non-adjacent jumps', () => {
    const { state } = newGame(1)
    expect(() => travelTo(state, 'veyra')).toThrow()
  })

  it('arriving at Veyra with the mission active starts the mission encounter', () => {
    let s = newGame(1).state
    s = travelTo(s, 'archer').state
    s = travelTo(s, 'hromi').state
    // Random patrols could interrupt en route in general; with seed 1 they don't.
    expect(s.mode).toBe('sector')
    s = travelTo(s, 'veyra').state
    expect(s.mode).toBe('encounter')
    expect(s.encounterContext).toBe('mission')
    expect(s.encounter?.ships[1]?.name).toBe('IKS Vengeance')
  })

  it('can trigger random patrol intercepts (seeded)', () => {
    // Deterministically find a seed whose first jump spawns a patrol.
    for (let seed = 0; seed < 400; seed++) {
      let s = newGame(seed).state
      const step = travelTo(s, 'tellun')
      if (step.state.mode === 'encounter') {
        expect(step.state.encounterContext).toBe('random')
        expect(step.state.encounter?.ships[1]?.faction).toBe('klingon')
        return
      }
    }
    throw new Error('no seed in 400 produced a random encounter — chance broken?')
  })
})

describe('dock', () => {
  it('repairs everything at a starbase', () => {
    const { state } = newGame(1)
    const damaged: GameState = structuredClone(state)
    damaged.ship.hull = 30
    damaged.ship.subsystems.weapons.hp = 0
    damaged.ship.shields.fore = 0
    damaged.ship.torpedoes = 1
    const { state: repaired } = dock(damaged)
    expect(repaired.ship.hull).toBe(100)
    expect(repaired.ship.subsystems.weapons.hp).toBe(60)
    expect(repaired.ship.shields.fore).toBe(40)
    expect(repaired.ship.torpedoes).toBe(8)
  })

  it('refuses to dock away from a starbase', () => {
    let s = newGame(1).state
    s = travelTo(s, 'tellun').state
    expect(s.mode).toBe('sector')
    expect(() => dock(s)).toThrow()
  })
})

describe('full M1 mission playthrough (sim-level integration)', () => {
  it('travels to Veyra, defeats the raider, resolves the mission', () => {
    // Find a seed with a clean run to Veyra (no patrol interruptions) and a
    // finishable battle within 40 rounds. Deterministic: fixed iteration order.
    outer: for (let seed = 0; seed < 50; seed++) {
      let s = newGame(seed).state
      for (const hop of ['archer', 'hromi', 'veyra']) {
        const step = travelTo(s, hop)
        s = step.state
        if (s.mode === 'encounter' && s.encounterContext === 'random') continue outer
      }
      if (s.mode !== 'encounter') continue
      const aiRng = createRng(seed * 7 + 1)
      let rounds = 0
      while (s.mode === 'encounter' && s.encounter!.status === 'active' && rounds < 40) {
        const enemy = s.encounter!.ships[1]!
        const player = s.encounter!.ships[0]!
        const playerOrders: OrderSet = {
          shipId: 'player',
          helm: captainHelm(player, enemy),
          tactical: { firePhasers: { targetId: 'enemy', subsystem: null } },
          engineering: { power: { engines: 2, shields: 3, weapons: 4, sensors: 1 }, repair: null },
          science: { scanTargetId: 'enemy' },
        }
        const enemyOrders = klingonAI(s.encounter!, 'enemy', aiRng)
        s = applyEncounterRound(s, [playerOrders, enemyOrders]).state
        rounds++
      }
      if (s.encounter!.status === 'active') continue // stalemate seed; try another
      if (s.encounter!.status === 'defeat') continue
      const { state: after, log } = concludeEncounter(s)
      expect(after.mode).toBe('sector')
      expect(after.mission.stage).toBe('resolved')
      expect(['victory', 'enemy-disabled', 'enemy-withdrawn']).toContain(after.mission.outcome)
      expect(log.join(' ')).toContain('Veyra')
      // Battle damage persists on the ship after the encounter.
      expect(after.ship.id).toBe('player')
      expect(after.encounter).toBeNull()
      return
    }
    throw new Error('no seed produced a completed mission in 50 tries')
  })
})

/**
 * A competent test captain: turn toward the foe; if it's camping our rear arc
 * up close, cut throttle so it overshoots into our 270° phaser coverage —
 * the intended counter-tactic to an agile knife-fighter.
 */
function captainHelm(
  player: { pos: { x: number; y: number }; heading: number },
  enemy: { pos: { x: number; y: number } },
): { turn: number; throttle: number } {
  const turn = headingDelta(player.heading, headingToward(player.pos, enemy.pos))
  const dist = distance(player.pos, enemy.pos)
  const behind = Math.abs(turn) >= 4 // bearing more than 90° off the bow
  let throttle: number
  if (behind && dist < 9) throttle = 0
  else if (dist > 12) throttle = 3
  else if (dist > 6) throttle = 2
  else throttle = 1
  return { turn, throttle }
}

describe('defeat handling', () => {
  it('a destroyed player ship ends the game', () => {
    // Enter any encounter, then hand the sim a doomed player.
    for (let seed = 0; seed < 400; seed++) {
      let s = newGame(seed).state
      const step = travelTo(s, 'tellun')
      if (step.state.mode !== 'encounter') continue
      s = structuredClone(step.state)
      s.ship.hull = 1
      s.encounter!.ships[0]!.hull = 1
      s.encounter!.ships[0]!.shields = { fore: 0, aft: 0, port: 0, starboard: 0 }
      // Let the Klingon shoot a stationary, shieldless 1-hull target until it dies.
      const aiRng = createRng(9)
      let rounds = 0
      while (s.encounter!.status === 'active' && rounds < 30) {
        const enemyOrders = klingonAI(s.encounter!, 'enemy', aiRng)
        s = applyEncounterRound(s, [idleOrders('player'), enemyOrders]).state
        rounds++
      }
      expect(s.encounter!.status).toBe('defeat')
      const { state: after, log } = concludeEncounter(s)
      expect(after.mode).toBe('game-over')
      expect(log.join(' ')).toContain('lost')
      return
    }
    throw new Error('no random-encounter seed found')
  })
})
