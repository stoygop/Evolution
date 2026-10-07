import { CONFIG } from '../config.ts'
import type { StatsSample } from '../sim/types.ts'

interface Series {
  label: string
  color: string
  read: (sample: StatsSample) => number
  min: number | 'auto'
  max: number | 'auto'
  digits: number
}

const series: Series[] = [
  { label: 'Population', color: '#efe7d6', read: (s) => s.population, min: 0, max: 'auto', digits: 0 },
  {
    label: 'Avg speed',
    color: '#e07a4a',
    read: (s) => s.avgSpeed,
    min: CONFIG.trait.speed.min,
    max: CONFIG.trait.speed.max,
    digits: 1,
  },
  {
    label: 'Avg vision',
    color: '#8ec8e8',
    read: (s) => s.avgVision,
    min: CONFIG.trait.vision.min,
    max: CONFIG.trait.vision.max,
    digits: 1,
  },
  {
    label: 'Avg size',
    color: '#e2c15a',
    read: (s) => s.avgSize,
    min: CONFIG.trait.size.min,
    max: CONFIG.trait.size.max,
    digits: 2,
  },
]

export function renderCharts(
  ctx: CanvasRenderingContext2D,
  history: readonly StatsSample[],
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): void {
  const width = Math.max(cssWidth, 1)
  const height = Math.max(cssHeight, 1)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  const gap = 10
  const cols = width < 640 ? 2 : 4
  const rows = cols === 4 ? 1 : 2
  const panelW = (width - gap * (cols - 1)) / cols
  const panelH = (height - gap * (rows - 1)) / rows

  for (let i = 0; i < series.length; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    drawPanel(ctx, series[i], history, col * (panelW + gap), row * (panelH + gap), panelW, panelH)
  }
}

function drawPanel(
  ctx: CanvasRenderingContext2D,
  item: Series,
  history: readonly StatsSample[],
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.fillStyle = '#171d13'
  ctx.fillRect(x, y, w, h)

  const padL = 8
  const padR = 8
  const padT = 22
  const padB = 8
  const plotX = x + padL
  const plotY = y + padT
  const plotW = Math.max(1, w - padL - padR)
  const plotH = Math.max(1, h - padT - padB)

  let min = item.min === 'auto' ? Infinity : item.min
  let max = item.max === 'auto' ? -Infinity : item.max
  if (item.min === 'auto' || item.max === 'auto') {
    for (let i = 0; i < history.length; i++) {
      const value = item.read(history[i])
      if (item.min === 'auto') min = Math.min(min, value)
      if (item.max === 'auto') max = Math.max(max, value)
    }
    if (!Number.isFinite(min)) min = 0
    if (!Number.isFinite(max)) max = 1
  }
  if (max - min < 1e-6) max = min + 1

  ctx.strokeStyle = 'rgba(239, 231, 214, 0.08)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let g = 0; g <= 2; g++) {
    const gy = plotY + (plotH * g) / 2
    ctx.moveTo(plotX, gy)
    ctx.lineTo(plotX + plotW, gy)
  }
  ctx.stroke()

  if (history.length > 0) {
    ctx.beginPath()
    const denom = Math.max(1, history.length - 1)
    for (let i = 0; i < history.length; i++) {
      const value = item.read(history[i])
      const px = plotX + (i / denom) * plotW
      const py = plotY + plotH - ((value - min) / (max - min)) * plotH
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.strokeStyle = item.color
    ctx.lineWidth = 1.6
    ctx.stroke()
  }

  const latest = history.length > 0 ? item.read(history[history.length - 1]) : 0
  ctx.fillStyle = '#b7b09f'
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  ctx.textBaseline = 'top'
  ctx.fillText(item.label, x + 8, y + 6)
  ctx.fillStyle = item.color
  ctx.textAlign = 'right'
  ctx.fillText(latest.toFixed(item.digits), x + w - 8, y + 6)
  ctx.textAlign = 'left'
}
