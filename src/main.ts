import './style.css'
import { CONFIG } from './config.ts'
import { createExperiment, type ExperimentLog } from './experiment/recorder.ts'
import { cameraFor, screenToWorld, type Camera } from './render/camera.ts'
import { createChartHistory, type ChartHistory } from './render/chart-history.ts'
import {
  nearestSample,
  parseManualRange,
  spanChoices,
  SCATTER_CHOICES,
  TRAITS,
  type HistorySpan,
  type ScatterKey,
  type TraitKey,
  type XMode,
  type YMode,
} from './render/dashboard-data.ts'
import { longevityLeaders, regionAt, renderDashboard, sampleTimeAt, type DashboardTab, type DashRegion } from './render/dashboard.ts'
import { averageLitter, offspringPer100Seconds, reproductiveLifespan } from './sim/lifetime.ts'
import { renderWorld } from './render/world-view.ts'
import {
  ENVIRONMENT_FIELDS,
  formatEnvironmentValue,
  readEnvironmentControl,
  updateEnvironment,
  v1Environment,
  type EnvironmentField,
  type EnvironmentGroup,
} from './sim/environment.ts'
import { maxEnergy } from './sim/genome.ts'
import { summarize } from './sim/stats.ts'
import type { Environment, ReproductionMode, World } from './sim/types.ts'
import { createWorld, findCreature, isReproductivelyEligible, pickCreature, stepWorld } from './sim/world.ts'
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

const envFields = required<HTMLElement>('#env-fields')
const constraintFields = required<HTMLElement>('#constraint-fields')
const matingFields = required<HTMLElement>('#mating-fields')
const envReset = required<HTMLButtonElement>('#env-reset')
const asexualButton = required<HTMLButtonElement>('#mode-asexual')
const sexualButton = required<HTMLButtonElement>('#mode-sexual')
const pauseButton = required<HTMLButtonElement>('#pause')
const restartButton = required<HTMLButtonElement>('#restart')
const downloadButton = required<HTMLButtonElement>('#download-run')
const exportFormat = required<HTMLSelectElement>('#export-format')
const clock = required<HTMLElement>('#clock')
const runMeta = required<HTMLElement>('#run-meta')
const speedButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-speed]'))

const inspectorEmpty = required<HTMLElement>('#inspector-empty')
const inspectorDead = required<HTMLElement>('#inspector-dead')
const inspectorFields = required<HTMLElement>('#inspector-fields')
const meter = required<HTMLElement>('#ins-meter')

const field = {
  id: required<HTMLElement>('#ins-id'),
  parent: required<HTMLElement>('#ins-parent'),
  parentB: required<HTMLElement>('#ins-parent-b'),
  generation: required<HTMLElement>('#ins-generation'),
  age: required<HTMLElement>('#ins-age'),
  energy: required<HTMLElement>('#ins-energy'),
  eaten: required<HTMLElement>('#ins-eaten'),
  offspring: required<HTMLElement>('#ins-offspring'),
  matings: required<HTMLElement>('#ins-matings'),
  speed: required<HTMLElement>('#ins-speed'),
  vision: required<HTMLElement>('#ins-vision'),
  mateDetection: required<HTMLElement>('#ins-mate-detection'),
  size: required<HTMLElement>('#ins-size'),
  investment: required<HTMLElement>('#ins-investment'),
  eligible: required<HTMLElement>('#ins-eligible'),
  behavior: required<HTMLElement>('#ins-behavior'),
  mateTarget: required<HTMLElement>('#ins-mate-target'),
}

const stat = {
  pop: required<HTMLElement>('#stat-pop'),
  food: required<HTMLElement>('#stat-food'),
  gen: required<HTMLElement>('#stat-gen'),
  speed: required<HTMLElement>('#stat-speed'),
  vision: required<HTMLElement>('#stat-vision'),
  size: required<HTMLElement>('#stat-size'),
}

