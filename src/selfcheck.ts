/**
 * Headless checks for the V1 rules. Not imported by the app.
 * Run with `npm run check`.
 */
import { CONFIG } from './config.ts'
import { createExperiment, type EnvironmentEvent, type ExperimentLog, type PopulationSample } from './experiment/recorder.ts'
import { updateEnvironment, v1Environment } from './sim/environment.ts'
import { createChartHistory, type ChartHistory } from './render/chart-history.ts'
import {
  downsample,
  groupInterventions,
  parseManualRange,
  scanExtrema,
  visibleSamples,
} from './render/dashboard-data.ts'
import {
  genomeWithinLimits,
  maxEnergy,
  metabolismPerSecond,
  mutateGenome,
  offspringStartingEnergy,
  recombineGenome,
  reproductionCost,
  sexualReproductionCost,
} from './sim/genome.ts'
import { mulberry32 } from './sim/rng.ts'
import type { Genome, World } from './sim/types.ts'
import { offspringPer100Seconds } from './sim/lifetime.ts'
import { addCreature, addFood, createWorld, stepWorld } from './sim/world.ts'
import { formatRunData, runDataFilename } from './ui/export-run.ts'

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

function runObserved(
  world: World,
  experiment: ExperimentLog,
  steps: number,
  seed: number,
  chart?: ChartHistory,
): void {
  const rng = mulberry32(seed)
  for (let i = 0; i < steps; i++) {
    stepWorld(world, dt, rng)
    experiment.observe(dt)
    chart?.record(world, dt)
  }
}

/** Mirrors ExperimentLog.observe so a trimmed log fails this count. */
function expectedSamples(steps: number, interval: number): number {
  let accumulator = 0
  let count = 1
  for (let i = 0; i < steps; i++) {
    accumulator += dt
    if (accumulator >= interval) {
      accumulator -= interval
      count += 1
    }
  }
  return count
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
  const genome: Genome = {
    speed: 55,
    vision: 90,
    size: 10,
    mateDetection: CONFIG.trait.mateDetection.initial,
    offspringInvestment: CONFIG.trait.offspringInvestment.initial,
  }
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
  assert(world.foodConsumed === 1, 'a meal should increment the world consumption counter')
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
  const genome: Genome = {
    speed: 48,
    vision: 96,
    size: 10,
    mateDetection: CONFIG.trait.mateDetection.initial,
    offspringInvestment: CONFIG.trait.offspringInvestment.initial,
  }
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
  assert(child.parentBId === null, 'asexual offspring should have no second parent')
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
  const experiment = createExperiment(world)
  const chart = createChartHistory()
  chart.record(world, 0, true)
  const steps = Math.round(60 / dt)
  runObserved(world, experiment, steps, 70, chart)
  const samples = experiment.samples
  const first = samples[0]
  const last = samples[samples.length - 1]
  const eaten = world.creatures.reduce((sum, creature) => sum + creature.foodEaten, 0)
  console.log(
    `ecology pop ${first.population} -> ${last.population}, births ${world.births}, deaths ${world.deaths}, eaten ${eaten}, food ${last.food}, gen ${last.avgGeneration.toFixed(2)}, speed ${first.avgSpeed.toFixed(1)} -> ${last.avgSpeed.toFixed(1)}, vision ${first.avgVision.toFixed(1)} -> ${last.avgVision.toFixed(1)}, size ${first.avgSize.toFixed(2)} -> ${last.avgSize.toFixed(2)}, samples ${samples.length}, chart ${chart.samples.length}`,
  )
  assert(eaten > 0 || world.foodConsumed > 0, 'the population should consume food')
  assert(world.deaths > 0, 'some creatures should die')
  assert(world.births > 0, 'some creatures should reproduce')
  assert(first.time === 0, 'experiment log should start at time 0')
  assert(samples.length === expectedSamples(steps, CONFIG.experiment.sampleInterval), 'experiment samples should not be trimmed')
  assert(chart.samples.length > 50, 'chart window should keep a finer history')
  assert(chart.samples.length > samples.length, 'charts should sample more often than the experiment log')
  assert(
    samples.some((sample) => sample.population !== first.population),
    'population samples should change',
  )
  assert(
    last.avgSpeed !== first.avgSpeed ||
      last.avgVision !== first.avgVision ||
      last.avgSize !== first.avgSize ||
      last.population !== first.population,
    'summary statistics should change over the run',
  )
  const births = samples.reduce((sum, sample) => sum + sample.birthsSincePrevious, 0)
  const deaths = samples.reduce((sum, sample) => sum + sample.deathsSincePrevious, 0)
  const consumed = samples.reduce((sum, sample) => sum + sample.foodConsumedSincePrevious, 0)
  assert(births > 0 && births <= world.births, 'interval births should be a positive portion of counted births')
  assert(deaths > 0 && deaths <= world.deaths, 'interval deaths should be a positive portion of counted deaths')
  assert(consumed > 0 && consumed <= world.foodConsumed, 'interval meals should be a positive portion of counted meals')
}

