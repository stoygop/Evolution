import type { EnvironmentEvent, PopulationSample } from '../experiment/recorder.ts'
import { birthTrait, offspringPer100Seconds } from '../sim/lifetime.ts'
import type { Creature, LifetimeRecord } from '../sim/types.ts'
import {
  downsample,
  groupInterventions,
  histogram,
  nearestSample,
  offspringFractions,
  parameterLabel,
  scanExtrema,
  summarizeValues,
  traitByKey,
  traitDomain,
  traitReadout,
  traitScaleValues,
  TRAITS,
  visibleSamples,
  xValue,
  type HistorySpan,
  type ScatterKey,
  type TraitDef,
  type TraitKey,
  type XMode,
  type YMode,
} from './dashboard-data.ts'

export type DashboardTab = 'evolution' | 'ecology' | 'distribution' | 'relationships' | 'fitness' | 'demography'

export interface DashboardView {
  tab: DashboardTab
  samples: readonly PopulationSample[]
  events: readonly EnvironmentEvent[]
  xMode: XMode
  span: HistorySpan
  overlays: { mean: boolean; median: boolean; minMax: boolean; sd1: boolean; sd2: boolean }
  yMode: Readonly<Record<string, YMode | undefined>>
  yManual: Readonly<Record<string, { min: string; max: string } | undefined>>
  pinTime: number | null
  hoverTime: number | null
  creatures: readonly Creature[]
  lifetimes: readonly LifetimeRecord[]
  distributionTrait: TraitKey
  scatterX: ScatterKey
  scatterY: ScatterKey
  fitnessTrait: TraitKey
  /** Completed-lifetime cache key. Living ages are read from the current creatures. */
  deaths: number
  runRecords: {
    maxPopulation: number
    minNonzeroPopulation: number
    maxLitter: number
    maxLivingAge: number
  }
}

export interface DashRegion {
  x: number
  y: number
  w: number
  h: number
  tooltip: string
  pinTime: number | null
  selectId: number | null
  /** Set on a time-series plot so the cursor can snap to a sample. */
  xMin: number | null
  xMax: number | null
}

