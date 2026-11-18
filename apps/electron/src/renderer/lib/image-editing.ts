/** 图片高级编辑的纯逻辑：坐标、标注、比例裁剪与背景移除。 */

export interface ImagePoint {
  x: number
  y: number
}

interface AnnotationBase {
  id: string
  color: string
  size: number
}

export interface DrawAnnotation extends AnnotationBase {
  type: 'draw'
  points: ImagePoint[]
}

export interface ShapeAnnotation extends AnnotationBase {
  type: 'rect' | 'ellipse' | 'arrow'
  x: number
  y: number
  w: number
  h: number
}

export interface TextAnnotation extends AnnotationBase {
  type: 'text'
  x: number
  y: number
  text: string
}

export type ImageAnnotation = DrawAnnotation | ShapeAnnotation | TextAnnotation

export interface ImageComment {
  id: string
  /** 相对图片宽度的坐标，范围 0–1。 */
  x: number
  /** 相对图片高度的坐标，范围 0–1。 */
  y: number
  text: string
}

export interface ImageRect {
  x: number
  y: number
  w: number
  h: number
}

export interface PixelImage {
  width: number
  height: number
  data: Uint8ClampedArray<ArrayBuffer>
}

export const IMAGE_ASPECT_RATIOS = [
  { id: '1:1', label: '正方形', ratio: 1 },
  { id: '3:4', label: '竖向', ratio: 3 / 4 },
  { id: '9:16', label: '故事版式', ratio: 9 / 16 },
  { id: '4:3', label: '横向', ratio: 4 / 3 },
  { id: '16:9', label: '宽屏', ratio: 16 / 9 },
] as const

export type ImageAspectRatio = typeof IMAGE_ASPECT_RATIOS[number]['id']

export function cloneImageAnnotations(annotations: ImageAnnotation[]): ImageAnnotation[] {
  return annotations.map((annotation) => annotation.type === 'draw'
    ? { ...annotation, points: annotation.points.map((point) => ({ ...point })) }
    : { ...annotation })
}

