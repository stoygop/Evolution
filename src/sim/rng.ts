export interface Rng {
  next(): number
  range(min: number, max: number): number
  gaussian(sigma: number): number
}

function gaussianFrom(next: () => number, sigma: number): number {
  let u = next()
  const v = next()
  while (u <= 1e-12) u = next()
  return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v)
}

export const defaultRng: Rng = {
  next: () => Math.random(),
  range(min, max) {
    return min + Math.random() * (max - min)
  },
  gaussian(sigma) {
    return gaussianFrom(Math.random, sigma)
  },
}

/** Deterministic generator for the self-check. The live sim uses defaultRng. */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    range(min, max) {
      return min + next() * (max - min)
    },
    gaussian(sigma) {
      return gaussianFrom(next, sigma)
    },
  }
}
