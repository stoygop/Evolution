import { CONFIG } from '../config.ts'
import type { Genome, GenomeInput } from './types.ts'
import type { Rng } from './rng.ts'

export function completeGenome(genome: GenomeInput): Genome {
  return {
    speed: genome.speed,
    vision: genome.vision,
    size: genome.size,
    mateDetection: genome.mateDetection ?? CONFIG.trait.mateDetection.initial,
    offspringInvestment: genome.offspringInvestment ?? CONFIG.trait.offspringInvestment.initial,
  }
}

export function maxEnergy(size: number): number {
  return size * CONFIG.energy.capacityPerSize
}

/**
 * Energy drained per second while the creature is alive.
 * `includeMateDetection` is true only in sexual mode. Asexual runs omit that
 * term, so their metabolism matches the historical equation exactly.
 */
export function metabolismPerSecond(genome: GenomeInput, includeMateDetection = false): number {
  const energy = CONFIG.energy
  const speedRatio = genome.speed / energy.refSpeed
  const sizeRatio = genome.size / energy.refSize
  const movement = energy.moveCoeff * speedRatio * speedRatio * sizeRatio
  const mateSense = includeMateDetection
    ? energy.perMateDetection * (genome.mateDetection ?? CONFIG.trait.mateDetection.initial)
    : 0
  return energy.base + energy.perVision * genome.vision + energy.sizeCost * genome.size + movement + mateSense
}

export function reproductionThreshold(genome: Genome): number {
  return CONFIG.reproduction.energyFraction * maxEnergy(genome.size)
}

export function reproductionCost(genome: Genome): number {
  return CONFIG.reproduction.costFraction * maxEnergy(genome.size)
}

export function offspringStartingEnergy(child: Genome, cost: number): number {
  return Math.min(maxEnergy(child.size), cost * CONFIG.reproduction.offspringShare)
}

/** Half of the asexual cost. Each sexual parent pays this share of its own max energy. */
export function sexualReproductionCost(genome: Genome): number {
  return reproductionCost(genome) / 2
}

export interface TraitWindow {
  speedWindowMin: number
  speedWindowMax: number
  visionWindowMin: number
  visionWindowMax: number
  mateDetectionWindowMin: number
  mateDetectionWindowMax: number
  offspringInvestmentWindowMin: number
  offspringInvestmentWindowMax: number
  sizeWindowMin: number
  sizeWindowMax: number
}

