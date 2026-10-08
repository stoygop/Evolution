import { CONFIG } from '../config.ts'
import { summarize } from '../sim/stats.ts'
import type { StatsSample, World } from '../sim/types.ts'

/** Rolling window for the on-screen charts. The experiment log is separate and is not trimmed. */
export interface ChartHistory {
  samples: StatsSample[]
  record(world: World, dt: number, force?: boolean): void
}

export function createChartHistory(): ChartHistory {
  const samples: StatsSample[] = []
  let accumulator = 0
  return {
    samples,
    record(world: World, dt: number, force = false): void {
      if (!force) {
        accumulator += dt
        if (accumulator < CONFIG.sim.historySampleInterval) return
        accumulator -= CONFIG.sim.historySampleInterval
      }
      samples.push(summarize(world))
      const extra = samples.length - CONFIG.sim.historyLimit
      if (extra > 0) samples.splice(0, extra)
    },
  }
}
