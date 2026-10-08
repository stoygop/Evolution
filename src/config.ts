/**
 * Tuning surface for Evolution Sandbox V1.
 * Equations that use these numbers are documented in the README.
 * Change values here; do not scatter magic numbers through the sim.
 *
 * `experiment` only controls recording. It does not feed movement, metabolism,
 * reproduction, or mutation.
 */
export const SIM_VERSION = '0.1.0'

export const CONFIG = {
  world: {
    width: 1100,
    height: 720,
  },
  population: {
    initial: 100,
    /** V1 default for the adjustable population safety cap. Not a carrying capacity. */
    max: 450,
    /**
     * Computational ceiling for the safety cap control.
     * A requested cap above this is clamped and recorded. It is not a biological limit.
     */
    absoluteMax: 8000,
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
    /**
     * Mate detection is separate from food vision.
     * Founders start at `initial` (twice the default mating radius).
     * Sexual founders are spread across initialMin–initialMax.
     * Asexual founders stay on `initial` and the trait does not affect them.
     */
    mateDetection: { min: 20, max: 600, initial: 180, initialMin: 120, initialMax: 240 },
    /**
     * Energy the parents aim to place in each sexual offspring.
     * Litter size is floor(shared budget / this value), not a gene of its own.
     * 32 sits under a typical pair's 20%+20% budget, so the usual litter is 1.
     */
    offspringInvestment: { min: 8, max: 200, initial: 32, initialMin: 24, initialMax: 48 },
  },
  mutation: {
    speedSigma: 5.5,
    visionSigma: 9,
    sizeSigma: 0.65,
    /** New sexual traits only. Asexual mutation does not draw these. */
    mateDetectionSigma: 12,
    offspringInvestmentSigma: 4,
  },
  energy: {
    /** maxEnergy = size * capacityPerSize */
    capacityPerSize: 14,
    initialFraction: 0.55,
    /** metabolism = base + perVision * vision + sizeCost * size + movement */
    base: 0.32,
    perVision: 0.0052,
    /**
     * Sexual mode only, per unit of mateDetection per second.
     * Half of perVision, so a founder at 180 pays 0.468/s.
     * Asexual metabolism does not include this term.
     */
    perMateDetection: 0.0026,
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
    /**
     * Center-to-center distance for sexual mating. Asexual runs ignore it.
     * Each sexual parent's budget is half of `costFraction` of its own max energy.
     * The mating pays only the energy the litter actually receives.
     */
    matingRadius: 90,
    /** V1 default experimental litter cap. Energy-limited mode ignores it. */
    maxLitterSize: 8,
    /**
     * Computational ceiling on offspring created by one mating.
     * Energy-limited litters that would exceed it are trimmed and recorded.
     */
    allocationCeiling: 64,
  },
  behavior: {
    /**
     * Below this fraction of max energy, a creature seeks food instead of a mate.
     * The default matches reproduction.energyFraction, so any eligible creature
     * may seek a mate and anyone below the reproduction threshold seeks food.
     */
    foodPriorityEnergyFraction: 0.66,
    /** A mutual chase breaks if the pair is still outside mating radius after this many seconds. */
    matePairTimeout: 8,
    /** After a timeout, those two will not pair with each other again until this elapses. */
    mateRetryDelay: 2,
  },
  wander: {
    minSeconds: 0.45,
    maxSeconds: 1.8,
  },
  sim: {
    fixedDt: 1 / 30,
    /** Enough for 100× even if a frame is slow. Extra time is dropped. */
    maxTicksPerFrame: 400,
    /** Rolling chart window only. The export uses `experiment` below. */
    historySampleInterval: 0.5,
    historyLimit: 2400,
  },
  experiment: {
    /** Full-run population samples, in simulated seconds. Not trimmed. */
    sampleInterval: 5,
    /** Full living-population genome snapshots, in simulated seconds. */
    snapshotInterval: 120,
  },
  speeds: [1, 5, 20, 100],
} as const