interface Scale {
  x: number
  y: number
  w: number
  h: number
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

const MAX_POINTS = 360
const FONT = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

export function renderDashboard(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  view: DashboardView,
): DashRegion[] {
  const width = Math.max(cssWidth, 1)
  const height = Math.max(cssHeight, 1)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.font = FONT
  ctx.textBaseline = 'top'
  const regions: DashRegion[] = []
  if (view.tab === 'evolution') drawEvolution(ctx, width, height, view, regions)
  else if (view.tab === 'ecology') drawEcology(ctx, width, height, view, regions)
  else if (view.tab === 'distribution') drawDistribution(ctx, width, height, view)
  else if (view.tab === 'relationships') drawRelationships(ctx, width, height, view, regions)
  else if (view.tab === 'fitness') drawFitness(ctx, width, height, view, regions)
  else drawDemography(ctx, width, height, view, regions)
  return regions
}

function drawEvolution(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  view: DashboardView,
  regions: DashRegion[],
): void {
  const columns = width >= 980 ? 3 : 2
  const rects = grid(width, height, TRAITS.length, columns)
  const visible = visibleSamples(view.samples, view.xMode, view.span)
  const bounds = view.samples[view.samples.length - 1]
  for (let i = 0; i < TRAITS.length; i++) {
    const trait = TRAITS[i]
    const mode = view.yMode[trait.key] ?? 'all-time'
    const manual = view.yManual[trait.key] ?? { min: '', max: '' }
    const domainSamples = mode === 'auto' ? visible : view.samples
    const domain = traitDomain(trait, domainSamples, mode, manual, bounds)
    drawTraitChart(ctx, rects[i], trait, visible, view, domain, mode, regions)
  }
}

function drawEcology(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  view: DashboardView,
  regions: DashRegion[],
): void {
  const rects = grid(width, height, 4, width >= 980 ? 2 : 1)
  const visible = visibleSamples(view.samples, view.xMode, view.span)
  const drawn = downsample(visible, MAX_POINTS, (sample) => [
    sample.population,
    sample.food,
    sample.birthsSincePrevious,
    sample.deathsSincePrevious,
    sample.matingsSincePrevious,
    sample.meanLitterSize,
    sample.mateLimitedPercent,
  ])
  drawDualLineChart(ctx, rects[0], 'Population and food', visible, drawn, view, regions, [
    { label: 'Population', color: '#efe7d6', read: (s) => s.population, axis: 'left' },
    { label: 'Food', color: '#d6f5a2', read: (s) => s.food, axis: 'right' },
  ])
  drawBarChart(ctx, rects[1], 'Births and deaths', visible, drawn, view, regions, [
    { label: 'Births', color: '#8fce73', read: (s) => s.birthsSincePrevious },
    { label: 'Deaths', color: '#e07a4a', read: (s) => s.deathsSincePrevious },
  ])
  drawDualLineChart(ctx, rects[2], 'Matings and litter', visible, drawn, view, regions, [
    { label: 'Matings', color: '#c4a0e8', read: (s) => s.matingsSincePrevious, axis: 'left' },
    { label: 'Mean litter', color: '#e2c15a', read: (s) => s.meanLitterSize, axis: 'right' },
  ])
  drawLineChart(ctx, rects[3], 'Mate-limited time', '%', visible, drawn, view, regions, {
    label: 'Mate-limited',
    color: '#8ec8e8',
    read: (s) => s.mateLimitedPercent,
    domain: { min: 0, max: 100 },
  })
}

function drawTraitChart(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  trait: TraitDef,
  visible: PopulationSample[],
  view: DashboardView,
  domain: { min: number; max: number },
  mode: YMode,
  regions: DashRegion[],
): void {
  const extrema = scanExtrema(view.samples, trait.min, trait.max)
  const header = extrema
    ? `${trait.label}   low ${extrema.min.toFixed(trait.digits)}   high ${extrema.max.toFixed(trait.digits)}`
    : trait.label
  const scale = openPlot(ctx, rect, header, domain, xDomain(visible, view.xMode))
  if (!scale || visible.length === 0) return
  regions.push(plotRegion(scale, visible, view, (sample) => traitTooltip(trait, sample, view.overlays)))
  const drawn = downsample(visible, MAX_POINTS, traitReadout(trait))
  clipPlot(ctx, scale)
  if (view.overlays.sd2) fillBand(ctx, scale, drawn, view.xMode, (s) => trait.mean(s) - 2 * trait.stdDev(s), (s) => trait.mean(s) + 2 * trait.stdDev(s), trait.color, 0.1)
  if (view.overlays.sd1) fillBand(ctx, scale, drawn, view.xMode, (s) => trait.mean(s) - trait.stdDev(s), (s) => trait.mean(s) + trait.stdDev(s), trait.color, 0.22)
  if (view.overlays.minMax) {
    strokeSeries(ctx, scale, drawn, view.xMode, trait.min, trait.color, 1, [3, 3])
    strokeSeries(ctx, scale, drawn, view.xMode, trait.max, trait.color, 1, [3, 3])
  }
  if (view.overlays.median) strokeSeries(ctx, scale, drawn, view.xMode, trait.median, '#efe7d6', 1.2, [5, 4])
  if (view.overlays.mean) strokeSeries(ctx, scale, drawn, view.xMode, trait.mean, trait.color, 1.8, [])
  drawMarkers(ctx, scale, view, regions)
  drawCursors(ctx, scale, visible, view)
  if (extrema) markExtrema(ctx, scale, visible, view.xMode, extrema, trait, regions)
  ctx.restore()
  axisLabels(ctx, scale, trait.digits)
  modeLabel(ctx, rect, mode)
}

function traitTooltip(trait: TraitDef, sample: PopulationSample, overlays: DashboardView['overlays']): string {
  const lines = [`${trait.label}`, when(sample)]
  if (overlays.mean) lines.push(`mean ${trait.mean(sample).toFixed(trait.digits)}`)
  if (overlays.median) lines.push(`median ${trait.median(sample).toFixed(trait.digits)}`)
  if (overlays.minMax) lines.push(`min ${trait.min(sample).toFixed(trait.digits)}   max ${trait.max(sample).toFixed(trait.digits)}`)
  if (overlays.sd1 || overlays.sd2) lines.push(`sd ${trait.stdDev(sample).toFixed(trait.digits)}`)
  const band = traitScaleValues(trait, sample)
  if (overlays.sd1) lines.push(`±1 sd ${band[4].toFixed(trait.digits)} … ${band[5].toFixed(trait.digits)}`)
  if (overlays.sd2) lines.push(`±2 sd ${band[6].toFixed(trait.digits)} … ${band[7].toFixed(trait.digits)}`)
  return lines.join('\n')
}

interface LineSpec {
  label: string
  color: string
  read: (sample: PopulationSample) => number
  axis: 'left' | 'right'
}

function drawDualLineChart(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  title: string,
  visible: PopulationSample[],
  drawn: PopulationSample[],
  view: DashboardView,
  regions: DashRegion[],
  series: LineSpec[],
): void {
  const left = series.filter((item) => item.axis === 'left')
  const right = series.filter((item) => item.axis === 'right')
  const leftDomain = domainFrom(visible, left)
  const rightDomain = domainFrom(visible, right)
  const scale = openPlot(ctx, rect, title, leftDomain, xDomain(visible, view.xMode))
  if (!scale || visible.length === 0) return
  regions.push(plotRegion(scale, visible, view, (sample) => series.map((item) => `${item.label} ${formatSeries(item, sample)}`).join('\n') + `\n${when(sample)}`))
  clipPlot(ctx, scale)
  for (const item of left) strokeSeries(ctx, scale, drawn, view.xMode, item.read, item.color, 1.7, [])
  const rightScale = { ...scale, yMin: rightDomain.min, yMax: rightDomain.max }
  for (const item of right) strokeSeries(ctx, rightScale, drawn, view.xMode, item.read, item.color, 1.7, [])
  drawMarkers(ctx, scale, view, regions)
  drawCursors(ctx, scale, visible, view)
  ctx.restore()
  axisLabels(ctx, scale, 0)
  rightAxisLabels(ctx, rightScale, 1)
  legend(ctx, rect, series.map((item) => ({ label: item.label, color: item.color })))
}

function drawLineChart(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  title: string,
  unit: string,
  visible: PopulationSample[],
  drawn: PopulationSample[],
  view: DashboardView,
  regions: DashRegion[],
  series: { label: string; color: string; read: (sample: PopulationSample) => number; domain: { min: number; max: number } },
): void {
  const scale = openPlot(ctx, rect, title, series.domain, xDomain(visible, view.xMode))
  if (!scale || visible.length === 0) return
  regions.push(plotRegion(scale, visible, view, (sample) => `${series.label} ${series.read(sample).toFixed(1)}${unit}\n${when(sample)}`))
  clipPlot(ctx, scale)
  strokeSeries(ctx, scale, drawn, view.xMode, series.read, series.color, 1.7, [])
  drawMarkers(ctx, scale, view, regions)
  drawCursors(ctx, scale, visible, view)
  ctx.restore()
  axisLabels(ctx, scale, 0)
}

function drawBarChart(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  title: string,
  visible: PopulationSample[],
  drawn: PopulationSample[],
  view: DashboardView,
  regions: DashRegion[],
  series: { label: string; color: string; read: (sample: PopulationSample) => number }[],
): void {
  const domain = domainFrom(visible, series.map((item) => ({ ...item, axis: 'left' as const })))
  const scale = openPlot(ctx, rect, title, { min: 0, max: Math.max(domain.max, 1) }, xDomain(visible, view.xMode))
  if (!scale || visible.length === 0) return
  regions.push(plotRegion(scale, visible, view, (sample) => series.map((item) => `${item.label} ${item.read(sample).toFixed(0)}`).join('\n') + `\n${when(sample)}`))
  clipPlot(ctx, scale)
  const span = Math.max(1e-6, scale.xMax - scale.xMin)
  const slot = drawn.length < 2 ? 8 : Math.max(2, ((scale.w / drawn.length) * 0.7) / series.length)
  for (let i = 0; i < drawn.length; i++) {
    const sample = drawn[i]
    const cx = scale.x + ((xValue(sample, view.xMode) - scale.xMin) / span) * scale.w
    for (let s = 0; s < series.length; s++) {
      const value = series[s].read(sample)
      const top = py(scale, value)
      const bottom = py(scale, 0)
      const offset = (s - (series.length - 1) / 2) * slot
      ctx.fillStyle = series[s].color
      ctx.fillRect(cx + offset - slot / 2, top, Math.max(1, slot - 1), Math.max(0, bottom - top))
    }
  }
  drawMarkers(ctx, scale, view, regions)
  drawCursors(ctx, scale, visible, view)
  ctx.restore()
  axisLabels(ctx, scale, 0)
  legend(ctx, rect, series)
}

function drawDistribution(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  view: DashboardView,
): void {
  const trait = traitByKey(view.distributionTrait)
  const values = view.creatures.map((creature) => creature.genome[trait.key])
  const summary = summarizeValues(values)
  const bins = histogram(values)
  const rect = { x: 8, y: 8, w: width - 16, h: height - 16 }
  const title = `${trait.label}   n ${summary.n}   mean ${summary.mean.toFixed(trait.digits)}   median ${summary.median.toFixed(trait.digits)}   sd ${summary.stdDev.toFixed(trait.digits)}   min ${summary.min.toFixed(trait.digits)}   max ${summary.max.toFixed(trait.digits)}`
  drawHistogram(ctx, rect, title, bins, trait.color, trait.digits)
}

function drawRelationships(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  view: DashboardView,
  regions: DashRegion[],
): void {
  const rect = { x: 8, y: 8, w: width - 16, h: height - 16 }
  const xLabel = scatterLabel(view.scatterX)
  const yLabel = scatterLabel(view.scatterY)
  const lifetimeAxis = isLifetimeKey(view.scatterX) || isLifetimeKey(view.scatterY)
  const points: ScatterPoint[] = []
  if (!lifetimeAxis) {
    const xTrait = traitByKey(view.scatterX as TraitKey)
    const yTrait = traitByKey(view.scatterY as TraitKey)
    for (let i = 0; i < view.creatures.length; i++) {
      const creature = view.creatures[i]
      points.push({ id: creature.id, x: creature.genome[xTrait.key], y: creature.genome[yTrait.key] })
    }
  } else {
    const completedOnly = view.scatterX === 'lifespan' || view.scatterY === 'lifespan'
    for (let i = 0; i < view.lifetimes.length; i++) {
      const life = view.lifetimes[i]
      if (!life) continue
      if (completedOnly && life.alive) continue
      const x = scatterRecordValue(life, view.scatterX)
      const y = scatterRecordValue(life, view.scatterY)
      if (x === null || y === null) continue
      points.push({
        id: life.alive ? life.id : null,
        x,
        y,
        color: life.alive ? '#efe7d6' : 'rgba(224, 122, 74, 0.85)',
        tooltip: lifeTooltip(life),
      })
    }
  }
  drawScatter(
    ctx,
    rect,
    `${xLabel} × ${yLabel}   n ${points.length}`,
    points,
    { label: xLabel, digits: view.scatterX === 'lifetimeOffspring' ? 0 : 1 },
    { label: yLabel, digits: view.scatterY === 'lifetimeOffspring' ? 0 : 1 },
    '#efe7d6',
    regions,
    !lifetimeAxis,
    view.scatterY === 'lifetimeOffspring' ? 0 : undefined,
  )
}

function drawFitness(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  view: DashboardView,
  regions: DashRegion[],
): void {
  const gap = 10
  const left = { x: 8, y: 8, w: (width - 16 - gap) * 0.42, h: height - 16 }
  const right = { x: left.x + left.w + gap, y: 8, w: width - 16 - left.w - gap, h: height - 16 }
  const completed = completedLives(view.lifetimes)
  const deadCounts = completed.map((life) => life.offspringCount)
  const liveCounts = view.creatures.map((creature) => creature.offspringCount)
  const deadSummary = summarizeValues(deadCounts)
  const liveSummary = summarizeValues(liveCounts)
  const fractions = offspringFractions(deadCounts)
  const maxCount = Math.max(0, deadSummary.max, liveSummary.max)
  const bins = offspringBins(deadCounts, liveCounts, maxCount)
  const fractionText = deadSummary.n === 0
    ? 'No completed lives yet'
    : `completed n ${deadSummary.n}   mean ${deadSummary.mean.toFixed(2)}   median ${deadSummary.median.toFixed(2)}   max ${deadSummary.max.toFixed(0)}   0 ${(fractions.zero * 100).toFixed(0)}%   1 ${(fractions.one * 100).toFixed(0)}%   2 ${(fractions.two * 100).toFixed(0)}%   3+ ${(fractions.more * 100).toFixed(0)}%`
  const liveText = `living n ${liveSummary.n}   mean ${liveSummary.mean.toFixed(2)}   median ${liveSummary.median.toFixed(2)}   max ${liveSummary.max.toFixed(0)}`
  drawGroupedHistogram(ctx, left, `Lifetime offspring   ${fractionText}`, liveText, bins)
  const trait = traitByKey(view.fitnessTrait)
  const points: ScatterPoint[] = []
  for (let i = 0; i < completed.length; i++) {
    const life = completed[i]
    points.push({
      id: null,
      x: birthTrait(life, trait.key),
      y: life.offspringCount,
      color: 'rgba(224, 122, 74, 0.85)',
      tooltip: deadTooltip(life),
    })
  }
  for (let i = 0; i < view.creatures.length; i++) {
    const creature = view.creatures[i]
    points.push({
      id: creature.id,
      x: creatureBirthTrait(view.lifetimes, creature, trait.key),
      y: creature.offspringCount,
      color: '#efe7d6',
      tooltip: livingTooltip(creature),
    })
  }
  drawScatter(
    ctx,
    right,
    `Offspring × ${trait.label}   filled living   open completed`,
    points,
    { ...trait, label: trait.label },
    { label: 'Offspring', digits: 0 },
    '#efe7d6',
    regions,
    false,
    0,
  )
}

function deadTooltip(life: LifetimeRecord): string {
  return lifeTooltip(life)
}

function lifeTooltip(life: LifetimeRecord): string {
  const per = life.matingCount > 0 ? (life.offspringCount / life.matingCount).toFixed(2) : '—'
  const when = life.alive ? 'alive' : `lifespan ${(life.lifespan ?? 0).toFixed(1)}s`
  return [
    `${life.alive ? 'Living' : 'Completed'} #${life.id}`,
    `offspring ${life.offspringCount}   matings ${life.matingCount}   ${per} / mating`,
    `${when}   gen ${life.generation}`,
    `parents ${life.parentId ?? '—'} / ${life.parentBId ?? '—'}`,
    `birth speed ${life.birthSpeed.toFixed(1)}   vision ${life.birthVision.toFixed(1)}   size ${life.birthSize.toFixed(2)}`,
    `mate detection ${life.birthMateDetection.toFixed(1)}   investment ${life.birthOffspringInvestment.toFixed(1)}`,
  ].join('\n')
}

function livingTooltip(creature: Creature): string {
  const per = creature.matingCount > 0 ? (creature.offspringCount / creature.matingCount).toFixed(2) : '—'
  return [
    `Living #${creature.id}`,
    `offspring ${creature.offspringCount}   matings ${creature.matingCount}   ${per} / mating`,
    `age ${creature.age.toFixed(1)}s   gen ${creature.generation}`,
    `parents ${creature.parentId ?? '—'} / ${creature.parentBId ?? '—'}`,
  ].join('\n')
}

interface Rect { x: number; y: number; w: number; h: number }

function grid(width: number, height: number, count: number, columns: number): Rect[] {
  const gap = 8
  const rows = Math.ceil(count / columns)
  const w = (width - gap * (columns + 1)) / columns
  const h = (height - gap * (rows + 1)) / rows
  const rects: Rect[] = []
  for (let i = 0; i < count; i++) {
    const col = i % columns
    const row = Math.floor(i / columns)
    rects.push({ x: gap + col * (w + gap), y: gap + row * (h + gap), w, h })
  }
  return rects
}

function openPlot(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  title: string,
  yDomain: { min: number; max: number },
  xDomainValues: { min: number; max: number },
): Scale | null {
  ctx.fillStyle = '#12170f'
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
  ctx.fillStyle = '#b7b09f'
  ctx.font = FONT
  ctx.textAlign = 'left'
  ctx.fillText(trim(ctx, title, rect.w - 16), rect.x + 8, rect.y + 6)
  const scale: Scale = {
    x: rect.x + 42,
    y: rect.y + 28,
    w: Math.max(1, rect.w - 54),
    h: Math.max(1, rect.h - 42),
    xMin: xDomainValues.min,
    xMax: xDomainValues.max,
    yMin: yDomain.min,
    yMax: yDomain.max,
  }
  ctx.strokeStyle = 'rgba(239, 231, 214, 0.08)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let g = 0; g <= 2; g++) {
    const gy = scale.y + (scale.h * g) / 2
    ctx.moveTo(scale.x, gy)
    ctx.lineTo(scale.x + scale.w, gy)
  }
  ctx.stroke()
  if (!(scale.w > 2) || !(scale.h > 2)) return null
  return scale
}