function sexualReproductionAndWindows(): void {
  const quiet = { creatures: 0, food: 0, foodSpawnPerSecond: 0 } as const
  const alone = createWorld(mulberry32(3), {
    ...quiet,
    environment: { reproductionMode: 'sexual', matingRadius: 90 },
  })
  const solo = addCreature(alone, mulberry32(4), {
    genome: { speed: 48, vision: 80, size: 10 },
    x: 200,
    y: 200,
    energy: maxEnergy(10),
    age: 30,
  })
  solo.wanderTimer = 10
  stepWorld(alone, dt, mulberry32(5))
  assert(alone.creatures.length === 1, 'a sexual creature with no mate should not reproduce')
  assert(alone.matings === 0 && alone.births === 0, 'a failed search is not a mating')
  assert(alone.mateFailures === 1, 'an eligible creature with no mate should be counted')

  const far = createWorld(mulberry32(6), {
    ...quiet,
    environment: { reproductionMode: 'sexual', matingRadius: 40 },
  })
  const left = addCreature(far, mulberry32(7), {
    genome: { speed: 50, vision: 80, size: 10 },
    x: 100,
    y: 200,
    energy: maxEnergy(10),
    age: 30,
  })
  const right = addCreature(far, mulberry32(8), {
    genome: { speed: 70, vision: 90, size: 10 },
    x: 100 + 200,
    y: 200,
    energy: maxEnergy(10),
    age: 30,
  })
  left.wanderTimer = 10
  right.wanderTimer = 10
  stepWorld(far, dt, mulberry32(9))
  assert(far.creatures.length === 2, 'mates outside the radius should not produce a child')
  assert(far.mateFailures === 2, 'each eligible creature should record the failed search')

  const world = createWorld(mulberry32(10), {
    ...quiet,
    environment: { reproductionMode: 'sexual', matingRadius: 90 },
  })
  const parentA = addCreature(world, mulberry32(11), {
    genome: { speed: 40, vision: 60, size: 10 },
    x: 300,
    y: 300,
    energy: maxEnergy(10),
    age: 30,
    generation: 2,
  })
  const parentB = addCreature(world, mulberry32(12), {
    genome: { speed: 100, vision: 160, size: 10 },
    x: 340,
    y: 300,
    energy: maxEnergy(10),
    age: 30,
    generation: 5,
  })
  parentA.wanderTimer = 10
  parentB.wanderTimer = 10
  const startA = parentA.energy
  const startB = parentB.energy
  stepWorld(world, dt, mulberry32(21))
  const child = world.creatures.find((creature) => creature.id !== parentA.id && creature.id !== parentB.id)
  assert(child !== undefined, 'two nearby eligible creatures should produce one child')
  if (!child) return
  assert(child.parentId === parentA.id, 'parent A should be the initiating parent')
  assert(child.parentBId === parentB.id, 'parent B should be stored on the child')
  assert(child.generation === 6, 'sexual generation should be one past the older parent')
  assert(parentA.offspringCount === 1 && parentB.offspringCount === 1, 'both parents should count the offspring')
  assert(near(parentA.reproduceCooldown, CONFIG.reproduction.cooldown), 'parent A should take the normal cooldown')
  assert(near(parentB.reproduceCooldown, CONFIG.reproduction.cooldown), 'parent B should take the normal cooldown')
  const costA = sexualReproductionCost(parentA.genome)
  const costB = sexualReproductionCost(parentB.genome)
  assert(near(costA, reproductionCost(parentA.genome) / 2), 'each sexual parent should budget half the asexual cost')
  const investment = (parentA.genome.offspringInvestment + parentB.genome.offspringInvestment) / 2
  const gift = Math.min(maxEnergy(child.genome.size), investment)
  const available = costA + costB
  const payA = gift * (costA / available)
  const payB = gift - payA
  const rateA = metabolismPerSecond(parentA.genome, true)
  const rateB = metabolismPerSecond(parentB.genome, true)
  assert(
    near(parentA.energy, startA - rateA * dt - payA, 1e-4),
    'parent A should pay its share of the litter after metabolism',
  )
  assert(
    near(parentB.energy, startB - rateB * dt - payB, 1e-4),
    'parent B should pay its share of the litter after metabolism',
  )
  assert(near(child.energy, gift), 'the child should start with the invested energy, capped at its max')
  assert(near(payA + payB, child.energy), 'sexual birth should move energy into the child without creating any')
  assert(world.matings === 1 && world.births === 1, 'the default investment should produce one offspring')

  const pipeline = mulberry32(21)
  const blended = recombineGenome(parentA.genome, parentB.genome, pipeline)
  const mutated = mutateGenome(blended, pipeline, world.environment)
  assert(
    child.genome.speed === mutated.speed &&
      child.genome.vision === mutated.vision &&
      child.genome.size === mutated.size,
    'the child genome should be recombination followed by mutation',
  )
  const noisy = mutateGenome({ speed: 60, vision: 80, size: 10 }, mulberry32(1))
  assert(
    noisy.speed !== 60 || noisy.vision !== 80 || noisy.size !== 10,
    'mutation should change the recombined genome',
  )
  assert(child.genome.speed !== parentA.genome.speed || child.genome.vision !== parentA.genome.vision, 'the child should not copy parent A')
  assert(child.genome.speed !== parentB.genome.speed || child.genome.vision !== parentB.genome.vision, 'the child should not copy parent B')

  const capped = createWorld(mulberry32(13), {
    ...quiet,
    environment: { reproductionMode: 'sexual', matingRadius: 90, speedWindowMin: 40, speedWindowMax: 50 },
  })
  const highA = addCreature(capped, mulberry32(14), {
    genome: { speed: 100, vision: 80, size: 10 },
    x: 400,
    y: 400,
    energy: maxEnergy(10),
    age: 30,
  })
  const highB = addCreature(capped, mulberry32(15), {
    genome: { speed: 100, vision: 90, size: 10 },
    x: 430,
    y: 400,
    energy: maxEnergy(10),
    age: 30,
  })
  highA.wanderTimer = 10
  highB.wanderTimer = 10
  stepWorld(capped, dt, mulberry32(16))
  const cappedChild = capped.creatures.find((creature) => creature.id !== highA.id && creature.id !== highB.id)
  assert(cappedChild !== undefined, 'parents inside a tight window should still be able to mate')
  if (cappedChild) {
    assert(cappedChild.genome.speed <= 50 && cappedChild.genome.speed >= 40, 'offspring speed should stay inside the window')
  }

  const live = createWorld(mulberry32(17), { ...quiet, creatures: 1 })
  const resident = live.creatures[0]
  const residentId = resident.id
  resident.genome.vision = 220
  resident.genome.speed = 20
  const time = live.time
  const experiment = createExperiment(live)
  const changes = updateEnvironment(live, { speedWindowMin: 80, visionWindowMax: 120 })
  assert(resident.genome.speed === 80, 'raising the speed minimum should clamp a slow creature')
  assert(resident.genome.vision === 120, 'lowering the vision maximum should clamp a farsighted creature')
  assert(live.time === time && live.creatures[0].id === residentId, 'clamping should not restart the population')
  const speedChange = changes.find((change) => change.parameter === 'speedWindowMin')
  const visionChange = changes.find((change) => change.parameter === 'visionWindowMax')
  assert(speedChange !== undefined && speedChange.creaturesAffected === 1, 'the speed clamp should count the affected creature')
  assert(visionChange !== undefined && visionChange.creaturesAffected === 1, 'the vision clamp should count the affected creature')
  if (speedChange && visionChange) {
    experiment.recordEnvironmentChange(speedChange)
    experiment.recordEnvironmentChange(visionChange)
    assert(experiment.environmentChanges[0].time === time, 'the clamp event should use the current simulation time')
    assert(experiment.environmentChanges[0].oldValue === CONFIG.trait.speed.min, 'the clamp event should record the old bound')
    assert(experiment.environmentChanges[0].newValue === 80, 'the clamp event should record the new bound')
    assert(experiment.environmentChanges[0].creaturesAffected === 1, 'the exported event should include how many creatures were clamped')
    assert(Number.isFinite(experiment.environmentChanges[0].avgGeneration), 'the clamp event should include average generation')
  }
  updateEnvironment(live, { visionWindowMax: CONFIG.trait.vision.max })
  assert(resident.genome.vision === 120, 'widening a window should not restore the previous vision')

  const fresh = createWorld(mulberry32(18), {
    creatures: 20,
    environment: {
      reproductionMode: 'sexual',
      matingRadius: 40,
      speedWindowMin: 50,
      speedWindowMax: 60,
      visionWindowMin: 80,
      visionWindowMax: 90,
    },
  })
  assert(fresh.environment.reproductionMode === 'sexual', 'a new run should keep sexual mode')
  assert(fresh.environment.matingRadius === 40, 'a new run should keep the selected mating radius')
  for (const creature of fresh.creatures) {
    assert(creature.genome.speed >= 50 && creature.genome.speed <= 60, 'founders should be born inside the speed window')
    assert(creature.genome.vision >= 80 && creature.genome.vision <= 90, 'founders should be born inside the vision window')
  }
  const restored = updateEnvironment(fresh, v1Environment())
  assert(fresh.environment.reproductionMode === 'asexual', 'reset should return to asexual reproduction')
  assert(fresh.environment.foodSpawnPerSecond === CONFIG.food.spawnPerSecond, 'reset should restore the V1 spawn rate')
  assert(fresh.environment.foodEnergy === CONFIG.food.energy, 'reset should restore the V1 meal')
  assert(
    fresh.environment.speedWindowMin === CONFIG.trait.speed.min &&
      fresh.environment.speedWindowMax === CONFIG.trait.speed.max,
    'reset should restore the original speed window',
  )
  assert(
    fresh.environment.visionWindowMin === CONFIG.trait.vision.min &&
      fresh.environment.visionWindowMax === CONFIG.trait.vision.max,
    'reset should restore the original vision window',
  )
  assert(restored.some((change) => change.parameter === 'reproductionMode'), 'reset should log the return to asexual')

  const baseline = createExperiment(createWorld(mulberry32(19)))
  assert(baseline.samples[0].reproductionMode === 'asexual', 'default samples should record asexual mode')
  assert(baseline.samples[0].matingRadius === CONFIG.reproduction.matingRadius, 'default samples should record the mating radius')
  assert(baseline.samples[0].speedWindowMin === 16 && baseline.samples[0].speedWindowMax === 130, 'default samples should record the V1 speed window')
  assert(baseline.samples[0].visionWindowMin === 24 && baseline.samples[0].visionWindowMax === 260, 'default samples should record the V1 vision window')
  assert(baseline.environmentChanges.length === 0, 'a default run should not invent environment events')

  const timed = createWorld(mulberry32(20), { environment: { reproductionMode: 'sexual', matingRadius: 120 } })
  const started = performance.now()
  runSteps(timed, Math.round(120 / dt), 22)
  const elapsed = performance.now() - started
  console.log(`sexual throughput 120 sim seconds in ${elapsed.toFixed(0)}ms`)
  assert(elapsed < 2000, `sexual runs should stay interactive at high speed, took ${elapsed.toFixed(0)}ms`)
  for (const creature of timed.creatures) {
    assert(Number.isFinite(creature.energy), 'sexual runs should stay numerically finite')
  }
}

