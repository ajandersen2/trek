// Ship class definitions. Data, not code — the sim interprets these.
// cosHalfArc values are precomputed literals (see geometry.ts for why no Math.cos):
//   270° arc → cos(135°) = -0.7071067811865476
//   180° arc → cos(90°)  =  0
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
    hasCloak: false,
    doctrine: 'brawler',
  },
  // The cloaked knife-fighter: decloaks on your flank, alpha-strikes, vanishes.
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
    hasCloak: true,
    doctrine: 'knife',
  },
  // The brawler: slow, tough, wide guns. Grinds you down arc against arc.
  'klingon-ktinga': {
    id: 'klingon-ktinga',
    name: "K't'inga-class Battlecruiser",
    faction: 'klingon',
    maxHull: 110,
    agility: 1,
    maxSpeed: 7,
    ratedPower: 11,
    // Broad 180° disruptor batteries.
    phaser: { cosHalfArc: 0, baseDamage: 14, range: 11 },
    torpedo: { cosHalfArc: 0.8660254037844387, damage: 30, speed: 18, fuel: 4, proximity: 2.5 },
    torpedoCapacity: 6,
    shieldMax: 35,
    shieldRegen: 5,
    subsystemMaxHp: 70,
    hasCloak: false,
    doctrine: 'brawler',
  },
  // The harasser: fast, fragile, slashing attack runs. Punish it when it turns.
  'klingon-raptor': {
    id: 'klingon-raptor',
    name: 'Raptor-class Scout',
    faction: 'klingon',
    maxHull: 50,
    agility: 4,
    maxSpeed: 12,
    ratedPower: 7,
    phaser: { cosHalfArc: 0.7071067811865476, baseDamage: 11, range: 9 },
    torpedo: { cosHalfArc: 0.8660254037844387, damage: 30, speed: 18, fuel: 4, proximity: 2.5 },
    torpedoCapacity: 2,
    shieldMax: 18,
    shieldRegen: 3,
    subsystemMaxHp: 40,
    hasCloak: false,
    doctrine: 'harasser',
  },
}

export function getShipClass(id: string): ShipClass {
  const cls = SHIP_CLASSES[id]
  if (!cls) throw new Error(`unknown ship class: ${id}`)
  return cls
}
