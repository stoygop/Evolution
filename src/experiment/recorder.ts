import { CONFIG, SIM_VERSION } from '../config.ts'
import { type EnvironmentChange } from '../sim/environment.ts'
import { maxEnergy } from '../sim/genome.ts'
import { summarize } from '../sim/stats.ts'
import { countMatePairs } from '../sim/world.ts'
import type { Environment, LifetimeRecord, SafetyEvent, World } from '../sim/types.ts'

/**
 * Full-run experiment log. This observes a world after steps; it does not
 * move creatures, change energy, or reproduce them.
 *
 * Live runs are not seeded. `metadata.seed` stays null on purpose.
 */

export interface TraitDistribution {
  mean: number
  median: number
  stdDev: number
  min: number
  max: number
}

export interface PopulationSample {
  time: number
  population: number
  food: number
  avgGeneration: number
  maxGeneration: number
  birthsSincePrevious: number
  deathsSincePrevious: number
  foodConsumedSincePrevious: number
  avgSpeed: number
  speedMedian: number
  speedStdDev: number
  speedMin: number
  speedMax: number
  avgVision: number
  visionMedian: number
  visionStdDev: number
  visionMin: number
  visionMax: number
  avgSize: number
  sizeMedian: number
  sizeStdDev: number
  sizeMin: number
  sizeMax: number
  avgMateDetection: number
  mateDetectionMedian: number
  mateDetectionStdDev: number
  mateDetectionMin: number
  mateDetectionMax: number
  avgOffspringInvestment: number
  offspringInvestmentMedian: number
  offspringInvestmentStdDev: number
  offspringInvestmentMin: number
  offspringInvestmentMax: number
  foodSpawnPerSecond: number
  foodEnergy: number
  reproductionMode: string
  matingRadius: number
  speedWindowMin: number
  speedWindowMax: number
  visionWindowMin: number
  visionWindowMax: number
  mateDetectionWindowMin: number
  mateDetectionWindowMax: number
  offspringInvestmentWindowMin: number
  offspringInvestmentWindowMax: number
  matingsSincePrevious: number
  mateFailuresSincePrevious: number
  /** Offspring from sexual matings divided by matings in the interval. 0 when there were no matings. */
  meanLitterSize: number
  /** Largest sexual litter in the interval. */
  maxLitterSize: number
  /** Mutual chases in progress at the sample instant. */
  activeMatePairs: number
  /** Seconds of reproductively eligible creature-time since the previous sample. */
  eligibleCreatureTimeSincePrevious: number
  /** Eligible creature-time with no other eligible creature inside mateDetection. */
  eligibleUnmatedCreatureTimeSincePrevious: number
  /**
   * 100 * unmated eligible creature-time / eligible creature-time.
   * 0 when the interval had no eligible creature-time.
   */
  mateLimitedPercent: number
  populationCap: number
  birthsBlockedByCapSincePrevious: number
  reproductionsBlockedByCapSincePrevious: number
  /** 100 * seconds at the cap / seconds in the interval. 0 at the opening sample. */
  fractionAtPopulationCap: number
  litterEnergyLimited: boolean
  litterCap: number
  matingsHittingLitterCapSincePrevious: number
  offspringPreventedByLitterCapSincePrevious: number
  /** 100 * matings that hit the experimental litter cap / sexual matings in the interval. */
  litterCapHitPercent: number
  offspringPreventedBySafetySincePrevious: number
  sizeWindowMin: number
  sizeWindowMax: number
  maxLivingAge: number
  /** -1 when no birth has happened. */
  timeSinceLastBirth: number
  /** -1 when no mating or asexual birth has happened. */
  timeSinceLastMating: number
  extinct: number
  reproductivelyExtinct: number
}

export interface EnvironmentEvent {
  time: number
  avgGeneration: number
  parameter: keyof Environment
  oldValue: number | string | boolean
  newValue: number | string | boolean
  creaturesAffected: number
}

export interface GenomeSnapshotCreature {
  id: number
  parentId: number | null
  /** Same as parentId. Named so a two-parent offspring is explicit in the export. */
  parentAId: number | null
  parentBId: number | null
  generation: number
  age: number
  energy: number
  maxEnergy: number
  foodEaten: number
  offspringCount: number
  speed: number
  vision: number
  size: number
  mateDetection: number
  offspringInvestment: number
  matingCount: number
}

export interface GenomeSnapshot {
  time: number
  creatures: GenomeSnapshotCreature[]
}

