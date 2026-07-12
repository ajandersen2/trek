// Enemy AI: a pure function of (encounter state, rng) → OrderSet, dispatched by
// the ship class's combat doctrine. Lives in the sim so it is deterministic and
// testable; the net layer's local-AI transport calls it. The sim never calls it.
//
// Doctrines:
//   knife    (Bird-of-Prey)  — cloaked stalking, decloak alpha strikes, vanish
//                              again when hurt. Kill it while it's visible.
//   brawler  (K't'inga)      — steady closure, wide arcs always bearing, grinds
//                              shields down. Out-turn it or out-range it.
//   harasser (Raptor)        — slashing attack runs, extends out, comes back.
//                              Punish the turn at the end of its run.

import { getShipClass } from '../data/ships'
import { THROTTLE_MAX, WARP_OUT_MIN_RANGE } from './constants'
import { distance, headingDelta, headingToward, normalizeHeading } from './geometry'
import { roll, type Rng } from './rng'
import type { Doctrine, EncounterState, OrderSet, ShipState, SubsystemId } from './types'

const FLEE_HULL_FRACTION: Record<Doctrine, number> = {
  knife: 0.3,
  brawler: 0.2,
  harasser: 0.4,
}

export function klingonAI(state: EncounterState, shipId: string, rng: Rng): OrderSet {
  const self = state.ships.find((s) => s.id === shipId)
  if (!self) throw new Error(`AI ship ${shipId} missing`)
  const foe = state.ships.find((s) => s.id !== shipId && s.alive && !s.warpedOut)
  const cls = getShipClass(self.classId)

  // No target left: hold position, keep shields up, patch holes.
  if (!foe) {
    return {
      shipId,
      helm: { turn: 0, throttle: 0 },
      tactical: {},
      engineering: {
        power: { engines: 2, shields: 3, weapons: 0, sensors: 0 },
        repair: pickRepair(self),
      },
    }
  }

  const dist = distance(self.pos, foe.pos)
  if (self.hull / self.maxHull < FLEE_HULL_FRACTION[cls.doctrine]) {
    return flee(self, foe, dist, shipId)
  }
  switch (cls.doctrine) {
    case 'knife':
      return knife(self, foe, dist, shipId, rng)
    case 'brawler':
      return brawler(self, foe, dist, shipId, rng)
    case 'harasser':
      return harasser(self, foe, dist, shipId, rng)
  }
}

// --- doctrines ---------------------------------------------------------------

function knife(self: ShipState, foe: ShipState, dist: number, shipId: string, rng: Rng): OrderSet {
  const cls = getShipClass(self.classId)
  const desired = headingToward(self.pos, foe.pos)
  const turn = headingDelta(self.heading, desired)

  if (self.cloaked) {
    // Stalk in close under cloak; drop it right on top of the target's flank.
    if (dist <= 6) {
      // Decloak this round and unload everything (decloak is immediate).
      const tactical: OrderSet['tactical'] = {
        firePhasers: { targetId: foe.id, subsystem: null },
      }
      if (self.torpedoes > 0 && bearsAfterTurn(self, desired, 2)) {
        tactical.fireTorpedo = { targetId: foe.id }
      }
      return {
        shipId,
        helm: { turn, throttle: 1, cloak: false },
        tactical,
        engineering: {
          power: { engines: 2, shields: 2, weapons: 4, sensors: 0 },
          repair: pickRepair(self),
        },
      }
    }
    // Keep closing quietly.
    return {
      shipId,
      helm: { turn, throttle: dist > 12 ? 4 : 2, cloak: true },
      tactical: {},
      engineering: {
        power: { engines: 3, shields: 0, weapons: 0, sensors: 2 },
        repair: pickRepair(self),
      },
    }
  }

  // Visible. Hurt and able to vanish? Break contact and restalk.
  const hullFrac = self.hull / self.maxHull
  if (hullFrac < 0.5 && self.cloakCooldown === 0 && dist > 4 && self.subsystems.engines.hp > 0) {
    return {
      shipId,
      helm: { turn: headingDelta(self.heading, normalizeHeading(desired + 8)), throttle: 3, cloak: true },
      tactical: {}, // engaging cloak drops weapons this round anyway
      engineering: {
        power: { engines: 4, shields: 0, weapons: 0, sensors: 0 },
        repair: pickRepair(self),
      },
    }
  }

  // Knife-fight: moderate closure, guns on target.
  let throttle: number
  if (dist > 12) throttle = 4
  else if (dist > 6) throttle = 2
  else throttle = 1
  const bears = bearsAfterTurn(self, desired, 2)
  const tactical: OrderSet['tactical'] = {}
  if (bears && dist <= cls.phaser.range * 1.2) {
    tactical.firePhasers = { targetId: foe.id, subsystem: null }
  }
  if (bears && self.torpedoes > 0 && dist > 5 && dist <= 16 && roll(rng, 0.4)) {
    tactical.fireTorpedo = { targetId: foe.id }
  }
  return {
    shipId,
    helm: { turn, throttle },
    tactical,
    engineering: {
      power: { engines: 3, shields: 2, weapons: 3, sensors: 0 },
      repair: pickRepair(self),
    },
  }
}

