/**
 * Headless checks for the V1 rules. Not imported by the app.
 * Run with `npm run check`.
 */
import { CONFIG } from './config.ts'
import {
  genomeWithinLimits,
  maxEnergy,
  metabolismPerSecond,
  offspringStartingEnergy,
  reproductionCost,
} from './sim/genome.ts'
import { mulberry32 } from './sim/rng.ts'
import type { Genome } from './sim/types.ts'
import { addCreature, addFood, createWorld, stepWorld } from './sim/world.ts'

const failures: string[] = []

function assert(condition: boolean, message: string): void {
  if (!condition) failures.push(message)
}

function near(actual: number, expected: number, epsilon = 1e-6): boolean {
  return Math.abs(actual - expected) <= epsilon
}

const dt = CONFIG.sim.fixedDt

function runSteps(world: ReturnType<typeof createWorld>, steps: number, seed = 1): void {
  const rng = mulberry32(seed)
  for (let i = 0; i < steps; i++) stepWorld(world, dt, rng)
}

function tradeoffs(): void {
  const slow = metabolismPerSecond({ speed: 20, vision: 40, size: 8 })
  const fast = metabolismPerSecond({ speed: 120, vision: 40, size: 8 })
  assert(fast > slow * 1.8, `speed should cost more energy (slow ${slow}, fast ${fast})`)

  const dim = metabolismPerSecond({ speed: 50, vision: 30, size: 8 })
  const sharp = metabolismPerSecond({ speed: 50, vision: 240, size: 8 })
  assert(sharp > dim + 0.8, `vision should cost upkeep (dim ${dim}, sharp ${sharp})`)

  const small = metabolismPerSecond({ speed: 50, vision: 80, size: 5 })
  const large = metabolismPerSecond({ speed: 50, vision: 80, size: 17 })
  assert(large > small + 0.5, `size should cost upkeep (small ${small}, large ${large})`)
  assert(maxEnergy(17) > maxEnergy(5) * 2.5, 'larger creatures should store more energy')

  const modest = metabolismPerSecond({ speed: 40, vision: 60, size: 7 })
  const greedy = metabolismPerSecond({
    speed: CONFIG.trait.speed.max,
    vision: CONFIG.trait.vision.max,
    size: CONFIG.trait.size.max,
  })
  assert(greedy > modest * 3, `maxing every trait should be expensive (modest ${modest}, greedy ${greedy})`)
}

function energyDecreases(): void {
  const rng = mulberry32(3)
  const genome: Genome = { speed: 55, vision: 90, size: 10 }
  const world = createWorld(rng, { creatures: 0, food: 0, foodSpawnPerSecond: 0 })
  const creature = addCreature(world, rng, {
    genome,
    x: 400,
    y: 300,
    energy: 40,
    age: 0,
  })
  const steps = Math.round(3 / dt)
  let expected = creature.energy
  const rate = metabolismPerSecond(genome)
  for (let i = 0; i < steps; i++) expected -= rate * dt
  runSteps(world, steps, 9)
  assert(world.creatures.length === 1, 'creature should still be alive')
  assert(
    near(creature.energy, expected, 1e-4),
    `energy ${creature.energy} should match metabolism drain ${expected}`,
  )
  assert(creature.energy < 40, 'energy should decrease with no food')
}

function creatureDies(): void {
  const rng = mulberry32(4)
  const world = createWorld(rng, { creatures: 0, food: 0, foodSpawnPerSecond: 0 })
  const creature = addCreature(world, rng, {
    genome: { speed: 40, vision: 40, size: 8 },
    x: 200,
    y: 200,
    energy: 0.2,
  })
  const id = creature.id
  runSteps(world, Math.round(2 / dt), 5)
  assert(world.creatures.every((item) => item.id !== id), 'starving creature should be removed')
  assert(world.deaths >= 1, 'death should be counted')
}

function seeksAndEats(): void {
  const rng = mulberry32(6)
  const world = createWorld(rng, { creatures: 0, food: 0, foodSpawnPerSecond: 0 })
  const creature = addCreature(world, rng, {
    genome: { speed: 70, vision: 220, size: 8 },
    x: 180,
    y: 300,
    energy: maxEnergy(8) * 0.5,
    heading: Math.PI,
  })
  const food = addFood(world, 180 + 100, 300)
  const startX = creature.x
  const startEnergy = creature.energy
  stepWorld(world, dt, mulberry32(8))
  assert(creature.x > startX, 'creature should step toward food on its right')
  assert(creature.foodEaten === 0, 'one tick should not already consume a distant meal')
  assert(world.foods.some((item) => item.id === food.id), 'food should still exist before contact')

  runSteps(world, Math.round(3 / dt), 8)
  assert(creature.foodEaten === 1, `creature should eat the food, ate ${creature.foodEaten}`)
  assert(!world.foods.some((item) => item.id === food.id), 'eaten food should be removed')
  assert(creature.energy > startEnergy, 'a meal should raise energy after the walk')
  assert(creature.x > startX + 50, 'creature should have closed most of the gap')
}

function ignoresUnseenFood(): void {
  const rng = mulberry32(11)
  const world = createWorld(rng, { creatures: 0, food: 0, foodSpawnPerSecond: 0 })
  const creature = addCreature(world, rng, {
    genome: { speed: 36, vision: 28, size: 7 },
    x: 150,
    y: 150,
    energy: 80,
  })
  addFood(world, 150 + 420, 150)
  runSteps(world, Math.round(1.2 / dt), 12)
  assert(creature.foodEaten === 0, 'food outside vision should not be eaten immediately')
  assert(world.foods.length === 1, 'unseen food should remain')
}

