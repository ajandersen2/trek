// Ship construction and damage application.

import { getShipClass } from '../data/ships'
import type { ArcId, Vec2 } from './geometry'
import type { RoundEvent, ShipState, SubsystemId } from './types'

/** Default allocation: nominal power everywhere if budget allows (it does for both M1 classes). */
export function defaultPower(): { engines: number; shields: number; weapons: number; sensors: number } {
  return { engines: 2, shields: 2, weapons: 2, sensors: 2 }
}

export function createShip(
  id: string,
  name: string,
  classId: string,
  pos: Vec2,
  heading: number,
): ShipState {
  const cls = getShipClass(classId)
  const sub = () => ({ hp: cls.subsystemMaxHp, maxHp: cls.subsystemMaxHp })
  return {
    id,
    name,
    classId,
    faction: cls.faction,
    pos: { ...pos },
    heading,
    hull: cls.maxHull,
    maxHull: cls.maxHull,
    shields: { fore: cls.shieldMax, aft: cls.shieldMax, port: cls.shieldMax, starboard: cls.shieldMax },
    subsystems: { weapons: sub(), engines: sub(), shields: sub(), sensors: sub() },
    power: defaultPower(),
    torpedoes: cls.torpedoCapacity,
    scanLevel: 0,
    alive: true,
    warpedOut: false,
  }
}

export interface DamageResult {
  shieldDamage: number
  hullDamage: number
  subsystemDamage: number
}

/**
 * Apply `amount` of incoming damage to `ship` on shield arc `arc`.
 * Shields soak first; leak-through goes to hull, or (if `targetSubsystem`)
 * 70% to that subsystem and 30% to hull. Emits subsystem/destroyed events
 * into `events`. Mutates ship (callers work on a cloned round state).
 *
 * Shields subsystem destroyed or unpowered collapse is handled upstream by
 * zeroing the arcs; here shields are just whatever the arcs hold.
 */
export function applyDamage(
  ship: ShipState,
  arc: ArcId,
  amount: number,
  targetSubsystem: SubsystemId | null,
  events: RoundEvent[],
): DamageResult {
  const arcStrength = ship.shields[arc]
  const shieldDamage = Math.min(arcStrength, amount)
  ship.shields[arc] = round2(arcStrength - shieldDamage)
  let through = amount - shieldDamage

  let hullDamage = 0
  let subsystemDamage = 0
  if (through > 0) {
    if (targetSubsystem) {
      subsystemDamage = through * 0.7
      hullDamage = through * 0.3
      damageSubsystem(ship, targetSubsystem, subsystemDamage, events)
    } else {
      hullDamage = through
    }
    ship.hull = round2(Math.max(0, ship.hull - hullDamage))
    if (ship.hull <= 0 && ship.alive) {
      ship.alive = false
      events.push({ type: 'ship-destroyed', shipId: ship.id })
    }
  }
  return { shieldDamage: round2(shieldDamage), hullDamage: round2(hullDamage), subsystemDamage: round2(subsystemDamage) }
}

export function damageSubsystem(
  ship: ShipState,
  system: SubsystemId,
  amount: number,
  events: RoundEvent[],
): void {
  const sub = ship.subsystems[system]
  if (sub.hp <= 0) return
  sub.hp = round2(Math.max(0, sub.hp - amount))
  events.push({
    type: 'subsystem-damaged',
    shipId: ship.id,
    subsystem: system,
    hp: sub.hp,
    disabled: sub.hp <= 0,
  })
  // Shield emitters destroyed: all arcs collapse.
  if (system === 'shields' && sub.hp <= 0) {
    ship.shields = { fore: 0, aft: 0, port: 0, starboard: 0 }
  }
}

/**
 * Round to 2 decimals to keep state JSON tidy and — more importantly — make
 * accumulated float drift identical across save/load boundaries.
 * (x * 100 and /100 are exact enough here because we quantize every write.)
 */
export function round2(x: number): number {
  return Math.round(x * 100) / 100
}