function traitDistributions(): void {
  const rng = mulberry32(4)
  const world = createWorld(rng, { creatures: 0, food: 0, foodSpawnPerSecond: 0 })
  addCreature(world, rng, {
    genome: { speed: 20, vision: 40, size: 6 },
    x: 100,
    y: 100,
    energy: 40,
    generation: 0,
  })
  addCreature(world, rng, {
    genome: { speed: 50, vision: 40, size: 8 },
    x: 200,
    y: 100,
    energy: 50,
    generation: 2,
  })
  addCreature(world, rng, {
    genome: { speed: 80, vision: 100, size: 10 },
    x: 300,
    y: 100,
    energy: 60,
    generation: 5,
  })
  const experiment = createExperiment(world)
  const sample = experiment.samples[0]
  assert(sample.time === 0, 'distribution sample should be taken at time 0')
  assert(sample.population === 3, 'distribution sample should see every creature')
  assert(sample.maxGeneration === 5, 'max generation should be the oldest lineage alive')
  assert(near(sample.avgGeneration, 7 / 3), 'average generation should include every creature')
  assert(near(sample.avgSpeed, 50), 'avgSpeed should be the mean')
  assert(near(sample.speedMedian, 50), 'speed median of three values should be the middle one')
  assert(near(sample.speedStdDev, Math.sqrt(600)), 'speed std dev should be the population standard deviation')
  assert(sample.speedMin === 20 && sample.speedMax === 80, 'speed min and max should be the extremes')
  assert(near(sample.avgVision, 60) && sample.visionMedian === 40, 'vision median should resist the high outlier')
  assert(sample.visionMin === 40 && sample.visionMax === 100, 'vision extremes should be recorded')
  assert(near(sample.avgSize, 8) && sample.sizeMedian === 8, 'size mean and median should match this set')
  assert(sample.birthsSincePrevious === 0 && sample.deathsSincePrevious === 0, 'the opening sample has no prior interval')
  const copied = experiment.genomeSnapshots[0].creatures[0].speed
  world.creatures[0].genome.speed = 123
  assert(experiment.genomeSnapshots[0].creatures[0].speed === copied, 'snapshots should copy traits, not alias the live creature')
  assert(experiment.genomeSnapshots[0].time === 0, 'a genome snapshot should be taken at time 0')
  assert(experiment.genomeSnapshots[0].creatures.length === 3, 'the opening snapshot should list every living creature')
  assert(experiment.metadata.seed === null, 'live-style logs should record that there is no seed')
  assert(experiment.metadata.config.energy.base === 0.32, 'export should carry the frozen metabolism base')
  assert(experiment.metadata.config.reproduction.costFraction === 0.4, 'export should carry the frozen reproduction cost')
  assert(experiment.metadata.config.mutation.speedSigma === 5.5, 'export should carry the frozen mutation width')
}

function exportHistory(): void {
  const header = [
    'time',
    'population',
    'food',
    'avgGeneration',
    'maxGeneration',
    'birthsSincePrevious',
    'deathsSincePrevious',
    'foodConsumedSincePrevious',
    'avgSpeed',
    'speedMedian',
    'speedStdDev',
    'speedMin',
    'speedMax',
    'avgVision',
    'visionMedian',
    'visionStdDev',
    'visionMin',
    'visionMax',
    'avgSize',
    'sizeMedian',
    'sizeStdDev',
    'sizeMin',
    'sizeMax',
    'avgMateDetection',
    'mateDetectionMedian',
    'mateDetectionStdDev',
    'mateDetectionMin',
    'mateDetectionMax',
    'avgOffspringInvestment',
    'offspringInvestmentMedian',
    'offspringInvestmentStdDev',
    'offspringInvestmentMin',
    'offspringInvestmentMax',
    'foodSpawnPerSecond',
    'foodEnergy',
    'reproductionMode',
    'matingRadius',
    'speedWindowMin',
    'speedWindowMax',
    'visionWindowMin',
    'visionWindowMax',
    'mateDetectionWindowMin',
    'mateDetectionWindowMax',
    'offspringInvestmentWindowMin',
    'offspringInvestmentWindowMax',
    'matingsSincePrevious',
    'mateFailuresSincePrevious',
    'meanLitterSize',
    'maxLitterSize',
    'activeMatePairs',
    'eligibleCreatureTimeSincePrevious',
    'eligibleUnmatedCreatureTimeSincePrevious',
    'mateLimitedPercent',
    'populationCap',
    'birthsBlockedByCapSincePrevious',
    'reproductionsBlockedByCapSincePrevious',
    'fractionAtPopulationCap',
    'litterEnergyLimited',
    'litterCap',
    'matingsHittingLitterCapSincePrevious',
    'offspringPreventedByLitterCapSincePrevious',
    'litterCapHitPercent',
    'offspringPreventedBySafetySincePrevious',
    'sizeWindowMin',
    'sizeWindowMax',
    'maxLivingAge',
    'timeSinceLastBirth',
    'timeSinceLastMating',
    'extinct',
    'reproductivelyExtinct',
  ].join(',')
  const world = createWorld(mulberry32(11), { creatures: 20, food: 15 })
  const experiment = createExperiment(world)
  const empty = formatRunData(
    { metadata: experiment.metadata, samples: [], genomeSnapshots: [], environmentChanges: [], lifetimes: [], safetyEvents: [] },
    'csv',
  )
  assert(empty === `${header}\n`, 'empty CSV should be a header only')
  const emptyJson = JSON.parse(
    formatRunData(
      { metadata: experiment.metadata, samples: [], genomeSnapshots: [], environmentChanges: [], lifetimes: [], safetyEvents: [] },
      'json',
    ),
  ) as { samples: unknown[]; genomeSnapshots: unknown[]; environmentChanges: unknown[]; metadata: { runId: string } }
  assert(emptyJson.samples.length === 0 && emptyJson.genomeSnapshots.length === 0, 'empty JSON should keep the experiment envelope')
  assert(emptyJson.environmentChanges.length === 0, 'empty JSON should include an environment change list')
  assert(emptyJson.metadata.runId === experiment.metadata.runId, 'JSON metadata should identify the run')

  const steps = Math.round(40 / dt)
  runObserved(world, experiment, steps, 12)
  assert(experiment.samples[0].time === 0, 'export should begin at time 0')
  assert(
    experiment.samples.length === expectedSamples(steps, CONFIG.experiment.sampleInterval),
    'export should keep every sample from time 0',
  )
  assert(experiment.samples.length > 2, 'export fixture should collect more than the initial sample')
  const csv = formatRunData(experiment, 'csv')
  const csvLines = csv.trim().split('\n')
  assert(csvLines.length === experiment.samples.length + 1, 'CSV should have one row per sample plus a header')
  assert(csvLines[0] === header, 'CSV header should match the sampled stats')
  assert(csvLines[1].startsWith('0,'), 'first CSV row should be the time-0 sample')
  const exported = JSON.parse(formatRunData(experiment, 'json')) as {
    metadata: {
      seed: null
      sampleInterval: number
      snapshotInterval: number
      initialPopulation: number
      initialFood: number
      version: string
      initialEnvironment: { foodSpawnPerSecond: number; foodEnergy: number }
    }
    samples: Array<Record<string, number>>
    genomeSnapshots: Array<{ time: number; creatures: Array<{ id: number; speed: number; parentId: number | null }> }>
    environmentChanges: unknown[]
  }
  assert(exported.samples.length === experiment.samples.length, 'JSON should have one record per sample')
  assert(exported.samples[0].time === 0, 'JSON samples should start at time 0')
  assert(exported.genomeSnapshots[0].time === 0, 'JSON snapshots should start at time 0')
  assert(exported.genomeSnapshots[0].creatures.length === 20, 'opening snapshot should include the founding population')
  assert(exported.metadata.seed === null, 'JSON should record the missing seed explicitly')
  assert(exported.metadata.initialPopulation === 20 && exported.metadata.initialFood === 15, 'metadata should record the actual starting counts')
  assert(exported.metadata.sampleInterval === CONFIG.experiment.sampleInterval, 'metadata should record the sample interval')
  assert(exported.metadata.snapshotInterval === CONFIG.experiment.snapshotInterval, 'metadata should record the snapshot interval')
  assert(exported.metadata.version === '0.1.0', 'metadata should record the simulation version')
  assert(exported.samples[0].foodSpawnPerSecond === CONFIG.food.spawnPerSecond, 'samples should record the active spawn rate')
  assert(exported.samples[0].foodEnergy === CONFIG.food.energy, 'samples should record the active meal energy')
  assert(exported.metadata.initialEnvironment.foodEnergy === CONFIG.food.energy, 'metadata should record the starting meal energy')
  assert(runDataFilename(experiment.metadata.runId, 'json') === `evolution-${experiment.metadata.runId}.json`, 'JSON filename should identify the run')
  assert(
    runDataFilename(experiment.metadata.runId, 'csv') === `evolution-${experiment.metadata.runId}-samples.csv`,
    'CSV filename should identify the run and that it is samples only',
  )
  const populations = exported.samples.map((record) => record.population)
  assert(populations.some((value) => value !== populations[0]), 'exported population should change across samples')
  assert(
    exported.samples[exported.samples.length - 1].food === experiment.samples[experiment.samples.length - 1].food,
    'export should use stored food counts',
  )
  assert(exported.environmentChanges.length === 0, 'an untouched run should have no environment events')
}

