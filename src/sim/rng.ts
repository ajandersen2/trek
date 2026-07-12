// Seeded, serializable RNG (mulberry32). The only randomness source allowed in the sim.
// State is a single uint32 stored in game state, so saves/replays/lockstep stay exact.

export interface Rng {
  state: number
}

export function createRng(seed: number): Rng {
  return { state: seed >>> 0 }
}

/** Uniform float in [0, 1). Advances state. Integer ops only — bit-exact on every engine. */
export function nextFloat(rng: Rng): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0
  let t = rng.state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** True with probability p. */
export function roll(rng: Rng, p: number): boolean {
  return nextFloat(rng) < p
}

/** Integer in [min, max] inclusive. */
export function rangeInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(nextFloat(rng) * (max - min + 1))
}

/** Pick an element. Throws on empty array. */
export function pick<T>(rng: Rng, arr: readonly T[]): T {
  const item = arr[rangeInt(rng, 0, arr.length - 1)]
  if (item === undefined && arr.length === 0) throw new Error('pick from empty array')
  return item as T
}