let world: World
let experiment: ExperimentLog
let chartHistory: ChartHistory
let paused = false
let speed: number = CONFIG.speeds[0]
let selectedId: number | null = null
let deadId: number | null = null
let tab: DashboardTab = 'evolution'
let xMode: XMode = 'generation'
let span: HistorySpan = 'all'
let pinTime: number | null = null
let hoverTime: number | null = null
let distributionTrait: TraitKey = 'speed'
let scatterX: ScatterKey = 'speed'
let scatterY: ScatterKey = 'vision'
let fitnessTrait: TraitKey = 'speed'
let regions: DashRegion[] = []
let pointer: { x: number; y: number; clientX: number; clientY: number } | null = null
const yMode: Record<string, YMode> = {}
const yManual: Record<string, { min: string; max: string }> = {}
let accumulator = 0
let lastFrame = performance.now()
let camera: Camera = cameraFor(CONFIG.world.width, CONFIG.world.height, 1, 1)

interface EnvWidgets {
  field: EnvironmentField
  range: HTMLInputElement
  number: HTMLInputElement
  output: HTMLOutputElement
  root: HTMLElement
}

const envWidgets: EnvWidgets[] = []
let reproductionMode: ReproductionMode = 'asexual'

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

function mountEnvironmentControls(): void {
  mountEnvironmentGroup(envFields, 'food')
  mountEnvironmentGroup(constraintFields, 'constraint')
  mountEnvironmentGroup(matingFields, 'reproduction')
}

function mountEnvironmentGroup(container: HTMLElement, group: EnvironmentGroup): void {
  for (const field of ENVIRONMENT_FIELDS) {
    if (field.group !== group) continue
    const wrap = document.createElement('div')
    wrap.className = 'env-field'

    const label = document.createElement('div')
    label.className = 'env-label'
    const name = document.createElement('span')
    name.textContent = field.label
    const output = document.createElement('output')
    label.append(name, output)

    const inputs = document.createElement('div')
    inputs.className = 'env-inputs'
    const range = document.createElement('input')
    range.type = 'range'
    range.min = String(field.min)
    range.max = String(field.max)
    range.step = String(field.step)
    range.setAttribute('aria-label', field.label)
    const number = document.createElement('input')
    number.type = 'number'
    number.min = String(field.min)
    number.max = String(field.max)
    number.step = String(field.step)
    number.setAttribute('aria-label', `${field.label} value`)
    inputs.append(range, number)

    const reference = document.createElement('p')
    reference.className = 'env-ref'
    const unit = field.unit === '' ? '' : field.unit
    reference.textContent = `V1 default ${formatEnvironmentValue(field.key, field.defaultValue)}${unit}`
    wrap.append(label, inputs, reference)
    container.append(wrap)

    const widgets: EnvWidgets = { field, range, number, output, root: wrap }
    const text = formatEnvironmentValue(field.key, field.defaultValue)
    range.value = text
    number.value = text
    output.textContent = text

    range.addEventListener('input', () => {
      const value = readEnvironmentControl(field.key, Number(range.value))
      number.value = formatEnvironmentValue(field.key, value)
      commitEnvironment({ [field.key]: value })
    })
    number.addEventListener('input', () => {
      if (!Number.isFinite(Number(number.value))) return
      const value = readEnvironmentControl(field.key, Number(number.value))
      range.value = formatEnvironmentValue(field.key, value)
      commitEnvironment({ [field.key]: value })
    })
    number.addEventListener('change', () => {
      const typed = Number(number.value)
      if (field.key === 'populationCap' && typed > CONFIG.population.absoluteMax) {
        world.safetyEvents.push({
          time: world.time,
          avgGeneration: world.creatures.length === 0 ? 0 : world.generationSum / world.creatures.length,
          kind: 'population-ceiling',
          offspringPrevented: 0,
          detail: `requested population cap ${typed} above computational ceiling ${CONFIG.population.absoluteMax}`,
        })
      }
      const value = readEnvironmentControl(field.key, typed)
      const shown = formatEnvironmentValue(field.key, value)
      number.value = shown
      range.value = shown
      commitEnvironment({ [field.key]: value })
    })
    if (field.key === 'populationCap') {
      const presets = document.createElement('div')
      presets.className = 'presets'
      for (const preset of [250, 450, 750, 1000, 2000]) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = String(preset)
        button.addEventListener('click', () => {
          const shown = formatEnvironmentValue(field.key, preset)
          range.value = shown
          number.value = shown
          commitEnvironment({ populationCap: preset })
        })
        presets.append(button)
      }
      wrap.append(presets)
    }
    envWidgets.push(widgets)
  }
}

