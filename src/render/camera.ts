export interface Camera {
  scale: number
  offsetX: number
  offsetY: number
  viewWidth: number
  viewHeight: number
}

export function cameraFor(
  worldWidth: number,
  worldHeight: number,
  viewWidth: number,
  viewHeight: number,
): Camera {
  const safeW = Math.max(viewWidth, 1)
  const safeH = Math.max(viewHeight, 1)
  const scale = Math.min(safeW / worldWidth, safeH / worldHeight)
  return {
    scale,
    offsetX: (safeW - worldWidth * scale) / 2,
    offsetY: (safeH - worldHeight * scale) / 2,
    viewWidth: safeW,
    viewHeight: safeH,
  }
}

export function screenToWorld(camera: Camera, x: number, y: number): { x: number; y: number } {
  return {
    x: (x - camera.offsetX) / camera.scale,
    y: (y - camera.offsetY) / camera.scale,
  }
}
