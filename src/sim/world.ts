import { CONFIG } from '../config.ts'
import { initialEnvironment, populationLimit } from './environment.ts'
import {
  completeGenome,
  investmentPerOffspring,
  maxEnergy,
  mutateGenome,
  offspringStartingEnergy,
  randomGenome,
  recombineGenome,
  resolveLitter,
  metabolismPerSecond,
  reproductionCost,
  reproductionThreshold,
  sexualReproductionCost,
} from './genome.ts'
import { defaultRng, type Rng } from './rng.ts'
import type { Creature, Environment, Food, Genome, GenomeInput, LifetimeRecord, SafetyEvent, World } from './types.ts'

export interface WorldOptions {
  creatures?: number
  food?: number
  width?: number
  height?: number
  foodSpawnPerSecond?: number
  foodEnergy?: number
  environment?: Partial<Environment>
}

export interface SpawnParams {
  genome: GenomeInput
  x: number
  y: number
  energy: number
  age?: number
  parentId?: number | null
  parentBId?: number | null
  generation?: number
  heading?: number
}

export function createWorld(rng: Rng = defaultRng, options: WorldOptions = {}): World {
  const world: World = {
    width: options.width ?? CONFIG.world.width,
    height: options.height ?? CONFIG.world.height,
    creatures: [],
    foods: [],
    nextCreatureId: 1,
    nextFoodId: 1,
    time: 0,
    spawnAccumulator: 0,
    environment: initialEnvironment(options),
    births: 0,
    deaths: 0,
    foodConsumed: 0,
    matings: 0,
    mateFailures: 0,
    litterSizeSum: 0,
    periodMaxLitter: 0,
    eligibleCreatureTime: 0,
    eligibleUnmatedCreatureTime: 0,
    generationSum: 0,
    timeAtCap: 0,
    birthsBlockedByCap: 0,
    reproductionsBlockedByCap: 0,
    matingsHittingLitterCap: 0,
    offspringPreventedByLitterCap: 0,
    safetyLitterClamps: 0,
    offspringPreventedBySafety: 0,
    lastBirthTime: null,
    lastMatingTime: null,
    maxPopulation: 0,
    minNonzeroPopulation: Infinity,
    maxLitterEver: 0,
    maxLivingAgeEver: 0,
    maxLivingAgeEverId: null,
    lifetimeRecords: [],
    safetyEvents: [],
  }

  const creatureCount = options.creatures ?? CONFIG.population.initial
  const sexualFounders = world.environment.reproductionMode === 'sexual'
  for (let i = 0; i < creatureCount; i++) {
    const genome = randomGenome(rng)
    if (sexualFounders) {
      const trait = CONFIG.trait
      genome.mateDetection = rng.range(trait.mateDetection.initialMin, trait.mateDetection.initialMax)
      genome.offspringInvestment = rng.range(trait.offspringInvestment.initialMin, trait.offspringInvestment.initialMax)
    }
    genome.speed = clamp(genome.speed, world.environment.speedWindowMin, world.environment.speedWindowMax)
    genome.vision = clamp(genome.vision, world.environment.visionWindowMin, world.environment.visionWindowMax)
    genome.mateDetection = clamp(
      genome.mateDetection,
      world.environment.mateDetectionWindowMin,
      world.environment.mateDetectionWindowMax,
    )
    genome.offspringInvestment = clamp(
      genome.offspringInvestment,
      world.environment.offspringInvestmentWindowMin,
      world.environment.offspringInvestmentWindowMax,
    )
    genome.size = clamp(genome.size, world.environment.sizeWindowMin, world.environment.sizeWindowMax)
    addCreature(world, rng, {
      genome,
      x: rng.range(genome.size, world.width - genome.size),
      y: rng.range(genome.size, world.height - genome.size),
      energy: maxEnergy(genome.size) * CONFIG.energy.initialFraction,
      parentId: null,
      generation: 0,
    })
  }

  const foodCount = options.food ?? CONFIG.food.initial
  for (let i = 0; i < foodCount; i++) spawnFood(world, rng)

  return world
}

