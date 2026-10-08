export type BehaviorState = 'seeking food' | 'seeking mate' | 'paired' | 'wandering'

/** Speed, vision, and size. Reproductive traits may be omitted and then take founder defaults. */
export interface CoreGenome {
  speed: number
  vision: number
  size: number
}

export interface Genome extends CoreGenome {
  /** How far this creature can notice an eligible mate. Not used for food. */
  mateDetection: number
  /** Energy the parents aim to give each sexual offspring. Asexual births ignore it. */
  offspringInvestment: number
}

export type GenomeInput = CoreGenome & Partial<Pick<Genome, 'mateDetection' | 'offspringInvestment'>>

export interface Creature {
  id: number
  /** Null for the founding population. Kept for a later lineage view. */
  parentId: number | null
  generation: number
  genome: Genome
  x: number
  y: number
  heading: number
  wanderTimer: number
  energy: number
  age: number
  foodEaten: number
  offspringCount: number
  /**
   * Times this creature reproduced. Asexual birth counts once.
   * A sexual mating counts once for each parent, however large the litter.
   * Observation only.
   */
  matingCount: number
  reproduceCooldown: number
  /**
   * Second parent. Null for founders and asexual offspring.
   * `parentId` remains the sole parent, or parent A when this is set.
   */
  parentBId: number | null
  /** Sexual chase target. Null while eating, wandering, or reproducing asexually. */
  mateTargetId: number | null
  /** Seconds spent on the current mutual chase. */
  matePairTime: number
  /** Partner skipped after a chase timed out. */
  mateAvoidId: number | null
  mateAvoidTime: number
  /** Last movement decision. The inspector reads this. */
  behavior: BehaviorState
}

/**
 * One compact summary per creature, created at birth and finalized at death.
 * Traits are the birth genome, so a later window clamp does not rewrite history.
 * Observation only. No per-tick path is stored.
 */
export interface LifetimeRecord {
  id: number
  parentId: number | null
  parentBId: number | null
  generation: number
  birthTime: number
  birthAvgGeneration: number
  birthSpeed: number
  birthVision: number
  birthSize: number
  birthMateDetection: number
  birthOffspringInvestment: number
  deathTime: number | null
  deathAvgGeneration: number | null
  lifespan: number | null
  foodEaten: number
  matingCount: number
  offspringCount: number
  litterSizeSum: number
  maxLitter: number
  ageAtFirstMating: number | null
  ageAtFirstOffspring: number | null
  ageAtLastMating: number | null
  ageAtLastOffspring: number | null
  alive: boolean
}

/** A computational safeguard fired. This is not an experimental intervention. */
export interface SafetyEvent {
  time: number
  avgGeneration: number
  kind: 'litter-allocation' | 'population-ceiling'
  offspringPrevented: number
  detail: string
}

export interface Food {
  id: number
  x: number
  y: number
}

export interface StatsSample {
  time: number
  population: number
  food: number
  avgGeneration: number
  avgSpeed: number
  avgVision: number
  avgSize: number
}

export type ReproductionMode = 'asexual' | 'sexual'

/**
 * Live experiment settings. Food defaults match CONFIG.food.
 * Trait windows default to CONFIG.trait limits.
 * Reproduction defaults to asexual.
 */
export interface Environment {
  /** New food items per simulated second. */
  foodSpawnPerSecond: number
  /** Energy gained from eating one food item. */
  foodEnergy: number
  reproductionMode: ReproductionMode
  /** Center-to-center mating distance. Ignored while reproduction is asexual. */
  matingRadius: number
  /** Hard clamp after recombination and mutation, and for living creatures when a window tightens. */
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
  /** Births stop at this count. Creatures already alive are not removed. */
  populationCap: number
  /** Used when litterEnergyLimited is false. */
  litterCap: number
  /** No experimental litter ceiling. The allocation ceiling can still trim a mating. */
  litterEnergyLimited: boolean
}

/**
 * V1 world. Fields below are the seams for later work; none of those
 * systems are implemented here.
 *
 * - predators: step a second agent list beside `creatures`
 * - food types: add a kind on `Food` and a nutrition table
 * - seasons / environmental change: vary fields on `environment` over `time`
 * - terrain: sample a movement multiplier at (x, y) inside the move step
 * - species: add a species id on `Genome`
 * - lineage visualization: `id`, `parentId` (parent A), `parentBId`, and `generation`
 */
export interface World {
  width: number
  height: number
  creatures: Creature[]
  foods: Food[]
  nextCreatureId: number
  nextFoodId: number
  time: number
  spawnAccumulator: number
  /** Live food settings. Restart copies the panel; a run can also change them in place. */
  environment: Environment
  births: number
  deaths: number
  /** Meals eaten since the world was created. Observation only. */
  foodConsumed: number
  /** Successful sexual matings since the world was created. */
  matings: number
  /**
   * Eligible sexual creatures that found no mate inside mateDetection.
   * Counted once per step. A creature already chasing is not a failure.
   */
  mateFailures: number
  /** Sum of sexual litter sizes since the world was created. */
  litterSizeSum: number
  /** Largest sexual litter since the last experiment sample. The recorder clears it. */
  periodMaxLitter: number
  /**
   * Sum of dt over reproductively eligible creatures, sexual mode only.
   * Observation only. See the README for mate-limited percent.
   */
  eligibleCreatureTime: number
  /** Subset of eligibleCreatureTime in which no eligible mate was inside mateDetection. */
  eligibleUnmatedCreatureTime: number
  /** Sum of living creatures' generations. Kept so a birth does not scan the population. */
  generationSum: number
  /** Seconds during which the population was at the safety cap. */
  timeAtCap: number
  birthsBlockedByCap: number
  reproductionsBlockedByCap: number
  matingsHittingLitterCap: number
  offspringPreventedByLitterCap: number
  safetyLitterClamps: number
  offspringPreventedBySafety: number
  lastBirthTime: number | null
  lastMatingTime: number | null
  maxPopulation: number
  /** Smallest living population above zero. Infinity until the first creature exists. */
  minNonzeroPopulation: number
  maxLitterEver: number
  maxLivingAgeEver: number
  maxLivingAgeEverId: number | null
  /**
   * Dense birth order. `lifetimeRecords[id - 1].id === id` for every creature ever born.
   * Living records stay in the array with `alive` true.
   */
  lifetimeRecords: LifetimeRecord[]
  safetyEvents: SafetyEvent[]
}