function selectedEnvironment(): Environment {
  const next = v1Environment()
  for (const widgets of envWidgets) {
    const key = widgets.field.key
    next[key] = readEnvironmentControl(key, Number(widgets.number.value))
  }
  next.reproductionMode = reproductionMode
  next.litterEnergyLimited = required<HTMLInputElement>('#litter-energy-limited').checked
  return next
}

function commitEnvironment(next: Partial<Environment>): void {
  const changes = updateEnvironment(world, next)
  for (const change of changes) experiment.recordEnvironmentChange(change)
  paintEnvironmentControls()
}

function paintEnvironmentControls(): void {
  for (const widgets of envWidgets) {
    const value = world.environment[widgets.field.key]
    const shown = formatEnvironmentValue(widgets.field.key, value)
    widgets.output.textContent = shown
    widgets.range.value = shown
    if (document.activeElement !== widgets.number) widgets.number.value = shown
    widgets.root.classList.toggle('is-changed', value !== widgets.field.defaultValue)
    const matingLocked = widgets.field.key === 'matingRadius' && world.environment.reproductionMode !== 'sexual'
    const litterLocked = widgets.field.key === 'litterCap' && world.environment.litterEnergyLimited
    widgets.range.disabled = matingLocked || litterLocked
    widgets.number.disabled = matingLocked || litterLocked
    widgets.root.classList.toggle('is-inactive', matingLocked || litterLocked)
  }
  const litterToggle = required<HTMLInputElement>('#litter-energy-limited')
  litterToggle.checked = world.environment.litterEnergyLimited
  reproductionMode = world.environment.reproductionMode
  asexualButton.setAttribute('aria-pressed', reproductionMode === 'asexual' ? 'true' : 'false')
  sexualButton.setAttribute('aria-pressed', reproductionMode === 'sexual' ? 'true' : 'false')
}

function resetEnvironmentToV1(): void {
  const defaults = v1Environment()
  for (const widgets of envWidgets) {
    const shown = formatEnvironmentValue(widgets.field.key, defaults[widgets.field.key])
    widgets.range.value = shown
    widgets.number.value = shown
  }
  commitEnvironment(defaults)
}

function beginRun(): void {
  const env = selectedEnvironment()
  world = createWorld(undefined, { environment: env })
  experiment = createExperiment(world)
  chartHistory = createChartHistory()
  chartHistory.record(world, 0, true)
  selectedId = null
  deadId = null
  pinTime = null
  hoverTime = null
  leadersKey = ''
  required<HTMLElement>('#life-card').hidden = true
  paintSnapshot()
  accumulator = 0
  lastFrame = performance.now()
  paintEnvironmentControls()
}

