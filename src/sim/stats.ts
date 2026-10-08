import type { StatsSample, World } from './types.ts'

export function summarize(world: World): StatsSample {
  const creatures = world.creatures
  const count = creatures.length
  let generation = 0
  let speed = 0
  let vision = 0
  let size = 0
  for (let i = 0; i < count; i++) {
    const creature = creatures[i]
    generation += creature.generation
    speed += creature.genome.speed
    vision += creature.genome.vision
    size += creature.genome.size
  }
  const inv = count > 0 ? 1 / count : 0
  return {
    time: world.time,
    population: count,
    food: world.foods.length,
    avgGeneration: generation * inv,
    avgSpeed: speed * inv,
    avgVision: vision * inv,
    avgSize: size * inv,
  }
}
