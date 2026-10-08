import { CONFIG } from '../config.ts'
import type { Environment, ReproductionMode, World } from './types.ts'

/**
 * Numeric controls. Slider bounds are wider than the V1 evolutionary windows
 * so an experiment can forbid a trait or let it run past the old cap.
 * `reproductionMode` is the one non-numeric setting.
 */
export type NumericEnvironmentKey = Exclude<keyof Environment, 'reproductionMode' | 'litterEnergyLimited'>

export type EnvironmentGroup = 'food' | 'constraint' | 'reproduction'

export interface EnvironmentField {
  key: NumericEnvironmentKey
  group: EnvironmentGroup
  label: string
  unit: string
  min: number
  max: number
  step: number
  digits: number
  defaultValue: number
}

export const ENVIRONMENT_FIELDS: readonly EnvironmentField[] = [
  {
    key: 'foodSpawnPerSecond',
    group: 'food',
    label: 'Food spawn rate',
    unit: '/s',
    min: 0,
    max: 16,
    step: 0.1,
    digits: 1,
    defaultValue: CONFIG.food.spawnPerSecond,
  },
  {
    key: 'foodEnergy',
    group: 'food',
    label: 'Food energy',
    unit: '',
    min: 0,
    max: 140,
    step: 1,
    digits: 0,
    defaultValue: CONFIG.food.energy,
  },
  {
    key: 'speedWindowMin',
    group: 'constraint',
    label: 'Speed minimum',
    unit: '',
    min: 0,
    max: 300,
    step: 1,
    digits: 0,
    defaultValue: CONFIG.trait.speed.min,
  },
  {
    key: 'speedWindowMax',
    group: 'constraint',
    label: 'Speed maximum',
    unit: '',
    min: 0,
    max: 300,
    step: 1,
    digits: 0,
    defaultValue: CONFIG.trait.speed.max,
  },
  {
    key: 'visionWindowMin',
    group: 'constraint',
    label: 'Vision minimum',
    unit: '',
    min: 0,
    max: 500,
    step: 1,
    digits: 0,
    defaultValue: CONFIG.trait.vision.min,
  },
  {
    key: 'visionWindowMax',
    group: 'constraint',
    label: 'Vision maximum',
    unit: '',
    min: 0,
    max: 500,
    step: 1,
    digits: 0,
    defaultValue: CONFIG.trait.vision.max,
  },
  {
    key: 'mateDetectionWindowMin',
    group: 'constraint',
    label: 'Mate detection minimum',
    unit: '',
    min: 0,
    max: 1500,
    step: 1,
    digits: 0,
    defaultValue: CONFIG.trait.mateDetection.min,
  },
  {
    key: 'mateDetectionWindowMax',
    group: 'constraint',
    label: 'Mate detection maximum',
    unit: '',
    min: 0,
    max: 1500,
    step: 1,
    digits: 0,
    defaultValue: CONFIG.trait.mateDetection.max,
  },
  {
    key: 'offspringInvestmentWindowMin',
    group: 'constraint',
    label: 'Offspring investment minimum',
    unit: '',
    min: 1,
    max: 500,
    step: 1,
    digits: 0,
    defaultValue: CONFIG.trait.offspringInvestment.min,
  },
  {
    key: 'offspringInvestmentWindowMax',
    group: 'constraint',
    label: 'Offspring investment maximum',
    unit: '',
    min: 1,
    max: 500,
    step: 1,
    digits: 0,
    defaultValue: CONFIG.trait.offspringInvestment.max,
  },
  {
    key: 'sizeWindowMin',
    group: 'constraint',
    label: 'Size minimum',
    unit: '',
    min: 1,
    max: 100,
    step: 0.1,
    digits: 1,
    defaultValue: CONFIG.trait.size.min,
  },
  {
    key: 'sizeWindowMax',
    group: 'constraint',
    label: 'Size maximum',
    unit: '',
    min: 1,
    max: 100,
    step: 0.1,
    digits: 1,
    defaultValue: CONFIG.trait.size.max,
  },
  {
    key: 'populationCap',
    group: 'reproduction',
    label: 'Population safety cap',
    unit: '',
    min: 1,
    max: CONFIG.population.absoluteMax,
    step: 1,
    digits: 0,
    defaultValue: CONFIG.population.max,
  },
  {
    key: 'litterCap',
    group: 'reproduction',
    label: 'Maximum litter size',
    unit: '',
    min: 1,
    max: CONFIG.reproduction.allocationCeiling,
    step: 1,
    digits: 0,
    defaultValue: CONFIG.reproduction.maxLitterSize,
  },
  {
    key: 'matingRadius',
    group: 'reproduction',
    label: 'Mating radius',
    unit: '',
    min: 0,
    max: 800,
    step: 1,
    digits: 0,
    defaultValue: CONFIG.reproduction.matingRadius,
  },
]

