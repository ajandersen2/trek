// Power management. Each round the warp core produces a budget the captain splits
// across engines / shields / weapons / sensors. Hull damage shrinks the budget.
//
// Effectiveness: factor = (0.5 + 0.25 * power) * subsystemHealth, so power 2 is
// nominal (1.0×), 4 is overcharged (1.5×), 0 is degraded (0.5×) — never dead from
// power alone. A destroyed subsystem (hp 0) is dead regardless of power.

import type { PowerAllocation, ShipState, SubsystemId } from './types'
import { getShipClass } from '../data/ships'

export const POWER_MAX_PER_SYSTEM = 4

/** Warp core output: full at full hull, down to 40% of rated as hull fails. */
export function powerBudget(ship: ShipState): number {
  const rated = getShipClass(ship.classId).ratedPower
  const hullFraction = ship.maxHull > 0 ? ship.hull / ship.maxHull : 0
  return Math.max(0, Math.ceil(rated * (0.4 + 0.6 * hullFraction)))
}

export function totalAllocated(power: PowerAllocation): number {
  return power.engines + power.shields + power.weapons + power.sensors
}

export function isValidAllocation(power: PowerAllocation, budget: number): boolean {
  const values = [power.engines, power.shields, power.weapons, power.sensors]
  if (values.some((v) => !Number.isInteger(v) || v < 0 || v > POWER_MAX_PER_SYSTEM)) return false
  return totalAllocated(power) <= budget
}

/**
 * Sanitize a requested allocation against the ship's current budget.
 * Clamps each system to [0, 4], then sheds power (sensors → weapons → shields →
 * engines order) until within budget. Deterministic, so both lockstep peers
 * agree on the result of an illegal order.
 */
export function clampAllocation(requested: PowerAllocation, budget: number): PowerAllocation {
  const p: PowerAllocation = {
    engines: clampSystem(requested.engines),
    shields: clampSystem(requested.shields),
    weapons: clampSystem(requested.weapons),
    sensors: clampSystem(requested.sensors),
  }
  const shedOrder: SubsystemId[] = ['sensors', 'weapons', 'shields', 'engines']
  let excess = totalAllocated(p) - budget
  for (const sys of shedOrder) {
    while (excess > 0 && p[sys] > 0) {
      p[sys] -= 1
      excess -= 1
    }
  }
  return p
}

function clampSystem(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(POWER_MAX_PER_SYSTEM, Math.floor(v)))
}

/**
 * Effectiveness multiplier for a subsystem: power curve × health fraction.
 * Returns 0 if the subsystem is destroyed.
 */
export function systemFactor(ship: ShipState, system: SubsystemId): number {
  const sub = ship.subsystems[system]
  if (sub.hp <= 0) return 0
  const health = sub.hp / sub.maxHp
  return (0.5 + 0.25 * ship.power[system]) * health
}