export function v1TraitWindow(): TraitWindow {
  return {
    speedWindowMin: CONFIG.trait.speed.min,
    speedWindowMax: CONFIG.trait.speed.max,
    visionWindowMin: CONFIG.trait.vision.min,
    visionWindowMax: CONFIG.trait.vision.max,
    mateDetectionWindowMin: CONFIG.trait.mateDetection.min,
    mateDetectionWindowMax: CONFIG.trait.mateDetection.max,
    offspringInvestmentWindowMin: CONFIG.trait.offspringInvestment.min,
    offspringInvestmentWindowMax: CONFIG.trait.offspringInvestment.max,
    sizeWindowMin: CONFIG.trait.size.min,
    sizeWindowMax: CONFIG.trait.size.max,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function randomGenome(rng: Rng): Genome {
  const trait = CONFIG.trait
  return {
    speed: rng.range(trait.speed.initialMin, trait.speed.initialMax),
    vision: rng.range(trait.vision.initialMin, trait.vision.initialMax),
    size: rng.range(trait.size.initialMin, trait.size.initialMax),
    mateDetection: trait.mateDetection.initial,
    offspringInvestment: trait.offspringInvestment.initial,
  }
}

/**
 * Independent blend, one alpha per trait, in this order:
 * speed, vision, size, mateDetection, offspringInvestment.
 * Mutation is a separate later step. alpha is rng.next(), in [0, 1).
 */
export function recombineGenome(parentA: GenomeInput, parentB: GenomeInput, rng: Rng): Genome {
  const left = completeGenome(parentA)
  const right = completeGenome(parentB)
  const mix = (a: number, b: number) => {
    const alpha = rng.next()
    return alpha * a + (1 - alpha) * b
  }
  return {
    speed: mix(left.speed, right.speed),
    vision: mix(left.vision, right.vision),
    size: mix(left.size, right.size),
    mateDetection: mix(left.mateDetection, right.mateDetection),
    offspringInvestment: mix(left.offspringInvestment, right.offspringInvestment),
  }
}

/**
 * Gaussian noise, then clamp.
 * Asexual births pass `reproductive = false` and do not draw the two new traits,
 * so the historical speed/vision/size random stream is unchanged.
 * Sexual births pass true. Those two draws happen after speed, vision, and size.
 */
export function mutateGenome(
  parent: GenomeInput,
  rng: Rng,
  window: TraitWindow = v1TraitWindow(),
  reproductive = false,
): Genome {
  const mutation = CONFIG.mutation
  const source = completeGenome(parent)
  const speed = clamp(source.speed + rng.gaussian(mutation.speedSigma), window.speedWindowMin, window.speedWindowMax)
  const vision = clamp(source.vision + rng.gaussian(mutation.visionSigma), window.visionWindowMin, window.visionWindowMax)
  const size = clamp(source.size + rng.gaussian(mutation.sizeSigma), window.sizeWindowMin, window.sizeWindowMax)
  if (!reproductive) {
    return {
      speed,
      vision,
      size,
      mateDetection: source.mateDetection,
      offspringInvestment: source.offspringInvestment,
    }
  }
  return {
    speed,
    vision,
    size,
    mateDetection: clamp(
      source.mateDetection + rng.gaussian(mutation.mateDetectionSigma),
      window.mateDetectionWindowMin,
      window.mateDetectionWindowMax,
    ),
    offspringInvestment: clamp(
      source.offspringInvestment + rng.gaussian(mutation.offspringInvestmentSigma),
      window.offspringInvestmentWindowMin,
      window.offspringInvestmentWindowMax,
    ),
  }
}

export function genomeWithinLimits(genome: Genome): boolean {
  const trait = CONFIG.trait
  return (
    genome.speed >= trait.speed.min &&
    genome.speed <= trait.speed.max &&
    genome.vision >= trait.vision.min &&
    genome.vision <= trait.vision.max &&
    genome.size >= trait.size.min &&
    genome.size <= trait.size.max &&
    genome.mateDetection >= trait.mateDetection.min &&
    genome.mateDetection <= trait.mateDetection.max &&
    genome.offspringInvestment >= trait.offspringInvestment.min &&
    genome.offspringInvestment <= trait.offspringInvestment.max
  )
}

/** Shared sexual budget is the sum of each parent's 20% reserve. */
export function reproductiveBudget(genome: Genome): number {
  return sexualReproductionCost(genome)
}

/** Mean of the parents' investment traits. This is the energy aimed at each child. */
export function investmentPerOffspring(parentA: Genome, parentB: Genome): number {
  return (parentA.offspringInvestment + parentB.offspringInvestment) / 2
}

/**
 * floor(available / investment), at least nothing.
 * `cap` defaults to the V1 litter maximum. Pass Infinity for no experimental cap.
 * Returns 0 when the budget cannot fund one offspring.
 * The computational allocation ceiling is applied by the world, not here.
 */
export function plannedLitterSize(
  available: number,
  investment: number,
  cap: number = CONFIG.reproduction.maxLitterSize,
): number {
  if (!(investment > 0) || !(available >= investment)) return 0
  const litter = Math.floor(available / investment)
  if (!Number.isFinite(cap)) return litter
  return Math.min(cap, litter)
}

export interface LitterPlan {
  litter: number
  preventedByCap: number
  preventedBySafety: number
}

/** Experimental cap first, then the allocation ceiling. Parents still pay for every child that is born. */
export function resolveLitter(available: number, investment: number, energyLimited: boolean, cap: number): LitterPlan {
  const energyLitter = plannedLitterSize(available, investment, Number.POSITIVE_INFINITY)
  let litter = energyLitter
  let preventedByCap = 0
  if (!energyLimited) {
    const limited = Math.min(litter, Math.max(0, Math.floor(cap)))
    preventedByCap = litter - limited
    litter = limited
  }
  let preventedBySafety = 0
  const ceiling = CONFIG.reproduction.allocationCeiling
  if (litter > ceiling) {
    preventedBySafety = litter - ceiling
    litter = ceiling
  }
  return { litter, preventedByCap, preventedBySafety }
}
