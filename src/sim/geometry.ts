// Deterministic 2D geometry for the tactical sim.
//
// Headings are 16 compass steps (22.5° each) with precomputed literal vectors, and arc
// tests use dot/cross products, so the sim never calls Math.sin/cos/atan2 — those are
// not IEEE-mandated and can differ across JS engines, which would break lockstep
// multiplayer and replays. +, -, *, /, Math.sqrt are exactly specified and safe.

export interface Vec2 {
  x: number
  y: number
}

export const HEADING_STEPS = 16

/** Unit vector for each heading. Heading 0 = +X, counterclockwise, 22.5° per step. */
export const HEADING_VECTORS: readonly Vec2[] = [
  { x: 1, y: 0 },
  { x: 0.9238795325112867, y: 0.3826834323650898 },
  { x: 0.7071067811865476, y: 0.7071067811865476 },
  { x: 0.3826834323650898, y: 0.9238795325112867 },
  { x: 0, y: 1 },
  { x: -0.3826834323650898, y: 0.9238795325112867 },
  { x: -0.7071067811865476, y: 0.7071067811865476 },
  { x: -0.9238795325112867, y: 0.3826834323650898 },
  { x: -1, y: 0 },
  { x: -0.9238795325112867, y: -0.3826834323650898 },
  { x: -0.7071067811865476, y: -0.7071067811865476 },
  { x: -0.3826834323650898, y: -0.9238795325112867 },
  { x: 0, y: -1 },
  { x: 0.3826834323650898, y: -0.9238795325112867 },
  { x: 0.7071067811865476, y: -0.7071067811865476 },
  { x: 0.9238795325112867, y: -0.3826834323650898 },
]

export function headingVector(heading: number): Vec2 {
  const v = HEADING_VECTORS[((heading % HEADING_STEPS) + HEADING_STEPS) % HEADING_STEPS]
  if (!v) throw new Error(`bad heading ${heading}`)
  return v
}

export function normalizeHeading(heading: number): number {
  return ((heading % HEADING_STEPS) + HEADING_STEPS) % HEADING_STEPS
}

export function distance(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s }
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y
}

/** z-component of the 3D cross product; sign gives which side b is of a. */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x
}

/**
 * Heading (0..15) that points closest to the direction from `from` to `to`.
 * Argmax of dot products — no atan2. Ties resolve to the lowest heading index.
 */
export function headingToward(from: Vec2, to: Vec2): number {
  const d = sub(to, from)
  let best = 0
  let bestDot = -Infinity
  for (let h = 0; h < HEADING_STEPS; h++) {
    const hv = HEADING_VECTORS[h]!
    const dp = dot(hv, d)
    if (dp > bestDot) {
      bestDot = dp
      best = h
    }
  }
  return best
}

/** Signed shortest step count from heading a to heading b, in [-8, 8) style (−7..8). */
export function headingDelta(a: number, b: number): number {
  let d = normalizeHeading(b) - normalizeHeading(a)
  if (d > HEADING_STEPS / 2) d -= HEADING_STEPS
  if (d <= -HEADING_STEPS / 2) d += HEADING_STEPS
  return d
}

/** Turn from `current` toward `target` by at most `maxSteps`. */
export function turnToward(current: number, target: number, maxSteps: number): number {
  const d = headingDelta(current, target)
  const step = Math.max(-maxSteps, Math.min(maxSteps, d))
  return normalizeHeading(current + step)
}

/**
 * Is `target` within the weapon arc centered on `heading` of a ship at `origin`?
 * cosHalfArc is the cosine of the arc's half-angle (precomputed literal in ship data).
 * Uses dot(facing, dir) >= cosHalfArc * |dir| to avoid normalizing (no divide).
 */
export function inArc(origin: Vec2, heading: number, target: Vec2, cosHalfArc: number): boolean {
  const d = sub(target, origin)
  const len = Math.sqrt(d.x * d.x + d.y * d.y)
  if (len === 0) return true
  return dot(headingVector(heading), d) >= cosHalfArc * len
}

export type ArcId = 'fore' | 'aft' | 'port' | 'starboard'

/**
 * Which shield arc of a ship at `pos` facing `heading` is struck by fire coming
 * from `attackerPos`? Decided by comparing components along facing vs. perpendicular
 * (port = left of facing, i.e. positive cross side). Ties prefer fore/aft.
 */
export function shieldArcHit(pos: Vec2, heading: number, attackerPos: Vec2): ArcId {
  const facing = headingVector(heading)
  const d = sub(attackerPos, pos)
  const along = dot(facing, d)
  const across = cross(facing, d)
  if (Math.abs(along) >= Math.abs(across)) {
    return along >= 0 ? 'fore' : 'aft'
  }
  return across > 0 ? 'port' : 'starboard'
}