mountEnvironmentControls()
asexualButton.addEventListener('click', () => {
  reproductionMode = 'asexual'
  commitEnvironment({ reproductionMode: 'asexual' })
})
sexualButton.addEventListener('click', () => {
  reproductionMode = 'sexual'
  commitEnvironment({ reproductionMode: 'sexual' })
})
envReset.addEventListener('click', resetEnvironmentToV1)
pauseButton.addEventListener('click', () => setPaused(!paused))
restartButton.addEventListener('click', beginRun)
downloadButton.addEventListener('click', () => {
  const format: RunDataFormat = exportFormat.value === 'json' ? 'json' : exportFormat.value === 'lifetimes' ? 'lifetimes' : 'csv'
  downloadRunData(experiment, format)
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
  field.parentB.textContent = creature.parentBId === null ? '—' : String(creature.parentBId)
  field.generation.textContent = String(creature.generation)
  field.age.textContent = `${creature.age.toFixed(1)}s`
  field.energy.textContent = `${creature.energy.toFixed(1)} / ${cap.toFixed(1)}`
  field.eaten.textContent = String(creature.foodEaten)
  field.offspring.textContent = String(creature.offspringCount)
  field.matings.textContent = String(creature.matingCount)
  field.speed.textContent = creature.genome.speed.toFixed(1)
  field.vision.textContent = creature.genome.vision.toFixed(1)
  field.mateDetection.textContent = creature.genome.mateDetection.toFixed(1)
  field.size.textContent = creature.genome.size.toFixed(2)
  field.investment.textContent = creature.genome.offspringInvestment.toFixed(1)
  field.eligible.textContent = isReproductivelyEligible(creature) ? 'yes' : 'no'
  field.behavior.textContent = creature.behavior
  field.mateTarget.textContent = creature.mateTargetId === null ? '—' : String(creature.mateTargetId)
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
  const runId = experiment.metadata.runId
  const sampleCount = experiment.samples.length
  const snapshotCount = experiment.genomeSnapshots.length
  runMeta.textContent = `${runId.slice(0, 8)} · unseeded · ${sampleCount} ${sampleCount === 1 ? 'sample' : 'samples'}`
  runMeta.title = `Run ${runId}. Live runs use Math.random and have no seed. ${snapshotCount} genome ${snapshotCount === 1 ? 'snapshot' : 'snapshots'}.`
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
      experiment.observe(dt)
      chartHistory.record(world, dt)
      accumulator -= dt
      ticks += 1
    }
    if (ticks >= CONFIG.sim.maxTicksPerFrame) accumulator = 0
  }

  const worldSize = fit(worldCanvas)
  const chartSize = fit(chartCanvas)
  camera = cameraFor(world.width, world.height, worldSize.cssWidth, worldSize.cssHeight)
  renderWorld(worldContext, world, camera, selectedId, worldSize.dpr)
  regions = renderDashboard(chartContext, chartSize.cssWidth, chartSize.cssHeight, chartSize.dpr, {
    tab,
    samples: experiment.samples,
    events: experiment.environmentChanges,
    xMode,
    span,
    overlays: {
      mean: overlayInput('ov-mean'),
      median: overlayInput('ov-median'),
      minMax: overlayInput('ov-minmax'),
      sd1: overlayInput('ov-sd1'),
      sd2: overlayInput('ov-sd2'),
    },
    yMode,
    yManual,
    pinTime,
    hoverTime,
    creatures: world.creatures,
    lifetimes: experiment.lifetimes,
    distributionTrait,
    scatterX,
    scatterY,
    fitnessTrait,
    deaths: world.deaths,
    runRecords: {
      maxPopulation: world.maxPopulation,
      minNonzeroPopulation: world.minNonzeroPopulation,
      maxLitter: world.maxLitterEver,
      maxLivingAge: world.maxLivingAgeEver,
    },
  })
  renderLeaders()
  renderSafetyNote()
  syncTip()
  renderInspector()
  renderStats()
  requestAnimationFrame(frame)
}

const toolsSeries = required<HTMLElement>('#tools-series')
const toolsDist = required<HTMLElement>('#tools-dist')
const toolsScatter = required<HTMLElement>('#tools-scatter')
const toolsFitness = required<HTMLElement>('#tools-fitness')
const yControls = required<HTMLElement>('#y-controls')
const xModeSelect = required<HTMLSelectElement>('#x-mode')
const xSpanSelect = required<HTMLSelectElement>('#x-span')
const snapshot = required<HTMLElement>('#snapshot')
const snapshotBody = required<HTMLElement>('#snapshot-body')
const dashTip = required<HTMLElement>('#dash-tip')
const tabButtons: { id: DashboardTab; button: HTMLButtonElement }[] = [
  { id: 'evolution', button: required('#tab-evolution') },
  { id: 'ecology', button: required('#tab-ecology') },
  { id: 'distribution', button: required('#tab-distribution') },
  { id: 'relationships', button: required('#tab-relationships') },
  { id: 'fitness', button: required('#tab-fitness') },
  { id: 'demography', button: required('#tab-demography') },
]

function overlayInput(id: string): boolean {
  return required<HTMLInputElement>(`#${id}`).checked
}

function fillSpanOptions(): void {
  const choices = spanChoices(xMode)
  xSpanSelect.replaceChildren()
  for (const choice of choices) {
    const option = document.createElement('option')
    option.value = choice.id
    option.textContent = choice.label
    xSpanSelect.append(option)
  }
  xSpanSelect.value = span
}

function fillScatterSelect(select: HTMLSelectElement, value: ScatterKey): void {
  select.replaceChildren()
  for (const choice of SCATTER_CHOICES) {
    const option = document.createElement('option')
    option.value = choice.key
    option.textContent = choice.label
    select.append(option)
  }
  select.value = value
}

function fillTraitSelect(select: HTMLSelectElement, value: TraitKey): void {
  select.replaceChildren()
  for (const trait of TRAITS) {
    const option = document.createElement('option')
    option.value = trait.key
    option.textContent = trait.label
    select.append(option)
  }
  select.value = value
}

