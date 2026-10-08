import type { EnvironmentEvent, PopulationSample } from '../experiment/recorder.ts'

export type TraitKey = 'speed' | 'vision' | 'size' | 'mateDetection' | 'offspringInvestment'
export type ScatterKey = TraitKey | 'lifespan' | 'lifetimeOffspring'

export const SCATTER_CHOICES: readonly { key: ScatterKey; label: string }[] = [
  { key: 'speed', label: 'Speed' },
  { key: 'vision', label: 'Food vision' },
  { key: 'size', label: 'Size' },
  { key: 'mateDetection', label: 'Mate detection' },
  { key: 'offspringInvestment', label: 'Offspring investment' },
  { key: 'lifespan', label: 'Lifespan' },
  { key: 'lifetimeOffspring', label: 'Lifetime offspring' },
]
export type XMode = 'generation' | 'time'
export type HistorySpan = '50' | '100' | '250' | '500' | 'all'
export type YMode = 'auto' | 'all-time' | 'bounds' | 'manual'

export interface TraitDef {
  key: TraitKey
  label: string
  color: string
  digits: number
  mean: (sample: PopulationSample) => number
  median: (sample: PopulationSample) => number
  stdDev: (sample: PopulationSample) => number
  min: (sample: PopulationSample) => number
  max: (sample: PopulationSample) => number
  boundMin: (sample: PopulationSample) => number
  boundMax: (sample: PopulationSample) => number
  /** Display clamp for SD bands. Does not apply to recorded min/max. */
  sensibleMin: number
  sensibleMax: number
}

export const TRAITS: readonly TraitDef[] = [
  {
    key: 'speed',
    label: 'Speed',
    color: '#e07a4a',
    digits: 1,
    mean: (s) => s.avgSpeed,
    median: (s) => s.speedMedian,
    stdDev: (s) => s.speedStdDev,
    min: (s) => s.speedMin,
    max: (s) => s.speedMax,
    boundMin: (s) => s.speedWindowMin,
    boundMax: (s) => s.speedWindowMax,
    sensibleMin: 0,
    sensibleMax: 300,
  },
  {
    key: 'vision',
    label: 'Food vision',
    color: '#8ec8e8',
    digits: 1,
    mean: (s) => s.avgVision,
    median: (s) => s.visionMedian,
    stdDev: (s) => s.visionStdDev,
    min: (s) => s.visionMin,
    max: (s) => s.visionMax,
    boundMin: (s) => s.visionWindowMin,
    boundMax: (s) => s.visionWindowMax,
    sensibleMin: 0,
    sensibleMax: 500,
  },
  {
    key: 'size',
    label: 'Size',
    color: '#e2c15a',
    digits: 2,
    mean: (s) => s.avgSize,
    median: (s) => s.sizeMedian,
    stdDev: (s) => s.sizeStdDev,
    min: (s) => s.sizeMin,
    max: (s) => s.sizeMax,
    boundMin: (s) => s.sizeWindowMin,
    boundMax: (s) => s.sizeWindowMax,
    sensibleMin: 1,
    sensibleMax: 100,
  },
  {
    key: 'mateDetection',
    label: 'Mate detection',
    color: '#c4a0e8',
    digits: 1,
    mean: (s) => s.avgMateDetection,
    median: (s) => s.mateDetectionMedian,
    stdDev: (s) => s.mateDetectionStdDev,
    min: (s) => s.mateDetectionMin,
    max: (s) => s.mateDetectionMax,
    boundMin: (s) => s.mateDetectionWindowMin,
    boundMax: (s) => s.mateDetectionWindowMax,
    sensibleMin: 0,
    sensibleMax: 1500,
  },
  {
    key: 'offspringInvestment',
    label: 'Offspring investment',
    color: '#8fce73',
    digits: 1,
    mean: (s) => s.avgOffspringInvestment,
    median: (s) => s.offspringInvestmentMedian,
    stdDev: (s) => s.offspringInvestmentStdDev,
    min: (s) => s.offspringInvestmentMin,
    max: (s) => s.offspringInvestmentMax,
    boundMin: (s) => s.offspringInvestmentWindowMin,
    boundMax: (s) => s.offspringInvestmentWindowMax,
    sensibleMin: 1,
    sensibleMax: 500,
  },
]

