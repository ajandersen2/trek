// Sector map model: star systems, adjacency, travel bookkeeping.

import { getSystem } from '../data/sectors'
import type { Vec2 } from './geometry'

export type SystemType = 'starbase' | 'colony' | 'empty' | 'anomaly'

export interface StarSystem {
  id: string
  name: string
  /** Map-space position (0-100), for display only. */
  pos: Vec2
  links: string[]
  type: SystemType
  description: string
}

export interface GalaxyState {
  currentSystemId: string
  stardate: number
  visited: string[]
}

export function createGalaxy(startSystemId: string, stardate: number): GalaxyState {
  return { currentSystemId: startSystemId, stardate, visited: [startSystemId] }
}

export function isAdjacent(fromId: string, toId: string): boolean {
  return getSystem(fromId).links.includes(toId)
}

/** Move to an adjacent system. Mutates the (cloned, caller-owned) galaxy state. */
export function moveTo(galaxy: GalaxyState, toId: string): void {
  if (!isAdjacent(galaxy.currentSystemId, toId)) {
    throw new Error(`no warp lane from ${galaxy.currentSystemId} to ${toId}`)
  }
  galaxy.currentSystemId = toId
  galaxy.stardate = Math.round((galaxy.stardate + 0.5) * 10) / 10
  if (!galaxy.visited.includes(toId)) galaxy.visited.push(toId)
}