function clipPlot(ctx: CanvasRenderingContext2D, scale: Scale): void {
  ctx.save()
  ctx.beginPath()
  ctx.rect(scale.x, scale.y, scale.w, scale.h)
  ctx.clip()
}

function xDomain(samples: readonly PopulationSample[], mode: XMode): { min: number; max: number } {
  if (samples.length === 0) return { min: 0, max: 1 }
  const first = xValue(samples[0], mode)
  const last = xValue(samples[samples.length - 1], mode)
  if (last - first < 1e-6) return { min: first - 0.5, max: last + 0.5 }
  return { min: first, max: last }
}

function px(scale: Scale, value: number): number {
  return scale.x + ((value - scale.xMin) / (scale.xMax - scale.xMin || 1)) * scale.w
}

function py(scale: Scale, value: number): number {
  return scale.y + scale.h - ((value - scale.yMin) / (scale.yMax - scale.yMin || 1)) * scale.h
}

function strokeSeries(
  ctx: CanvasRenderingContext2D,
  scale: Scale,
  samples: readonly PopulationSample[],
  mode: XMode,
  read: (sample: PopulationSample) => number,
  color: string,
  width: number,
  dash: number[],
): void {
  if (samples.length === 0) return
  ctx.beginPath()
  for (let i = 0; i < samples.length; i++) {
    const x = px(scale, xValue(samples[i], mode))
    const y = py(scale, read(samples[i]))
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.setLineDash(dash)
  ctx.stroke()
  ctx.setLineDash([])
}

function fillBand(
  ctx: CanvasRenderingContext2D,
  scale: Scale,
  samples: readonly PopulationSample[],
  mode: XMode,
  low: (sample: PopulationSample) => number,
  high: (sample: PopulationSample) => number,
  color: string,
  alpha: number,
): void {
  if (samples.length === 0) return
  ctx.beginPath()
  for (let i = 0; i < samples.length; i++) {
    const x = px(scale, xValue(samples[i], mode))
    const y = py(scale, high(samples[i]))
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  for (let i = samples.length - 1; i >= 0; i--) {
    ctx.lineTo(px(scale, xValue(samples[i], mode)), py(scale, low(samples[i])))
  }
  ctx.closePath()
  ctx.fillStyle = hexAlpha(color, alpha)
  ctx.fill()
}

function drawMarkers(ctx: CanvasRenderingContext2D, scale: Scale, view: DashboardView, regions: DashRegion[]): void {
  const groups = groupInterventions(view.events)
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]
    const xData = view.xMode === 'generation' ? group.avgGeneration : group.time
    if (xData < scale.xMin || xData > scale.xMax) continue
    const x = px(scale, xData)
    ctx.strokeStyle = 'rgba(239, 231, 214, 0.45)'
    ctx.lineWidth = 1
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    ctx.moveTo(x, scale.y)
    ctx.lineTo(x, scale.y + scale.h)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#efe7d6'
    ctx.beginPath()
    ctx.moveTo(x, scale.y)
    ctx.lineTo(x - 4, scale.y + 7)
    ctx.lineTo(x + 4, scale.y + 7)
    ctx.closePath()
    ctx.fill()
    const lines = [`gen ${group.avgGeneration.toFixed(2)}   ${group.time.toFixed(1)}s`]
    for (const event of group.events) {
      const clamped = event.creaturesAffected > 0 ? `   ${event.creaturesAffected} clamped` : ''
      lines.push(`${parameterLabel(event.parameter)}   ${event.oldValue} → ${event.newValue}${clamped}`)
    }
    regions.push({
      x: x - 6,
      y: scale.y,
      w: 12,
      h: scale.h,
      tooltip: lines.join('\n'),
      pinTime: group.time,
      selectId: null,
      xMin: null,
      xMax: null,
    })
  }
}