function brawler(self: ShipState, foe: ShipState, dist: number, shipId: string, rng: Rng): OrderSet {
  const cls = getShipClass(self.classId)
  const desired = headingToward(self.pos, foe.pos)
  const turn = headingDelta(self.heading, desired)
  // Steady closure to mid-range; the wide batteries bear almost always.
  let throttle: number
  if (dist > 12) throttle = 3
  else if (dist > 5) throttle = 2
  else throttle = 0
  const bears = bearsAfterTurn(self, desired, 4) // 180° arc: generous
  const tactical: OrderSet['tactical'] = {}
  if (bears && dist <= cls.phaser.range * 1.2) {
    tactical.firePhasers = { targetId: foe.id, subsystem: null }
  }
  if (bearsAfterTurn(self, desired, 2) && self.torpedoes > 0 && dist > 4 && dist <= 15 && roll(rng, 0.5)) {
    tactical.fireTorpedo = { targetId: foe.id }
  }
  return {
    shipId,
    helm: { turn, throttle },
    tactical,
    engineering: {
      power: { engines: 2, shields: 4, weapons: 4, sensors: 1 },
      repair: pickRepair(self),
    },
  }
}

function harasser(self: ShipState, foe: ShipState, dist: number, shipId: string, rng: Rng): OrderSet {
  const cls = getShipClass(self.classId)
  const toward = headingToward(self.pos, foe.pos)
  const away = normalizeHeading(toward + 8)
  const tactical: OrderSet['tactical'] = {}
  let turn: number
  let throttle: number
  // Speeds are tuned so an attack pass spends 2-3 rounds inside the gun
  // envelope instead of ballistically crossing it in one (which left the
  // target abeam of the narrow arc at every sampled firing point).
  if (dist > 14) {
    // Line up the next run.
    turn = headingDelta(self.heading, toward)
    throttle = 3
  } else if (dist > 5) {
    // Attack run: guns hot.
    turn = headingDelta(self.heading, toward)
    throttle = 2
    if (bearsAfterTurn(self, toward, 2) && dist <= cls.phaser.range * 1.2) {
      tactical.firePhasers = { targetId: foe.id, subsystem: null }
    }
    if (bearsAfterTurn(self, toward, 2) && self.torpedoes > 0 && roll(rng, 0.3)) {
      tactical.fireTorpedo = { targetId: foe.id }
    }
  } else {
    // Too close: extend out for the next pass, snap a shot if guns still bear.
    turn = headingDelta(self.heading, away)
    throttle = 3
    if (bearsAfterTurn(self, toward, 2) && dist <= cls.phaser.range) {
      tactical.firePhasers = { targetId: foe.id, subsystem: null }
    }
  }
  return {
    shipId,
    helm: { turn, throttle },
    tactical,
    engineering: {
      power: { engines: 3, shields: 1, weapons: 3, sensors: 0 },
      repair: pickRepair(self),
    },
  }
}

function flee(self: ShipState, foe: ShipState, dist: number, shipId: string): OrderSet {
  const cls = getShipClass(self.classId)
  const awayHeading = normalizeHeading(headingToward(self.pos, foe.pos) + 8)
  // A cloak-capable ship escapes under cloak (untargetable beats fast).
  const canCloak =
    cls.hasCloak && !self.cloaked && self.cloakCooldown === 0 && self.subsystems.engines.hp > 0
  const canWarp = self.subsystems.engines.hp > 0 && dist >= WARP_OUT_MIN_RANGE
  return {
    shipId,
    helm: {
      turn: headingDelta(self.heading, awayHeading),
      throttle: THROTTLE_MAX,
      warpOut: canWarp,
      ...(canCloak || self.cloaked ? { cloak: true } : {}),
    },
    tactical: {},
    engineering: {
      power: { engines: 4, shields: self.cloaked ? 0 : 2, weapons: 0, sensors: 0 },
      repair: pickRepair(self),
    },
  }
}

// --- helpers -------------------------------------------------------------------

/** Will the target be within `steps` headings of our bow after we turn? */
function bearsAfterTurn(self: ShipState, desiredHeading: number, steps: number): boolean {
  const cls = getShipClass(self.classId)
  const turn = headingDelta(self.heading, desiredHeading)
  const clamped = Math.max(-cls.agility, Math.min(cls.agility, turn))
  const predicted = normalizeHeading(self.heading + clamped)
  return Math.abs(headingDelta(predicted, desiredHeading)) <= steps
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

// Power allocations above are requests; the sim clamps them to the live budget
// deterministically (see power.ts), so damaged ships degrade gracefully.
