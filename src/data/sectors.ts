// The Veyra Sector: M1 map. Coordinates are map-space 0-100 (render scales them).

import type { StarSystem } from '../sim/galaxy'

export const SECTOR_NAME = 'Veyra Sector'
export const START_SYSTEM_ID = 'sb4'
export const MISSION_TARGET_SYSTEM_ID = 'veyra'

export const SYSTEMS: Record<string, StarSystem> = {
  sb4: {
    id: 'sb4',
    name: 'Starbase 4',
    pos: { x: 12, y: 46 },
    links: ['meridian', 'tellun', 'archer'],
    type: 'starbase',
    description: 'Federation forward operations. Full repair and rearm facilities.',
  },
  meridian: {
    id: 'meridian',
    name: 'Meridian',
    pos: { x: 26, y: 24 },
    links: ['sb4', 'kaleb', 'tellun'],
    type: 'colony',
    description: 'Agricultural colony, 12,000 souls. Quiet, usually.',
  },
  tellun: {
    id: 'tellun',
    name: 'Tellun',
    pos: { x: 40, y: 46 },
    links: ['sb4', 'meridian', 'drozana', 'archer'],
    type: 'empty',
    description: 'Red dwarf, three barren planets. A convenient waypoint.',
  },
  kaleb: {
    id: 'kaleb',
    name: 'Kaleb',
    pos: { x: 52, y: 16 },
    links: ['meridian', 'drozana', 'gasko'],
    type: 'empty',
    description: 'Binary pair. Charted, mined out, forgotten.',
  },
  drozana: {
    id: 'drozana',
    name: 'Drozana',
    pos: { x: 58, y: 42 },
    links: ['tellun', 'kaleb', 'hromi', 'gasko'],
    type: 'anomaly',
    description: 'Subspace shear zone. Sensor readings here are... creative.',
  },
  archer: {
    id: 'archer',
    name: 'Archer',
    pos: { x: 30, y: 72 },
    links: ['sb4', 'tellun', 'hromi'],
    type: 'empty',
    description: 'Named for a captain who got lost here. Twice.',
  },
  hromi: {
    id: 'hromi',
    name: 'Hromi Cluster',
    pos: { x: 56, y: 74 },
    links: ['archer', 'drozana', 'veyra'],
    type: 'empty',
    description: 'Young stars wrapped in dust. Beautiful and blinding.',
  },
  gasko: {
    id: 'gasko',
    name: 'Gasko',
    pos: { x: 80, y: 26 },
    links: ['kaleb', 'drozana', 'veyra'],
    type: 'empty',
    description: 'Border marker system. Klingon space is two sectors out.',
  },
  veyra: {
    id: 'veyra',
    name: 'Veyra Colony',
    pos: { x: 84, y: 62 },
    links: ['hromi', 'gasko'],
    type: 'colony',
    description: 'Mining colony on Veyra II. 4,000 colonists, one aging phaser battery.',
  },
}

export function getSystem(id: string): StarSystem {
  const sys = SYSTEMS[id]
  if (!sys) throw new Error(`unknown system: ${id}`)
  return sys
}