function drawCursors(
  ctx: CanvasRenderingContext2D,
  scale: Scale,
  visible: readonly PopulationSample[],
  view: DashboardView,
): void {
  drawCursor(ctx, scale, visible, view, view.hoverTime, 'rgba(239, 231, 214, 0.35)')
  drawCursor(ctx, scale, visible, view, view.pinTime, '#efe7d6')
}

function drawCursor(
  ctx: CanvasRenderingContext2D,
  scale: Scale,
  visible: readonly PopulationSample[],
  view: DashboardView,
  time: number | null,
  color: string,
): void {
  if (time === null) return
  const sample = visible.find((item) => item.time === time) ?? nearestSample(visible, 'time', time)
  if (!sample) return
  const xData = xValue(sample, view.xMode)
  if (xData < scale.xMin || xData > scale.xMax) return
  const x = px(scale, xData)
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, scale.y)
  ctx.lineTo(x, scale.y + scale.h)
  ctx.stroke()
}

function markExtrema(
  ctx: CanvasRenderingContext2D,
  scale: Scale,
  visible: readonly PopulationSample[],
  mode: XMode,
  extrema: { min: number; minTime: number; minGeneration: number; max: number; maxTime: number; maxGeneration: number },
  trait: TraitDef,
  regions: DashRegion[],
): void {
  markOne(ctx, scale, visible, mode, extrema.minTime, extrema.min, trait.color)
  markOne(ctx, scale, visible, mode, extrema.maxTime, extrema.max, trait.color)
  regions.push({
    x: scale.x,
    y: scale.y - 22,
    w: scale.w,
    h: 16,
    tooltip: [
      `${trait.label} all-time low ${extrema.min.toFixed(trait.digits)}`,
      `gen ${extrema.minGeneration.toFixed(2)}   ${extrema.minTime.toFixed(1)}s`,
      `${trait.label} all-time high ${extrema.max.toFixed(trait.digits)}`,
      `gen ${extrema.maxGeneration.toFixed(2)}   ${extrema.maxTime.toFixed(1)}s`,
    ].join('\n'),
    pinTime: null,
    selectId: null,
    xMin: null,
    xMax: null,
  })
}

