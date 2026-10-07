import { CONFIG } from '../config.ts'
import type { Camera } from './camera.ts'
import type { Genome, World } from '../sim/types.ts'

const trait = CONFIG.trait

function creatureColor(genome: Genome): string {
  const speedT = (genome.speed - trait.speed.min) / (trait.speed.max - trait.speed.min)
  const hue = 208 - speedT * 176
  return `hsl(${hue} 62% 58%)`
}

export function renderWorld(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  selectedId: number | null,
  dpr: number,
): void {
  const { scale, offsetX, offsetY, viewWidth, viewHeight } = camera
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, viewWidth, viewHeight)
  ctx.fillStyle = '#10140e'
  ctx.fillRect(0, 0, viewWidth, viewHeight)

  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offsetX, dpr * offsetY)
  ctx.fillStyle = '#1c2418'
  ctx.fillRect(0, 0, world.width, world.height)

  ctx.strokeStyle = 'rgba(239, 231, 214, 0.05)'
  ctx.lineWidth = 1 / scale
  ctx.beginPath()
  for (let x = 100; x < world.width; x += 100) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, world.height)
  }
  for (let y = 100; y < world.height; y += 100) {
    ctx.moveTo(0, y)
    ctx.lineTo(world.width, y)
  }
  ctx.stroke()

  ctx.fillStyle = '#d6f5a2'
  const foods = world.foods
  const foodDraw = Math.max(CONFIG.food.radius, 2.4 / scale)
  for (let i = 0; i < foods.length; i++) {
    const food = foods[i]
    ctx.beginPath()
    ctx.arc(food.x, food.y, foodDraw, 0, Math.PI * 2)
    ctx.fill()
  }

  const creatures = world.creatures
  let selectedIndex = -1
  for (let i = 0; i < creatures.length; i++) {
    const creature = creatures[i]
    if (creature.id === selectedId) selectedIndex = i
    ctx.fillStyle = creatureColor(creature.genome)
    ctx.beginPath()
    ctx.arc(creature.x, creature.y, creature.genome.size, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(16, 20, 14, 0.55)'
    ctx.lineWidth = 1.25 / scale
    ctx.stroke()

    const nose = creature.genome.size * 0.72
    ctx.strokeStyle = 'rgba(255, 248, 236, 0.8)'
    ctx.lineWidth = Math.max(1.1 / scale, creature.genome.size * 0.12)
    ctx.beginPath()
    ctx.moveTo(creature.x, creature.y)
    ctx.lineTo(
      creature.x + Math.cos(creature.heading) * nose,
      creature.y + Math.sin(creature.heading) * nose,
    )
    ctx.stroke()
  }

  if (selectedIndex >= 0) {
    const creature = creatures[selectedIndex]
    ctx.beginPath()
    ctx.arc(creature.x, creature.y, creature.genome.vision, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(239, 231, 214, 0.28)'
    ctx.lineWidth = 1.25 / scale
    ctx.setLineDash([7 / scale, 6 / scale])
    ctx.stroke()
    ctx.setLineDash([])

    ctx.beginPath()
    ctx.arc(creature.x, creature.y, creature.genome.size + 5, 0, Math.PI * 2)
    ctx.strokeStyle = '#f4efe4'
    ctx.lineWidth = 2.4 / scale
    ctx.stroke()
  }

  ctx.strokeStyle = 'rgba(239, 231, 214, 0.18)'
  ctx.lineWidth = 1.5 / scale
  ctx.strokeRect(0, 0, world.width, world.height)
}
