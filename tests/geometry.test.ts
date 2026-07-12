import { describe, expect, it } from 'vitest'
import {
  HEADING_STEPS,
  HEADING_VECTORS,
  distance,
  headingDelta,
  headingToward,
  inArc,
  normalizeHeading,
  shieldArcHit,
  turnToward,
} from '../src/sim/geometry'

describe('heading table', () => {
  it('has 16 unit vectors', () => {
    expect(HEADING_VECTORS).toHaveLength(HEADING_STEPS)
    for (const v of HEADING_VECTORS) {
      expect(Math.sqrt(v.x * v.x + v.y * v.y)).toBeCloseTo(1, 12)
    }
  })

  it('normalizes headings including negatives', () => {
    expect(normalizeHeading(16)).toBe(0)
    expect(normalizeHeading(-1)).toBe(15)
    expect(normalizeHeading(35)).toBe(3)
  })
})

describe('headingToward', () => {
  it('points at cardinal targets', () => {
    const o = { x: 0, y: 0 }
    expect(headingToward(o, { x: 10, y: 0 })).toBe(0)
    expect(headingToward(o, { x: 0, y: 10 })).toBe(4)
    expect(headingToward(o, { x: -10, y: 0 })).toBe(8)
    expect(headingToward(o, { x: 0, y: -10 })).toBe(12)
    expect(headingToward(o, { x: 10, y: 10 })).toBe(2)
  })
})

describe('headingDelta / turnToward', () => {
  it('takes the short way around', () => {
    expect(headingDelta(15, 1)).toBe(2)
    expect(headingDelta(1, 15)).toBe(-2)
    expect(headingDelta(0, 8)).toBe(8) // opposite: convention resolves to +8
  })

  it('clamps turn rate', () => {
    expect(turnToward(0, 8, 2)).toBe(2)
    expect(turnToward(0, 15, 2)).toBe(15)
    expect(turnToward(14, 2, 4)).toBe(2)
  })
})

describe('inArc', () => {
  const origin = { x: 0, y: 0 }
  // 90° arc: cos(45°)
  const cos45 = 0.7071067811865476

  it('hits targets dead ahead', () => {
    expect(inArc(origin, 0, { x: 5, y: 0 }, cos45)).toBe(true)
  })

  it('excludes targets abeam for a 90° arc', () => {
    expect(inArc(origin, 0, { x: 0, y: 5 }, cos45)).toBe(false)
    expect(inArc(origin, 0, { x: -5, y: 0 }, cos45)).toBe(false)
  })

  it('respects facing', () => {
    expect(inArc(origin, 4, { x: 0, y: 5 }, cos45)).toBe(true)
    expect(inArc(origin, 4, { x: 5, y: 0 }, cos45)).toBe(false)
  })

  it('wide 270° arc excludes only the rear wedge', () => {
    const cos135 = -0.7071067811865476
    expect(inArc(origin, 0, { x: 0, y: 5 }, cos135)).toBe(true)
    expect(inArc(origin, 0, { x: -5, y: 0.1 }, cos135)).toBe(false)
    expect(inArc(origin, 0, { x: -3, y: 4 }, cos135)).toBe(true) // just outside rear wedge
  })
})

describe('shieldArcHit', () => {
  const pos = { x: 0, y: 0 }

  it('maps attacker bearings to arcs for heading 0 (+X)', () => {
    expect(shieldArcHit(pos, 0, { x: 10, y: 0 })).toBe('fore')
    expect(shieldArcHit(pos, 0, { x: -10, y: 0 })).toBe('aft')
    expect(shieldArcHit(pos, 0, { x: 0, y: 10 })).toBe('port') // +Y is left of +X facing
    expect(shieldArcHit(pos, 0, { x: 0, y: -10 })).toBe('starboard')
  })

  it('rotates with facing', () => {
    // Facing +Y: attacker at +X is now to starboard.
    expect(shieldArcHit(pos, 4, { x: 10, y: 0 })).toBe('starboard')
    expect(shieldArcHit(pos, 4, { x: 0, y: 10 })).toBe('fore')
  })
})

describe('distance', () => {
  it('is euclidean', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })
})