export interface RunMetadata {
  schemaVersion: 6
  runId: string
  /** Always null until the live sandbox grows a seeded generator. */
  seed: null
  rng: 'Math.random'
  reproducible: false
  rngNote: string
  version: string
  initialPopulation: number
  initialFood: number
  /** Food settings in effect when the run was created. */
  initialEnvironment: Environment
  sampleInterval: number
  snapshotInterval: number
  /** Divisor is n, the number of living creatures, because each sample is a census. */
  stdDev: 'population'
  intervalCounts: 'since-previous-sample'
  timeUnit: 'seconds'
  startedAt: string
  config: typeof CONFIG
}

export interface RunExport {
  metadata: RunMetadata
  samples: readonly PopulationSample[]
  genomeSnapshots: readonly GenomeSnapshot[]
  environmentChanges: readonly EnvironmentEvent[]
  /** Every creature born this run, living and dead. Shared with the world; not copied per tick. */
  lifetimes: readonly LifetimeRecord[]
  safetyEvents: readonly SafetyEvent[]
}

export interface ExperimentLog extends RunExport {
  samples: PopulationSample[]
  genomeSnapshots: GenomeSnapshot[]
  environmentChanges: EnvironmentEvent[]
  lifetimes: LifetimeRecord[]
  safetyEvents: SafetyEvent[]
  observe(dt: number): void
  recordEnvironmentChange(change: EnvironmentChange): void
}

export interface ExperimentOptions {
  sampleInterval?: number
  snapshotInterval?: number
}

const RNG_NOTE =
  'The live sandbox draws Math.random and does not take a seed. Replays are not reproducible. mulberry32 is used only by the headless self-check.'

export function createExperiment(world: World, options: ExperimentOptions = {}): ExperimentLog {
  const sampleInterval = options.sampleInterval ?? CONFIG.experiment.sampleInterval
  const snapshotInterval = options.snapshotInterval ?? CONFIG.experiment.snapshotInterval
  if (!(sampleInterval > 0) || !(snapshotInterval > 0)) {
    throw new Error('Experiment intervals must be positive')
  }

  const samples: PopulationSample[] = []
  const genomeSnapshots: GenomeSnapshot[] = []
  const environmentChanges: EnvironmentEvent[] = []
  let sampleAccumulator = 0
  let snapshotAccumulator = 0
  let previousBirths = 0
  let previousDeaths = 0
  let previousFoodConsumed = 0
  let previousMatings = 0
  let previousMateFailures = 0
  let previousLitterSizeSum = 0
  let previousEligibleCreatureTime = 0
  let previousEligibleUnmatedCreatureTime = 0
  let previousTimeAtCap = 0
  let previousBirthsBlockedByCap = 0
  let previousReproductionsBlockedByCap = 0
  let previousMatingsHittingLitterCap = 0
  let previousOffspringPreventedByLitterCap = 0
  let previousOffspringPreventedBySafety = 0
  let previousSampleTime = 0

  const log: ExperimentLog = {
    metadata: {
      schemaVersion: 6,
      runId: createRunId(),
      seed: null,
      rng: 'Math.random',
      reproducible: false,
      rngNote: RNG_NOTE,
      version: SIM_VERSION,
      initialPopulation: world.creatures.length,
      initialFood: world.foods.length,
      initialEnvironment: { ...world.environment },
      sampleInterval,
      snapshotInterval,
      stdDev: 'population',
      intervalCounts: 'since-previous-sample',
      timeUnit: 'seconds',
      startedAt: new Date().toISOString(),
      config: CONFIG,
    },
    samples,
    genomeSnapshots,
    environmentChanges,
    lifetimes: world.lifetimeRecords,
    safetyEvents: world.safetyEvents,
    observe(dt: number): void {
      sampleAccumulator += dt
      if (sampleAccumulator >= sampleInterval) {
        sampleAccumulator -= sampleInterval
        takeSample()
      }
      snapshotAccumulator += dt
      if (snapshotAccumulator >= snapshotInterval) {
        snapshotAccumulator -= snapshotInterval
        takeSnapshot()
      }
    },
    recordEnvironmentChange(change: EnvironmentChange): void {
      environmentChanges.push({
        time: world.time,
        avgGeneration: summarize(world).avgGeneration,
        parameter: change.parameter,
        oldValue: change.oldValue,
        newValue: change.newValue,
        creaturesAffected: change.creaturesAffected,
      })
    },
  }

  takeSample()
  takeSnapshot()
  return log

  function takeSample(): void {
    samples.push(
      measureSample(
        world,
        previousBirths,
        previousDeaths,
        previousFoodConsumed,
        previousMatings,
        previousMateFailures,
        previousLitterSizeSum,
        previousEligibleCreatureTime,
        previousEligibleUnmatedCreatureTime,
        previousTimeAtCap,
        previousBirthsBlockedByCap,
        previousReproductionsBlockedByCap,
        previousMatingsHittingLitterCap,
        previousOffspringPreventedByLitterCap,
        previousOffspringPreventedBySafety,
        previousSampleTime,
      ),
    )
    previousBirths = world.births
    previousDeaths = world.deaths
    previousFoodConsumed = world.foodConsumed
    previousMatings = world.matings
    previousMateFailures = world.mateFailures
    previousLitterSizeSum = world.litterSizeSum
    previousEligibleCreatureTime = world.eligibleCreatureTime
    previousEligibleUnmatedCreatureTime = world.eligibleUnmatedCreatureTime
    previousTimeAtCap = world.timeAtCap
    previousBirthsBlockedByCap = world.birthsBlockedByCap
    previousReproductionsBlockedByCap = world.reproductionsBlockedByCap
    previousMatingsHittingLitterCap = world.matingsHittingLitterCap
    previousOffspringPreventedByLitterCap = world.offspringPreventedByLitterCap
    previousOffspringPreventedBySafety = world.offspringPreventedBySafety
    previousSampleTime = world.time
    world.periodMaxLitter = 0
  }

  function takeSnapshot(): void {
    genomeSnapshots.push(captureSnapshot(world))
  }
}