export function addCreature(world: World, rng: Rng, params: SpawnParams): Creature {
  const span = CONFIG.wander.maxSeconds - CONFIG.wander.minSeconds
  const creature: Creature = {
    id: world.nextCreatureId++,
    parentId: params.parentId ?? null,
    parentBId: params.parentBId ?? null,
    generation: params.generation ?? 0,
    genome: completeGenome(params.genome),
    x: params.x,
    y: params.y,
    heading: params.heading ?? rng.next() * Math.PI * 2,
    wanderTimer: CONFIG.wander.minSeconds + rng.next() * span,
    energy: params.energy,
    age: params.age ?? 0,
    foodEaten: 0,
    offspringCount: 0,
    matingCount: 0,
    reproduceCooldown: 0,
    mateTargetId: null,
    matePairTime: 0,
    mateAvoidId: null,
    mateAvoidTime: 0,
    behavior: 'wandering',
  }
  const prior = world.creatures.length
  const birthAvgGeneration = prior === 0 ? 0 : world.generationSum / prior
  world.creatures.push(creature)
  world.generationSum += creature.generation
  const genome = creature.genome
  const record: LifetimeRecord = {
    id: creature.id,
    parentId: creature.parentId,
    parentBId: creature.parentBId,
    generation: creature.generation,
    birthTime: world.time,
    birthAvgGeneration,
    birthSpeed: genome.speed,
    birthVision: genome.vision,
    birthSize: genome.size,
    birthMateDetection: genome.mateDetection,
    birthOffspringInvestment: genome.offspringInvestment,
    deathTime: null,
    deathAvgGeneration: null,
    lifespan: null,
    foodEaten: 0,
    matingCount: 0,
    offspringCount: 0,
    litterSizeSum: 0,
    maxLitter: 0,
    ageAtFirstMating: null,
    ageAtFirstOffspring: null,
    ageAtLastMating: null,
    ageAtLastOffspring: null,
    alive: true,
  }
  world.lifetimeRecords[creature.id - 1] = record
  return creature
}

export function addFood(world: World, x: number, y: number): Food {
  const food: Food = { id: world.nextFoodId++, x, y }
  world.foods.push(food)
  return food
}

export function findCreature(world: World, id: number): Creature | undefined {
  const creatures = world.creatures
  for (let i = 0; i < creatures.length; i++) {
    if (creatures[i].id === id) return creatures[i]
  }
  return undefined
}

/** Nearest creature whose body contains the point, with a few units of slop. */
export function pickCreature(world: World, x: number, y: number): number | null {
  let bestId: number | null = null
  let bestDistance = Infinity
  const creatures = world.creatures
  for (let i = 0; i < creatures.length; i++) {
    const creature = creatures[i]
    const dx = creature.x - x
    const dy = creature.y - y
    const distance = dx * dx + dy * dy
    const reach = creature.genome.size + 6
    if (distance <= reach * reach && distance < bestDistance) {
      bestDistance = distance
      bestId = creature.id
    }
  }
  return bestId
}

export function stepWorld(world: World, dt: number, rng: Rng = defaultRng): void {
  const sexual = world.environment.reproductionMode === 'sexual'
  const creatures = world.creatures
  for (let i = 0; i < creatures.length; i++) {
    const creature = creatures[i]
    creature.age += dt
    if (creature.age > world.maxLivingAgeEver) {
      world.maxLivingAgeEver = creature.age
      world.maxLivingAgeEverId = creature.id
    }
    if (creature.reproduceCooldown > 0) creature.reproduceCooldown -= dt
    if (creature.mateAvoidTime > 0) {
      creature.mateAvoidTime -= dt
      if (creature.mateAvoidTime <= 0) {
        creature.mateAvoidTime = 0
        creature.mateAvoidId = null
      }
    }

    creature.energy -= metabolismPerSecond(creature.genome, sexual) * dt
    if (creature.energy <= 0) {
      creature.energy = 0
      creature.mateTargetId = null
      creature.behavior = 'wandering'
    }
  }

  if (sexual) assignMatePairs(world, dt)
  else clearMatePairs(creatures)

  for (let i = 0; i < creatures.length; i++) {
    const creature = creatures[i]
    if (creature.energy <= 0) continue
    const foodIndex = moveCreature(world, creature, dt, rng)
    stayInside(creature, world)
    if (foodIndex >= 0) tryEat(creature, world, foodIndex)
  }

  compactCreatures(world)
  observeMateLimitation(world, dt)

  const living = world.creatures.length
  for (let i = 0; i < living; i++) tryReproduce(world, world.creatures[i], rng)
  if (sexual) countUnmated(world)

  spawnFoods(world, rng, dt)
  const population = world.creatures.length
  if (population > world.maxPopulation) world.maxPopulation = population
  if (population > 0 && population < world.minNonzeroPopulation) world.minNonzeroPopulation = population
  if (population >= populationLimit(world.environment)) world.timeAtCap += dt
  world.time += dt
}

