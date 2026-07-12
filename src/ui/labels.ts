// Shared UI label maps (chrome voice + captain's-log nouns).

import type { ArcId } from '../sim/geometry'
import type { EncounterStatus, SubsystemId } from '../sim/types'

export const SUB_LABELS: Record<SubsystemId, string> = {
  weapons: 'WEAPONS',
  engines: 'ENGINES',
  shields: 'SHIELDS',
  sensors: 'SENSORS',
}

/** Diegetic prose nouns for captain's-log lines. */
export const SUB_NOUNS: Record<SubsystemId, string> = {
  weapons: 'weapons array',
  engines: 'engines',
  shields: 'shield emitters',
  sensors: 'sensor array',
}

export const ARC_LABELS: Record<ArcId, string> = {
  fore: 'FORE',
  aft: 'AFT',
  port: 'PORT',
  starboard: 'STBD',
}

export const OUTCOME_TITLES: Record<EncounterStatus, string> = {
  active: '',
  victory: 'VICTORY',
  'enemy-disabled': 'ENEMY DISABLED',
  'enemy-withdrawn': 'ENEMY WITHDREW',
  withdrawn: 'WITHDRAWN',
  defeat: 'SHIP LOST',
}
