// Ship class definitions. Data, not code — the sim interprets these.
// cosHalfArc values are precomputed literals (see geometry.ts for why no Math.cos):
//   270° arc → cos(135°) = -0.7071067811865476
//    90° arc → cos(45°)  =  0.7071067811865476
//    60° arc → cos(30°)  =  0.8660254037844387

import type { ShipClass } from '../sim/types'

export const SHIP_CLASSES: Record<string, ShipClass> = {
  'fed-cruiser': {
    id: 'fed-cruiser',
    name: 'Constellation-class Cruiser',
    faction: 'federation',
    maxHull: 100,
    agility: 2,
    maxSpeed: 8,
    ratedPower: 10,
    // Wide 270° phaser coverage, moderate punch.
    phaser: { cosHalfArc: -0.7071067811865476, baseDamage: 12, range: 12 },
    // Photon torpedoes: narrow 60° forward launch window.
    torpedo: { cosHalfArc: 0.8660254037844387, damage: 30, speed: 18, fuel: 4, proximity: 2.5 },
    torpedoCapacity: 8,
    shieldMax: 40,
    shieldRegen: 6,
    subsystemMaxHp: 60,
  },
  'klingon-bop': {
    id: 'klingon-bop',
    name: "B'rel-class Bird-of-Prey",
    faction: 'klingon',
    maxHull: 70,
    agility: 4,
    maxSpeed: 11,
    ratedPower: 8,
    // Heavy disruptors in a narrow 90° forward arc.
    phaser: { cosHalfArc: 0.7071067811865476, baseDamage: 16, range: 10 },
    torpedo: { cosHalfArc: 0.8660254037844387, damage: 30, speed: 18, fuel: 4, proximity: 2.5 },
    torpedoCapacity: 3,
    shieldMax: 25,
    shieldRegen: 4,
    subsystemMaxHp: 45,
  },
}

export function getShipClass(id: string): ShipClass {
  const cls = SHIP_CLASSES[id]
  if (!cls) throw new Error(`unknown ship class: ${id}`)
  return cls
}
