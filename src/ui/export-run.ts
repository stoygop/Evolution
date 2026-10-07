import type { StatsSample } from '../sim/types.ts'

export type RunDataFormat = 'csv' | 'json'

const COLUMNS = [
  'time',
  'population',
  'food',
  'avgGeneration',
  'avgSpeed',
  'avgVision',
  'avgSize',
] as const satisfies readonly (keyof StatsSample)[]

/** One record per sample already stored on the world. Empty history is still valid. */
export function formatRunData(samples: readonly StatsSample[], format: RunDataFormat): string {
  if (format === 'json') {
    const records = samples.map((sample) => ({
      time: sample.time,
      population: sample.population,
      food: sample.food,
      avgGeneration: sample.avgGeneration,
      avgSpeed: sample.avgSpeed,
      avgVision: sample.avgVision,
      avgSize: sample.avgSize,
    }))
    return `${JSON.stringify(records, null, 2)}\n`
  }

  const lines = [COLUMNS.join(',')]
  for (const sample of samples) {
    lines.push(COLUMNS.map((key) => String(sample[key])).join(','))
  }
  return `${lines.join('\n')}\n`
}

export function downloadRunData(samples: readonly StatsSample[], format: RunDataFormat): void {
  const body = formatRunData(samples, format)
  const mime = format === 'json' ? 'application/json' : 'text/csv'
  const blob = new Blob([body], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `evolution-run.${format}`
  link.click()
  URL.revokeObjectURL(url)
}
