// Core sim types. Everything here must be plain JSON-serializable data —
// saves, network packets, and structuredClone all depend on it.

import type { ArcId, Vec2 } from './geometry'

export type SubsystemId = 'weapons' | 'engines' | 'shields' | 'sensors'
export type FactionId = 'federation' | 'klingon'

export const SUBSYSTEM_IDS: readonly SubsystemId[] = ['weapons', 'engines', 'shields', 'sensors']
export const ARC_IDS: readonly ArcId[] = ['fore', 'aft', 'port', 'starboard']

export interface PowerAllocation {
  engines: number
  shields: number
  weapons: number
  sensors: number
}

export interface Subsystem {
  hp: number
  maxHp: number
}

export type ShieldState = Record<ArcId, number>

export interface ShipState {
  id: string
  name: string
  classId: string
  faction: FactionId
  pos: Vec2
  heading: number // 0..15, see geometry.ts
  hull: number
  maxHull: number
  shields: ShieldState
  subsystems: Record<SubsystemId, Subsystem>
  power: PowerAllocation
  torpedoes: number
  /** 0 = unknown contact (hull bar only in UI), 1 = scanned (full readout, subsystem targeting). */
  scanLevel: number
  alive: boolean
  /** Left the encounter via warp. Encounter-scoped; reset on encounter start. */
  warpedOut: boolean
}

export interface TorpedoState {
  id: number
  ownerId: string
  targetId: string
  pos: Vec2
  heading: number
  /** Rounds of tracking left before it fizzles. */
  fuel: number
  // Flight spec copied from the launcher's class at launch, so the torpedo
  // keeps flying even if its owner is destroyed mid-flight.
  speed: number
  damage: number
  proximity: number
  turnRate: number
}

export type EncounterStatus =
  | 'active'
  | 'victory' // enemy destroyed
  | 'enemy-disabled' // weapons + engines down: non-lethal win
  | 'enemy-withdrawn' // enemy warped out
  | 'withdrawn' // player warped out
  | 'defeat' // player destroyed

export interface EncounterState {
  round: number
  /** Canonical resolution order. Player ship first by construction. */
  ships: ShipState[]
  torpedoes: TorpedoState[]
  nextTorpedoId: number
  status: EncounterStatus
  playerShipId: string
}

// ---------------------------------------------------------------------------
// Orders: one set per captain per round (WEGO).

export interface HelmOrder {
  /** Signed heading steps, clamped to ship agility. */
  turn: number
  /** Impulse level 0..4 (quarters of max speed). */
  throttle: number
  /** Attempt to leave the encounter. Needs working engines and enough range. */
  warpOut?: boolean
}

export interface TacticalOrder {
  firePhasers?: { targetId: string; subsystem: SubsystemId | null }
  fireTorpedo?: { targetId: string }
}

export interface EngineeringOrder {
  power: PowerAllocation
  /** Field repair: one subsystem per round. */
  repair?: SubsystemId | null
}

export interface ScienceOrder {
  scanTargetId?: string
}

export interface CommsOrder {
  hail?: boolean
}

export interface OrderSet {
  shipId: string
  helm: HelmOrder
  tactical: TacticalOrder
  engineering: EngineeringOrder
  science?: ScienceOrder
  comms?: CommsOrder
}

// ---------------------------------------------------------------------------
// Round events: what happened, in animation order. The render layer replays
// these; the UI log prints them. Sim state never references them back.

export type RoundEvent =
  | { type: 'round-start'; round: number }
  | { type: 'power'; shipId: string; power: PowerAllocation; budget: number }
  | { type: 'repair'; shipId: string; subsystem: SubsystemId; hp: number }
  | { type: 'helm'; shipId: string; from: Vec2; to: Vec2; headingFrom: number; headingTo: number }
  | { type: 'warp-out'; shipId: string }
  | { type: 'warp-out-failed'; shipId: string; reason: 'engines' | 'too-close' }
  | { type: 'scan'; shipId: string; targetId: string; success: boolean }
  | { type: 'hail'; shipId: string; targetId: string; text: string }
  | { type: 'torpedo-launch'; id: number; ownerId: string; targetId: string; pos: Vec2 }
  | { type: 'torpedo-move'; id: number; from: Vec2; to: Vec2 }
  | { type: 'torpedo-expired'; id: number; pos: Vec2 }
  | {
      type: 'torpedo-hit'
      id: number
      targetId: string
      arc: ArcId
      shieldDamage: number
      hullDamage: number
      pos: Vec2
    }
  | {
      type: 'phaser-fire'
      shooterId: string
      targetId: string
      from: Vec2
      to: Vec2
      hit: boolean
      arc: ArcId | null
      shieldDamage: number
      hullDamage: number
      targetedSubsystem: SubsystemId | null
      subsystemDamage: number
    }
  | { type: 'phaser-blocked'; shooterId: string; reason: 'arc' | 'range' | 'weapons-down' | 'no-power' }
  | { type: 'torpedo-blocked'; shooterId: string; reason: 'arc' | 'ammo' | 'weapons-down' | 'no-power' }
  | { type: 'subsystem-damaged'; shipId: string; subsystem: SubsystemId; hp: number; disabled: boolean }
  | { type: 'ship-destroyed'; shipId: string }
  | { type: 'ship-disabled'; shipId: string }
  | { type: 'encounter-end'; status: EncounterStatus }
  | { type: 'log'; text: string }

// ---------------------------------------------------------------------------
// Ship class data shape (instances live in src/data/ships.ts).

export interface WeaponSpec {
  /** Cosine of the firing arc half-angle, precomputed literal. */
  cosHalfArc: number
  baseDamage: number
  range: number
}

export interface ShipClass {
  id: string
  name: string
  faction: FactionId
  maxHull: number
  /** Max heading steps per round. */
  agility: number
  /** Distance units per round at full impulse, nominal power. */
  maxSpeed: number
  /** Warp core output at full hull. */
  ratedPower: number
  phaser: WeaponSpec
  torpedo: { cosHalfArc: number; damage: number; speed: number; fuel: number; proximity: number }
  torpedoCapacity: number
  shieldMax: number
  shieldRegen: number
  subsystemMaxHp: number
}