function reproducesWithMutation(): void {
  const rng = mulberry32(21)
  const genome: Genome = { speed: 48, vision: 96, size: 10 }
  const world = createWorld(rng, { creatures: 0, food: 0, foodSpawnPerSecond: 0 })
  const parent = addCreature(world, rng, {
    genome,
    x: 500,
    y: 360,
    energy: maxEnergy(genome.size),
    age: 30,
    generation: 2,
  })
  const start = parent.energy
  const cost = reproductionCost(genome)
  stepWorld(world, dt, mulberry32(22))
  const child = world.creatures.find((item) => item.id !== parent.id)
  assert(child !== undefined, 'well-fed adult should reproduce')
  if (!child) return
  const expected = start - metabolismPerSecond(genome) * dt - cost
  assert(near(parent.energy, expected, 1e-4), `parent energy ${parent.energy} != ${expected}`)
  assert(parent.offspringCount === 1, 'parent offspring count should increment')
  assert(child.parentId === parent.id, 'offspring should store the parent id')
  assert(child.generation === parent.generation + 1, 'offspring generation should be parent + 1')
  assert(child.genome !== parent.genome, 'offspring genome should be its own object')
  assert(genomeWithinLimits(child.genome), 'mutated genome should stay inside trait limits')
  assert(
    near(child.energy, offspringStartingEnergy(child.genome, cost), 1e-6),
    'offspring should start with a share of the reproduction cost',
  )

  const births: Genome[] = [child.genome]
  for (let i = 0; i < 24; i++) {
    parent.energy = maxEnergy(parent.genome.size)
    parent.reproduceCooldown = 0
    parent.age = 40
    const seen = new Set(world.creatures.map((item) => item.id))
    stepWorld(world, dt, mulberry32(100 + i))
    const born = world.creatures.find((item) => !seen.has(item.id))
    assert(born !== undefined, `birth ${i + 2} should produce a child`)
    if (!born) continue
    births.push({ ...born.genome })
    assert(born.parentId === parent.id, 'later offspring should keep the parent id')
    assert(born.generation === 3, 'later offspring generation should stay parent + 1')
    assert(genomeWithinLimits(born.genome), 'later offspring should stay in bounds')
    assert(born.id !== parent.id, 'offspring id should be unique')
  }
  const ids = world.creatures.map((item) => item.id)
  assert(new Set(ids).size === ids.length, 'creature ids should be unique')
  assert(births.some((item) => item.speed !== genome.speed), 'speed should mutate across offspring')
  assert(births.some((item) => item.vision !== genome.vision), 'vision should mutate across offspring')
  assert(births.some((item) => item.size !== genome.size), 'size should mutate across offspring')
  const meanSpeed = births.reduce((sum, item) => sum + item.speed, 0) / births.length
  assert(Math.abs(meanSpeed - genome.speed) < 8, `mutated speed should stay near the parent (${meanSpeed})`)
}

function populationChanges(): void {
  const world = createWorld(mulberry32(7))
  const first = world.history[0]
  runSteps(world, Math.round(60 / dt), 70)
  const eaten = world.creatures.reduce((sum, creature) => sum + creature.foodEaten, 0)
  const last = world.history[world.history.length - 1]
  console.log(
    `ecology pop ${first.population} -> ${last.population}, births ${world.births}, deaths ${world.deaths}, eaten ${eaten}, food ${last.food}, gen ${last.avgGeneration.toFixed(2)}, speed ${first.avgSpeed.toFixed(1)} -> ${last.avgSpeed.toFixed(1)}, vision ${first.avgVision.toFixed(1)} -> ${last.avgVision.toFixed(1)}, size ${first.avgSize.toFixed(2)} -> ${last.avgSize.toFixed(2)}, samples ${world.history.length}`,
  )
  assert(eaten > 0, 'the population should consume food')
  assert(world.deaths > 0, 'some creatures should die')
  assert(world.births > 0, 'some creatures should reproduce')
  assert(world.history.length > 50, 'history should keep samples over time')
  assert(
    world.history.some((sample) => sample.population !== first.population),
    'population samples should change',
  )
  assert(
    last.avgSpeed !== first.avgSpeed ||
      last.avgVision !== first.avgVision ||
      last.avgSize !== first.avgSize ||
      last.population !== first.population,
    'summary statistics should change over the run',
  )
}

function acceleratedThroughput(): void {
  const world = createWorld(mulberry32(99))
  const steps = Math.round(100 / dt)
  const started = performance.now()
  const rng = mulberry32(123)
  for (let i = 0; i < steps; i++) stepWorld(world, dt, rng)
  const elapsed = performance.now() - started
  const factor = 100 / (elapsed / 1000)
  console.log(`throughput 100 sim seconds in ${elapsed.toFixed(0)}ms (${factor.toFixed(0)}× realtime)`)
  assert(elapsed < 800, `100 simulated seconds should finish well under a second, took ${elapsed.toFixed(0)}ms`)
  for (const creature of world.creatures) {
    assert(Number.isFinite(creature.energy) && Number.isFinite(creature.x), 'state should stay finite at high tick counts')
    assert(genomeWithinLimits(creature.genome), 'traits should stay in bounds after a long run')
  }
}

tradeoffs()
energyDecreases()
creatureDies()
seeksAndEats()
ignoresUnseenFood()
reproducesWithMutation()
populationChanges()
acceleratedThroughput()

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`)
  throw new Error(`${failures.length} self-check failure(s)`)
}

console.log('self-check passed')