function markOne(ctx: CanvasRenderingContext2D, scale: Scale, visible: readonly PopulationSample[], mode: XMode, time: number, value: number, color: string): void {
  const sample = visible.find((item) => item.time === time)
  if (!sample) return
  const x = px(scale, xValue(sample, mode))
  const y = py(scale, value)
  ctx.fillStyle = color
  ctx.fillRect(x - 2.5, y - 2.5, 5, 5)
}

function axisLabels(ctx: CanvasRenderingContext2D, scale: Scale, digits: number): void {
  ctx.fillStyle = '#8d8778'
  ctx.font = FONT
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillText(scale.yMax.toFixed(digits), scale.x - 4, scale.y + 4)
  ctx.fillText(scale.yMin.toFixed(digits), scale.x - 4, scale.y + scale.h - 4)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
}

function rightAxisLabels(ctx: CanvasRenderingContext2D, scale: Scale, digits: number): void {
  ctx.fillStyle = '#8d8778'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(scale.yMax.toFixed(digits), scale.x + scale.w + 4, scale.y + 4)
  ctx.fillText(scale.yMin.toFixed(digits), scale.x + scale.w + 4, scale.y + scale.h - 4)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
}

function modeLabel(ctx: CanvasRenderingContext2D, rect: Rect, mode: YMode): void {
  ctx.fillStyle = '#8d8778'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillText(mode, rect.x + rect.w - 8, rect.y + 6)
  ctx.textAlign = 'left'
}

function legend(ctx: CanvasRenderingContext2D, rect: Rect, items: { label: string; color: string }[]): void {
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  let cursor = rect.x + rect.w - 8
  for (let i = items.length - 1; i >= 0; i--) {
    const width = ctx.measureText(items[i].label).width
    cursor -= width
    ctx.fillStyle = items[i].color
    ctx.fillText(items[i].label, cursor, rect.y + 6)
    cursor -= 10
  }
  ctx.textAlign = 'left'
}