export function getAnnotationBounds(annotation: ImageAnnotation): ImageRect {
  if (annotation.type === 'draw') {
    if (annotation.points.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
    const xs = annotation.points.map((point) => point.x)
    const ys = annotation.points.map((point) => point.y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
  }
  if (annotation.type === 'text') {
    const lines = annotation.text.split('\n')
    const width = Math.max(...lines.map((line) => Array.from(line).reduce((width, character) => {
      return width + (/^[\x00-\xff]$/.test(character) ? 0.6 : 1)
    }, 0)), 1) * annotation.size
    return { x: annotation.x, y: annotation.y - annotation.size, w: width, h: lines.length * annotation.size * 1.25 }
  }
  return {
    x: Math.min(annotation.x, annotation.x + annotation.w),
    y: Math.min(annotation.y, annotation.y + annotation.h),
    w: Math.abs(annotation.w),
    h: Math.abs(annotation.h),
  }
}

export function hitTestAnnotation(annotation: ImageAnnotation, point: ImagePoint, tolerance = 8): boolean {
  const bounds = getAnnotationBounds(annotation)
  const padding = tolerance + annotation.size / 2
  return point.x >= bounds.x - padding && point.x <= bounds.x + bounds.w + padding
    && point.y >= bounds.y - padding && point.y <= bounds.y + bounds.h + padding
}

export function translateAnnotation(annotation: ImageAnnotation, dx: number, dy: number): ImageAnnotation {
  if (annotation.type === 'draw') {
    return { ...annotation, points: annotation.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) }
  }
  return { ...annotation, x: annotation.x + dx, y: annotation.y + dy }
}

/** 以画布中心生成指定比例的最大裁剪框；旋转 90°/270° 时使用最终显示方向的比例。 */
export function calculateCenteredAspectCrop(
  width: number,
  height: number,
  ratio: number,
  rotation = 0,
): ImageRect {
  if (width <= 0 || height <= 0 || ratio <= 0) throw new Error('图片尺寸和比例必须大于 0')
  const targetRatio = rotation % 180 === 0 ? ratio : 1 / ratio
  const sourceRatio = width / height
  let w = width
  let h = height
  if (sourceRatio > targetRatio) w = Math.max(1, Math.round(height * targetRatio))
  else h = Math.max(1, Math.round(width / targetRatio))
  return {
    x: Math.round((width - w) / 2),
    y: Math.round((height - h) / 2),
    w,
    h,
  }
}

/** 生成随编号标记图片一起交给 Agent 的结构化坐标说明。 */
export function buildImageCommentPrompt(comments: ImageComment[]): string {
  const lines = comments
    .filter((comment) => comment.text.trim())
    .map((comment, index) => {
      const x = Math.min(100, Math.max(0, comment.x * 100)).toFixed(1)
      const y = Math.min(100, Math.max(0, comment.y * 100)).toFixed(1)
      return `${index + 1}. (x: ${x}%, y: ${y}%) ${comment.text.trim()}`
    })
  if (lines.length === 0) return ''
  return `请根据图片中的编号评论精准修改，保持未提及区域不变：\n图像 1：\n${lines.join('\n')}`
}

function colorDistance(data: Uint8ClampedArray, index: number, red: number, green: number, blue: number): number {
  const offset = index * 4
  const dr = (data[offset] ?? 0) - red
  const dg = (data[offset + 1] ?? 0) - green
  const db = (data[offset + 2] ?? 0) - blue
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

interface BackgroundRemovalResult {
  data: Uint8ClampedArray<ArrayBuffer>
  removed: number
}

function removeConnectedColors(
  image: PixelImage,
  seeds: number[],
  red: number,
  green: number,
  blue: number,
  tolerance: number,
): BackgroundRemovalResult {
  const { width, height } = image
  const total = width * height
  const data = new Uint8ClampedArray(image.data)
  const visited = new Uint8Array(total)
  const queue = new Int32Array(total)
  let head = 0
  let tail = 0
  let removed = 0
  const threshold = Math.max(0, tolerance)

  for (const seed of seeds) {
    if (seed < 0 || seed >= total || visited[seed]) continue
    visited[seed] = 1
    queue[tail++] = seed
  }

  while (head < tail) {
    const index = queue[head++]
    if (index === undefined) continue
    const offset = index * 4
    if (data[offset + 3] === 0 || colorDistance(data, index, red, green, blue) > threshold) continue
    data[offset + 3] = 0
    removed += 1
    const x = index % width
    const y = Math.floor(index / width)
    const neighbors = [
      x > 0 ? index - 1 : -1,
      x + 1 < width ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y + 1 < height ? index + width : -1,
    ]
    for (const neighbor of neighbors) {
      if (neighbor >= 0 && !visited[neighbor]) {
        visited[neighbor] = 1
        queue[tail++] = neighbor
      }
    }
  }
  return { data, removed }
}

/** 移除点击位置所属的连通相近色区域，不影响不相连的相同颜色。 */
export function removeBackgroundAt(
  image: PixelImage,
  point: ImagePoint,
  tolerance = 40,
): BackgroundRemovalResult {
  if (image.width <= 0 || image.height <= 0 || image.data.length < 4) {
    return { data: new Uint8ClampedArray(image.data), removed: 0 }
  }
  const x = Math.min(image.width - 1, Math.max(0, Math.floor(point.x)))
  const y = Math.min(image.height - 1, Math.max(0, Math.floor(point.y)))
  const seed = y * image.width + x
  const offset = seed * 4
  return removeConnectedColors(
    image,
    [seed],
    image.data[offset] ?? 0,
    image.data[offset + 1] ?? 0,
    image.data[offset + 2] ?? 0,
    tolerance,
  )
}

/** 从与左上角同色的图像边缘向内移除背景，适合常见的纯色和近纯色底图。 */
export function removeEdgeBackground(image: PixelImage, tolerance = 40): BackgroundRemovalResult {
  if (image.width <= 0 || image.height <= 0 || image.data.length < 4) {
    return { data: new Uint8ClampedArray(image.data), removed: 0 }
  }
  const red = image.data[0] ?? 0
  const green = image.data[1] ?? 0
  const blue = image.data[2] ?? 0
  const seeds: number[] = []
  const threshold = Math.max(0, tolerance)
  for (let x = 0; x < image.width; x += 1) {
    const top = x
    const bottom = (image.height - 1) * image.width + x
    if (colorDistance(image.data, top, red, green, blue) <= threshold) seeds.push(top)
    if (colorDistance(image.data, bottom, red, green, blue) <= threshold) seeds.push(bottom)
  }
  for (let y = 1; y + 1 < image.height; y += 1) {
    const left = y * image.width
    const right = left + image.width - 1
    if (colorDistance(image.data, left, red, green, blue) <= threshold) seeds.push(left)
    if (colorDistance(image.data, right, red, green, blue) <= threshold) seeds.push(right)
  }
  return removeConnectedColors(image, seeds, red, green, blue, tolerance)
}