function renderYControls(): void {
  yControls.replaceChildren()
  if (tab !== 'evolution') return
  for (const trait of TRAITS) {
    const wrap = document.createElement('label')
    wrap.className = 'y-control'
    wrap.append(document.createTextNode(trait.label))
    const select = document.createElement('select')
    select.setAttribute('aria-label', `${trait.label} y scale`)
    for (const mode of ['all-time', 'auto', 'bounds', 'manual'] as const) {
      const option = document.createElement('option')
      option.value = mode
      option.textContent = mode
      select.append(option)
    }
    select.value = yMode[trait.key] ?? 'all-time'
    select.addEventListener('change', () => {
      yMode[trait.key] = select.value as YMode
      renderYControls()
    })
    wrap.append(select)
    if ((yMode[trait.key] ?? 'all-time') === 'manual') {
      const min = document.createElement('input')
      const max = document.createElement('input')
      min.type = 'number'
      max.type = 'number'
      min.placeholder = 'min'
      max.placeholder = 'max'
      min.setAttribute('aria-label', `${trait.label} y minimum`)
      max.setAttribute('aria-label', `${trait.label} y maximum`)
      const current = yManual[trait.key] ?? { min: '', max: '' }
      min.value = current.min
      max.value = current.max
      const refresh = () => {
        yManual[trait.key] = { min: min.value, max: max.value }
        const valid = parseManualRange(min.value, max.value) !== null
        min.classList.toggle('is-invalid', !valid)
        max.classList.toggle('is-invalid', !valid)
      }
      min.addEventListener('input', refresh)
      max.addEventListener('input', refresh)
      refresh()
      wrap.append(min, max)
    }
    yControls.append(wrap)
  }
}

function setTab(next: DashboardTab): void {
  tab = next
  for (const item of tabButtons) item.button.setAttribute('aria-selected', item.id === next ? 'true' : 'false')
  toolsSeries.hidden = next !== 'evolution' && next !== 'ecology'
  for (const id of ['ov-mean', 'ov-median', 'ov-minmax', 'ov-sd1', 'ov-sd2']) {
    const input = required<HTMLInputElement>(`#${id}`)
    const label = input.parentElement
    if (label) label.hidden = next !== 'evolution'
  }
  toolsDist.hidden = next !== 'distribution'
  toolsScatter.hidden = next !== 'relationships'
  toolsFitness.hidden = next !== 'fitness'
  renderYControls()
  renderLeaders()
}

function paintSnapshot(): void {
  const sample = pinTime === null ? undefined : experiment.samples.find((item) => item.time === pinTime)
  snapshot.hidden = sample === undefined
  if (!sample) {
    snapshotBody.replaceChildren()
    return
  }
  const rows: [string, string][] = [
    ['Generation', sample.avgGeneration.toFixed(2)],
    ['Time', `${sample.time.toFixed(1)}s`],
    ['Population', String(sample.population)],
    ['Food', String(sample.food)],
    ['Speed', sample.avgSpeed.toFixed(1)],
    ['Food vision', sample.avgVision.toFixed(1)],
    ['Size', sample.avgSize.toFixed(2)],
    ['Mate detection', sample.avgMateDetection.toFixed(1)],
    ['Investment', sample.avgOffspringInvestment.toFixed(1)],
    ['Food rate', `${sample.foodSpawnPerSecond.toFixed(1)}/s`],
    ['Food energy', sample.foodEnergy.toFixed(0)],
    ['Reproduction', sample.reproductionMode],
    ['Mating radius', sample.matingRadius.toFixed(0)],
    ['Speed window', `${sample.speedWindowMin.toFixed(0)}–${sample.speedWindowMax.toFixed(0)}`],
    ['Vision window', `${sample.visionWindowMin.toFixed(0)}–${sample.visionWindowMax.toFixed(0)}`],
    ['Mate window', `${sample.mateDetectionWindowMin.toFixed(0)}–${sample.mateDetectionWindowMax.toFixed(0)}`],
    ['Investment window', `${sample.offspringInvestmentWindowMin.toFixed(0)}–${sample.offspringInvestmentWindowMax.toFixed(0)}`],
    ['Births', sample.birthsSincePrevious.toFixed(0)],
    ['Deaths', sample.deathsSincePrevious.toFixed(0)],
    ['Matings', sample.matingsSincePrevious.toFixed(0)],
    ['Mean litter', sample.meanLitterSize.toFixed(2)],
    ['Mate-limited', `${sample.mateLimitedPercent.toFixed(1)}%`],
    ['Population cap', sample.populationCap.toFixed(0)],
    ['At cap', `${sample.fractionAtPopulationCap.toFixed(0)}%`],
    ['Litter', sample.litterEnergyLimited ? 'energy limited' : `max ${sample.litterCap.toFixed(0)}`],
    ['Size window', `${sample.sizeWindowMin.toFixed(1)}–${sample.sizeWindowMax.toFixed(1)}`],
    ['Oldest living', `${sample.maxLivingAge.toFixed(1)}s`],
    ['Since birth', sample.timeSinceLastBirth < 0 ? '—' : `${sample.timeSinceLastBirth.toFixed(1)}s`],
    ['Since mating', sample.timeSinceLastMating < 0 ? '—' : `${sample.timeSinceLastMating.toFixed(1)}s`],
  ]
  snapshotBody.replaceChildren()
  for (const [name, value] of rows) {
    const row = document.createElement('div')
    const term = document.createElement('dt')
    term.textContent = name
    const detail = document.createElement('dd')
    detail.textContent = value
    row.append(term, detail)
    snapshotBody.append(row)
  }
}

