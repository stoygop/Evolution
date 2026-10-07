import { CONFIG } from '../config.ts'
import {
  maxEnergy,
  mutateGenome,
  offspringStartingEnergy,
  randomGenome,
  metabolismPerSecond,
  reproductionCost,
  reproductionThreshold,
} from './genome.ts'
import { defaultRng, type Rng } from './rng.ts'
import { recordSample } from './stats.ts'
import type { Creature, Food, Genome, World } from './types.ts'

export interface WorldOptions {
  creatures?: number
  food?: number
  width?: number
  height?: number
  foodSpawnPerSecond?: number
}

export interface SpawnParams {
  genome: Genome
  x: number
  y: number
  energy: number
  age?: number
  parentId?: number | null
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
    history: [],
    sampleAccumulator: 0,
    spawnAccumulator: 0,
    foodSpawnPerSecond: options.foodSpawnPerSecond ?? CONFIG.food.spawnPerSecond,
    births: 0,
    deaths: 0,
  }

  const creatureCount = options.creatures ?? CONFIG.population.initial
  for (let i = 0; i < creatureCount; i++) {
    const genome = randomGenome(rng)
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

  recordSample(world, 0, true)
  return world
}

export function addCreature(world: World, rng: Rng, params: SpawnParams): Creature {
  const span = CONFIG.wander.maxSeconds - CONFIG.wander.minSeconds
  const creature: Creature = {
    id: world.nextCreatureId++,
    parentId: params.parentId ?? null,
    generation: params.generation ?? 0,
    genome: params.genome,
    x: params.x,
    y: params.y,
    heading: params.heading ?? rng.next() * Math.PI * 2,
    wanderTimer: CONFIG.wander.minSeconds + rng.next() * span,
    energy: params.energy,
    age: params.age ?? 0,
    foodEaten: 0,
    offspringCount: 0,
    reproduceCooldown: 0,
  }
  world.creatures.push(creature)
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
  const creatures = world.creatures
  for (let i = 0; i < creatures.length; i++) {
    const creature = creatures[i]
    creature.age += dt
    if (creature.reproduceCooldown > 0) creature.reproduceCooldown -= dt

    creature.energy -= metabolismPerSecond(creature.genome) * dt
    if (creature.energy <= 0) {
      creature.energy = 0
      continue
    }

    const foodIndex = nearestFoodIndex(creature, world.foods)
    if (foodIndex >= 0) moveToward(creature, world.foods[foodIndex], dt)
    else wander(creature, rng, dt)

    stayInside(creature, world)
    if (foodIndex >= 0) tryEat(creature, world, foodIndex)
  }

  compactCreatures(world)

  const living = world.creatures.length
  for (let i = 0; i < living; i++) tryReproduce(world, world.creatures[i], rng)

  spawnFoods(world, rng, dt)
  world.time += dt
  recordSample(world, dt)
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

function moveToward(creature: Creature, food: Food, dt: number): void {
  const dx = food.x - creature.x
  const dy = food.y - creature.y
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
  creature.energy = Math.min(maxEnergy(creature.genome.size), creature.energy + CONFIG.food.energy)
  creature.foodEaten += 1
  const last = world.foods.pop()
  if (last && foodIndex < world.foods.length) world.foods[foodIndex] = last
}

function compactCreatures(world: World): void {
  const creatures = world.creatures
  let write = 0
  for (let i = 0; i < creatures.length; i++) {
    const creature = creatures[i]
    if (creature.energy > 0) creatures[write++] = creature
    else world.deaths += 1
  }
  creatures.length = write
}

function tryReproduce(world: World, parent: Creature, rng: Rng): void {
  if (world.creatures.length >= CONFIG.population.max) return
  if (parent.age < CONFIG.reproduction.minAge) return
  if (parent.reproduceCooldown > 0) return
  if (parent.energy < reproductionThreshold(parent.genome)) return
  const cost = reproductionCost(parent.genome)
  if (parent.energy < cost) return

  parent.energy -= cost
  parent.offspringCount += 1
  parent.reproduceCooldown = CONFIG.reproduction.cooldown
  world.births += 1

  const genome = mutateGenome(parent.genome, rng)
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

function spawnFoods(world: World, rng: Rng, dt: number): void {
  if (world.foods.length >= CONFIG.food.max || world.foodSpawnPerSecond <= 0) return
  world.spawnAccumulator += world.foodSpawnPerSecond * dt
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