function plotRegion(
  scale: Scale,
  visible: readonly PopulationSample[],
  view: DashboardView,
  describe: (sample: PopulationSample) => string,
): DashRegion {
  const sample = view.hoverTime === null ? null : visible.find((item) => item.time === view.hoverTime) ?? nearestSample(visible, 'time', view.hoverTime)
  return {
    x: scale.x,
    y: scale.y,
    w: scale.w,
    h: scale.h,
    tooltip: sample ? describe(sample) : '',
    pinTime: sample ? sample.time : null,
    selectId: null,
    xMin: scale.xMin,
    xMax: scale.xMax,
  }
}

function formatSeries(item: LineSpec, sample: PopulationSample): string {
  const digits = item.label === 'Mean litter' ? 2 : item.label === 'Mate-limited' ? 1 : 0
  return item.read(sample).toFixed(digits)
}

function domainFrom(samples: readonly PopulationSample[], series: LineSpec[]): { min: number; max: number } {
  const values: number[] = []
  for (let i = 0; i < samples.length; i++) {
    for (let s = 0; s < series.length; s++) values.push(series[s].read(samples[i]))
  }
  if (values.length === 0) return { min: 0, max: 1 }
  let min = values[0]
  let max = values[0]
  for (let i = 1; i < values.length; i++) {
    if (values[i] < min) min = values[i]
    if (values[i] > max) max = values[i]
  }
  if (max - min < 1e-6) return { min: min - 0.5, max: max + 0.5 }
  const pad = (max - min) * 0.08
  return { min: min - pad, max: max + pad }
}

interface ScatterPoint {
  id: number | null
  x: number
  y: number
  color?: string
  tooltip?: string
}

function drawScatter(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  title: string,
  points: readonly ScatterPoint[],
  xTrait: { label: string; digits: number },
  yTrait: { label: string; digits: number },
  color: string,
  regions: DashRegion[],
  filledOnly: boolean,
  yFloor?: number,
): void {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const xSummary = summarizeValues(xs)
  const ySummary = summarizeValues(ys)
  const yDomain = padDomain(ySummary.min, ySummary.max)
  if (yFloor !== undefined) yDomain.min = Math.max(yFloor, yDomain.min)
  const scale = openPlot(
    ctx,
    rect,
    title,
    yDomain,
    padDomain(xSummary.min, xSummary.max),
  )
  if (!scale) return
  clipPlot(ctx, scale)
  for (let i = 0; i < points.length; i++) {
    const point = points[i]
    const x = px(scale, point.x)
    const y = py(scale, point.y)
    ctx.beginPath()
    ctx.arc(x, y, 3.2, 0, Math.PI * 2)
    if (filledOnly || point.id !== null) {
      ctx.fillStyle = point.color ?? color
      ctx.fill()
    } else {
      ctx.strokeStyle = point.color ?? color
      ctx.lineWidth = 1.4
      ctx.stroke()
    }
    regions.push({
      x: x - 6,
      y: y - 6,
      w: 12,
      h: 12,
      tooltip: point.tooltip ?? `${xTrait.label} ${point.x.toFixed(xTrait.digits)}\n${yTrait.label} ${point.y.toFixed(yTrait.digits)}`,
      pinTime: null,
      selectId: point.id,
      xMin: null,
      xMax: null,
    })
  }
  ctx.restore()
  axisLabels(ctx, scale, yTrait.digits)
  ctx.fillStyle = '#8d8778'
  ctx.textAlign = 'left'
  ctx.fillText(xSummary.min.toFixed(xTrait.digits), scale.x, scale.y + scale.h + 2)
  ctx.textAlign = 'right'
  ctx.fillText(xSummary.max.toFixed(xTrait.digits), scale.x + scale.w, scale.y + scale.h + 2)
  ctx.textAlign = 'left'
}

function drawHistogram(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  title: string,
  bins: { lo: number; hi: number; count: number }[],
  color: string,
  digits: number,
): void {
  let max = 1
  for (let i = 0; i < bins.length; i++) if (bins[i].count > max) max = bins[i].count
  const scale = openPlot(ctx, rect, title, { min: 0, max: max }, {
    min: bins.length > 0 ? bins[0].lo : 0,
    max: bins.length > 0 ? bins[bins.length - 1].hi : 1,
  })
  if (!scale) return
  clipPlot(ctx, scale)
  const slot = scale.w / Math.max(1, bins.length)
  for (let i = 0; i < bins.length; i++) {
    const top = py(scale, bins[i].count)
    const bottom = py(scale, 0)
    ctx.fillStyle = color
    ctx.fillRect(scale.x + i * slot + 1, top, Math.max(1, slot - 2), Math.max(0, bottom - top))
  }
  ctx.restore()
  axisLabels(ctx, scale, 0)
  if (bins.length > 0) {
    ctx.fillStyle = '#8d8778'
    ctx.fillText(bins[0].lo.toFixed(digits), scale.x, scale.y + scale.h + 2)
    ctx.textAlign = 'right'
    ctx.fillText(bins[bins.length - 1].hi.toFixed(digits), scale.x + scale.w, scale.y + scale.h + 2)
    ctx.textAlign = 'left'
  }
}