export function traitByKey(key: TraitKey): TraitDef {
  const trait = TRAITS.find((item) => item.key === key)
  if (!trait) throw new Error(`Unknown trait ${key}`)
  return trait
}

const GENERATION_SPAN: Record<Exclude<HistorySpan, 'all'>, number> = {
  '50': 50,
  '100': 100,
  '250': 250,
  '500': 500,
}

const TIME_SPAN: Record<Exclude<HistorySpan, 'all'>, number> = {
  '50': 120,
  '100': 600,
  '250': 1800,
  '500': 7200,
}

export function xValue(sample: PopulationSample, mode: XMode): number {
  return mode === 'generation' ? sample.avgGeneration : sample.time
}

export function spanChoices(mode: XMode): { id: HistorySpan; label: string }[] {
  if (mode === 'generation') {
    return [
      { id: '50', label: 'Last 50 generations' },
      { id: '100', label: 'Last 100' },
      { id: '250', label: 'Last 250' },
      { id: '500', label: 'Last 500' },
      { id: 'all', label: 'All' },
    ]
  }
  return [
    { id: '50', label: 'Last 2 min' },
    { id: '100', label: 'Last 10 min' },
    { id: '250', label: 'Last 30 min' },
    { id: '500', label: 'Last 2 hours' },
    { id: 'all', label: 'All' },
  ]
}

/** Samples whose x is inside the trailing window. The source array is not modified. */
export function visibleSamples(
  samples: readonly PopulationSample[],
  mode: XMode,
  span: HistorySpan,
): PopulationSample[] {
  if (span === 'all' || samples.length === 0) return samples.slice()
  const width = mode === 'generation' ? GENERATION_SPAN[span] : TIME_SPAN[span]
  const end = xValue(samples[samples.length - 1], mode)
  const start = end - width
  let index = samples.length - 1
  while (index > 0 && xValue(samples[index - 1], mode) >= start) index -= 1
  return samples.slice(index)
}

export interface Extrema {
  min: number
  minTime: number
  minGeneration: number
  max: number
  maxTime: number
  maxGeneration: number
}

/** Earliest sample wins a tie. Scans the full series, not the visible window. */
export function scanExtrema(
  samples: readonly PopulationSample[],
  readMin: (sample: PopulationSample) => number,
  readMax: (sample: PopulationSample) => number,
): Extrema | null {
  if (samples.length === 0) return null
  let min = readMin(samples[0])
  let max = readMax(samples[0])
  let minSample = samples[0]
  let maxSample = samples[0]
  for (let i = 1; i < samples.length; i++) {
    const sample = samples[i]
    const low = readMin(sample)
    const high = readMax(sample)
    if (low < min) {
      min = low
      minSample = sample
    }
    if (high > max) {
      max = high
      maxSample = sample
    }
  }
  return {
    min,
    minTime: minSample.time,
    minGeneration: minSample.avgGeneration,
    max,
    maxTime: maxSample.time,
    maxGeneration: maxSample.avgGeneration,
  }
}

/**
 * Deterministic display downsample. Each bucket keeps its first and last
 * sample and the samples that hold the min and max of every reader.
 * The input array and its objects are not modified.
 */
