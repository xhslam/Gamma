import type { ImageAnnotation, ImageComment } from './image-editing'

/** 在原始图片坐标系绘制一个可选标注对象。 */
export function renderImageAnnotation(ctx: CanvasRenderingContext2D, annotation: ImageAnnotation): void {
  ctx.save()
  ctx.strokeStyle = annotation.color
  ctx.fillStyle = annotation.color
  ctx.lineWidth = annotation.size
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (annotation.type === 'draw') {
    const [first, ...rest] = annotation.points
    if (first) {
      ctx.beginPath()
      ctx.moveTo(first.x, first.y)
      if (rest.length === 0) ctx.lineTo(first.x + 0.01, first.y + 0.01)
      for (const point of rest) ctx.lineTo(point.x, point.y)
      ctx.stroke()
    }
  } else if (annotation.type === 'rect') {
    ctx.strokeRect(annotation.x, annotation.y, annotation.w, annotation.h)
  } else if (annotation.type === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse(
      annotation.x + annotation.w / 2,
      annotation.y + annotation.h / 2,
      Math.abs(annotation.w / 2),
      Math.abs(annotation.h / 2),
      0,
      0,
      Math.PI * 2,
    )
    ctx.stroke()
  } else if (annotation.type === 'arrow') {
    const endX = annotation.x + annotation.w
    const endY = annotation.y + annotation.h
    const angle = Math.atan2(annotation.h, annotation.w)
    const headLength = Math.max(12, annotation.size * 4)
    ctx.beginPath()
    ctx.moveTo(annotation.x, annotation.y)
    ctx.lineTo(endX, endY)
    ctx.moveTo(endX, endY)
    ctx.lineTo(endX - headLength * Math.cos(angle - Math.PI / 6), endY - headLength * Math.sin(angle - Math.PI / 6))
    ctx.moveTo(endX, endY)
    ctx.lineTo(endX - headLength * Math.cos(angle + Math.PI / 6), endY - headLength * Math.sin(angle + Math.PI / 6))
    ctx.stroke()
  } else if (annotation.type === 'text') {
    ctx.font = `500 ${annotation.size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
    ctx.textBaseline = 'alphabetic'
    annotation.text.split('\n').forEach((line, index) => {
      ctx.fillText(line, annotation.x, annotation.y + index * annotation.size * 1.25)
    })
  }
  ctx.restore()
}

/** 将评论编号绘制到交给 Agent 的图片副本上，编号与结构化文字一一对应。 */
export function renderImageCommentMarkers(
  ctx: CanvasRenderingContext2D,
  comments: ImageComment[],
  width: number,
  height: number,
): void {
  const radius = Math.max(16, Math.round(Math.min(width, height) * 0.025))
  const fontSize = Math.round(radius * 1.05)
  comments.forEach((comment, index) => {
    const x = comment.x * width
    const y = comment.y * height
    ctx.save()
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fillStyle = '#287d78'
    ctx.fill()
    ctx.lineWidth = Math.max(2, radius * 0.1)
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(index + 1), x, y + fontSize * 0.04)
    ctx.restore()
  })
}
