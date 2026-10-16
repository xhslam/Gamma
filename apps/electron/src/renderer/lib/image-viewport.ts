/** 图片以适配视口的尺寸为 1 倍；每个轴独立约束，禁止拖动未溢出的轴。 */
export interface ImageViewportSize { width: number; height: number }
export interface ImageTransform { scale: number; x: number; y: number }
export const INITIAL_IMAGE_TRANSFORM: ImageTransform = { scale: 1, x: 0, y: 0 }
export const MAX_IMAGE_SCALE = 8

export function constrainImageTransform(transform: ImageTransform, image: ImageViewportSize, viewport: ImageViewportSize): ImageTransform {
  const scale = Math.min(MAX_IMAGE_SCALE, Math.max(1, transform.scale))
  const boundX = Math.max(0, (image.width * scale - viewport.width) / 2)
  const boundY = Math.max(0, (image.height * scale - viewport.height) / 2)
  return { scale, x: boundX === 0 ? 0 : Math.min(boundX, Math.max(-boundX, transform.x)), y: boundY === 0 ? 0 : Math.min(boundY, Math.max(-boundY, transform.y)) }
}

/** anchor 是相对于视口中心的指针坐标，缩放前后其对应的图片像素保持不变。 */
export function zoomImageAt(transform: ImageTransform, scale: number, anchor: { x: number; y: number }, image: ImageViewportSize, viewport: ImageViewportSize): ImageTransform {
  const nextScale = Math.min(MAX_IMAGE_SCALE, Math.max(1, scale))
  const ratio = nextScale / transform.scale
  return constrainImageTransform({ scale: nextScale, x: anchor.x - (anchor.x - transform.x) * ratio, y: anchor.y - (anchor.y - transform.y) * ratio }, image, viewport)
}