export function downsample<T>(items: readonly T[], maxPoints: number, read: (item: T) => readonly number[]): T[] {
  if (maxPoints < 2 || items.length <= maxPoints) return items.slice()
  const chosen = new Set<number>()
  const buckets = maxPoints
  const count = items.length
  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = Math.floor((bucket * count) / buckets)
    const end = Math.floor(((bucket + 1) * count) / buckets)
    if (end <= start) continue
    chosen.add(start)
    chosen.add(end - 1)
    const probe = read(items[start])
    const minAt = new Array<number>(probe.length).fill(start)
    const maxAt = new Array<number>(probe.length).fill(start)
    const minValue = probe.slice()
    const maxValue = probe.slice()
    for (let index = start + 1; index < end; index++) {
      const values = read(items[index])
      for (let series = 0; series < values.length; series++) {
        if (values[series] < minValue[series]) {
          minValue[series] = values[series]
          minAt[series] = index
        }
        if (values[series] > maxValue[series]) {
          maxValue[series] = values[series]
          maxAt[series] = index
        }
      }
    }
    for (let series = 0; series < minAt.length; series++) {
      chosen.add(minAt[series])
      chosen.add(maxAt[series])
    }
  }
  return [...chosen].sort((a, b) => a - b).map((index) => items[index])
}

export function traitReadout(trait: TraitDef): (sample: PopulationSample) => number[] {
  return (sample) => [trait.mean(sample), trait.min(sample), trait.max(sample)]
}

export function parseManualRange(minText: string, maxText: string): { min: number; max: number } | null {
  const min = Number(minText)
  const max = Number(maxText)
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(min < max)) return null
  return { min, max }
}

export function domainOf(values: readonly number[]): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    if (!Number.isFinite(value)) continue
    if (value < min) min = value
    if (value > max) max = value
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 }
  if (max - min < 1e-6) return { min: min - 0.5, max: max + 0.5 }
  const pad = (max - min) * 0.06
  return { min: min - pad, max: max + pad }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Values that should influence a trait's Y scale. SD edges are display-clamped. */
export function traitScaleValues(trait: TraitDef, sample: PopulationSample): number[] {
  const mean = trait.mean(sample)
  const sd = trait.stdDev(sample)
  return [
    mean,
    trait.median(sample),
    trait.min(sample),
    trait.max(sample),
    clamp(mean - sd, trait.sensibleMin, trait.sensibleMax),
    clamp(mean + sd, trait.sensibleMin, trait.sensibleMax),
    clamp(mean - 2 * sd, trait.sensibleMin, trait.sensibleMax),
    clamp(mean + 2 * sd, trait.sensibleMin, trait.sensibleMax),
  ]
}

export function traitDomain(
  trait: TraitDef,
  samples: readonly PopulationSample[],
  mode: YMode,
  manual: { min: string; max: string },
  boundsSample: PopulationSample | undefined,
): { min: number; max: number } {
  if (mode === 'bounds') {
    const source = boundsSample
    if (!source) return { min: trait.sensibleMin, max: trait.sensibleMax }
    const min = trait.boundMin(source)
    const max = trait.boundMax(source)
    if (Number.isFinite(min) && Number.isFinite(max) && min < max) return { min, max }
    return { min: trait.sensibleMin, max: trait.sensibleMax }
  }
  if (mode === 'manual') {
    const parsed = parseManualRange(manual.min, manual.max)
    if (parsed) return parsed
  }
  const values: number[] = []
  for (let i = 0; i < samples.length; i++) values.push(...traitScaleValues(trait, samples[i]))
  return domainOf(values)
}

export interface InterventionGroup {
  time: number
  avgGeneration: number
  events: EnvironmentEvent[]
}

/** Same-time edits, and edits within 0.05s, share one marker. */
export function groupInterventions(events: readonly EnvironmentEvent[]): InterventionGroup[] {
  const groups: InterventionGroup[] = []
  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    const previous = groups[groups.length - 1]
    if (previous && event.time - previous.time <= 0.05) {
      previous.events.push(event)
      continue
    }
    groups.push({ time: event.time, avgGeneration: event.avgGeneration, events: [event] })
  }
  return groups
}