export function isReproductivelyEligible(creature: Creature): boolean {
  if (creature.age < CONFIG.reproduction.minAge) return false
  if (creature.reproduceCooldown > 0) return false
  if (creature.energy < reproductionThreshold(creature.genome)) return false
  return true
}

export function countMatePairs(world: World): number {
  let pairs = 0
  const creatures = world.creatures
  for (let i = 0; i < creatures.length; i++) {
    const creature = creatures[i]
    const targetId = creature.mateTargetId
    if (targetId === null || targetId <= creature.id) continue
    const partner = findCreature(world, targetId)
    if (partner && partner.mateTargetId === creature.id) pairs += 1
  }
  return pairs
}

function clearMatePairs(creatures: Creature[]): void {
  for (let i = 0; i < creatures.length; i++) {
    creatures[i].mateTargetId = null
    creatures[i].matePairTime = 0
  }
}

function canSeekMate(world: World, creature: Creature): boolean {
  if (world.creatures.length >= populationLimit(world.environment)) return false
  if (!isReproductivelyEligible(creature)) return false
  const floor = CONFIG.behavior.foodPriorityEnergyFraction * maxEnergy(creature.genome.size)
  if (creature.energy < floor) return false
  if (creature.energy < sexualReproductionCost(creature.genome)) return false
  return true
}

/**
 * Mutual pairs only. The lower id picks first among creatures that are not
 * already locked, and both creatures then share that target. A creature whose
 * target is someone else is skipped, so chases cannot form a cycle.
 */
function assignMatePairs(world: World, dt: number): void {
  const creatures = world.creatures
  const eligible: Creature[] = []
  for (let i = 0; i < creatures.length; i++) {
    const creature = creatures[i]
    if (creature.energy <= 0 || !canSeekMate(world, creature)) {
      creature.mateTargetId = null
      creature.matePairTime = 0
      continue
    }
    eligible.push(creature)
  }

  const byId = new Map<number, Creature>()
  for (let i = 0; i < eligible.length; i++) byId.set(eligible[i].id, eligible[i])

  const locked = new Set<number>()
  const timeout = CONFIG.behavior.matePairTimeout
  const contact2 = world.environment.matingRadius * world.environment.matingRadius

  for (let i = 0; i < eligible.length; i++) {
    const creature = eligible[i]
    if (locked.has(creature.id)) continue
    const partnerId = creature.mateTargetId
    const partner = partnerId === null ? undefined : byId.get(partnerId)
    if (!partner || partner.mateTargetId !== creature.id) {
      creature.mateTargetId = null
      creature.matePairTime = 0
      continue
    }
    if (creature.id > partner.id) continue
    const dist2 = distance2(creature, partner)
    const reach = Math.max(creature.genome.mateDetection, partner.genome.mateDetection)
    const inSight = dist2 <= reach * reach
    const inContact = dist2 <= contact2
    const nextTime = Math.max(creature.matePairTime, partner.matePairTime) + dt
    if ((!inSight && !inContact) || (nextTime > timeout && !inContact)) {
      breakPair(creature, partner)
      continue
    }
    creature.matePairTime = nextTime
    partner.matePairTime = nextTime
    locked.add(creature.id)
    locked.add(partner.id)
  }

  const open: Creature[] = []
  for (let i = 0; i < eligible.length; i++) {
    if (!locked.has(eligible[i].id)) open.push(eligible[i])
  }
  open.sort((a, b) => a.id - b.id)

  for (let i = 0; i < open.length; i++) {
    const seeker = open[i]
    if (locked.has(seeker.id)) continue
    const mate = nearestOpenMate(seeker, open, locked)
    if (!mate) {
      seeker.mateTargetId = null
      seeker.matePairTime = 0
      continue
    }
    seeker.mateTargetId = mate.id
    mate.mateTargetId = seeker.id
    seeker.matePairTime = 0
    mate.matePairTime = 0
    locked.add(seeker.id)
    locked.add(mate.id)
  }
}

