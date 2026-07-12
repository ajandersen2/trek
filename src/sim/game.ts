// Top-level game flow: sector travel <-> encounters <-> mission resolution.
// Pure state-in/state-out like the rest of the sim. The controller (main.ts)
// owns collecting orders; this module owns what they mean for the campaign.
// Missions are data (src/data/missions.ts); this module interprets triggers,
// activation chains, and outcomes.

import {
  FLAVOR_EVENT_CHANCE,
  PATROL_TABLE,
  RANDOM_ENCOUNTER_CHANCE,
  TRAVEL_FLAVOR,
} from '../data/events'
import { MISSION_DEFS, getMissionDef, type MissionDef } from '../data/missions'
import { START_SYSTEM_ID, getSystem } from '../data/sectors'
import { getShipClass } from '../data/ships'
import { createEncounter, getShip, resolveRound } from './encounter'
import { createGalaxy, moveTo, type GalaxyState } from './galaxy'
import { nextFloat, pick, roll, type Rng } from './rng'
import { createShip, round2 } from './ship'
import type { EncounterState, EncounterStatus, OrderSet, RoundEvent, ShipState } from './types'

export type GameMode = 'sector' | 'encounter' | 'game-over'

export interface GameSettings {
  /** Locked design decision #3: on by default; "Captain's Mercy" disables. */
  permadeath: boolean
}

export interface MissionRecord {
  defId: string
  stage: 'inactive' | 'active' | 'resolved'
  outcome: EncounterStatus | null
  /** Jumps made since activation (drives intercept-after triggers). */
  jumps: number
}

export type EncounterContext = { kind: 'mission'; defId: string } | { kind: 'random' }

export interface GameState {
  seed: number
  rngState: number
  mode: GameMode
  settings: GameSettings
  ship: ShipState
  galaxy: GalaxyState
  missions: MissionRecord[]
  encounter: EncounterState | null
  encounterContext: EncounterContext | null
  /** Persistent captain's log (story beats, not per-shot combat noise). */
  logArchive: string[]
}

export interface GameStep {
  state: GameState
  log: string[]
}

export const PLAYER_SHIP_ID = 'player'
export const STARTING_STARDATE = 47501.3
const LOG_ARCHIVE_MAX = 400

export function newGame(seed: number, options?: Partial<GameSettings>): GameStep {
  const ship = createShip(PLAYER_SHIP_ID, 'USS Farragut', 'fed-cruiser', { x: 0, y: 0 }, 0)
  const state: GameState = {
    seed,
    rngState: seed >>> 0,
    mode: 'sector',
    settings: { permadeath: options?.permadeath ?? true },
    ship,
    galaxy: createGalaxy(START_SYSTEM_ID, STARTING_STARDATE),
    missions: MISSION_DEFS.map((def) => ({
      defId: def.id,
      stage: def.activateAfter === null ? 'active' : 'inactive',
      outcome: null,
      jumps: 0,
    })),
    encounter: null,
    encounterContext: null,
    logArchive: [],
  }
  const log: string[] = []
  for (const def of MISSION_DEFS) {
    if (def.activateAfter === null) log.push(...def.briefing)
  }
  archive(state, log)
  return { state, log }
}

/** Missions currently active, in definition order. */
export function activeMissions(state: GameState): MissionRecord[] {
  return state.missions.filter((m) => m.stage === 'active')
}

export function missionRecord(state: GameState, defId: string): MissionRecord {
  const rec = state.missions.find((m) => m.defId === defId)
  if (!rec) throw new Error(`no mission record ${defId}`)
  return rec
}

