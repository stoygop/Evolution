import type { LifetimeRecord } from '../sim/types.ts'
import { averageLitter, offspringPer100Seconds, reproductiveLifespan } from '../sim/lifetime.ts'
import type { PopulationSample, RunExport } from '../experiment/recorder.ts'

export type RunDataFormat = 'csv' | 'json' | 'lifetimes'

const COLUMNS = [
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
] as const satisfies readonly (keyof PopulationSample)[]

const LIFETIME_COLUMNS = [
  'id',
  'alive',
  'parentId',
  'parentBId',
  'generation',
  'birthTime',
  'birthAvgGeneration',
  'birthSpeed',
  'birthVision',
  'birthSize',
  'birthMateDetection',
  'birthOffspringInvestment',
  'deathTime',
  'deathAvgGeneration',
  'lifespan',
  'foodEaten',
  'matingCount',
  'offspringCount',
  'averageLitter',
  'maxLitter',
  'offspringPer100Seconds',
  'ageAtFirstMating',
  'ageAtFirstOffspring',
  'ageAtLastMating',
  'ageAtLastOffspring',
  'reproductiveLifespan',
] as const

export function runDataFilename(runId: string, format: RunDataFormat): string {
  if (format === 'json') return `evolution-${runId}.json`
  if (format === 'lifetimes') return `evolution-${runId}-lifetimes.csv`
  return `evolution-${runId}-samples.csv`
}

/**
 * JSON is the full experiment (metadata, every population sample, genome snapshots).
 * CSV is the population samples only, one row per sample, starting at time 0.
 */
export function formatRunData(log: RunExport, format: RunDataFormat): string {
  if (format === 'json') {
    const payload = {
      metadata: log.metadata,
      samples: log.samples,
      genomeSnapshots: log.genomeSnapshots,
      environmentChanges: log.environmentChanges ?? [],
      lifetimeRecords: log.lifetimes ?? [],
      safetyEvents: log.safetyEvents ?? [],
    }
    return `${JSON.stringify(payload, null, 2)}\n`
  }
  if (format === 'lifetimes') return formatLifetimes(log.lifetimes ?? [])

  const lines = [COLUMNS.join(',')]
  for (const sample of log.samples) {
    lines.push(COLUMNS.map((key) => String(sample[key])).join(','))
  }
  return `${lines.join('\n')}\n`
}

function formatLifetimes(records: readonly LifetimeRecord[]): string {
  const lines = [LIFETIME_COLUMNS.join(',')]
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (!record) continue
    const rateSeconds = record.alive ? null : record.lifespan
    const rate = rateSeconds === null ? null : offspringPer100Seconds(record.offspringCount, rateSeconds)
    const cells: Record<(typeof LIFETIME_COLUMNS)[number], string> = {
      id: String(record.id),
      alive: record.alive ? 'true' : 'false',
      parentId: cell(record.parentId),
      parentBId: cell(record.parentBId),
      generation: String(record.generation),
      birthTime: String(record.birthTime),
      birthAvgGeneration: String(record.birthAvgGeneration),
      birthSpeed: String(record.birthSpeed),
      birthVision: String(record.birthVision),
      birthSize: String(record.birthSize),
      birthMateDetection: String(record.birthMateDetection),
      birthOffspringInvestment: String(record.birthOffspringInvestment),
      deathTime: cell(record.deathTime),
      deathAvgGeneration: cell(record.deathAvgGeneration),
      lifespan: cell(record.lifespan),
      foodEaten: String(record.foodEaten),
      matingCount: String(record.matingCount),
      offspringCount: String(record.offspringCount),
      averageLitter: String(averageLitter(record)),
      maxLitter: String(record.maxLitter),
      offspringPer100Seconds: cell(rate),
      ageAtFirstMating: cell(record.ageAtFirstMating),
      ageAtFirstOffspring: cell(record.ageAtFirstOffspring),
      ageAtLastMating: cell(record.ageAtLastMating),
      ageAtLastOffspring: cell(record.ageAtLastOffspring),
      reproductiveLifespan: record.alive ? '' : cell(reproductiveLifespan(record)),
    }
    lines.push(LIFETIME_COLUMNS.map((key) => cells[key]).join(','))
  }
  return `${lines.join('\n')}\n`
}

function cell(value: number | null): string {
  return value === null ? '' : String(value)
}

export function downloadRunData(log: RunExport, format: RunDataFormat): void {
  const body = formatRunData(log, format)
  const mime = format === 'json' ? 'application/json' : 'text/csv'
  const blob = new Blob([body], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = runDataFilename(log.metadata.runId, format)
  link.click()
  URL.revokeObjectURL(url)
}
