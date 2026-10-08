import type { LifetimeRecord } from './types.ts'

/** 100 * offspring / seconds. Null when the duration is zero or not finite. */
export function offspringPer100Seconds(offspring: number, seconds: number): number | null {
  if (!Number.isFinite(offspring) || !(seconds > 1e-6)) return null
  return (100 * offspring) / seconds
}

/** Null when the creature never produced offspring. Zero when the first and last were the same event. */
export function reproductiveLifespan(record: LifetimeRecord): number | null {
  if (record.ageAtFirstOffspring === null || record.ageAtLastOffspring === null) return null
  return record.ageAtLastOffspring - record.ageAtFirstOffspring
}

export function averageLitter(record: LifetimeRecord): number {
  if (!(record.matingCount > 0)) return 0
  return record.litterSizeSum / record.matingCount
}

export type BirthTrait = 'speed' | 'vision' | 'size' | 'mateDetection' | 'offspringInvestment'

export function birthTrait(record: LifetimeRecord, trait: BirthTrait): number {
  if (trait === 'speed') return record.birthSpeed
  if (trait === 'vision') return record.birthVision
  if (trait === 'size') return record.birthSize
  if (trait === 'mateDetection') return record.birthMateDetection
  return record.birthOffspringInvestment
}