/** Warp to an adjacent system. May drop the ship into an encounter on arrival. */
export function travelTo(state: GameState, systemId: string): GameStep {
  if (state.mode !== 'sector') throw new Error('cannot travel: not in sector mode')
  const s = structuredClone(state)
  const rng: Rng = { state: s.rngState }
  const log: string[] = []

  moveTo(s.galaxy, systemId)
  const system = getSystem(systemId)
  log.push(`Stardate ${s.galaxy.stardate.toFixed(1)} — arrived at ${system.name}.`)
  for (const rec of activeMissions(s)) rec.jumps += 1

  const missionHere = findTriggeredMission(s, systemId)
  if (missionHere) {
    const def = getMissionDef(missionHere.defId)
    const enemy = createShip('enemy', def.enemyName, def.enemyClassId, { x: 0, y: 0 }, 8)
    s.encounter = createEncounter(s.ship, enemy, rng)
    s.encounterContext = { kind: 'mission', defId: def.id }
    s.mode = 'encounter'
    log.push(...def.contact)
  } else if (system.type !== 'starbase' && roll(rng, RANDOM_ENCOUNTER_CHANCE)) {
    const entry = pickWeightedPatrol(rng)
    const name = pick(rng, entry.names)
    const enemy = createShip('enemy', name, entry.classId, { x: 0, y: 0 }, 8)
    s.encounter = createEncounter(s.ship, enemy, rng)
    s.encounterContext = { kind: 'random' }
    s.mode = 'encounter'
    const clsName = getShipClass(entry.classId).name
    log.push(`Klingon patrol — ${name} (${clsName}) decloaks off the bow. RED ALERT.`)
  } else if (roll(rng, FLAVOR_EVENT_CHANCE)) {
    log.push(pick(rng, TRAVEL_FLAVOR))
  }

  s.rngState = rng.state
  archive(s, log)
  return { state: s, log }
}

function findTriggeredMission(s: GameState, arrivedSystemId: string): MissionRecord | null {
  const system = getSystem(arrivedSystemId)
  for (const rec of activeMissions(s)) {
    const def = getMissionDef(rec.defId)
    if (def.trigger.type === 'at-system' && def.trigger.systemId === arrivedSystemId) {
      return rec
    }
    if (
      def.trigger.type === 'intercept-after' &&
      rec.jumps >= def.trigger.jumps &&
      system.type !== 'starbase' // no ambushes under the base's guns
    ) {
      return rec
    }
  }
  return null
}

function pickWeightedPatrol(rng: Rng): (typeof PATROL_TABLE)[number] {
  const total = PATROL_TABLE.reduce((sum, e) => sum + e.weight, 0)
  let ticket = nextFloat(rng) * total
  for (const entry of PATROL_TABLE) {
    ticket -= entry.weight
    if (ticket < 0) return entry
  }
  return PATROL_TABLE[PATROL_TABLE.length - 1]!
}

/** Dock at a starbase: full repair, shields, and torpedo restock. */
export function dock(state: GameState): GameStep {
  if (state.mode !== 'sector') throw new Error('cannot dock: not in sector mode')
  const system = getSystem(state.galaxy.currentSystemId)
  if (system.type !== 'starbase') throw new Error('no starbase here')
  const s = structuredClone(state)
  restoreShip(s.ship, 1)
  const log = [
    `${system.name}: repair crews swarm the hull. All systems restored, torpedoes restocked.`,
  ]
  archive(s, log)
  return { state: s, log }
}

export interface EncounterRoundStep {
  state: GameState
  events: RoundEvent[]
}

/**
 * Resolve one WEGO round of the active encounter with everyone's orders.
 * The encounter (with its final status) stays on the state so the UI can show
 * the end-of-battle board; call concludeEncounter() to return to the sector.
 */
export function applyEncounterRound(state: GameState, orders: OrderSet[]): EncounterRoundStep {
  if (state.mode !== 'encounter' || !state.encounter) {
    throw new Error('no active encounter')
  }
  const s = structuredClone(state)
  const rng: Rng = { state: s.rngState }
  const { state: encounter, events } = resolveRound(s.encounter!, orders, rng)
  s.encounter = encounter
  s.rngState = rng.state
  // Persist player-ship changes as they happen so a mid-battle crash/save
  // can never duplicate a pristine ship.
  s.ship = structuredClone(getShip(encounter, PLAYER_SHIP_ID))
  return { state: s, events }
}

