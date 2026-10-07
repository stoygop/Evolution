/**
 * Tuning surface for Evolution Sandbox V1.
 * Equations that use these numbers are documented in the README.
 * Change values here; do not scatter magic numbers through the sim.
 */
export const CONFIG = {
  world: {
    width: 1100,
    height: 720,
  },
  population: {
    initial: 100,
    /** Safety cap so accelerated runs stay interactive. Not a biological limit. */
    max: 450,
  },
  food: {
    initial: 90,
    spawnPerSecond: 3.6,
    max: 110,
    energy: 34,
    radius: 2.6,
  },
  trait: {
    speed: { min: 16, max: 130, initialMin: 32, initialMax: 88 },
    vision: { min: 24, max: 260, initialMin: 40, initialMax: 160 },
    size: { min: 4.5, max: 18, initialMin: 6, initialMax: 12 },
  },
  mutation: {
    speedSigma: 5.5,
    visionSigma: 9,
    sizeSigma: 0.65,
  },
  energy: {
    /** maxEnergy = size * capacityPerSize */
    capacityPerSize: 14,
    initialFraction: 0.55,
    /** metabolism = base + perVision * vision + sizeCost * size + movement */
    base: 0.32,
    perVision: 0.0052,
    sizeCost: 0.048,
    /**
     * movement = moveCoeff * (speed / refSpeed)^2 * (size / refSize)
     * Quadratic in speed, so the fastest creatures are expensive.
     */
    moveCoeff: 0.58,
    refSpeed: 50,
    refSize: 10,
  },
  reproduction: {
    minAge: 4,
    cooldown: 2.5,
    /** Reproduce when energy >= energyFraction * maxEnergy. */
    energyFraction: 0.66,
    /** Parent pays costFraction * maxEnergy. */
    costFraction: 0.4,
    /** Offspring receives offspringShare * cost, capped at the child's max. */
    offspringShare: 0.72,
    spawnGap: 3,
  },
  wander: {
    minSeconds: 0.45,
    maxSeconds: 1.8,
  },
  sim: {
    fixedDt: 1 / 30,
    /** Enough for 100× even if a frame is slow. Extra time is dropped. */
    maxTicksPerFrame: 400,
    historySampleInterval: 0.5,
    historyLimit: 2400,
  },
  speeds: [1, 5, 20, 100],
} as const