function breakPair(creature: Creature, partner: Creature): void {
  const delay = CONFIG.behavior.mateRetryDelay
  creature.mateAvoidId = partner.id
  creature.mateAvoidTime = delay
  partner.mateAvoidId = creature.id
  partner.mateAvoidTime = delay
  creature.mateTargetId = null
  partner.mateTargetId = null
  creature.matePairTime = 0
  partner.matePairTime = 0
}

function nearestOpenMate(seeker: Creature, open: Creature[], locked: Set<number>): Creature | null {
  const reach2 = seeker.genome.mateDetection * seeker.genome.mateDetection
  let best: Creature | null = null
  let bestDistance = reach2
  for (let i = 0; i < open.length; i++) {
    const other = open[i]
    if (other === seeker || locked.has(other.id)) continue
    if (seeker.mateAvoidId === other.id && seeker.mateAvoidTime > 0) continue
    if (other.mateAvoidId === seeker.id && other.mateAvoidTime > 0) continue
    const dist2 = distance2(seeker, other)
    if (dist2 > reach2) continue
    if (!best || dist2 < bestDistance || (dist2 === bestDistance && other.id < best.id)) {
      best = other
      bestDistance = dist2
    }
  }
  return best
}

function distance2(a: Creature, b: Creature): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/**
 * Hungry creatures, and anyone without a mate target, keep the historical
 * food-then-wander rule. A seeker with a target walks toward that creature.
 * Returns the food index when this step was aimed at food, so eating can follow.
 */
function moveCreature(world: World, creature: Creature, dt: number, rng: Rng): number {
  const partner = creature.mateTargetId === null ? undefined : findCreature(world, creature.mateTargetId)
  if (partner && world.environment.reproductionMode === 'sexual') {
    moveTowardPoint(creature, partner.x, partner.y, dt)
    const contact = world.environment.matingRadius
    creature.behavior = distance2(creature, partner) <= contact * contact ? 'paired' : 'seeking mate'
    return -1
  }
  const foodIndex = nearestFoodIndex(creature, world.foods)
  if (foodIndex >= 0) {
    moveTowardPoint(creature, world.foods[foodIndex].x, world.foods[foodIndex].y, dt)
    creature.behavior = 'seeking food'
    return foodIndex
  }
  wander(creature, rng, dt)
  creature.behavior = 'wandering'
  return -1
}

function nearestFoodIndex(creature: Creature, foods: Food[]): number {
  const reach2 = creature.genome.vision * creature.genome.vision
  let best = -1
  let bestDistance = reach2
  const x = creature.x
  const y = creature.y
  for (let i = 0; i < foods.length; i++) {
    const food = foods[i]
    const dx = food.x - x
    const dy = food.y - y
    const distance = dx * dx + dy * dy
    if (distance <= bestDistance) {
      bestDistance = distance
      best = i
    }
  }
  return best
}

function moveTowardPoint(creature: Creature, x: number, y: number, dt: number): void {
  const dx = x - creature.x
  const dy = y - creature.y
  const dist = Math.hypot(dx, dy)
  if (dist < 1e-8) return
  creature.heading = Math.atan2(dy, dx)
  const step = Math.min(creature.genome.speed * dt, dist)
  creature.x += (dx / dist) * step
  creature.y += (dy / dist) * step
}

function wander(creature: Creature, rng: Rng, dt: number): void {
  creature.wanderTimer -= dt
  if (creature.wanderTimer <= 0) {
    creature.heading = rng.next() * Math.PI * 2
    const span = CONFIG.wander.maxSeconds - CONFIG.wander.minSeconds
    creature.wanderTimer = CONFIG.wander.minSeconds + rng.next() * span
  }
  const step = creature.genome.speed * dt
  creature.x += Math.cos(creature.heading) * step
  creature.y += Math.sin(creature.heading) * step
}

