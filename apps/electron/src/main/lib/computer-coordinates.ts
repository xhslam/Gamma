export interface DisplayGeometry {
  originX: number
  originY: number
  ptWidth: number
  ptHeight: number
  scaledWidth: number
  scaledHeight: number
}

/**
 * 将模型视觉坐标 (scaledWidth x scaledHeight 图像像素) 转换为 macOS 逻辑点坐标 (Point)。
 * 支持 Retina 缩放及多显示器全局坐标空间偏移 (originX, originY)。
 */
export function modelToLogicalPoint(
  modelCoord: { x: number; y: number },
  display: DisplayGeometry,
): { x: number; y: number } {
  if (display.scaledWidth <= 0 || display.scaledHeight <= 0) {
    throw new Error('无效的缩放尺寸')
  }
  const clampedX = Math.max(0, Math.min(modelCoord.x, display.scaledWidth))
  const clampedY = Math.max(0, Math.min(modelCoord.y, display.scaledHeight))
  const x = display.originX + (clampedX * display.ptWidth) / display.scaledWidth
  const y = display.originY + (clampedY * display.ptHeight) / display.scaledHeight
  return {
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
  }
}

/**
 * 将 macOS 逻辑点坐标转换为模型视觉坐标。
 */
export function logicalPointToModel(
  logicalPoint: { x: number; y: number },
  display: DisplayGeometry,
): { x: number; y: number } {
  if (display.ptWidth <= 0 || display.ptHeight <= 0) {
    throw new Error('无效的逻辑屏幕尺寸')
  }
  const relX = logicalPoint.x - display.originX
  const relY = logicalPoint.y - display.originY
  const clampedX = Math.max(0, Math.min(relX, display.ptWidth))
  const clampedY = Math.max(0, Math.min(relY, display.ptHeight))
  const x = (clampedX * display.scaledWidth) / display.ptWidth
  const y = (clampedY * display.scaledHeight) / display.ptHeight
  return {
    x: Math.round(x),
    y: Math.round(y),
  }
}