function drawGroupedHistogram(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  title: string,
  subtitle: string,
  bins: { label: string; dead: number; live: number }[],
): void {
  let max = 1
  for (let i = 0; i < bins.length; i++) max = Math.max(max, bins[i].dead, bins[i].live)
  ctx.fillStyle = '#12170f'
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
  ctx.fillStyle = '#b7b09f'
  ctx.font = FONT
  ctx.textAlign = 'left'
  ctx.fillText(trim(ctx, title, rect.w - 16), rect.x + 8, rect.y + 6)
  ctx.fillText(trim(ctx, subtitle, rect.w - 16), rect.x + 8, rect.y + 20)
  const scale: Scale = {
    x: rect.x + 36,
    y: rect.y + 48,
    w: Math.max(1, rect.w - 48),
    h: Math.max(1, rect.h - 70),
    xMin: 0,
    xMax: Math.max(1, bins.length),
    yMin: 0,
    yMax: max,
  }
  const slot = scale.w / Math.max(1, bins.length)
  for (let i = 0; i < bins.length; i++) {
    const deadTop = py(scale, bins[i].dead)
    const liveTop = py(scale, bins[i].live)
    const bottom = py(scale, 0)
    ctx.fillStyle = 'rgba(224, 122, 74, 0.85)'
    ctx.fillRect(scale.x + i * slot + 1, deadTop, Math.max(1, slot * 0.45), Math.max(0, bottom - deadTop))
    ctx.fillStyle = '#efe7d6'
    ctx.fillRect(scale.x + i * slot + slot * 0.5, liveTop, Math.max(1, slot * 0.45), Math.max(0, bottom - liveTop))
    if (bins.length <= 16) {
      ctx.fillStyle = '#8d8778'
      ctx.fillText(bins[i].label, scale.x + i * slot, scale.y + scale.h + 2)
    }
  }
}

function offspringBins(dead: readonly number[], live: readonly number[], max: number): { label: string; dead: number; live: number }[] {
  const cap = Math.min(12, max)
  const bins = Array.from({ length: cap + 1 }, (_, index) => ({
    label: index === cap && max > cap ? `${cap}+` : String(index),
    dead: 0,
    live: 0,
  }))
  const place = (value: number) => Math.min(cap, Math.max(0, Math.floor(value)))
  for (let i = 0; i < dead.length; i++) bins[place(dead[i])].dead += 1
  for (let i = 0; i < live.length; i++) bins[place(live[i])].live += 1
  return bins
}

function padDomain(min: number, max: number): { min: number; max: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 }
  if (max - min < 1e-6) return { min: min - 0.5, max: max + 0.5 }
  const pad = (max - min) * 0.08
  return { min: min - pad, max: max + pad }
}

function when(sample: PopulationSample): string {
  return `gen ${sample.avgGeneration.toFixed(2)}   ${sample.time.toFixed(1)}s`
}

function trim(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text
  let end = text.length
  while (end > 4 && ctx.measureText(`${text.slice(0, end)}…`).width > width) end -= 1
  return `${text.slice(0, end)}…`
}

function completedLives(records: readonly LifetimeRecord[]): LifetimeRecord[] {
  const completed: LifetimeRecord[] = []
  for (let i = 0; i < records.length; i++) {
    const life = records[i]
    if (life && !life.alive) completed.push(life)
  }
  return completed
}

function creatureBirthTrait(records: readonly LifetimeRecord[], creature: Creature, trait: TraitKey): number {
  const record = records[creature.id - 1]
  if (record && record.id === creature.id) return birthTrait(record, trait)
  return creature.genome[trait]
}

function isLifetimeKey(key: ScatterKey): boolean {
  return key === 'lifespan' || key === 'lifetimeOffspring'
}

function scatterLabel(key: ScatterKey): string {
  if (key === 'lifespan') return 'Lifespan'
  if (key === 'lifetimeOffspring') return 'Lifetime offspring'
  return traitByKey(key).label
}

function scatterRecordValue(life: LifetimeRecord, key: ScatterKey): number | null {
  if (key === 'lifespan') return life.alive ? null : life.lifespan
  if (key === 'lifetimeOffspring') return life.offspringCount
  return birthTrait(life, key)
}

interface DemoFigures {
  key: string
  completed: LifetimeRecord[]
  ages: number[]
  currentAges: number[]
  lifespan: ReturnType<typeof summarizeValues>
  offspring: ReturnType<typeof summarizeValues>
  rate: ReturnType<typeof summarizeValues>
  longest: LifetimeRecord | null
  oldestLiving: Creature | null
  maxOffspring: number
  maxMatings: number
  maxFood: number
  leadersDead: LifetimeRecord[]
  leadersLiving: Creature[]
}

let completedCache: Omit<DemoFigures, 'currentAges' | 'oldestLiving' | 'leadersLiving'> | null = null

function demographyFigures(view: Pick<DashboardView, 'lifetimes' | 'creatures' | 'deaths'>): DemoFigures {
  const key = `${view.deaths}:${view.lifetimes.length}`
  if (!completedCache || completedCache.key !== key) {
    const completed = completedLives(view.lifetimes)
    const ages: number[] = []
    const rates: number[] = []
    const offspring: number[] = []
    let longest: LifetimeRecord | null = null
    let maxOffspring = 0
    let maxMatings = 0
    let maxFood = 0
    const deadRank: LifetimeRecord[] = []
    for (let i = 0; i < completed.length; i++) {
      const life = completed[i]
      const span = life.lifespan ?? 0
      ages.push(span)
      offspring.push(life.offspringCount)
      const rate = offspringPer100Seconds(life.offspringCount, span)
      if (rate !== null) rates.push(rate)
      if (life.offspringCount > maxOffspring) maxOffspring = life.offspringCount
      if (life.matingCount > maxMatings) maxMatings = life.matingCount
      if (life.foodEaten > maxFood) maxFood = life.foodEaten
      if (!longest || span > (longest.lifespan ?? 0)) longest = life
      insertLeader(deadRank, life, (item) => item.lifespan ?? 0)
    }
    completedCache = {
      key,
      completed,
      ages,
      lifespan: summarizeValues(ages),
      offspring: summarizeValues(offspring),
      rate: summarizeValues(rates),
      longest,
      maxOffspring,
      maxMatings,
      maxFood,
      leadersDead: deadRank,
    }
  }
  const currentAges: number[] = []
  let oldestLiving: Creature | null = null
  const liveRank: Creature[] = []
  for (let i = 0; i < view.creatures.length; i++) {
    const creature = view.creatures[i]
    currentAges.push(creature.age)
    if (!oldestLiving || creature.age > oldestLiving.age) oldestLiving = creature
    insertLeader(liveRank, creature, (item) => item.age)
  }
  return {
    ...completedCache,
    currentAges,
    oldestLiving,
    leadersLiving: liveRank,
  }
}