export type EnvironmentValue = number | ReproductionMode | boolean

export interface EnvironmentChange {
  parameter: keyof Environment
  oldValue: EnvironmentValue
  newValue: EnvironmentValue
  /** Living creatures whose trait was clamped by this change. */
  creaturesAffected: number
}

export function v1Environment(): Environment {
  return {
    foodSpawnPerSecond: CONFIG.food.spawnPerSecond,
    foodEnergy: CONFIG.food.energy,
    reproductionMode: 'asexual',
    matingRadius: CONFIG.reproduction.matingRadius,
    speedWindowMin: CONFIG.trait.speed.min,
    speedWindowMax: CONFIG.trait.speed.max,
    visionWindowMin: CONFIG.trait.vision.min,
    visionWindowMax: CONFIG.trait.vision.max,
    mateDetectionWindowMin: CONFIG.trait.mateDetection.min,
    mateDetectionWindowMax: CONFIG.trait.mateDetection.max,
    offspringInvestmentWindowMin: CONFIG.trait.offspringInvestment.min,
    offspringInvestmentWindowMax: CONFIG.trait.offspringInvestment.max,
    sizeWindowMin: CONFIG.trait.size.min,
    sizeWindowMax: CONFIG.trait.size.max,
    populationCap: CONFIG.population.max,
    litterCap: CONFIG.reproduction.maxLitterSize,
    litterEnergyLimited: false,
  }
}

export function environmentField(key: NumericEnvironmentKey): EnvironmentField {
  const field = ENVIRONMENT_FIELDS.find((item) => item.key === key)
  if (!field) throw new Error(`Unknown environment field ${key}`)
  return field
}

/** Snap a typed or dragged value onto the control's step and limits. */
export function readEnvironmentControl(key: NumericEnvironmentKey, raw: number): number {
  const field = environmentField(key)
  if (!Number.isFinite(raw)) return field.defaultValue
  const clamped = Math.min(field.max, Math.max(field.min, raw))
  const steps = Math.round((clamped - field.min) / field.step)
  return Number((field.min + steps * field.step).toFixed(field.digits))
}

export function formatEnvironmentValue(key: NumericEnvironmentKey, value: number): string {
  return value.toFixed(environmentField(key).digits)
}

/**
 * Write settings onto a living world. Does not reset creatures, food, time,
 * or ids. Tightening a trait window clamps living genomes immediately.
 */
export function updateEnvironment(world: World, next: Partial<Environment>): EnvironmentChange[] {
  const changes: EnvironmentChange[] = []
  if (next.reproductionMode === 'asexual' || next.reproductionMode === 'sexual') {
    const oldValue = world.environment.reproductionMode
    if (oldValue !== next.reproductionMode) {
      world.environment.reproductionMode = next.reproductionMode
      changes.push({
        parameter: 'reproductionMode',
        oldValue,
        newValue: next.reproductionMode,
        creaturesAffected: 0,
      })
    }
  }
  if (typeof next.litterEnergyLimited === 'boolean' && next.litterEnergyLimited !== world.environment.litterEnergyLimited) {
    const oldValue = world.environment.litterEnergyLimited
    world.environment.litterEnergyLimited = next.litterEnergyLimited
    changes.push({
      parameter: 'litterEnergyLimited',
      oldValue,
      newValue: next.litterEnergyLimited,
      creaturesAffected: 0,
    })
  }

  for (const field of ENVIRONMENT_FIELDS) {
    const raw = next[field.key]
    if (raw === undefined) continue
    const coupled = coupleWindow(world.environment, field.key, readEnvironmentControl(field.key, raw))
    const oldValue = world.environment[field.key]
    if (oldValue === coupled) continue
    world.environment[field.key] = coupled
    const trait = windowTrait(field.key)
    const creaturesAffected = trait === null ? 0 : clampLiving(world, trait)
    changes.push({
      parameter: field.key,
      oldValue,
      newValue: coupled,
      creaturesAffected,
    })
  }
  return changes
}

