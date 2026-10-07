import { CONFIG } from '../config.ts'
import type { Genome } from './types.ts'
import type { Rng } from './rng.ts'

export function maxEnergy(size: number): number {
  return size * CONFIG.energy.capacityPerSize
}

/** Energy drained per second while the creature is alive. */
export function metabolismPerSecond(genome: Genome): number {
  const energy = CONFIG.energy
  const speedRatio = genome.speed / energy.refSpeed
  const sizeRatio = genome.size / energy.refSize
  const movement = energy.moveCoeff * speedRatio * speedRatio * sizeRatio
  return energy.base + energy.perVision * genome.vision + energy.sizeCost * genome.size + movement
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function randomGenome(rng: Rng): Genome {
  const trait = CONFIG.trait
  return {
    speed: rng.range(trait.speed.initialMin, trait.speed.initialMax),
    vision: rng.range(trait.vision.initialMin, trait.vision.initialMax),
    size: rng.range(trait.size.initialMin, trait.size.initialMax),
  }
}

export function mutateGenome(parent: Genome, rng: Rng): Genome {
  const trait = CONFIG.trait
  const mutation = CONFIG.mutation
  return {
    speed: clamp(parent.speed + rng.gaussian(mutation.speedSigma), trait.speed.min, trait.speed.max),
    vision: clamp(parent.vision + rng.gaussian(mutation.visionSigma), trait.vision.min, trait.vision.max),
    size: clamp(parent.size + rng.gaussian(mutation.sizeSigma), trait.size.min, trait.size.max),
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
    genome.size <= trait.size.max
  )
}