let leadersKey = ''

function renderSafetyNote(): void {
  const note = required<HTMLElement>('#safety-note')
  const sample = experiment.samples[experiment.samples.length - 1]
  const parts: string[] = []
  if (sample && sample.fractionAtPopulationCap > 0) {
    parts.push(`Population safety cap is blocking births (${sample.populationCap.toFixed(0)}).`)
  }
  if (sample && !sample.litterEnergyLimited && sample.litterCapHitPercent > 0) {
    parts.push(`Litter cap ${sample.litterCap.toFixed(0)} is trimming offspring.`)
  }
  if (world.safetyEvents.length > 0) {
    const latest = world.safetyEvents[world.safetyEvents.length - 1]
    parts.push(`Computational safeguard: ${latest.kind}.`)
  }
  if (world.creatures.length === 0) parts.push('Population extinct.')
  else if (world.environment.reproductionMode === 'sexual' && world.creatures.length === 1) {
    parts.push('Reproductively extinct: one creature remains in sexual mode.')
  }
  note.hidden = parts.length === 0
  note.textContent = parts.join(' ')
}

function renderLeaders(): void {
  const panel = required<HTMLElement>('#leaders')
  panel.hidden = tab !== 'demography'
  if (panel.hidden) return
  const leaders = longevityLeaders({
    lifetimes: experiment.lifetimes,
    creatures: world.creatures,
    deaths: world.deaths,
  })
  const signature = `${leaders.dead.map((life) => life.id).join(',')}|${leaders.living.map((creature) => creature.id).join(',')}`
  const body = required<HTMLElement>('#leaders-body')
  if (signature !== leadersKey) {
    leadersKey = signature
    body.replaceChildren(leaderTable('Longest completed', leaders.dead, false), leaderTable('Oldest living', leaders.living, true))
  }
  refreshLeaderRows(body, leaders.dead, false)
  refreshLeaderRows(body, leaders.living, true)
}

function refreshLeaderRows(
  body: HTMLElement,
  rows: readonly { id: number; offspringCount: number; matingCount: number; foodEaten: number; age?: number }[],
  living: boolean,
): void {
  const found = body.querySelectorAll(`tr[data-alive="${living ? 'true' : 'false'}"]`)
  for (let i = 0; i < rows.length && i < found.length; i++) {
    const row = rows[i]
    const cells = found[i].children
    if (cells.length < 7) continue
    const life = experiment.lifetimes[row.id - 1]
    const age = living ? (row.age ?? 0) : (life?.lifespan ?? 0)
    const rate = offspringPer100Seconds(row.offspringCount, age)
    cells[2].textContent = age.toFixed(1)
    cells[3].textContent = String(row.offspringCount)
    cells[4].textContent = rate === null ? '—' : rate.toFixed(2)
    cells[5].textContent = String(row.matingCount)
    cells[6].textContent = String(row.foodEaten)
  }
}

