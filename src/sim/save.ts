// Versioned save/load. Saves are plain JSON with a version number; loading a
// save from an older version walks it through the migration registry. Never
// break old saves silently — if we can't understand a file, we throw SaveError.
//
// Storage (localStorage slots, file export) is the UI layer's business; the
// sim only speaks strings.

import { SYSTEMS } from '../data/sectors'
import type { GameState } from './game'

export const SAVE_VERSION = 2

export interface SaveFile {
  version: number
  /** Denormalized for slot labels without parsing the whole state. */
  stardate: number
  state: GameState
}

export class SaveError extends Error {}

/**
 * Migrations: migrations[n] upgrades a version-n save file to version n+1.
 * Added whenever SAVE_VERSION bumps. Keyed by source version.
 */
const migrations: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 → v2: cloaking device fields, mission chain, difficulty settings,
  // persistent captain's log archive.
  1: (file) => {
    const state = file['state'] as Record<string, unknown> | undefined
    if (!state) return file
    state['settings'] = { permadeath: true }
    state['logArchive'] = []
    const oldMission = state['mission'] as
      | { stage?: string; outcome?: unknown }
      | undefined
    const m1Resolved = oldMission?.stage === 'resolved'
    state['missions'] = [
      {
        defId: 'm1-veyra-distress',
        stage: m1Resolved ? 'resolved' : 'active',
        outcome: oldMission?.outcome ?? null,
        jumps: 0,
      },
      { defId: 'm2-fek-lhr', stage: m1Resolved ? 'active' : 'inactive', outcome: null, jumps: 0 },
    ]
    delete state['mission']
    // v1 stored a plain string context; saves are sector-only so it is always null here.
    state['encounterContext'] = null
    const addCloakFields = (ship: Record<string, unknown> | undefined) => {
      if (!ship) return
      ship['cloaked'] = false
      ship['cloakCooldown'] = 0
    }
    addCloakFields(state['ship'] as Record<string, unknown> | undefined)
    const encounter = state['encounter'] as { ships?: Record<string, unknown>[] } | null
    if (encounter?.ships) for (const ship of encounter.ships) addCloakFields(ship)
    return file
  },
}

export function serializeGame(state: GameState): string {
  const file: SaveFile = {
    version: SAVE_VERSION,
    stardate: state.galaxy.stardate,
    state,
  }
  return JSON.stringify(file)
}

export function deserializeGame(json: string): GameState {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new SaveError('save file is not valid JSON')
  }
  if (typeof raw !== 'object' || raw === null) throw new SaveError('save file is not an object')
  let file = raw as Record<string, unknown>

  const version = file['version']
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new SaveError('save file has no valid version')
  }
  if (version > SAVE_VERSION) {
    throw new SaveError(`save is from a newer game version (v${version} > v${SAVE_VERSION})`)
  }
  for (let v = version; v < SAVE_VERSION; v++) {
    const migrate = migrations[v]
    if (!migrate) throw new SaveError(`no migration path from save version ${v}`)
    file = migrate(file)
  }

  const state = file['state'] as GameState | undefined
  validateState(state)
  return structuredClone(state!)
}

/** Shallow structural sanity checks — enough to reject foreign/corrupt JSON. */
function validateState(state: GameState | undefined): void {
  if (typeof state !== 'object' || state === null) throw new SaveError('save has no game state')
  if (typeof state.rngState !== 'number') throw new SaveError('save missing rng state')
  if (!['sector', 'encounter', 'game-over'].includes(state.mode)) {
    throw new SaveError(`save has unknown mode: ${String(state.mode)}`)
  }
  if (typeof state.ship?.id !== 'string' || typeof state.ship?.hull !== 'number') {
    throw new SaveError('save missing player ship')
  }
  if (!state.galaxy || !(state.galaxy.currentSystemId in SYSTEMS)) {
    throw new SaveError('save references an unknown star system')
  }
  if (state.mode === 'encounter' && !state.encounter) {
    throw new SaveError('save in encounter mode but has no encounter')
  }
  if (!Array.isArray(state.missions) || state.missions.length === 0) {
    throw new SaveError('save missing mission records')
  }
  if (typeof state.settings?.permadeath !== 'boolean') {
    throw new SaveError('save missing settings')
  }
  if (!Array.isArray(state.logArchive)) {
    throw new SaveError('save missing log archive')
  }
}
