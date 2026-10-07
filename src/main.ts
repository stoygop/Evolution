import './style.css'
import { CONFIG } from './config.ts'
import { cameraFor, screenToWorld, type Camera } from './render/camera.ts'
import { renderCharts } from './render/charts.ts'
import { renderWorld } from './render/world-view.ts'
import { maxEnergy } from './sim/genome.ts'
import { summarize } from './sim/stats.ts'
import type { World } from './sim/types.ts'
import { createWorld, findCreature, pickCreature, stepWorld } from './sim/world.ts'
import { downloadRunData, type RunDataFormat } from './ui/export-run.ts'

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing ${selector}`)
  return element
}

const app = required<HTMLDivElement>('#app')
const worldCanvas = required<HTMLCanvasElement>('#world')
const chartCanvas = required<HTMLCanvasElement>('#charts')
const worldCtx = worldCanvas.getContext('2d')
const chartCtx = chartCanvas.getContext('2d')

if (!worldCtx || !chartCtx) {
  app.replaceChildren(document.createTextNode('Canvas 2D is not available in this browser.'))
  throw new Error('Canvas 2D unavailable')
}

const worldContext: CanvasRenderingContext2D = worldCtx
const chartContext: CanvasRenderingContext2D = chartCtx

const pauseButton = required<HTMLButtonElement>('#pause')
const restartButton = required<HTMLButtonElement>('#restart')
const downloadButton = required<HTMLButtonElement>('#download-run')
const exportFormat = required<HTMLSelectElement>('#export-format')
const clock = required<HTMLElement>('#clock')
const speedButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-speed]'))

const inspectorEmpty = required<HTMLElement>('#inspector-empty')
const inspectorDead = required<HTMLElement>('#inspector-dead')
const inspectorFields = required<HTMLElement>('#inspector-fields')
const meter = required<HTMLElement>('#ins-meter')

const field = {
  id: required<HTMLElement>('#ins-id'),
  parent: required<HTMLElement>('#ins-parent'),
  generation: required<HTMLElement>('#ins-generation'),
  age: required<HTMLElement>('#ins-age'),
  energy: required<HTMLElement>('#ins-energy'),
  eaten: required<HTMLElement>('#ins-eaten'),
  offspring: required<HTMLElement>('#ins-offspring'),
  speed: required<HTMLElement>('#ins-speed'),
  vision: required<HTMLElement>('#ins-vision'),
  size: required<HTMLElement>('#ins-size'),
}

const stat = {
  pop: required<HTMLElement>('#stat-pop'),
  food: required<HTMLElement>('#stat-food'),
  gen: required<HTMLElement>('#stat-gen'),
  speed: required<HTMLElement>('#stat-speed'),
  vision: required<HTMLElement>('#stat-vision'),
  size: required<HTMLElement>('#stat-size'),
}

let world: World = createWorld()
let paused = false
let speed: number = CONFIG.speeds[0]
let selectedId: number | null = null
let deadId: number | null = null
let accumulator = 0
let lastFrame = performance.now()
let camera: Camera = cameraFor(world.width, world.height, 1, 1)

function setSpeed(next: number): void {
  speed = next
  for (const button of speedButtons) {
    button.setAttribute('aria-pressed', button.dataset.speed === String(next) ? 'true' : 'false')
  }
}

function setPaused(next: boolean): void {
  paused = next
  pauseButton.textContent = paused ? 'Resume' : 'Pause'
  pauseButton.classList.toggle('is-paused', paused)
}

function restart(): void {
  world = createWorld()
  selectedId = null
  deadId = null
  accumulator = 0
  lastFrame = performance.now()
}

pauseButton.addEventListener('click', () => setPaused(!paused))
restartButton.addEventListener('click', restart)
downloadButton.addEventListener('click', () => {
  const format: RunDataFormat = exportFormat.value === 'json' ? 'json' : 'csv'
  downloadRunData(world.history, format)
})
for (const button of speedButtons) {
  button.addEventListener('click', () => {
    const next = Number(button.dataset.speed)
    if (CONFIG.speeds.includes(next as (typeof CONFIG.speeds)[number])) setSpeed(next)
  })
}

window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.repeat) return
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    event.target instanceof HTMLSelectElement
  ) {
    return
  }
  event.preventDefault()
  setPaused(!paused)
})

worldCanvas.addEventListener('pointerdown', (event) => {
  const rect = worldCanvas.getBoundingClientRect()
  const point = screenToWorld(camera, event.clientX - rect.left, event.clientY - rect.top)
  selectedId = pickCreature(world, point.x, point.y)
  deadId = null
})

function fit(canvas: HTMLCanvasElement): { cssWidth: number; cssHeight: number; dpr: number } {
  const rect = canvas.getBoundingClientRect()
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const cssWidth = Math.max(1, rect.width)
  const cssHeight = Math.max(1, rect.height)
  const width = Math.max(1, Math.floor(cssWidth * dpr))
  const height = Math.max(1, Math.floor(cssHeight * dpr))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  return { cssWidth, cssHeight, dpr }
}

function renderInspector(): void {
  if (selectedId !== null && !findCreature(world, selectedId)) {
    deadId = selectedId
    selectedId = null
  }

  const creature = selectedId === null ? undefined : findCreature(world, selectedId)
  inspectorEmpty.hidden = creature !== undefined || deadId !== null
  inspectorDead.hidden = deadId === null || creature !== undefined
  inspectorFields.hidden = creature === undefined

  if (deadId !== null && creature === undefined) {
    inspectorDead.textContent = `Creature ${deadId} died.`
  }
  if (!creature) return

  const cap = maxEnergy(creature.genome.size)
  field.id.textContent = String(creature.id)
  field.parent.textContent = creature.parentId === null ? '—' : String(creature.parentId)
  field.generation.textContent = String(creature.generation)
  field.age.textContent = `${creature.age.toFixed(1)}s`
  field.energy.textContent = `${creature.energy.toFixed(1)} / ${cap.toFixed(1)}`
  field.eaten.textContent = String(creature.foodEaten)
  field.offspring.textContent = String(creature.offspringCount)
  field.speed.textContent = creature.genome.speed.toFixed(1)
  field.vision.textContent = creature.genome.vision.toFixed(1)
  field.size.textContent = creature.genome.size.toFixed(2)
  meter.style.width = `${Math.max(0, Math.min(100, (creature.energy / cap) * 100))}%`
}

function renderStats(): void {
  const sample = summarize(world)
  stat.pop.textContent = String(sample.population)
  stat.food.textContent = String(sample.food)
  stat.gen.textContent = sample.avgGeneration.toFixed(2)
  stat.speed.textContent = sample.avgSpeed.toFixed(1)
  stat.vision.textContent = sample.avgVision.toFixed(1)
  stat.size.textContent = sample.avgSize.toFixed(2)
  clock.textContent = `${world.time.toFixed(1)}s · ${speed}×${paused ? ' · paused' : ''}`
}

function frame(now: number): void {
  const realDt = Math.min(0.05, (now - lastFrame) / 1000)
  lastFrame = now

  if (!paused) {
    accumulator += realDt * speed
    const dt = CONFIG.sim.fixedDt
    let ticks = 0
    while (accumulator >= dt && ticks < CONFIG.sim.maxTicksPerFrame) {
      stepWorld(world, dt)
      accumulator -= dt
      ticks += 1
    }
    if (ticks >= CONFIG.sim.maxTicksPerFrame) accumulator = 0
  }

  const worldSize = fit(worldCanvas)
  const chartSize = fit(chartCanvas)
  camera = cameraFor(world.width, world.height, worldSize.cssWidth, worldSize.cssHeight)
  renderWorld(worldContext, world, camera, selectedId, worldSize.dpr)
  renderCharts(chartContext, world.history, chartSize.cssWidth, chartSize.cssHeight, chartSize.dpr)
  renderInspector()
  renderStats()
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