function stayInside(creature: Creature, world: World): void {
  const radius = creature.genome.size
  if (creature.x < radius) {
    creature.x = radius
    creature.heading = Math.PI - creature.heading
  } else if (creature.x > world.width - radius) {
    creature.x = world.width - radius
    creature.heading = Math.PI - creature.heading
  }
  if (creature.y < radius) {
    creature.y = radius
    creature.heading = -creature.heading
  } else if (creature.y > world.height - radius) {
    creature.y = world.height - radius
    creature.heading = -creature.heading
  }
}

function tryEat(creature: Creature, world: World, foodIndex: number): void {
  const food = world.foods[foodIndex]
  if (!food) return
  const dx = food.x - creature.x
  const dy = food.y - creature.y
  const reach = creature.genome.size + CONFIG.food.radius
  if (dx * dx + dy * dy > reach * reach) return
  creature.energy = Math.min(maxEnergy(creature.genome.size), creature.energy + world.environment.foodEnergy)
  creature.foodEaten += 1
  world.foodConsumed += 1
  const record = lifeOf(world, creature.id)
  if (record) record.foodEaten = creature.foodEaten
  const last = world.foods.pop()
  if (last && foodIndex < world.foods.length) world.foods[foodIndex] = last
}

function compactCreatures(world: World): void {
  const creatures = world.creatures
  let write = 0
  for (let i = 0; i < creatures.length; i++) {
    const creature = creatures[i]
    if (creature.energy > 0) creatures[write++] = creature
    else {
      world.deaths += 1
      finalizeLifetime(world, creature)
      world.generationSum -= creature.generation
    }
  }
  creatures.length = write
}

function tryReproduce(world: World, parent: Creature, rng: Rng): void {
  if (world.environment.reproductionMode === 'sexual') {
    tryReproduceSexual(world, parent, rng)
    return
  }
  const ready =
    parent.age >= CONFIG.reproduction.minAge &&
    parent.reproduceCooldown <= 0 &&
    parent.energy >= reproductionThreshold(parent.genome) &&
    parent.energy >= reproductionCost(parent.genome)
  if (world.creatures.length >= populationLimit(world.environment)) {
    if (ready) {
      world.reproductionsBlockedByCap += 1
      world.birthsBlockedByCap += 1
    }
    return
  }
  if (!ready) return
  const cost = reproductionCost(parent.genome)

  parent.energy -= cost
  parent.offspringCount += 1
  parent.matingCount += 1
  noteReproduction(world, parent, 1)
  parent.reproduceCooldown = CONFIG.reproduction.cooldown
  world.births += 1
  world.lastBirthTime = world.time
  world.lastMatingTime = world.time

  const genome = mutateGenome(parent.genome, rng, world.environment)
  const angle = rng.next() * Math.PI * 2
  const dist = parent.genome.size + genome.size + CONFIG.reproduction.spawnGap
  const x = clamp(parent.x + Math.cos(angle) * dist, genome.size, world.width - genome.size)
  const y = clamp(parent.y + Math.sin(angle) * dist, genome.size, world.height - genome.size)
  addCreature(world, rng, {
    genome,
    x,
    y,
    energy: offspringStartingEnergy(genome, cost),
    age: 0,
    parentId: parent.id,
    generation: parent.generation + 1,
  })
}

/**
 * Mate only on contact. A committed pair waits for its partner.
 * An uncommitted creature can still mate with the nearest eligible
 * creature already inside the mating radius.
 * Creatures act in array order, so the earlier one claims the mate.
 */
