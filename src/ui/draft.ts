// UI-side order draft: widget state for the encounter screen, assembled into a
// complete OrderSet when EXECUTE ROUND is pressed. Draft objects belong to the
// UI — they are never sim state and never mutate anything from GameState.

import { getShipClass } from '../data/ships'
import { THROTTLE_MAX } from '../sim/constants'
import type { GameState } from '../sim/game'
import { clampAllocation, powerBudget } from '../sim/power'
import type { OrderSet, PowerAllocation, ShipState, SubsystemId } from '../sim/types'

export interface OrderDraft {
  power: PowerAllocation
  turn: number
  throttle: number
  warpOut: boolean
  /** Desired cloak state (absolute). Only sent when the ship class hasCloak. */
  cloak: boolean
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
 * carries over from the previous round of the same encounter. The cloak
 * toggle starts at the ship's current state (HelmOrder.cloak is absolute).
 */
export function newDraft(ship: ShipState, throttle: number): OrderDraft {
  return {
    power: clampAllocation(ship.power, powerBudget(ship)),
    turn: 0,
    throttle: Math.max(0, Math.min(THROTTLE_MAX, Math.trunc(throttle))),
    warpOut: false,
    cloak: ship.cloaked,
    firePhasers: false,
    targetSubsystem: null,
    fireTorpedo: false,
    scan: false,
    hail: false,
    repair: null,
  }
}

/**
 * Assemble a complete OrderSet from the draft for `ship` against `enemy`.
 * Shared by the campaign encounter and the hot-seat skirmish (where the
 * ordering ship is whichever seat holds the console, not GameState.ship).
 */
export function buildShipOrders(draft: OrderDraft, ship: ShipState, enemy: ShipState | null): OrderSet {
  const orders: OrderSet = {
    shipId: ship.id,
    helm: { turn: draft.turn, throttle: draft.throttle, warpOut: draft.warpOut },
    tactical: {},
    engineering: { power: { ...draft.power }, repair: draft.repair },
  }
  // Ships without a cloaking device never send the order (the sim would ignore
  // it, but the wire format stays clean for lockstep hashing).
  if (getShipClass(ship.classId).hasCloak) orders.helm.cloak = draft.cloak
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

/** Assemble the complete player OrderSet from the draft (campaign encounter). */
export function buildOrders(draft: OrderDraft, game: GameState): OrderSet {
  const enc = game.encounter
  const player = enc ? (enc.ships.find((s) => s.id === enc.playerShipId) ?? game.ship) : game.ship
  const enemy = enc ? (enc.ships.find((s) => s.id !== enc.playerShipId) ?? null) : null
  return buildShipOrders(draft, player, enemy)
}