function environmentControls(): void {
  const plain = createWorld(mulberry32(2))
  assert(plain.environment.foodSpawnPerSecond === CONFIG.food.spawnPerSecond, 'a default world should spawn food at the V1 rate')
  assert(plain.environment.foodEnergy === CONFIG.food.energy, 'a default meal should still be 34 energy')

  const mealGain = (foodEnergy: number): number => {
    const rng = mulberry32(6)
    const world = createWorld(rng, { creatures: 0, food: 0, foodSpawnPerSecond: 0, foodEnergy })
    const genome: Genome = {
      speed: 40,
      vision: 40,
      size: 8,
      mateDetection: CONFIG.trait.mateDetection.initial,
      offspringInvestment: CONFIG.trait.offspringInvestment.initial,
    }
    const creature = addCreature(world, rng, { genome, x: 200, y: 200, energy: 20, heading: 0 })
    addFood(world, 200, 200)
    const before = creature.energy
    stepWorld(world, dt, mulberry32(8))
    assert(creature.foodEaten === 1, `meal of ${foodEnergy} should be eaten`)
    return creature.energy - before
  }
  const modest = mealGain(CONFIG.food.energy)
  const rich = mealGain(90)
  assert(near(rich - modest, 90 - CONFIG.food.energy), `richer meals should add the extra energy (${modest} vs ${rich})`)
  assert(modest > 30, `a V1 meal should still add about 34 energy, gained ${modest}`)

  const foodAfter = (rate: number): number => {
    const world = createWorld(mulberry32(1), { creatures: 0, food: 0, foodSpawnPerSecond: rate })
    runSteps(world, Math.round(6 / dt), 2)
    return world.foods.length
  }
  const none = foodAfter(0)
  const scarce = foodAfter(0.4)
  const abundant = foodAfter(8)
  assert(none === 0, 'a spawn rate of 0 should add no food')
  assert(scarce > 0 && scarce < 6, `a low spawn rate should leave food scarce, count ${scarce}`)
  assert(abundant > scarce * 5, `a higher spawn rate should stock more food (${scarce} vs ${abundant})`)

  const world = createWorld(mulberry32(4), { creatures: 12, food: 10 })
  const experiment = createExperiment(world, { sampleInterval: dt, snapshotInterval: 1000 })
  runSteps(world, 30, 5)
  const ids = world.creatures.map((creature) => creature.id).join(',')
  const pop = world.creatures.length
  const time = world.time
  world.creatures[0].generation = 4
  world.creatures[1].generation = 2
  const generation = summarizeGeneration(world)
  const changes = updateEnvironment(world, { foodSpawnPerSecond: 0, foodEnergy: 12 })
  for (const change of changes) experiment.recordEnvironmentChange(change)
  assert(world.creatures.map((creature) => creature.id).join(',') === ids, 'a live change should keep the same creatures')
  assert(world.creatures.length === pop && world.time === time, 'a live change should not reset the run')
  assert(changes.length === 2, 'both food controls should be recorded when both change')
  const spawnEvent = experiment.environmentChanges.find((event) => event.parameter === 'foodSpawnPerSecond')
  const energyEvent = experiment.environmentChanges.find((event) => event.parameter === 'foodEnergy')
  assert(spawnEvent !== undefined && energyEvent !== undefined, 'JSON history should name each changed parameter')
  if (spawnEvent && energyEvent) {
    assert(spawnEvent.time === time && energyEvent.time === time, 'environment events should use the current simulation time')
    assert(spawnEvent.oldValue === CONFIG.food.spawnPerSecond && spawnEvent.newValue === 0, 'spawn event should store old and new values')
    assert(energyEvent.oldValue === CONFIG.food.energy && energyEvent.newValue === 12, 'energy event should store old and new values')
    assert(near(spawnEvent.avgGeneration, generation), 'events should record average generation at the change')
    assert(near(energyEvent.avgGeneration, generation), 'both events should share that generation')
  }
  experiment.observe(dt)
  const latest = experiment.samples[experiment.samples.length - 1]
  assert(latest.foodSpawnPerSecond === 0 && latest.foodEnergy === 12, 'later samples should carry the new environment')
  assert(experiment.samples[0].foodSpawnPerSecond === CONFIG.food.spawnPerSecond, 'earlier samples should keep the old spawn rate')
  const csv = formatRunData(experiment, 'csv')
  assert(csv.includes('foodSpawnPerSecond,foodEnergy'), 'CSV should include the active environment columns')
  const exported = JSON.parse(formatRunData(experiment, 'json')) as {
    environmentChanges: Array<{ parameter: string; oldValue: number; newValue: number; time: number }>
  }
  assert(exported.environmentChanges.length === 2, 'JSON should list the live environment changes')

  const restored = updateEnvironment(world, v1Environment())
  assert(restored.length === 2, 'reset should change both values back')
  assert(
    world.environment.foodSpawnPerSecond === CONFIG.food.spawnPerSecond &&
      world.environment.foodEnergy === CONFIG.food.energy,
    'reset should restore the V1 food environment',
  )

  const restarted = createWorld(mulberry32(9), { creatures: 7, food: 4, foodSpawnPerSecond: 2.5, foodEnergy: 50 })
  const restartedLog = createExperiment(restarted)
  assert(restarted.creatures.length === 7, 'restart should build a new population')
  assert(restarted.environment.foodSpawnPerSecond === 2.5 && restarted.environment.foodEnergy === 50, 'restart should use the selected environment')
  assert(restartedLog.environmentChanges.length === 0, 'a new run should not inherit the previous change log')
  assert(restartedLog.metadata.initialEnvironment.foodEnergy === 50, 'the new run should record its own starting meal energy')
  assert(restartedLog.samples[0].foodSpawnPerSecond === 2.5, 'the first sample of a new run should use the selected spawn rate')
}

function summarizeGeneration(world: ReturnType<typeof createWorld>): number {
  if (world.creatures.length === 0) return 0
  const total = world.creatures.reduce((sum, creature) => sum + creature.generation, 0)
  return total / world.creatures.length
}

function fullHistoryIsRetained(): void {
  const world = createWorld(mulberry32(3), { creatures: 8, food: 6, foodSpawnPerSecond: 0 })
  const interval = dt
  const experiment = createExperiment(world, { sampleInterval: interval, snapshotInterval: interval * 10 })
  const steps = 180
  runObserved(world, experiment, steps, 4)
  assert(experiment.samples[0].time === 0, 'dense log should still start at time 0')
  assert(experiment.samples.length === expectedSamples(steps, interval), 'dense log should keep a sample per step plus the start')
  assert(experiment.samples.length === steps + 1, 'dense log should keep the opening sample and one sample per step')
  let previous = -1
  for (const sample of experiment.samples) {
    assert(sample.time > previous, 'sample times should increase')
    previous = sample.time
  }
  assert(experiment.genomeSnapshots[0].time === 0, 'dense snapshots should include time 0')
  assert(experiment.genomeSnapshots.length > 10, 'snapshots should accumulate across the run')

  const chart = createChartHistory()
  for (let i = 0; i < CONFIG.sim.historyLimit + 80; i++) chart.record(world, CONFIG.sim.historySampleInterval)
  assert(chart.samples.length === CONFIG.sim.historyLimit, 'chart history should stay capped while the experiment log does not')
}

function acceleratedThroughput(): void {
  const world = createWorld(mulberry32(99))
  const experiment = createExperiment(world)
  const chart = createChartHistory()
  chart.record(world, 0, true)
  const simSeconds = 600
  const steps = Math.round(simSeconds / dt)
  const started = performance.now()
  runObserved(world, experiment, steps, 123, chart)
  const elapsed = performance.now() - started
  const factor = simSeconds / (elapsed / 1000)
  console.log(
    `throughput ${simSeconds} sim seconds in ${elapsed.toFixed(0)}ms (${factor.toFixed(0)}× realtime), samples ${experiment.samples.length}, snapshots ${experiment.genomeSnapshots.length}, chart ${chart.samples.length}`,
  )
  assert(elapsed < 6000, `${simSeconds} simulated seconds with recording should stay above 100×, took ${elapsed.toFixed(0)}ms`)
  assert(experiment.samples[0].time === 0, 'a long recorded run should still export from time 0')
  assert(
    experiment.samples.length === expectedSamples(steps, CONFIG.experiment.sampleInterval),
    'a long run should keep every population sample',
  )
  const chartUncapped = expectedSamples(steps, CONFIG.sim.historySampleInterval)
  assert(
    chart.samples.length === Math.min(CONFIG.sim.historyLimit, chartUncapped),
    'charts should follow the rolling window while the experiment log stays complete',
  )
  assert(
    experiment.genomeSnapshots.length === expectedSamples(steps, CONFIG.experiment.snapshotInterval),
    'snapshots should follow their own interval without trimming',
  )
  for (const creature of world.creatures) {
    assert(Number.isFinite(creature.energy) && Number.isFinite(creature.x), 'state should stay finite at high tick counts')
    assert(genomeWithinLimits(creature.genome), 'traits should stay in bounds after a long run')
  }
}