function tryReproduceSexual(world: World, parent: Creature, rng: Rng): void {
  if (!isReproductivelyEligible(parent)) return
  const budgetA = sexualReproductionCost(parent.genome)
  if (parent.energy < budgetA) return
  const mate = contactMate(world, parent)
  if (!mate) return
  const budgetB = sexualReproductionCost(mate.genome)
  const available = budgetA + budgetB
  const investment = investmentPerOffspring(parent.genome, mate.genome)
  const plan = resolveLitter(available, investment, world.environment.litterEnergyLimited, world.environment.litterCap)
  if (plan.litter < 1) return
  const cap = populationLimit(world.environment)
  if (world.creatures.length >= cap) {
    world.reproductionsBlockedByCap += 1
    world.birthsBlockedByCap += plan.litter
    return
  }

  const births: Array<{ genome: Genome; x: number; y: number; energy: number }> = []
  for (let n = 0; n < plan.litter; n++) {
    if (world.creatures.length + births.length >= cap) {
      world.birthsBlockedByCap += plan.litter - births.length
      break
    }
    const genome = mutateGenome(recombineGenome(parent.genome, mate.genome, rng), rng, world.environment, true)
    const gift = Math.min(maxEnergy(genome.size), investment)
    const angle = rng.next() * Math.PI * 2
    const dist = parent.genome.size + genome.size + CONFIG.reproduction.spawnGap
    births.push({
      genome,
      x: clamp(parent.x + Math.cos(angle) * dist, genome.size, world.width - genome.size),
      y: clamp(parent.y + Math.sin(angle) * dist, genome.size, world.height - genome.size),
      energy: gift,
    })
  }
  if (births.length === 0) return

  let total = 0
  for (let i = 0; i < births.length; i++) total += births[i].energy
  const payA = total * (budgetA / available)
  parent.energy -= payA
  mate.energy -= total - payA
  parent.offspringCount += births.length
  mate.offspringCount += births.length
  parent.matingCount += 1
  mate.matingCount += 1
  noteReproduction(world, parent, births.length)
  noteReproduction(world, mate, births.length)
  if (plan.preventedByCap > 0) {
    world.matingsHittingLitterCap += 1
    world.offspringPreventedByLitterCap += plan.preventedByCap
  }
  if (plan.preventedBySafety > 0) {
    world.safetyLitterClamps += 1
    world.offspringPreventedBySafety += plan.preventedBySafety
    world.safetyEvents.push(safetyEvent(world, 'litter-allocation', plan.preventedBySafety, `allocation ceiling ${CONFIG.reproduction.allocationCeiling}`))
  }
  parent.reproduceCooldown = CONFIG.reproduction.cooldown
  mate.reproduceCooldown = CONFIG.reproduction.cooldown
  parent.mateTargetId = null
  mate.mateTargetId = null
  parent.matePairTime = 0
  mate.matePairTime = 0
  world.births += births.length
  world.matings += 1
  world.litterSizeSum += births.length
  world.lastBirthTime = world.time
  world.lastMatingTime = world.time
  if (births.length > world.periodMaxLitter) world.periodMaxLitter = births.length
  if (births.length > world.maxLitterEver) world.maxLitterEver = births.length

  const generation = Math.max(parent.generation, mate.generation) + 1
  for (let i = 0; i < births.length; i++) {
    const birth = births[i]
    addCreature(world, rng, {
      genome: birth.genome,
      x: birth.x,
      y: birth.y,
      energy: birth.energy,
      age: 0,
      parentId: parent.id,
      parentBId: mate.id,
      generation,
    })
  }
}

function contactMate(world: World, parent: Creature): Creature | null {
  const radius2 = world.environment.matingRadius * world.environment.matingRadius
  const committed = parent.mateTargetId === null ? undefined : findCreature(world, parent.mateTargetId)
  if (committed && committed.mateTargetId === parent.id && canBeMate(committed) && distance2(parent, committed) <= radius2) {
    return committed
  }
  if (parent.mateTargetId !== null) return null
  return nearestMate(world, parent)
}

/**
 * Sexual mode only. Counts creature-time, in seconds, for creatures that
 * already meet the reproduction threshold. A creature is unmated when no
 * other eligible creature lies inside its mateDetection radius.
 * Reads positions and writes only the two counters.
 */