function measureSample(
  world: World,
  previousBirths: number,
  previousDeaths: number,
  previousFoodConsumed: number,
  previousMatings: number,
  previousMateFailures: number,
  previousLitterSizeSum: number,
  previousEligibleCreatureTime: number,
  previousEligibleUnmatedCreatureTime: number,
  previousTimeAtCap: number,
  previousBirthsBlockedByCap: number,
  previousReproductionsBlockedByCap: number,
  previousMatingsHittingLitterCap: number,
  previousOffspringPreventedByLitterCap: number,
  previousOffspringPreventedBySafety: number,
  previousSampleTime: number,
): PopulationSample {
  const creatures = world.creatures
  const count = creatures.length
  const speeds = new Array<number>(count)
  const visions = new Array<number>(count)
  const sizes = new Array<number>(count)
  const mateDetections = new Array<number>(count)
  const investments = new Array<number>(count)
  let generation = 0
  let maxGeneration = 0
  let maxLivingAge = 0
  for (let i = 0; i < count; i++) {
    const creature = creatures[i]
    generation += creature.generation
    if (creature.generation > maxGeneration) maxGeneration = creature.generation
    if (creature.age > maxLivingAge) maxLivingAge = creature.age
    speeds[i] = creature.genome.speed
    visions[i] = creature.genome.vision
    sizes[i] = creature.genome.size
    mateDetections[i] = creature.genome.mateDetection
    investments[i] = creature.genome.offspringInvestment
  }
  const speed = traitDistribution(speeds)
  const vision = traitDistribution(visions)
  const size = traitDistribution(sizes)
  const mateDetection = traitDistribution(mateDetections)
  const investment = traitDistribution(investments)
  const inv = count > 0 ? 1 / count : 0
  const matingsSincePrevious = world.matings - previousMatings
  const litterSincePrevious = world.litterSizeSum - previousLitterSizeSum
  const eligibleSincePrevious = world.eligibleCreatureTime - previousEligibleCreatureTime
  const unmatedSincePrevious = world.eligibleUnmatedCreatureTime - previousEligibleUnmatedCreatureTime
  const elapsed = world.time - previousSampleTime
  const hits = world.matingsHittingLitterCap - previousMatingsHittingLitterCap
  const sexual = world.environment.reproductionMode === 'sexual'
  return {
    time: world.time,
    population: count,
    food: world.foods.length,
    avgGeneration: generation * inv,
    maxGeneration,
    birthsSincePrevious: world.births - previousBirths,
    deathsSincePrevious: world.deaths - previousDeaths,
    foodConsumedSincePrevious: world.foodConsumed - previousFoodConsumed,
    avgSpeed: speed.mean,
    speedMedian: speed.median,
    speedStdDev: speed.stdDev,
    speedMin: speed.min,
    speedMax: speed.max,
    avgVision: vision.mean,
    visionMedian: vision.median,
    visionStdDev: vision.stdDev,
    visionMin: vision.min,
    visionMax: vision.max,
    avgSize: size.mean,
    sizeMedian: size.median,
    sizeStdDev: size.stdDev,
    sizeMin: size.min,
    sizeMax: size.max,
    avgMateDetection: mateDetection.mean,
    mateDetectionMedian: mateDetection.median,
    mateDetectionStdDev: mateDetection.stdDev,
    mateDetectionMin: mateDetection.min,
    mateDetectionMax: mateDetection.max,
    avgOffspringInvestment: investment.mean,
    offspringInvestmentMedian: investment.median,
    offspringInvestmentStdDev: investment.stdDev,
    offspringInvestmentMin: investment.min,
    offspringInvestmentMax: investment.max,
    foodSpawnPerSecond: world.environment.foodSpawnPerSecond,
    foodEnergy: world.environment.foodEnergy,
    reproductionMode: world.environment.reproductionMode,
    matingRadius: world.environment.matingRadius,
    speedWindowMin: world.environment.speedWindowMin,
    speedWindowMax: world.environment.speedWindowMax,
    visionWindowMin: world.environment.visionWindowMin,
    visionWindowMax: world.environment.visionWindowMax,
    mateDetectionWindowMin: world.environment.mateDetectionWindowMin,
    mateDetectionWindowMax: world.environment.mateDetectionWindowMax,
    offspringInvestmentWindowMin: world.environment.offspringInvestmentWindowMin,
    offspringInvestmentWindowMax: world.environment.offspringInvestmentWindowMax,
    matingsSincePrevious,
    mateFailuresSincePrevious: world.mateFailures - previousMateFailures,
    meanLitterSize: matingsSincePrevious > 0 ? litterSincePrevious / matingsSincePrevious : 0,
    maxLitterSize: world.periodMaxLitter,
    activeMatePairs: countMatePairs(world),
    eligibleCreatureTimeSincePrevious: eligibleSincePrevious,
    eligibleUnmatedCreatureTimeSincePrevious: unmatedSincePrevious,
    mateLimitedPercent: eligibleSincePrevious > 0 ? (100 * unmatedSincePrevious) / eligibleSincePrevious : 0,
    populationCap: world.environment.populationCap,
    birthsBlockedByCapSincePrevious: world.birthsBlockedByCap - previousBirthsBlockedByCap,
    reproductionsBlockedByCapSincePrevious: world.reproductionsBlockedByCap - previousReproductionsBlockedByCap,
    fractionAtPopulationCap: elapsed > 0 ? (100 * (world.timeAtCap - previousTimeAtCap)) / elapsed : 0,
    litterEnergyLimited: world.environment.litterEnergyLimited,
    litterCap: world.environment.litterCap,
    matingsHittingLitterCapSincePrevious: hits,
    offspringPreventedByLitterCapSincePrevious: world.offspringPreventedByLitterCap - previousOffspringPreventedByLitterCap,
    litterCapHitPercent: matingsSincePrevious > 0 ? (100 * hits) / matingsSincePrevious : 0,
    offspringPreventedBySafetySincePrevious: world.offspringPreventedBySafety - previousOffspringPreventedBySafety,
    sizeWindowMin: world.environment.sizeWindowMin,
    sizeWindowMax: world.environment.sizeWindowMax,
    maxLivingAge,
    timeSinceLastBirth: world.lastBirthTime === null ? -1 : world.time - world.lastBirthTime,
    timeSinceLastMating: world.lastMatingTime === null ? -1 : world.time - world.lastMatingTime,
    extinct: count === 0 ? 1 : 0,
    reproductivelyExtinct: sexual && count === 1 ? 1 : 0,
  }
}