function coupleWindow(environment: Environment, key: NumericEnvironmentKey, value: number): number {
  if (key === 'speedWindowMin') return Math.min(value, environment.speedWindowMax)
  if (key === 'speedWindowMax') return Math.max(value, environment.speedWindowMin)
  if (key === 'visionWindowMin') return Math.min(value, environment.visionWindowMax)
  if (key === 'visionWindowMax') return Math.max(value, environment.visionWindowMin)
  if (key === 'mateDetectionWindowMin') return Math.min(value, environment.mateDetectionWindowMax)
  if (key === 'mateDetectionWindowMax') return Math.max(value, environment.mateDetectionWindowMin)
  if (key === 'offspringInvestmentWindowMin') return Math.min(value, environment.offspringInvestmentWindowMax)
  if (key === 'offspringInvestmentWindowMax') return Math.max(value, environment.offspringInvestmentWindowMin)
  if (key === 'sizeWindowMin') return Math.min(value, environment.sizeWindowMax)
  if (key === 'sizeWindowMax') return Math.max(value, environment.sizeWindowMin)
  return value
}

type WindowTrait = 'speed' | 'vision' | 'size' | 'mateDetection' | 'offspringInvestment'

function windowTrait(key: NumericEnvironmentKey): WindowTrait | null {
  if (key === 'speedWindowMin' || key === 'speedWindowMax') return 'speed'
  if (key === 'visionWindowMin' || key === 'visionWindowMax') return 'vision'
  if (key === 'mateDetectionWindowMin' || key === 'mateDetectionWindowMax') return 'mateDetection'
  if (key === 'offspringInvestmentWindowMin' || key === 'offspringInvestmentWindowMax') return 'offspringInvestment'
  if (key === 'sizeWindowMin' || key === 'sizeWindowMax') return 'size'
  return null
}

function clampLiving(world: World, trait: WindowTrait): number {
  const environment = world.environment
  const min =
    trait === 'speed'
      ? environment.speedWindowMin
      : trait === 'vision'
        ? environment.visionWindowMin
        : trait === 'size'
          ? environment.sizeWindowMin
          : trait === 'mateDetection'
            ? environment.mateDetectionWindowMin
            : environment.offspringInvestmentWindowMin
  const max =
    trait === 'speed'
      ? environment.speedWindowMax
      : trait === 'vision'
        ? environment.visionWindowMax
        : trait === 'size'
          ? environment.sizeWindowMax
          : trait === 'mateDetection'
            ? environment.mateDetectionWindowMax
            : environment.offspringInvestmentWindowMax
  let affected = 0
  const creatures = world.creatures
  for (let i = 0; i < creatures.length; i++) {
    const value = creatures[i].genome[trait]
    const clamped = Math.min(max, Math.max(min, value))
    if (clamped === value) continue
    creatures[i].genome[trait] = clamped
    affected += 1
  }
  return affected
}

function nonNegative(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(0, value)
}

export function initialEnvironment(options: {
  foodSpawnPerSecond?: number
  foodEnergy?: number
  environment?: Partial<Environment>
} = {}): Environment {
  const next = v1Environment()
  if (options.foodSpawnPerSecond !== undefined) {
    next.foodSpawnPerSecond = nonNegative(options.foodSpawnPerSecond, next.foodSpawnPerSecond)
  }
  if (options.foodEnergy !== undefined) next.foodEnergy = nonNegative(options.foodEnergy, next.foodEnergy)

  const extra = options.environment
  if (extra) {
    if (extra.reproductionMode === 'asexual' || extra.reproductionMode === 'sexual') {
      next.reproductionMode = extra.reproductionMode
    }
    if (typeof extra.litterEnergyLimited === 'boolean') next.litterEnergyLimited = extra.litterEnergyLimited
    for (const field of ENVIRONMENT_FIELDS) {
      const raw = extra[field.key]
      if (raw === undefined) continue
      next[field.key] = readEnvironmentControl(field.key, raw)
    }
    if (next.speedWindowMin > next.speedWindowMax) next.speedWindowMin = next.speedWindowMax
    if (next.visionWindowMin > next.visionWindowMax) next.visionWindowMin = next.visionWindowMax
    if (next.mateDetectionWindowMin > next.mateDetectionWindowMax) {
      next.mateDetectionWindowMin = next.mateDetectionWindowMax
    }
    if (next.offspringInvestmentWindowMin > next.offspringInvestmentWindowMax) {
      next.offspringInvestmentWindowMin = next.offspringInvestmentWindowMax
    }
    if (next.sizeWindowMin > next.sizeWindowMax) next.sizeWindowMin = next.sizeWindowMax
  }
  return next
}

/** The cap the world actually enforces. Never above the computational ceiling. */
export function populationLimit(environment: Environment): number {
  const cap = environment.populationCap
  if (!Number.isFinite(cap)) return CONFIG.population.max
  return Math.min(CONFIG.population.absoluteMax, Math.max(1, Math.floor(cap)))
}
