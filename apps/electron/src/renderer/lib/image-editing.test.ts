import { describe, expect, test } from 'bun:test'
import {
  buildImageCommentPrompt,
  calculateCenteredAspectCrop,
  cloneImageAnnotations,
  getAnnotationBounds,
  hitTestAnnotation,
  removeBackgroundAt,
  removeEdgeBackground,
  translateAnnotation,
} from './image-editing'
import type { ImageAnnotation, PixelImage } from './image-editing'

function image(rows: Array<Array<[number, number, number, number]>>): PixelImage {
  return {
    width: rows[0]?.length ?? 0,
    height: rows.length,
    data: new Uint8ClampedArray(rows.flat(2)),
  }
}

const white: [number, number, number, number] = [255, 255, 255, 255]
const black: [number, number, number, number] = [0, 0, 0, 255]

describe('Given 图片评论坐标', () => {
  test('When 生成编辑要求 Then 编号与归一化百分比坐标稳定且忽略空评论', () => {
    const prompt = buildImageCommentPrompt([
      { id: 'a', x: 0.18234, y: 0.0241, text: '  在这块侧边栏加上细线  ' },
      { id: 'b', x: 0.5, y: 0.5, text: '   ' },
      { id: 'c', x: 2, y: -1, text: '修复文字' },
    ])
    expect(prompt).toContain('根据图片中的编号评论')
    expect(prompt).toContain('1. (x: 18.2%, y: 2.4%) 在这块侧边栏加上细线')
    expect(prompt).toContain('2. (x: 100.0%, y: 0.0%) 修复文字')
    expect(prompt).not.toContain('0.5')
    expect(buildImageCommentPrompt([])).toBe('')
  })
})

describe('Given 不同方向与旋转状态的图片', () => {
  test('When 设置比例 Then 返回居中最大裁剪框并考虑旋转后的显示比例', () => {
    expect(calculateCenteredAspectCrop(1600, 900, 1)).toEqual({ x: 350, y: 0, w: 900, h: 900 })
    expect(calculateCenteredAspectCrop(800, 1200, 16 / 9)).toEqual({ x: 0, y: 375, w: 800, h: 450 })
    expect(calculateCenteredAspectCrop(1600, 900, 16 / 9, 90)).toEqual({ x: 547, y: 0, w: 506, h: 900 })
  })

  test('When 输入无效尺寸 Then 明确拒绝而不是产生空图片', () => {
    expect(() => calculateCenteredAspectCrop(0, 100, 1)).toThrow('图片尺寸和比例必须大于 0')
  })
})

describe('Given 连通背景与前景像素', () => {
  test('When 移除边缘白色背景 Then 保留封闭前景和内部不相连白色', () => {
    const source = image([
      [white, white, white, white, white],
      [white, black, black, black, white],
      [white, black, white, black, white],
      [white, black, black, black, white],
      [white, white, white, white, white],
    ])
    const result = removeEdgeBackground(source, 12)
    expect(result.removed).toBe(16)
    expect(result.data[(2 * 5 + 2) * 4 + 3]).toBe(255)
    expect(result.data[(2 * 5 + 1) * 4 + 3]).toBe(255)
    expect(result.data[3]).toBe(0)
  })

  test('When 点击局部背景 Then 只擦除该连通区域并支持颜色容差', () => {
    const nearWhite: [number, number, number, number] = [250, 250, 250, 255]
    const source = image([
      [white, nearWhite, black, white],
      [white, white, black, white],
    ])
    const result = removeBackgroundAt(source, { x: 0, y: 0 }, 10)
    expect(result.removed).toBe(4)
    expect(result.data[(0 * 4 + 3) * 4 + 3]).toBe(255)
    expect(result.data[(1 * 4 + 2) * 4 + 3]).toBe(255)
  })

  test('When 主体碰到边角 Then 自动移除四边的背景并保留主体', () => {
    const source = image([
      [black, white, white],
      [black, black, white],
      [white, white, white],
    ])
    const result = removeEdgeBackground(source)
    expect(result.removed).toBe(6)
    expect(result.data[3]).toBe(255)
    expect(removeEdgeBackground({ ...source, data: result.data }).removed).toBe(0)
  })
})

describe('Given 可选择和移动的标注对象', () => {
  test('When 命中、移动及撤销克隆 Then 坐标正确且历史快照互不污染', () => {
    const annotation: ImageAnnotation = {
      id: 'shape', type: 'rect', x: 10, y: 20, w: 100, h: 50, color: '#f00', size: 4,
    }
    expect(getAnnotationBounds(annotation)).toEqual({ x: 10, y: 20, w: 100, h: 50 })
    expect(hitTestAnnotation(annotation, { x: 50, y: 40 })).toBe(true)
    expect(hitTestAnnotation(annotation, { x: 200, y: 40 })).toBe(false)
    const history = cloneImageAnnotations([annotation])
    const moved = translateAnnotation(annotation, 5, -10)
    expect(moved).toMatchObject({ x: 15, y: 10 })
    expect(history[0]).toMatchObject({ x: 10, y: 20 })
  })
})
