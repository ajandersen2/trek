// Klingon Bird-of-Prey AI: a pure function of (encounter state, rng) → OrderSet.
// Lives in the sim so it is deterministic and testable; the net layer's local-AI
// transport calls it. The sim never calls it itself.
//
// Doctrine: close aggressively, keep the foe in the forward disruptor arc,
// torpedo at medium range, repair whatever hurts most, and when the hull is
// failing — run for warp range. No cloak until M2.

import { getShipClass } from '../data/ships'
import { THROTTLE_MAX, WARP_OUT_MIN_RANGE } from './constants'
import { distance, headingDelta, headingToward, normalizeHeading } from './geometry'
import { roll, type Rng } from './rng'
import type { EncounterState, OrderSet, PowerAllocation, ShipState, SubsystemId } from './types'

const FLEE_HULL_FRACTION = 0.3

export function klingonAI(state: EncounterState, shipId: string, rng: Rng): OrderSet {
  const self = state.ships.find((s) => s.id === shipId)
  if (!self) throw new Error(`AI ship ${shipId} missing`)
  const foe = state.ships.find((s) => s.id !== shipId && s.alive && !s.warpedOut)
  const cls = getShipClass(self.classId)

  // No target left: hold position, keep shields up.
  if (!foe) {
    return {
      shipId,
      helm: { turn: 0, throttle: 0 },
      tactical: {},
      engineering: { power: { engines: 2, shields: 3, weapons: 0, sensors: 0 }, repair: pickRepair(self) },
    }
  }

  const dist = distance(self.pos, foe.pos)
  const fleeing = self.hull / self.maxHull < FLEE_HULL_FRACTION

  if (fleeing) {
    const awayHeading = normalizeHeading(headingToward(self.pos, foe.pos) + 8)
    const power: PowerAllocation = { engines: 4, shields: 2, weapons: 0, sensors: 0 }
    const canWarp = self.subsystems.engines.hp > 0 && dist >= WARP_OUT_MIN_RANGE
    return {
      shipId,
      helm: {
        turn: headingDelta(self.heading, awayHeading),
        throttle: THROTTLE_MAX,
        warpOut: canWarp,
      },
      tactical: {},
      engineering: { power, repair: pickRepair(self) },
    }
  }

  // Attack: turn onto the foe, manage closure rate.
  const desired = headingToward(self.pos, foe.pos)
  const turn = headingDelta(self.heading, desired)
  let throttle: number
  if (dist > 8) throttle = 4
  else if (dist > 3) throttle = 3
  else throttle = 2

  // Predict own post-turn facing to decide if guns bear this round.
  const clampedTurn = Math.max(-cls.agility, Math.min(cls.agility, turn))
  const predictedHeading = normalizeHeading(self.heading + clampedTurn)
  const bears = Math.abs(headingDelta(predictedHeading, desired)) <= 2 // within ~45°

  const tactical: OrderSet['tactical'] = {}
  if (bears && dist <= cls.phaser.range * 1.2) {
    tactical.firePhasers = { targetId: foe.id, subsystem: null }
  }
  // Torpedoes: medium range, launch window bears, spend sparingly. RNG: one draw
  // per eligible round.
  if (bears && self.torpedoes > 0 && dist > 5 && dist <= 16 && roll(rng, 0.4)) {
    tactical.fireTorpedo = { targetId: foe.id }
  }

  const power: PowerAllocation = { engines: 3, shields: 2, weapons: 3, sensors: 0 }
  return {
    shipId,
    helm: { turn, throttle },
    tactical,
    engineering: { power, repair: pickRepair(self) },
  }
}

/** Repair priority: weapons, engines, shields, sensors — first below 60%. */
function pickRepair(self: ShipState): SubsystemId | null {
  const priority: SubsystemId[] = ['weapons', 'engines', 'shields', 'sensors']
  for (const sys of priority) {
    const sub = self.subsystems[sys]
    if (sub.hp / sub.maxHp < 0.6) return sys
  }
  return null
}
