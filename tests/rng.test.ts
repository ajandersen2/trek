import { describe, expect, it } from 'vitest'
import { createRng, nextFloat, pick, rangeInt, roll } from '../src/sim/rng'

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(12345)
    const b = createRng(12345)
    for (let i = 0; i < 100; i++) {
      expect(nextFloat(a)).toBe(nextFloat(b))
    }
  })

  it('differs across seeds', () => {
    const a = createRng(1)
    const b = createRng(2)
    const seqA = Array.from({ length: 8 }, () => nextFloat(a))
    const seqB = Array.from({ length: 8 }, () => nextFloat(b))
    expect(seqA).not.toEqual(seqB)
  })

  it('resumes exactly from serialized state', () => {
    const a = createRng(999)
    for (let i = 0; i < 10; i++) nextFloat(a)
    const snapshot = JSON.parse(JSON.stringify(a)) // simulate save/load
    const fromSave = { state: snapshot.state }
    for (let i = 0; i < 50; i++) {
      expect(nextFloat(fromSave)).toBe(nextFloat(a))
    }
  })

  it('produces floats in [0,1)', () => {
    const rng = createRng(42)
    for (let i = 0; i < 1000; i++) {
      const f = nextFloat(rng)
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThan(1)
    }
  })

  it('rangeInt covers bounds inclusively', () => {
    const rng = createRng(7)
    const seen = new Set<number>()
    for (let i = 0; i < 500; i++) seen.add(rangeInt(rng, 1, 4))
    expect([...seen].sort()).toEqual([1, 2, 3, 4])
  })

  it('roll respects probability extremes', () => {
    const rng = createRng(3)
    for (let i = 0; i < 50; i++) {
      expect(roll(rng, 1)).toBe(true)
      expect(roll(rng, 0)).toBe(false)
    }
  })

  it('pick returns elements from the array', () => {
    const rng = createRng(5)
    for (let i = 0; i < 50; i++) {
      expect(['a', 'b', 'c']).toContain(pick(rng, ['a', 'b', 'c']))
    }
  })
})