/** Census statistics. Standard deviation divides by n, not n - 1. */
function traitDistribution(values: readonly number[]): TraitDistribution {
  const n = values.length
  if (n === 0) return { mean: 0, median: 0, stdDev: 0, min: 0, max: 0 }

  let sum = 0
  let min = values[0]
  let max = values[0]
  for (let i = 0; i < n; i++) {
    const value = values[i]
    sum += value
    if (value < min) min = value
    if (value > max) max = value
  }
  const mean = sum / n
  let square = 0
  for (let i = 0; i < n; i++) {
    const delta = values[i] - mean
    square += delta * delta
  }
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = n >> 1
  const median = n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return { mean, median, stdDev: Math.sqrt(square / n), min, max }
}

function captureSnapshot(world: World): GenomeSnapshot {
  const creatures = world.creatures
  const records = new Array<GenomeSnapshotCreature>(creatures.length)
  for (let i = 0; i < creatures.length; i++) {
    const creature = creatures[i]
    records[i] = {
      id: creature.id,
      parentId: creature.parentId,
      parentAId: creature.parentId,
      parentBId: creature.parentBId,
      generation: creature.generation,
      age: creature.age,
      energy: creature.energy,
      maxEnergy: maxEnergy(creature.genome.size),
      foodEaten: creature.foodEaten,
      offspringCount: creature.offspringCount,
      speed: creature.genome.speed,
      vision: creature.genome.vision,
      size: creature.genome.size,
      mateDetection: creature.genome.mateDetection,
      offspringInvestment: creature.genome.offspringInvestment,
      matingCount: creature.matingCount,
    }
  }
  return { time: world.time, creatures: records }
}

function createRunId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  return `run-${Date.now().toString(36)}`
}