function mateSeekingAndInvestment(): void {
  const quiet = { creatures: 0, food: 0, foodSpawnPerSecond: 0 } as const
  const plain = metabolismPerSecond({ speed: 40, vision: 60, size: 7 })
  const sensing = metabolismPerSecond(
    { speed: 40, vision: 60, size: 7, mateDetection: 180, offspringInvestment: 32 },
    true,
  )
  assert(metabolismPerSecond({ speed: 40, vision: 60, size: 7, mateDetection: 180 }) === plain, 'asexual metabolism should ignore mate detection')
  assert(near(sensing - plain, CONFIG.energy.perMateDetection * 180), 'mate detection should cost perMateDetection per unit')

  const sensed = createWorld(mulberry32(30), { ...quiet, environment: { reproductionMode: 'sexual' } })
  const unsensed = createWorld(mulberry32(30), quiet)
  const body = {
    speed: 40,
    vision: 60,
    size: 8,
    mateDetection: 180,
    offspringInvestment: 32,
  }
  addCreature(sensed, mulberry32(1), { genome: body, x: 200, y: 200, energy: 80, age: 0 })
  addCreature(unsensed, mulberry32(1), { genome: body, x: 200, y: 200, energy: 80, age: 0 })
  runSteps(sensed, 30, 2)
  runSteps(unsensed, 30, 2)
  assert(
    sensed.creatures[0].energy < unsensed.creatures[0].energy - 0.2,
    'a sexual creature should pay mate-detection upkeep',
  )

  const chase = createWorld(mulberry32(31), {
    ...quiet,
    environment: { reproductionMode: 'sexual', matingRadius: 24 },
  })
  const seeker = addCreature(chase, mulberry32(3), {
    genome: { speed: 90, vision: 100, size: 8, mateDetection: 280, offspringInvestment: 32 },
    x: 100,
    y: 300,
    energy: maxEnergy(8),
    age: 20,
  })
  const target = addCreature(chase, mulberry32(4), {
    genome: { speed: 90, vision: 20, size: 8, mateDetection: 280, offspringInvestment: 32 },
    x: 280,
    y: 300,
    energy: maxEnergy(8),
    age: 20,
  })
  addFood(chase, 100, 240)
  const gap = Math.hypot(target.x - seeker.x, target.y - seeker.y)
  stepWorld(chase, dt, mulberry32(5))
  assert(seeker.mateTargetId === target.id && target.mateTargetId === seeker.id, 'eligible creatures should pair with the nearest detectable mate')
  assert(seeker.behavior === 'seeking mate', 'a pair outside contact range should be seeking the mate')
  assert(seeker.x > 102 && Math.abs(seeker.y - 300) < 1, 'an eligible creature should walk toward its mate even when food is visible')
  assert(chase.creatures.length === 2, 'seeing a mate should not mate before contact')
  const closed = Math.hypot(target.x - seeker.x, target.y - seeker.y)
  assert(closed < gap - 2, 'a pair should walk toward each other')
  runSteps(chase, 80, 6)
  assert(chase.matings === 1 && chase.births >= 1, 'a pair that closes to the mating radius should reproduce')

  const blind = createWorld(mulberry32(32), {
    ...quiet,
    environment: { reproductionMode: 'sexual', matingRadius: 80 },
  })
  const left = addCreature(blind, mulberry32(7), {
    genome: { speed: 40, vision: 20, size: 8, mateDetection: 30, offspringInvestment: 32 },
    x: 100,
    y: 200,
    energy: maxEnergy(8),
    age: 20,
  })
  addCreature(blind, mulberry32(8), {
    genome: { speed: 40, vision: 20, size: 8, mateDetection: 30, offspringInvestment: 32 },
    x: 220,
    y: 200,
    energy: maxEnergy(8),
    age: 20,
  })
  const blindX = left.x
  stepWorld(blind, dt, mulberry32(9))
  assert(left.mateTargetId === null, 'a creature should not detect a mate outside mateDetection')
  assert(blind.mateFailures === 2, 'both creatures should count a failed mate search')
  assert(blind.births === 0, 'undetected creatures should not mate just because the mating radius is large')
  assert(Math.abs(left.x - blindX) < 2, 'with no food and no mate, one step of wandering should not close a 120 unit gap')

  const hungry = createWorld(mulberry32(33), {
    ...quiet,
    foodSpawnPerSecond: 0,
    environment: { reproductionMode: 'sexual', matingRadius: 20 },
  })
  const starved = addCreature(hungry, mulberry32(10), {
    genome: { speed: 80, vision: 100, size: 10, mateDetection: 400, offspringInvestment: 32 },
    x: 200,
    y: 200,
    energy: maxEnergy(10) * 0.4,
    age: 20,
  })
  addCreature(hungry, mulberry32(11), {
    genome: { speed: 80, vision: 40, size: 10, mateDetection: 400, offspringInvestment: 32 },
    x: 200,
    y: 360,
    energy: maxEnergy(10),
    age: 20,
  })
  addFood(hungry, 250, 200)
  const startX = starved.x
  runSteps(hungry, 12, 12)
  assert(starved.behavior === 'seeking food' || starved.foodEaten > 0, 'a hungry creature should prioritize food')
  assert(starved.x > startX + 8, 'the hungry creature should move toward the food, not the mate')
  assert(starved.mateTargetId === null, 'a creature below the food-priority threshold should not lock a mate')

  const litter = createWorld(mulberry32(34), {
    ...quiet,
    environment: { reproductionMode: 'sexual', matingRadius: 40 },
  })
  const mother = addCreature(litter, mulberry32(13), {
    genome: { speed: 20, vision: 20, size: 10, mateDetection: 100, offspringInvestment: 20 },
    x: 400,
    y: 400,
    energy: maxEnergy(10),
    age: 30,
  })
  const father = addCreature(litter, mulberry32(14), {
    genome: { speed: 80, vision: 140, size: 10, mateDetection: 220, offspringInvestment: 20 },
    x: 420,
    y: 400,
    energy: maxEnergy(10),
    age: 30,
  })
  const beforeA = mother.energy
  const beforeB = father.energy
  stepWorld(litter, dt, mulberry32(40))
  const kids = litter.creatures.filter((creature) => creature.parentId !== null)
  const budget = sexualReproductionCost(mother.genome) + sexualReproductionCost(father.genome)
  assert(kids.length === 2, `investment 20 against a budget of ${budget.toFixed(1)} should make two offspring`)
  if (kids.length < 2) return
  assert(litter.matings === 1 && litter.births === 2, 'one mating should count every child in the litter')
  const spent = beforeA - mother.energy - metabolismPerSecond(mother.genome, true) * dt
  const spentB = beforeB - father.energy - metabolismPerSecond(father.genome, true) * dt
  const endowed = kids.reduce((sum, creature) => sum + creature.energy, 0)
  assert(near(spent + spentB, endowed, 1e-4), 'parents should pay exactly the energy the litter receives')
  assert(kids.every((creature) => near(creature.energy, 20)), 'each child should start with the investment, not a fixed endowment')
  assert(kids[0].parentId === mother.id && kids[0].parentBId === father.id, 'every litter-mate should keep both parents')
  assert(
    kids[0].genome.speed !== kids[1].genome.speed ||
      kids[0].genome.vision !== kids[1].genome.vision ||
      kids[0].genome.mateDetection !== kids[1].genome.mateDetection ||
      kids[0].genome.offspringInvestment !== kids[1].genome.offspringInvestment,
    'litter-mates should be recombined and mutated independently',
  )

  const pipeline = mulberry32(40)
  const first = mutateGenome(recombineGenome(mother.genome, father.genome, pipeline), pipeline, litter.environment, true)
  pipeline.next()
  const second = mutateGenome(recombineGenome(mother.genome, father.genome, pipeline), pipeline, litter.environment, true)
  assert(
    kids[0].genome.speed === first.speed &&
      kids[0].genome.mateDetection === first.mateDetection &&
      kids[0].genome.offspringInvestment === first.offspringInvestment &&
      kids[1].genome.speed === second.speed &&
      kids[1].genome.offspringInvestment === second.offspringInvestment,
    'each child should recombine every trait and then mutate',
  )

  const many = createWorld(mulberry32(35), {
    ...quiet,
    environment: { reproductionMode: 'sexual', matingRadius: 40 },
  })
  addCreature(many, mulberry32(15), {
    genome: { speed: 30, vision: 40, size: 10, mateDetection: 80, offspringInvestment: 5 },
    x: 100,
    y: 100,
    energy: maxEnergy(10),
    age: 30,
  })
  addCreature(many, mulberry32(16), {
    genome: { speed: 30, vision: 40, size: 10, mateDetection: 80, offspringInvestment: 5 },
    x: 120,
    y: 100,
    energy: maxEnergy(10),
    age: 30,
  })
  stepWorld(many, dt, mulberry32(17))
  assert(many.births === CONFIG.reproduction.maxLitterSize, 'litter size should stop at the safety maximum')
  assert(many.creatures.length === 2 + CONFIG.reproduction.maxLitterSize, 'the cap should be the number of children added')
  const cheapKids = many.creatures.filter((creature) => creature.parentId !== null)
  assert(cheapKids.length > 0 && cheapKids.every((creature) => near(creature.energy, 5)), 'a cheap litter should give each child only its investment')
  if (cheapKids.length === 0) return

  const rich = createWorld(mulberry32(36), {
    ...quiet,
    environment: { reproductionMode: 'sexual', matingRadius: 40 },
  })
  addCreature(rich, mulberry32(18), {
    genome: { speed: 30, vision: 40, size: 10, mateDetection: 80, offspringInvestment: 50 },
    x: 100,
    y: 100,
    energy: maxEnergy(10),
    age: 30,
  })
  addCreature(rich, mulberry32(19), {
    genome: { speed: 30, vision: 40, size: 10, mateDetection: 80, offspringInvestment: 50 },
    x: 120,
    y: 100,
    energy: maxEnergy(10),
    age: 30,
  })
  stepWorld(rich, dt, mulberry32(20))
  const richKids = rich.creatures.filter((creature) => creature.parentId !== null)
  assert(richKids.length === 1, 'a higher investment should produce a smaller litter')
  assert(richKids[0].energy > cheapKids[0].energy, 'the single child should receive more starting energy than a cheap litter-mate')

  const broke = createWorld(mulberry32(37), {
    ...quiet,
    environment: { reproductionMode: 'sexual', matingRadius: 40 },
  })
  addCreature(broke, mulberry32(21), {
    genome: { speed: 30, vision: 40, size: 10, mateDetection: 80, offspringInvestment: 200 },
    x: 100,
    y: 100,
    energy: maxEnergy(10),
    age: 30,
  })
  addCreature(broke, mulberry32(22), {
    genome: { speed: 30, vision: 40, size: 10, mateDetection: 80, offspringInvestment: 200 },
    x: 120,
    y: 100,
    energy: maxEnergy(10),
    age: 30,
  })
  stepWorld(broke, dt, mulberry32(23))
  assert(broke.births === 0 && broke.matings === 0, 'a mating should wait when the budget cannot fund one offspring')

  const bounded = createWorld(mulberry32(38), {
    ...quiet,
    environment: {
      reproductionMode: 'sexual',
      matingRadius: 40,
      mateDetectionWindowMin: 40,
      mateDetectionWindowMax: 50,
      offspringInvestmentWindowMin: 16,
      offspringInvestmentWindowMax: 24,
    },
  })
  addCreature(bounded, mulberry32(24), {
    genome: { speed: 40, vision: 40, size: 10, mateDetection: 200, offspringInvestment: 80 },
    x: 300,
    y: 300,
    energy: maxEnergy(10),
    age: 30,
  })
  addCreature(bounded, mulberry32(25), {
    genome: { speed: 70, vision: 40, size: 10, mateDetection: 300, offspringInvestment: 8 },
    x: 320,
    y: 300,
    energy: maxEnergy(10),
    age: 30,
  })
  stepWorld(bounded, dt, mulberry32(26))
  const boundedKids = bounded.creatures.filter((creature) => creature.parentId !== null)
  assert(boundedKids.length > 0, 'parents inside the contact radius should still bear a litter')
  for (const child of boundedKids) {
    assert(child.genome.mateDetection >= 40 && child.genome.mateDetection <= 50, 'mate detection should stay inside its window')
    assert(
      child.genome.offspringInvestment >= 16 && child.genome.offspringInvestment <= 24,
      'offspring investment should stay inside its window',
    )
  }

  const live = createWorld(mulberry32(39), { ...quiet, creatures: 1 })
  const resident = live.creatures[0]
  resident.genome.mateDetection = 400
  resident.genome.offspringInvestment = 12
  const stamp = live.time
  const residentId = resident.id
  const changes = updateEnvironment(live, { mateDetectionWindowMax: 100, offspringInvestmentWindowMin: 40 })
  assert(resident.genome.mateDetection === 100, 'tightening mate detection should clamp a living creature')
  assert(resident.genome.offspringInvestment === 40, 'raising the investment minimum should clamp a living creature')
  assert(live.time === stamp && live.creatures[0].id === residentId, 'a live trait clamp should not restart the population')
  assert(
    changes.every((change) => change.creaturesAffected === 1),
    'each new window change should record how many creatures were clamped',
  )

  const sampleWorld = createWorld(mulberry32(41), { creatures: 4, food: 0, foodSpawnPerSecond: 0 })
  const log = createExperiment(sampleWorld)
  assert(log.metadata.schemaVersion === 6, 'exports should advance to the lifetime schema')
  assert(log.samples[0].avgMateDetection === CONFIG.trait.mateDetection.initial, 'samples should record mate detection')
  assert(log.samples[0].avgOffspringInvestment === CONFIG.trait.offspringInvestment.initial, 'samples should record offspring investment')
  assert(log.samples[0].mateDetectionWindowMin === 20 && log.samples[0].offspringInvestmentWindowMax === 200, 'samples should record the new windows')
  assert(log.genomeSnapshots[0].creatures[0].mateDetection === CONFIG.trait.mateDetection.initial, 'snapshots should copy mate detection')
  assert(log.genomeSnapshots[0].creatures[0].offspringInvestment === CONFIG.trait.offspringInvestment.initial, 'snapshots should copy offspring investment')
  const csv = formatRunData(log, 'csv')
  assert(csv.includes('meanLitterSize') && csv.includes('activeMatePairs'), 'CSV should include the litter and pairing columns')
}