/** Leave a finished encounter: apply mission/campaign consequences. */
export function concludeEncounter(state: GameState): GameStep {
  if (state.mode !== 'encounter' || !state.encounter) throw new Error('no active encounter')
  const status = state.encounter.status
  if (status === 'active') throw new Error('encounter still active')
  const s = structuredClone(state)
  const log: string[] = []

  s.ship = structuredClone(getShip(s.encounter!, PLAYER_SHIP_ID))
  s.ship.warpedOut = false
  s.ship.cloaked = false
  s.encounter = null
  const context = s.encounterContext
  s.encounterContext = null

  if (status === 'defeat') {
    concludeDefeat(s, log)
    archive(s, log)
    return { state: s, log }
  }

  s.mode = 'sector'
  const wonOutcomes: EncounterStatus[] = ['victory', 'enemy-disabled', 'enemy-withdrawn']
  if (context?.kind === 'mission') {
    const rec = missionRecord(s, context.defId)
    const def = getMissionDef(context.defId)
    if (wonOutcomes.includes(status)) {
      rec.stage = 'resolved'
      rec.outcome = status
      log.push(...(def.resolution[status] ?? []))
      log.push(`MISSION COMPLETE — ${def.title}.`)
      activateFollowUps(s, def, log)
    } else {
      log.push(def.withdrawnLine)
    }
  } else {
    switch (status) {
      case 'victory':
        log.push('The patrol ship is destroyed. Space is quiet again.')
        break
      case 'enemy-disabled':
        log.push('The patrol ship drifts, disabled. Starbase 4 will send a tug — and a boarding party.')
        break
      case 'enemy-withdrawn':
        log.push('The Klingon breaks off and warps out. They will remember this.')
        break
      case 'withdrawn':
        log.push('We disengage and go to warp. No shame in choosing the fight you can win.')
        break
      default:
        break
    }
  }
  archive(s, log)
  return { state: s, log }
}

function activateFollowUps(s: GameState, resolved: MissionDef, log: string[]): void {
  for (const def of MISSION_DEFS) {
    if (def.activateAfter !== resolved.id) continue
    const rec = missionRecord(s, def.id)
    if (rec.stage !== 'inactive') continue
    rec.stage = 'active'
    rec.jumps = 0
    log.push(...def.briefing)
  }
}

function concludeDefeat(s: GameState, log: string[]): void {
  if (s.settings.permadeath) {
    s.mode = 'game-over'
    log.push(`The ${s.ship.name} is lost with all hands. Stardate ${s.galaxy.stardate.toFixed(1)}.`)
    return
  }
  // Captain's Mercy: the ship survives — barely — and is towed home.
  s.mode = 'sector'
  s.galaxy.currentSystemId = START_SYSTEM_ID
  s.galaxy.stardate = round2(s.galaxy.stardate + 2)
  restoreShip(s.ship, 0) // clear the wreck state first
  s.ship.hull = Math.round(s.ship.maxHull * 0.3)
  for (const sub of Object.values(s.ship.subsystems)) sub.hp = Math.round(sub.maxHp * 0.25)
  s.ship.shields = { fore: 10, aft: 10, port: 10, starboard: 10 }
  s.ship.torpedoes = 2
  log.push(
    'Emergency beacons. Darkness. Then tractor beams — a Starbase 4 tender hauling our broken hull home.',
    `Stardate ${s.galaxy.stardate.toFixed(1)}: the ${s.ship.name} limps back to service. The war does not wait.`,
  )
}

/** Restore a ship to spec (fraction 1 = full restore; 0 = just revive systems at zero). */
function restoreShip(ship: ShipState, fraction: number): void {
  const cls = getShipClass(ship.classId)
  ship.alive = true
  ship.warpedOut = false
  ship.cloaked = false
  ship.cloakCooldown = 0
  if (fraction >= 1) {
    ship.hull = cls.maxHull
    for (const sub of Object.values(ship.subsystems)) sub.hp = sub.maxHp
    ship.shields = {
      fore: cls.shieldMax,
      aft: cls.shieldMax,
      port: cls.shieldMax,
      starboard: cls.shieldMax,
    }
    ship.torpedoes = cls.torpedoCapacity
  }
}

function archive(s: GameState, lines: string[]): void {
  if (lines.length === 0) return
  s.logArchive.push(...lines)
  if (s.logArchive.length > LOG_ARCHIVE_MAX) {
    s.logArchive = s.logArchive.slice(s.logArchive.length - LOG_ARCHIVE_MAX)
  }
}
