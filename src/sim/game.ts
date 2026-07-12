// Top-level game flow: sector travel <-> encounters <-> mission resolution.
// Pure state-in/state-out like the rest of the sim. The controller (main.ts)
// owns collecting orders; this module owns what they mean for the campaign.

import {
  FLAVOR_EVENT_CHANCE,
  PATROL_SHIP_NAMES,
  RANDOM_ENCOUNTER_CHANCE,
  TRAVEL_FLAVOR,
} from '../data/events'
import {
  MISSION_BRIEFING,
  MISSION_ENEMY_NAME,
  MISSION_ID,
  MISSION_RESOLUTION,
  MISSION_TITLE,
  MISSION_WITHDRAWN_LINE,
} from '../data/mission'
import { MISSION_TARGET_SYSTEM_ID, START_SYSTEM_ID, getSystem } from '../data/sectors'
import { getShipClass } from '../data/ships'
import { createEncounter, getShip, resolveRound } from './encounter'
import { createGalaxy, moveTo, type GalaxyState } from './galaxy'
import { pick, roll, type Rng } from './rng'
import { createShip } from './ship'
import type { EncounterState, EncounterStatus, OrderSet, RoundEvent, ShipState } from './types'

export type GameMode = 'sector' | 'encounter' | 'game-over'
export type EncounterContext = 'mission' | 'random'

export interface MissionState {
  id: string
  title: string
  stage: 'active' | 'resolved'
  outcome: EncounterStatus | null
  targetSystemId: string
}

export interface GameState {
  seed: number
  rngState: number
  mode: GameMode
  ship: ShipState
  galaxy: GalaxyState
  mission: MissionState
  encounter: EncounterState | null
  encounterContext: EncounterContext | null
}

export interface GameStep {
  state: GameState
  log: string[]
}

export const PLAYER_SHIP_ID = 'player'
export const STARTING_STARDATE = 47501.3

export function newGame(seed: number): GameStep {
  const ship = createShip(PLAYER_SHIP_ID, 'USS Farragut', 'fed-cruiser', { x: 0, y: 0 }, 0)
  const state: GameState = {
    seed,
    rngState: seed >>> 0,
    mode: 'sector',
    ship,
    galaxy: createGalaxy(START_SYSTEM_ID, STARTING_STARDATE),
    mission: {
      id: MISSION_ID,
      title: MISSION_TITLE,
      stage: 'active',
      outcome: null,
      targetSystemId: MISSION_TARGET_SYSTEM_ID,
    },
    encounter: null,
    encounterContext: null,
  }
  return { state, log: [...MISSION_BRIEFING] }
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

  const missionHere =
    s.mission.stage === 'active' && systemId === s.mission.targetSystemId

  if (missionHere) {
    const enemy = createShip('enemy', MISSION_ENEMY_NAME, 'klingon-bop', { x: 0, y: 0 }, 8)
    s.encounter = createEncounter(s.ship, enemy, rng)
    s.encounterContext = 'mission'
    s.mode = 'encounter'
    log.push(`${MISSION_ENEMY_NAME} is firing on the colony. It is coming about to face us.`)
    log.push('RED ALERT. All stations, battle orders.')
  } else if (system.type !== 'starbase' && roll(rng, RANDOM_ENCOUNTER_CHANCE)) {
    const name = pick(rng, PATROL_SHIP_NAMES)
    const enemy = createShip('enemy', name, 'klingon-bop', { x: 0, y: 0 }, 8)
    s.encounter = createEncounter(s.ship, enemy, rng)
    s.encounterContext = 'random'
    s.mode = 'encounter'
    log.push(`Klingon patrol ${name} decloaks off the bow. RED ALERT.`)
  } else if (roll(rng, FLAVOR_EVENT_CHANCE)) {
    log.push(pick(rng, TRAVEL_FLAVOR))
  }

  s.rngState = rng.state
  return { state: s, log }
}

/** Dock at a starbase: full repair, shields, and torpedo restock. */
export function dock(state: GameState): GameStep {
  if (state.mode !== 'sector') throw new Error('cannot dock: not in sector mode')
  const system = getSystem(state.galaxy.currentSystemId)
  if (system.type !== 'starbase') throw new Error('no starbase here')
  const s = structuredClone(state)
  const cls = getShipClass(s.ship.classId)
  s.ship.hull = s.ship.maxHull
  for (const sub of Object.values(s.ship.subsystems)) sub.hp = sub.maxHp
  s.ship.shields = {
    fore: cls.shieldMax,
    aft: cls.shieldMax,
    port: cls.shieldMax,
    starboard: cls.shieldMax,
  }
  s.ship.torpedoes = cls.torpedoCapacity
  return {
    state: s,
    log: [`${system.name}: repair crews swarm the hull. All systems restored, torpedoes restocked.`],
  }
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
  s.encounter = null
  const context = s.encounterContext
  s.encounterContext = null

  if (status === 'defeat') {
    s.mode = 'game-over'
    log.push(`The ${s.ship.name} is lost with all hands. Stardate ${s.galaxy.stardate.toFixed(1)}.`)
    return { state: s, log }
  }

  s.mode = 'sector'
  const wonOutcomes: EncounterStatus[] = ['victory', 'enemy-disabled', 'enemy-withdrawn']
  if (context === 'mission') {
    if (wonOutcomes.includes(status)) {
      s.mission.stage = 'resolved'
      s.mission.outcome = status
      log.push(...(MISSION_RESOLUTION[status] ?? []))
      log.push('MISSION COMPLETE — The Veyra Distress Call.')
    } else {
      log.push(MISSION_WITHDRAWN_LINE)
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
  return { state: s, log }
}