function blankSample(time: number, patch: Partial<PopulationSample> = {}): PopulationSample {
  return {
    time,
    population: 1,
    food: 0,
    avgGeneration: time,
    maxGeneration: time,
    birthsSincePrevious: 0,
    deathsSincePrevious: 0,
    foodConsumedSincePrevious: 0,
    avgSpeed: 0,
    speedMedian: 0,
    speedStdDev: 0,
    speedMin: 0,
    speedMax: 0,
    avgVision: 0,
    visionMedian: 0,
    visionStdDev: 0,
    visionMin: 0,
    visionMax: 0,
    avgSize: 0,
    sizeMedian: 0,
    sizeStdDev: 0,
    sizeMin: 0,
    sizeMax: 0,
    avgMateDetection: 0,
    mateDetectionMedian: 0,
    mateDetectionStdDev: 0,
    mateDetectionMin: 0,
    mateDetectionMax: 0,
    avgOffspringInvestment: 0,
    offspringInvestmentMedian: 0,
    offspringInvestmentStdDev: 0,
    offspringInvestmentMin: 0,
    offspringInvestmentMax: 0,
    foodSpawnPerSecond: 3.6,
    foodEnergy: 34,
    reproductionMode: 'asexual',
    matingRadius: 90,
    speedWindowMin: 16,
    speedWindowMax: 130,
    visionWindowMin: 24,
    visionWindowMax: 260,
    mateDetectionWindowMin: 20,
    mateDetectionWindowMax: 600,
    offspringInvestmentWindowMin: 8,
    offspringInvestmentWindowMax: 200,
    matingsSincePrevious: 0,
    mateFailuresSincePrevious: 0,
    meanLitterSize: 0,
    maxLitterSize: 0,
    activeMatePairs: 0,
    eligibleCreatureTimeSincePrevious: 0,
    eligibleUnmatedCreatureTimeSincePrevious: 0,
    mateLimitedPercent: 0,
    populationCap: 450,
    birthsBlockedByCapSincePrevious: 0,
    reproductionsBlockedByCapSincePrevious: 0,
    fractionAtPopulationCap: 0,
    litterEnergyLimited: false,
    litterCap: 8,
    matingsHittingLitterCapSincePrevious: 0,
    offspringPreventedByLitterCapSincePrevious: 0,
    litterCapHitPercent: 0,
    offspringPreventedBySafetySincePrevious: 0,
    sizeWindowMin: 4.5,
    sizeWindowMax: 18,
    maxLivingAge: 0,
    timeSinceLastBirth: -1,
    timeSinceLastMating: -1,
    extinct: 0,
    reproductivelyExtinct: 0,
    ...patch,
  }
}