function leaderTable(title: string, rows: readonly { id: number; generation: number; age?: number; lifespan?: number | null; offspringCount: number; matingCount: number; foodEaten: number }[], living: boolean): HTMLElement {
  const wrap = document.createElement('section')
  const heading = document.createElement('h3')
  heading.textContent = title
  const table = document.createElement('table')
  table.innerHTML = '<thead><tr><th>ID</th><th>Gen</th><th>Age</th><th>Off</th><th>/100s</th><th>Mate</th><th>Food</th><th>Birth traits</th></tr></thead>'
  const tbody = document.createElement('tbody')
  for (const row of rows) {
    const life = experiment.lifetimes[row.id - 1]
    const age = living ? (row.age ?? 0) : (life?.lifespan ?? 0)
    const rate = offspringPer100Seconds(row.offspringCount, age)
    const traits = life
      ? `${life.birthSpeed.toFixed(0)}/${life.birthVision.toFixed(0)}/${life.birthSize.toFixed(1)}/${life.birthMateDetection.toFixed(0)}/${life.birthOffspringInvestment.toFixed(0)}`
      : '—'
    const tr = document.createElement('tr')
    tr.dataset.id = String(row.id)
    tr.dataset.alive = living ? 'true' : 'false'
    tr.tabIndex = 0
    tr.setAttribute('role', 'button')
    tr.setAttribute('aria-label', `${living ? 'Select living creature' : 'Open completed record'} ${row.id}`)
    tr.innerHTML = `<td>${row.id}</td><td>${row.generation}</td><td>${age.toFixed(1)}</td><td>${row.offspringCount}</td><td>${rate === null ? '—' : rate.toFixed(2)}</td><td>${row.matingCount}</td><td>${row.foodEaten}</td><td>${traits}</td>`
    tbody.append(tr)
  }
  table.append(tbody)
  wrap.append(heading, table)
  return wrap
}

function showLifeCard(id: number): void {
  const life = experiment.lifetimes[id - 1]
  const card = required<HTMLElement>('#life-card')
  const body = required<HTMLElement>('#life-card-body')
  if (!life || life.id !== id) {
    card.hidden = true
    return
  }
  const rate = life.alive ? offspringPer100Seconds(life.offspringCount, world.creatures.find((creature) => creature.id === id)?.age ?? 0) : offspringPer100Seconds(life.offspringCount, life.lifespan ?? 0)
  const rows: [string, string][] = [
    ['ID', String(life.id)],
    ['Alive', life.alive ? 'yes' : 'no'],
    ['Parents', `${life.parentId ?? '—'} / ${life.parentBId ?? '—'}`],
    ['Generation', String(life.generation)],
    ['Born', `${life.birthTime.toFixed(1)}s`],
    ['Lifespan', life.lifespan === null ? '—' : `${life.lifespan.toFixed(1)}s`],
    ['Offspring', String(life.offspringCount)],
    [life.alive ? 'Current rate /100s' : 'Offspring /100s', rate === null ? '—' : rate.toFixed(2)],
    ['Matings', String(life.matingCount)],
    ['Food', String(life.foodEaten)],
    ['Avg litter', averageLitter(life).toFixed(2)],
    ['Max litter', String(life.maxLitter)],
    ['Reproductive span', life.alive ? '—' : formatSpan(reproductiveLifespan(life))],
    ['Birth speed', life.birthSpeed.toFixed(1)],
    ['Birth vision', life.birthVision.toFixed(1)],
    ['Birth size', life.birthSize.toFixed(2)],
    ['Birth mate detection', life.birthMateDetection.toFixed(1)],
    ['Birth investment', life.birthOffspringInvestment.toFixed(1)],
  ]
  body.replaceChildren()
  for (const [name, value] of rows) {
    const row = document.createElement('div')
    const term = document.createElement('dt')
    term.textContent = name
    const detail = document.createElement('dd')
    detail.textContent = value
    row.append(term, detail)
    body.append(row)
  }
  card.hidden = false
}

