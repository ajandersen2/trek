// Versioned save/load. Saves are plain JSON with a version number; loading a
// save from an older version walks it through the migration registry. Never
// break old saves silently — if we can't understand a file, we throw SaveError.
//
// Storage (localStorage slots, file export) is the UI layer's business; the
// sim only speaks strings.

import { SYSTEMS } from '../data/sectors'
import type { GameState } from './game'

export const SAVE_VERSION = 1

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
const migrations: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {}

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
}