function analysisLayer(): void {
  const series = [0, 1, 2, 3, 4].map((time) => blankSample(time, { speedMin: time === 0 ? 4 : 20, speedMax: time === 3 ? 90 : 30, avgSpeed: time }))
  const visible = visibleSamples(series, 'generation', '50')
  assert(series.length === 5, 'windowing the chart should not drop stored samples')
  assert(visible.length === series.length, 'a short run should stay inside a 50 generation window')
  const full = scanExtrema(series, (sample) => sample.speedMin, (sample) => sample.speedMax)
  const tail = scanExtrema(series.filter((sample) => sample.time >= 2), (sample) => sample.speedMin, (sample) => sample.speedMax)
  assert(full !== null && tail !== null, 'extrema scans should find a sample')
  if (!full || !tail) return
  assert(full.min === 4 && full.minTime === 0, 'all-time low should come from the whole run')
  assert(tail.min === 20, 'a later window should miss the earlier low')
  assert(full.max === 90 && full.maxTime === 3, 'all-time high should remember when it happened')

  const peak = blankSample(50, { speedMax: 999, avgSpeed: 1, speedMin: 1 })
  const flat = Array.from({ length: 80 }, (_, index) => blankSample(index, { speedMax: 2, avgSpeed: 1, speedMin: 1 }))
  flat[40] = peak
  const reduced = downsample(flat, 8, (sample) => [sample.avgSpeed, sample.speedMin, sample.speedMax])
  assert(flat.length === 80 && flat[40] === peak, 'downsampling should not modify the experiment samples')
  assert(reduced.length < flat.length, 'display downsampling should shorten a long series')
  assert(reduced.includes(peak), 'downsampling should keep the sample that holds the extreme')

  const events: EnvironmentEvent[] = [
    { time: 1, avgGeneration: 0.2, parameter: 'foodEnergy', oldValue: 34, newValue: 40, creaturesAffected: 0 },
    { time: 1, avgGeneration: 0.2, parameter: 'visionWindowMax', oldValue: 260, newValue: 100, creaturesAffected: 3 },
    { time: 8, avgGeneration: 1.4, parameter: 'reproductionMode', oldValue: 'asexual', newValue: 'sexual', creaturesAffected: 0 },
  ]
  const groups = groupInterventions(events)
  assert(groups.length === 2 && groups[0].events.length === 2, 'same-time interventions should share one marker')
  assert(groups[1].events.length === 1 && groups[1].events[0].parameter === 'reproductionMode', 'later interventions should stay separate')
  assert(parseManualRange('1', '0') === null && parseManualRange('nope', '2') === null, 'manual ranges should reject inverted and non-numeric values')
  assert(parseManualRange('0', '10')?.max === 10, 'a finite increasing manual range should be accepted')

  const quiet = { creatures: 0, food: 0, foodSpawnPerSecond: 0 } as const
  const limited = createWorld(mulberry32(70), {
    ...quiet,
    environment: { reproductionMode: 'sexual', matingRadius: 8 },
  })
  const limitedLog = createExperiment(limited)
  addCreature(limited, mulberry32(71), {
    genome: { speed: 20, vision: 20, size: 8, mateDetection: 25 },
    x: 80,
    y: 80,
    energy: maxEnergy(8),
    age: 30,
  })
  addCreature(limited, mulberry32(72), {
    genome: { speed: 20, vision: 20, size: 8, mateDetection: 25 },
    x: 320,
    y: 80,
    energy: maxEnergy(8),
    age: 30,
  })
  runObserved(limited, limitedLog, Math.ceil(6 / dt), 73)
  const limitedSample = limitedLog.samples.find((sample) => sample.time > 0) ?? limitedLog.samples[limitedLog.samples.length - 1]
  assert(limitedSample.mateLimitedPercent > 90, 'creatures outside mate detection should count as mate-limited')
  assert(limitedSample.eligibleCreatureTimeSincePrevious > 0, 'eligible creature-time should be recorded')
  assert(limited.births === 0, 'the mate-limited measurement should not cause a birth')

  const paired = createWorld(mulberry32(74), {
    ...quiet,
    environment: { reproductionMode: 'sexual', matingRadius: 4 },
  })
  addCreature(paired, mulberry32(75), {
    genome: { speed: 10, vision: 10, size: 8, mateDetection: 80 },
    x: 200,
    y: 200,
    energy: maxEnergy(8),
    age: 30,
  })
  addCreature(paired, mulberry32(76), {
    genome: { speed: 10, vision: 10, size: 8, mateDetection: 80 },
    x: 220,
    y: 200,
    energy: maxEnergy(8),
    age: 30,
  })
  stepWorld(paired, dt, mulberry32(77))
  assert(near(paired.eligibleCreatureTime, 2 * dt), 'both eligible creatures should contribute creature-time')
  assert(paired.eligibleUnmatedCreatureTime === 0, 'a detected mate should not count as mate-limited')

  const plain = createWorld(mulberry32(78), quiet)
  addCreature(plain, mulberry32(79), {
    genome: { speed: 20, vision: 20, size: 8 },
    x: 100,
    y: 100,
    energy: maxEnergy(8),
    age: 30,
  })
  stepWorld(plain, dt, mulberry32(80))
  assert(plain.eligibleCreatureTime === 0, 'asexual steps should not accumulate mate-limited time')

  const dying = createWorld(mulberry32(81), quiet)
  const elder = addCreature(dying, mulberry32(82), {
    genome: { speed: 30, vision: 40, size: 8 },
    x: 150,
    y: 150,
    energy: 0.0001,
    age: 12,
    generation: 2,
    parentId: 7,
  })
  elder.offspringCount = 4
  elder.matingCount = 3
  stepWorld(dying, dt, mulberry32(83))
  assert(dying.creatures.length === 0, 'the exhausted creature should still be removed')
  const record = dying.lifetimeRecords[elder.id - 1]
  assert(record !== undefined && record.alive === false, 'death should finalize the birth record')
  if (!record) return
  assert(record.offspringCount === 4 && record.matingCount === 3, 'the record should keep lifetime offspring and matings')
  assert(record.parentId === 7 && record.generation === 2, 'the record should keep ancestry')
  assert(record.birthSpeed === 30 && record.birthVision === 40 && record.birthSize === 8, 'the record should keep traits from birth')
  assert((record.lifespan ?? 0) >= 12, 'the record should keep lifespan at death')
  const saved = createExperiment(dying)
  assert(saved.lifetimes.length === 1 && saved.lifetimes[0].id === elder.id, 'the export log should keep completed lives')
  const exported = JSON.parse(formatRunData(saved, 'json')) as { lifetimeRecords: { offspringCount: number }[] }
  assert(exported.lifetimeRecords.length === 1 && exported.lifetimeRecords[0].offspringCount === 4, 'downloaded JSON should include lifetime offspring')
  const lifeCsv = formatRunData(saved, 'lifetimes')
  assert(lifeCsv.includes('alive') && lifeCsv.includes('false'), 'the lifetime CSV should mark completed creatures')
}