function formatSpan(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}s`
}

function clearPin(): void {
  pinTime = null
  paintSnapshot()
}

function localPoint(event: MouseEvent): { x: number; y: number } {
  const rect = chartCanvas.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function syncTip(): void {
  if (!pointer) {
    dashTip.hidden = true
    return
  }
  const hit = regionAt(regions, pointer.x, pointer.y)
  if (!hit || hit.tooltip === '') {
    dashTip.hidden = true
    return
  }
  dashTip.hidden = false
  dashTip.textContent = hit.tooltip
  const bounds = chartCanvas.getBoundingClientRect()
  const left = Math.min(pointer.clientX + 14, bounds.right - 16)
  const top = Math.min(pointer.clientY + 14, bounds.bottom - 12)
  dashTip.style.left = `${left - bounds.left}px`
  dashTip.style.top = `${top - bounds.top}px`
}

function pointerTime(hit: DashRegion, localX: number): number | null {
  if (hit.xMin === null || hit.xMax === null) return hit.pinTime
  return sampleTimeAt(experiment.samples, xMode, span, hit.x, hit.w, hit.xMin, hit.xMax, localX)
}

fillSpanOptions()
fillTraitSelect(required('#dist-trait'), distributionTrait)
fillScatterSelect(required('#scatter-x'), scatterX)
fillScatterSelect(required('#scatter-y'), scatterY)
fillTraitSelect(required('#fit-trait'), fitnessTrait)
renderYControls()

for (const item of tabButtons) {
  item.button.addEventListener('click', () => setTab(item.id))
}
xModeSelect.addEventListener('change', () => {
  xMode = xModeSelect.value === 'time' ? 'time' : 'generation'
  fillSpanOptions()
})
xSpanSelect.addEventListener('change', () => {
  span = xSpanSelect.value as HistorySpan
})
required<HTMLButtonElement>('#clear-pin').addEventListener('click', clearPin)
required<HTMLButtonElement>('#snapshot-clear').addEventListener('click', clearPin)
required<HTMLButtonElement>('#life-card-close').addEventListener('click', () => {
  required<HTMLElement>('#life-card').hidden = true
})
required<HTMLElement>('#leaders-body').addEventListener('click', (event) => {
  const row = (event.target as HTMLElement).closest('tr')
  if (!(row instanceof HTMLTableRowElement) || !row.dataset.id) return
  const id = Number(row.dataset.id)
  if (row.dataset.alive === 'true') {
    selectedId = id
    required<HTMLElement>('#life-card').hidden = true
  } else {
    showLifeCard(id)
  }
})
required<HTMLSelectElement>('#dist-trait').addEventListener('change', (event) => {
  distributionTrait = (event.target as HTMLSelectElement).value as TraitKey
})
required<HTMLSelectElement>('#scatter-x').addEventListener('change', (event) => {
  scatterX = (event.target as HTMLSelectElement).value as ScatterKey
  if (scatterX === scatterY) {
    scatterY = SCATTER_CHOICES.find((choice) => choice.key !== scatterX)?.key ?? scatterY
    required<HTMLSelectElement>('#scatter-y').value = scatterY
  }
})
required<HTMLSelectElement>('#scatter-y').addEventListener('change', (event) => {
  scatterY = (event.target as HTMLSelectElement).value as ScatterKey
  if (scatterY === scatterX) {
    scatterX = SCATTER_CHOICES.find((choice) => choice.key !== scatterY)?.key ?? scatterX
    required<HTMLSelectElement>('#scatter-x').value = scatterX
  }
})
required<HTMLInputElement>('#litter-energy-limited').addEventListener('change', (event) => {
  commitEnvironment({ litterEnergyLimited: (event.target as HTMLInputElement).checked })
})
required<HTMLSelectElement>('#fit-trait').addEventListener('change', (event) => {
  fitnessTrait = (event.target as HTMLSelectElement).value as TraitKey
})

chartCanvas.addEventListener('mousemove', (event) => {
  const point = localPoint(event)
  pointer = { x: point.x, y: point.y, clientX: event.clientX, clientY: event.clientY }
  const hit = regionAt(regions, point.x, point.y)
  hoverTime = hit ? pointerTime(hit, point.x) : null
})
chartCanvas.addEventListener('mouseleave', () => {
  pointer = null
  hoverTime = null
  dashTip.hidden = true
})
chartCanvas.addEventListener('click', (event) => {
  const point = localPoint(event)
  const hit = regionAt(regions, point.x, point.y)
  if (!hit) return
  if (hit.selectId !== null) {
    selectedId = hit.selectId
    deadId = null
    return
  }
  const time = pointerTime(hit, point.x)
  if (time === null) return
  const sample = nearestSample(experiment.samples, 'time', time)
  pinTime = sample ? sample.time : null
  paintSnapshot()
})

beginRun()
requestAnimationFrame(frame)