const PARAMETER_LABELS: Record<string, string> = {
  foodSpawnPerSecond: 'Food spawn rate',
  foodEnergy: 'Food energy',
  reproductionMode: 'Reproduction mode',
  matingRadius: 'Mating radius',
  speedWindowMin: 'Speed minimum',
  speedWindowMax: 'Speed maximum',
  visionWindowMin: 'Vision minimum',
  visionWindowMax: 'Vision maximum',
  mateDetectionWindowMin: 'Mate detection minimum',
  mateDetectionWindowMax: 'Mate detection maximum',
  offspringInvestmentWindowMin: 'Offspring investment minimum',
  offspringInvestmentWindowMax: 'Offspring investment maximum',
  sizeWindowMin: 'Size minimum',
  sizeWindowMax: 'Size maximum',
  populationCap: 'Population safety cap',
  litterCap: 'Maximum litter size',
  litterEnergyLimited: 'Energy-limited litter',
}

export function parameterLabel(parameter: string): string {
  return PARAMETER_LABELS[parameter] ?? parameter
}

export function nearestSample(
  samples: readonly PopulationSample[],
  mode: XMode,
  x: number,
): PopulationSample | null {
  if (samples.length === 0 || !Number.isFinite(x)) return null
  let best = samples[0]
  let bestDistance = Math.abs(xValue(best, mode) - x)
  for (let i = 1; i < samples.length; i++) {
    const distance = Math.abs(xValue(samples[i], mode) - x)
    if (distance < bestDistance) {
      best = samples[i]
      bestDistance = distance
    }
  }
  return best
}

export interface ValueSummary {
  n: number
  mean: number
  median: number
  stdDev: number
  min: number
  max: number
}

/** Population standard deviation, divisor n, matching the experiment recorder. */
export function summarizeValues(values: readonly number[]): ValueSummary {
  const n = values.length
  if (n === 0) return { n: 0, mean: 0, median: 0, stdDev: 0, min: 0, max: 0 }
  let sum = 0
  let min = values[0]
  let max = values[0]
  for (let i = 0; i < n; i++) {
    const value = values[i]
    sum += value
    if (value < min) min = value
    if (value > max) max = value
  }
  const mean = sum / n
  let square = 0
  for (let i = 0; i < n; i++) {
    const delta = values[i] - mean
    square += delta * delta
  }
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = n >> 1
  const median = n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return { mean, median, stdDev: Math.sqrt(square / n), min, max, n }
}

export interface HistogramBin {
  lo: number
  hi: number
  count: number
}

export function histogram(values: readonly number[], maxBins = 20): HistogramBin[] {
  const n = values.length
  if (n === 0) return []
  let min = values[0]
  let max = values[0]
  for (let i = 1; i < n; i++) {
    if (values[i] < min) min = values[i]
    if (values[i] > max) max = values[i]
  }
  if (!(max > min)) return [{ lo: min, hi: max, count: n }]
  const bins = Math.max(4, Math.min(maxBins, Math.ceil(Math.sqrt(n))))
  const width = (max - min) / bins
  const counts = new Array<number>(bins).fill(0)
  for (let i = 0; i < n; i++) {
    let index = Math.floor((values[i] - min) / width)
    if (index >= bins) index = bins - 1
    if (index < 0) index = 0
    counts[index] += 1
  }
  return counts.map((count, index) => ({
    lo: min + index * width,
    hi: index === bins - 1 ? max : min + (index + 1) * width,
    count,
  }))
}

export interface OffspringFractions {
  n: number
  zero: number
  one: number
  two: number
  more: number
}

/** Shares of a set of lifetime offspring counts. Each value is a fraction from 0 to 1. */
export function offspringFractions(counts: readonly number[]): OffspringFractions {
  const n = counts.length
  if (n === 0) return { n: 0, zero: 0, one: 0, two: 0, more: 0 }
  let zero = 0
  let one = 0
  let two = 0
  let more = 0
  for (let i = 0; i < n; i++) {
    const count = counts[i]
    if (count <= 0) zero += 1
    else if (count === 1) one += 1
    else if (count === 2) two += 1
    else more += 1
  }
  return { n, zero: zero / n, one: one / n, two: two / n, more: more / n }
}

export function formatValue(value: number, digits: number): string {
  if (!Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}