function ceilingsAndLifetimes(): void {
  const quiet = { creatures: 0, food: 0, foodSpawnPerSecond: 0 } as const
  const dt = 1 / 30
  assert(v1Environment().populationCap === 450 && v1Environment().litterCap === 8, 'defaults should keep the historical caps')
  assert(v1Environment().sizeWindowMin === 4.5 && v1Environment().sizeWindowMax === 18, 'the size window should start at the old range')
  assert(offspringPer100Seconds(4, 40) === 10, 'offspring per 100 seconds should scale lifetime offspring by lifespan')
  assert(offspringPer100Seconds(1, 0) === null, 'a zero lifespan should not produce an infinite rate')

  const blocked = createWorld(mulberry32(90), { ...quiet, environment: { populationCap: 2 } })
  addCreature(blocked, mulberry32(91), { genome: { speed: 20, vision: 20, size: 8 }, x: 40, y: 40, energy: maxEnergy(8), age: 20 })
  addCreature(blocked, mulberry32(92), { genome: { speed: 20, vision: 20, size: 8 }, x: 80, y: 40, energy: maxEnergy(8), age: 20 })
  stepWorld(blocked, dt, mulberry32(93))
  assert(blocked.creatures.length === 2 && blocked.births === 0, 'a population safety cap should block births without removing creatures')
  assert(blocked.birthsBlockedByCap >= 1 && blocked.reproductionsBlockedByCap >= 1, 'blocked births should be recorded')
  updateEnvironment(blocked, { populationCap: 10 })
  stepWorld(blocked, dt, mulberry32(94))
  assert(blocked.creatures.length > 2, 'raising the cap should allow the next birth')

  const crowded = createWorld(mulberry32(95), { ...quiet, environment: { populationCap: 500 } })
  for (let i = 0; i < 460; i++) {
    addCreature(crowded, mulberry32(96 + i), {
      genome: { speed: 20, vision: 20, size: 8 },
      x: 20 + (i % 40) * 20,
      y: 20 + Math.floor(i / 40) * 20,
      energy: maxEnergy(8),
      age: 1,
    })
  }
  assert(crowded.creatures.length === 460, 'population should be able to exceed 450 when the safety cap is higher')
  updateEnvironment(crowded, { populationCap: 10 })
  const before = crowded.creatures.length
  stepWorld(crowded, dt, mulberry32(97))
  assert(crowded.creatures.length === before, 'lowering the cap should not delete living creatures')

  const openLitter = createWorld(mulberry32(98), {
    ...quiet,
    environment: { reproductionMode: 'sexual', matingRadius: 40, litterEnergyLimited: true },
  })
  const left = addCreature(openLitter, mulberry32(99), {
    genome: { speed: 30, vision: 40, size: 10, mateDetection: 80, offspringInvestment: 5 },
    x: 100,
    y: 100,
    energy: maxEnergy(10),
    age: 30,
  })
  const right = addCreature(openLitter, mulberry32(100), {
    genome: { speed: 30, vision: 40, size: 10, mateDetection: 80, offspringInvestment: 5 },
    x: 120,
    y: 100,
    energy: maxEnergy(10),
    age: 30,
  })
  const beforeLeft = left.energy
  const beforeRight = right.energy
  stepWorld(openLitter, dt, mulberry32(101))
  const openKids = openLitter.creatures.filter((creature) => creature.parentId !== null)
  assert(openKids.length === 11, 'energy-limited litter size should follow the energy budget past 8')
  const spent = beforeLeft - left.energy - metabolismPerSecond(left.genome, true) * dt
  const spentRight = beforeRight - right.energy - metabolismPerSecond(right.genome, true) * dt
  const endowed = openKids.reduce((sum, creature) => sum + creature.energy, 0)
  assert(near(spent + spentRight, endowed, 0.2), 'parents should still pay for every offspring')

  const raised = createWorld(mulberry32(102), {
    ...quiet,
    environment: { reproductionMode: 'sexual', matingRadius: 40, litterCap: 20 },
  })
  addCreature(raised, mulberry32(103), {
    genome: { speed: 30, vision: 40, size: 10, mateDetection: 80, offspringInvestment: 5 },
    x: 100,
    y: 100,
    energy: maxEnergy(10),
    age: 30,
  })
  addCreature(raised, mulberry32(104), {
    genome: { speed: 30, vision: 40, size: 10, mateDetection: 80, offspringInvestment: 5 },
    x: 120,
    y: 100,
    energy: maxEnergy(10),
    age: 30,
  })
  stepWorld(raised, dt, mulberry32(105))
  assert(raised.births === 11 && raised.matingsHittingLitterCap === 0, 'a raised litter cap should allow the energy-sized litter')

  const emergency = createWorld(mulberry32(106), {
    ...quiet,
    environment: { reproductionMode: 'sexual', matingRadius: 40, litterEnergyLimited: true },
  })
  addCreature(emergency, mulberry32(107), {
    genome: { speed: 30, vision: 40, size: 18, mateDetection: 80, offspringInvestment: 1 },
    x: 100,
    y: 100,
    energy: maxEnergy(18),
    age: 30,
  })
  addCreature(emergency, mulberry32(108), {
    genome: { speed: 30, vision: 40, size: 18, mateDetection: 80, offspringInvestment: 1 },
    x: 120,
    y: 100,
    energy: maxEnergy(18),
    age: 30,
  })
  stepWorld(emergency, dt, mulberry32(109))
  assert(emergency.births === CONFIG.reproduction.allocationCeiling, 'the allocation ceiling should stop a huge litter')
  assert(
    emergency.offspringPreventedBySafety > 0 && emergency.safetyEvents.some((event) => event.kind === 'litter-allocation'),
    'a safety trim should be recorded',
  )

  const sized = createWorld(mulberry32(110), quiet)
  const resident = addCreature(sized, mulberry32(111), {
    genome: { speed: 20, vision: 20, size: 18 },
    x: 50,
    y: 50,
    energy: maxEnergy(18),
    age: 3,
  })
  const tightened = updateEnvironment(sized, { sizeWindowMax: 10 })
  assert(
    resident.genome.size === 10 && tightened.some((change) => change.parameter === 'sizeWindowMax' && change.creaturesAffected >= 1),
    'tightening size should clamp living creatures and log it',
  )
  updateEnvironment(sized, { sizeWindowMax: 40 })
  assert(resident.genome.size === 10, 'widening the size window should not restore a clamped creature')
  const wideEnv = { ...v1Environment(), sizeWindowMax: 40 }
  let exceeded = false
  for (let seed = 1; seed < 40; seed++) {
    const child = mutateGenome(
      { speed: 40, vision: 80, size: 18, mateDetection: 180, offspringInvestment: 32 },
      mulberry32(seed),
      wideEnv,
      false,
    )
    if (child.size > 18 && child.size <= 40) exceeded = true
    const historical = mutateGenome(
      { speed: 40, vision: 80, size: 18, mateDetection: 180, offspringInvestment: 32 },
      mulberry32(seed),
      v1Environment(),
      false,
    )
    assert(historical.size <= 18 && historical.size >= 4.5, 'the default size window should keep the old bounds')
  }
  assert(exceeded, 'a wider size window should allow offspring above 18')

  const born = createWorld(mulberry32(112), quiet)
  const baby = addCreature(born, mulberry32(113), {
    genome: { speed: 22, vision: 33, size: 7 },
    x: 10,
    y: 10,
    energy: 20,
    age: 0,
  })
  const bornRecord = born.lifetimeRecords[baby.id - 1]
  assert(bornRecord?.alive === true && bornRecord.deathTime === null && bornRecord.birthSpeed === 22, 'birth should create an incomplete lifetime record')
  addCreature(born, mulberry32(114), {
    genome: { speed: 22, vision: 33, size: 7 },
    x: 30,
    y: 10,
    energy: 0.0001,
    age: 9,
  })
  stepWorld(born, dt, mulberry32(115))
  const dead = born.lifetimeRecords.filter((life) => life && !life.alive)
  const living = born.lifetimeRecords.filter((life) => life && life.alive)
  assert(dead.length === 1 && living.length === 1, 'completed lifespan statistics should exclude living creatures')
  assert(born.lifetimeRecords.length === 2, 'lifetime records should survive after death')
  const restarted = createWorld(mulberry32(116), quiet)
  assert(restarted.lifetimeRecords.length === 0, 'a new run should clear lifetime history')

  const logged = createExperiment(born)
  const csv = formatRunData(logged, 'lifetimes')
  assert(csv.startsWith('id,alive,'), 'the lifetime CSV should be one row per creature')
  assert(csv.includes('true'), 'living creatures should be marked alive')
  assert(runDataFilename('abc', 'lifetimes') === 'evolution-abc-lifetimes.csv', 'lifetime export should use its own filename')
}

ceilingsAndLifetimes()
tradeoffs()
energyDecreases()
creatureDies()
seeksAndEats()
ignoresUnseenFood()
reproducesWithMutation()
populationChanges()
environmentControls()
sexualReproductionAndWindows()
mateSeekingAndInvestment()
analysisLayer()
traitDistributions()
exportHistory()
fullHistoryIsRetained()
acceleratedThroughput()

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`)
  throw new Error(`${failures.length} self-check failure(s)`)
}

console.log('self-check passed')
