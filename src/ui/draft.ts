// UI-side order draft: widget state for the encounter screen, assembled into a
// complete OrderSet when EXECUTE ROUND is pressed. Draft objects belong to the
// UI — they are never sim state and never mutate anything from GameState.

import { THROTTLE_MAX } from '../sim/constants'
import type { GameState } from '../sim/game'
import { clampAllocation, powerBudget } from '../sim/power'
import type { OrderSet, PowerAllocation, ShipState, SubsystemId } from '../sim/types'

export interface OrderDraft {
  power: PowerAllocation
  turn: number
  throttle: number
  warpOut: boolean
  firePhasers: boolean
  /** null targets the hull. */
  targetSubsystem: SubsystemId | null
  fireTorpedo: boolean
  scan: boolean
  hail: boolean
  repair: SubsystemId | null
}

/**
 * Fresh draft for a new round: power mirrors the ship's current allocation
 * (clamped to the live budget), one-shot toggles and turn reset, throttle
 * carries over from the previous round of the same encounter.
 */
export function newDraft(ship: ShipState, throttle: number): OrderDraft {
  return {
    power: clampAllocation(ship.power, powerBudget(ship)),
    turn: 0,
    throttle: Math.max(0, Math.min(THROTTLE_MAX, Math.trunc(throttle))),
    warpOut: false,
    firePhasers: false,
    targetSubsystem: null,
    fireTorpedo: false,
    scan: false,
    hail: false,
    repair: null,
  }
}

/** Assemble the complete player OrderSet from the draft. */
export function buildOrders(draft: OrderDraft, game: GameState): OrderSet {
  const enc = game.encounter
  const enemy = enc ? (enc.ships.find((s) => s.id !== enc.playerShipId) ?? null) : null
  const orders: OrderSet = {
    shipId: game.ship.id,
    helm: { turn: draft.turn, throttle: draft.throttle, warpOut: draft.warpOut },
    tactical: {},
    engineering: { power: { ...draft.power }, repair: draft.repair },
  }
  if (enemy) {
    if (draft.firePhasers) {
      orders.tactical.firePhasers = { targetId: enemy.id, subsystem: draft.targetSubsystem }
    }
    if (draft.fireTorpedo) orders.tactical.fireTorpedo = { targetId: enemy.id }
    if (draft.scan) orders.science = { scanTargetId: enemy.id }
  }
  if (draft.hail) orders.comms = { hail: true }
  return orders
}