function insertLeader<T>(leaders: T[], item: T, score: (item: T) => number): void {
  const value = score(item)
  let index = leaders.length
  while (index > 0 && value > score(leaders[index - 1])) index -= 1
  if (index === 10 && leaders.length === 10) return
  leaders.splice(index, 0, item)
  if (leaders.length > 10) leaders.pop()
}

export function longevityLeaders(view: Pick<DashboardView, 'lifetimes' | 'creatures' | 'deaths'>): {
  dead: LifetimeRecord[]
  living: Creature[]
} {
  const figures = demographyFigures(view)
  return { dead: figures.leadersDead, living: figures.leadersLiving }
}

function drawDemography(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  view: DashboardView,
  regions: DashRegion[],
): void {
  const figures = demographyFigures(view)
  const head = 36
  ctx.fillStyle = '#c8c2b4'
  ctx.fillText(demographyTitle(figures), 12, 8)
  ctx.fillText(demographyRecords(view, figures), 12, 22)
  const rects = grid(width, height - head, 4, width >= 980 ? 2 : 1).map((rect) => ({ ...rect, y: rect.y + head }))
  const lifespanBins = histogram(figures.ages)
  const ageBins = histogram(figures.currentAges)
  drawHistogram(ctx, rects[0], `Completed lifespans   n ${figures.lifespan.n}`, lifespanBins, '#e07a4a', 1)
  drawHistogram(ctx, rects[1], `Current ages   n ${figures.currentAges.length}`, ageBins, '#efe7d6', 1)
  const visible = visibleSamples(view.samples, view.xMode, view.span)
  const drawn = downsample(visible, 360, (sample) => [sample.maxLivingAge])
  let ageMax = 1
  for (let i = 0; i < view.samples.length; i++) if (view.samples[i].maxLivingAge > ageMax) ageMax = view.samples[i].maxLivingAge
  drawLineChart(ctx, rects[2], 'Maximum living age', 's', visible, drawn, view, regions, {
    label: 'Max age',
    color: '#e2c15a',
    read: (sample) => sample.maxLivingAge,
    domain: { min: 0, max: ageMax * 1.08 },
  })
  const points: ScatterPoint[] = []
  for (let i = 0; i < figures.completed.length; i++) {
    const life = figures.completed[i]
    points.push({
      id: null,
      x: life.lifespan ?? 0,
      y: life.offspringCount,
      tooltip: lifeTooltip(life),
    })
  }
  drawScatter(
    ctx,
    rects[3],
    'Lifetime offspring × lifespan   completed',
    thinPoints(points),
    { label: 'Lifespan', digits: 1 },
    { label: 'Offspring', digits: 0 },
    'rgba(224, 122, 74, 0.85)',
    regions,
    false,
    0,
  )
}

function demographyTitle(figures: DemoFigures): string {
  const span = figures.lifespan
  const oldest = figures.oldestLiving
  const longest = figures.longest
  return `Completed ${span.n}   mean ${span.n ? span.mean.toFixed(1) : '—'}s   median ${span.n ? span.median.toFixed(1) : '—'}s   longest ${longest ? `${(longest.lifespan ?? 0).toFixed(1)}s #${longest.id}` : '—'}   oldest living ${oldest ? `${oldest.age.toFixed(1)}s #${oldest.id}` : '—'}`
}

function demographyRecords(view: DashboardView, figures: DemoFigures): string {
  const records = view.runRecords
  const minPop = Number.isFinite(records.minNonzeroPopulation) ? String(records.minNonzeroPopulation) : '—'
  const rate = figures.rate
  return `Offspring mean ${figures.offspring.n ? figures.offspring.mean.toFixed(2) : '—'}   median ${figures.offspring.n ? figures.offspring.median.toFixed(2) : '—'}   max ${figures.maxOffspring}   per 100s mean ${rate.n ? rate.mean.toFixed(2) : '—'}   max pop ${records.maxPopulation}   min pop ${minPop}   max litter ${records.maxLitter}   max age seen ${records.maxLivingAge.toFixed(1)}s   max matings ${figures.maxMatings}   max food ${figures.maxFood}`
}

function thinPoints(points: ScatterPoint[]): ScatterPoint[] {
  if (points.length <= 2500) return points
  const kept: ScatterPoint[] = []
  const stride = Math.ceil(points.length / 2500)
  let best = points[0]
  for (let i = 0; i < points.length; i++) {
    if (points[i].y > best.y) best = points[i]
    if (i % stride === 0) kept.push(points[i])
  }
  if (!kept.includes(best)) kept.push(best)
  return kept
}

function hexAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function regionAt(regions: readonly DashRegion[], x: number, y: number): DashRegion | null {
  for (let i = regions.length - 1; i >= 0; i--) {
    const region = regions[i]
    if (x >= region.x && x <= region.x + region.w && y >= region.y && y <= region.y + region.h) return region
  }
  return null
}

export function sampleTimeAt(
  samples: readonly PopulationSample[],
  mode: XMode,
  span: HistorySpan,
  scaleX: number,
  scaleW: number,
  xMin: number,
  xMax: number,
  localX: number,
): number | null {
  const visible = visibleSamples(samples, mode, span)
  if (visible.length === 0 || scaleW <= 0) return null
  const ratio = (localX - scaleX) / scaleW
  const data = xMin + ratio * (xMax - xMin)
  return nearestSample(visible, mode, data)?.time ?? null
}