function observeMateLimitation(world: World, dt: number): void {
  if (world.environment.reproductionMode !== 'sexual' || !(dt > 0)) return
  const creatures = world.creatures
  const eligible: Creature[] = []
  for (let i = 0; i < creatures.length; i++) {
    if (isReproductivelyEligible(creatures[i])) eligible.push(creatures[i])
  }
  for (let i = 0; i < eligible.length; i++) {
    world.eligibleCreatureTime += dt
    const seeker = eligible[i]
    const reach2 = seeker.genome.mateDetection * seeker.genome.mateDetection
    let detected = false
    for (let j = 0; j < eligible.length; j++) {
      if (i === j) continue
      if (distance2(seeker, eligible[j]) <= reach2) {
        detected = true
        break
      }
    }
    if (!detected) world.eligibleUnmatedCreatureTime += dt
  }
}

function lifeOf(world: World, id: number): LifetimeRecord | undefined {
  const record = world.lifetimeRecords[id - 1]
  return record && record.id === id ? record : undefined
}

function noteReproduction(world: World, creature: Creature, litter: number): void {
  const record = lifeOf(world, creature.id)
  if (!record) return
  record.matingCount = creature.matingCount
  record.offspringCount = creature.offspringCount
  record.litterSizeSum += litter
  if (litter > record.maxLitter) record.maxLitter = litter
  if (record.ageAtFirstMating === null) record.ageAtFirstMating = creature.age
  if (record.ageAtFirstOffspring === null) record.ageAtFirstOffspring = creature.age
  record.ageAtLastMating = creature.age
  record.ageAtLastOffspring = creature.age
}

function finalizeLifetime(world: World, creature: Creature): void {
  const record = lifeOf(world, creature.id)
  if (!record || !record.alive) return
  const living = world.creatures.length
  record.deathTime = world.time
  record.deathAvgGeneration = living === 0 ? 0 : world.generationSum / living
  record.lifespan = creature.age
  record.foodEaten = creature.foodEaten
  record.matingCount = creature.matingCount
  record.offspringCount = creature.offspringCount
  record.alive = false
}

function safetyEvent(world: World, kind: SafetyEvent['kind'], offspringPrevented: number, detail: string): SafetyEvent {
  const living = world.creatures.length
  return {
    time: world.time,
    avgGeneration: living === 0 ? 0 : world.generationSum / living,
    kind,
    offspringPrevented,
    detail,
  }
}

function countUnmated(world: World): void {
  if (world.creatures.length >= populationLimit(world.environment)) return
  const creatures = world.creatures
  for (let i = 0; i < creatures.length; i++) {
    const creature = creatures[i]
    if (!canSeekMate(world, creature)) continue
    if (creature.mateTargetId !== null) continue
    world.mateFailures += 1
  }
}

function canBeMate(creature: Creature): boolean {
  if (!isReproductivelyEligible(creature)) return false
  if (creature.energy < sexualReproductionCost(creature.genome)) return false
  return true
}

function nearestMate(world: World, seeker: Creature): Creature | null {
  const radius2 = world.environment.matingRadius * world.environment.matingRadius
  let best: Creature | null = null
  let bestDistance = radius2
  const creatures = world.creatures
  for (let i = 0; i < creatures.length; i++) {
    const other = creatures[i]
    if (other === seeker || !canBeMate(other)) continue
    if (other.mateTargetId !== null && other.mateTargetId !== seeker.id) continue
    if (seeker.mateAvoidId === other.id && seeker.mateAvoidTime > 0) continue
    const distance = distance2(seeker, other)
    const detect2 = seeker.genome.mateDetection * seeker.genome.mateDetection
    if (distance > radius2 || distance > detect2) continue
    if (!best || distance < bestDistance || (distance === bestDistance && other.id < best.id)) {
      best = other
      bestDistance = distance
    }
  }
  return best
}

function spawnFoods(world: World, rng: Rng, dt: number): void {
  if (world.foods.length >= CONFIG.food.max || world.environment.foodSpawnPerSecond <= 0) return
  world.spawnAccumulator += world.environment.foodSpawnPerSecond * dt
  while (world.spawnAccumulator >= 1 && world.foods.length < CONFIG.food.max) {
    world.spawnAccumulator -= 1
    spawnFood(world, rng)
  }
}

function spawnFood(world: World, rng: Rng): void {
  const margin = CONFIG.food.radius
  addFood(
    world,
    rng.range(margin, world.width - margin),
    rng.range(margin, world.height - margin),
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
