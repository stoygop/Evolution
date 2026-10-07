export interface Genome {
  speed: number
  vision: number
  size: number
}

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
  reproduceCooldown: number
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

/**
 * V1 world. Fields below are the seams for later work; none of those
 * systems are implemented here.
 *
 * - predators: step a second agent list beside `creatures`
 * - food types: add a kind on `Food` and a nutrition table
 * - seasons / environmental change: vary `foodSpawnPerSecond` over `time`
 * - terrain: sample a movement multiplier at (x, y) inside the move step
 * - sexual reproduction: search for a mate before the asexual birth
 * - species: add a species id on `Genome`
 * - lineage visualization: `id`, `parentId`, and `generation` are already stored
 */
export interface World {
  width: number
  height: number
  creatures: Creature[]
  foods: Food[]
  nextCreatureId: number
  nextFoodId: number
  time: number
  history: StatsSample[]
  sampleAccumulator: number
  spawnAccumulator: number
  /** Copied from config so a later season model can change it per world. */
  foodSpawnPerSecond: number
  births: number
  deaths: number
}
