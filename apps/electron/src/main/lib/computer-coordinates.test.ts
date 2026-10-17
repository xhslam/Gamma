import { describe, expect, it } from 'bun:test'
import {
  type DisplayGeometry,
  logicalPointToModel,
  modelToLogicalPoint,
} from './computer-coordinates'

describe('computer-coordinates 坐标换算系统', () => {
  it('Given 1x 显示器 (1920x1080 -> 1280x720) > When 换算中心点 Then 精确还原', () => {
    const display: DisplayGeometry = {
      originX: 0,
      originY: 0,
      ptWidth: 1920,
      ptHeight: 1080,
      scaledWidth: 1280,
      scaledHeight: 720,
    }

    // 图像中心点
    const logical = modelToLogicalPoint({ x: 640, y: 360 }, display)
    expect(logical.x).toBe(960)
    expect(logical.y).toBe(540)

    // 反向还原
    const model = logicalPointToModel(logical, display)
    expect(model.x).toBe(640)
    expect(model.y).toBe(360)
  })

  it('Given Retina 2x 显示器 (1440x900 逻辑点, 2880x1800 像素 -> 缩放至 1280x800) > When 换算顶点与特定控件 Then 精确映射', () => {
    const display: DisplayGeometry = {
      originX: 0,
      originY: 0,
      ptWidth: 1440,
      ptHeight: 900,
      scaledWidth: 1280,
      scaledHeight: 800,
    }

    // 左上角原点
    const origin = modelToLogicalPoint({ x: 0, y: 0 }, display)
    expect(origin.x).toBe(0)
    expect(origin.y).toBe(0)

    // 右下角
    const corner = modelToLogicalPoint({ x: 1280, y: 800 }, display)
    expect(corner.x).toBe(1440)
    expect(corner.y).toBe(900)

    // 备忘录新建笔记按钮大概位置 (如 x: 100, y: 50)
    const buttonLogical = modelToLogicalPoint({ x: 100, y: 50 }, display)
    expect(buttonLogical.x).toBe(112.5)
    expect(buttonLogical.y).toBe(56.25)
  })

  it('Given 多显示器主屏与副屏 (副屏位于左侧或右侧) > When 换算全局带偏移坐标 Then 准确定位到副屏', () => {
    // 副屏在右侧，originX = 1440
    const rightDisplay: DisplayGeometry = {
      originX: 1440,
      originY: 0,
      ptWidth: 1920,
      ptHeight: 1080,
      scaledWidth: 1280,
      scaledHeight: 720,
    }

    const rightPoint = modelToLogicalPoint({ x: 640, y: 360 }, rightDisplay)
    expect(rightPoint.x).toBe(2400) // 1440 + 960
    expect(rightPoint.y).toBe(540)

    // 副屏在左侧，originX = -1920
    const leftDisplay: DisplayGeometry = {
      originX: -1920,
      originY: 0,
      ptWidth: 1920,
      ptHeight: 1080,
      scaledWidth: 1280,
      scaledHeight: 720,
    }

    const leftPoint = modelToLogicalPoint({ x: 640, y: 360 }, leftDisplay)
    expect(leftPoint.x).toBe(-960) // -1920 + 960
    expect(leftPoint.y).toBe(540)
  })

  it('Given 越界坐标 > When 超过 scaled 宽高或为负值 Then 安全截断至显示边界', () => {
    const display: DisplayGeometry = {
      originX: 0,
      originY: 0,
      ptWidth: 1440,
      ptHeight: 900,
      scaledWidth: 1280,
      scaledHeight: 800,
    }

    const negative = modelToLogicalPoint({ x: -50, y: -20 }, display)
    expect(negative.x).toBe(0)
    expect(negative.y).toBe(0)

    const overflow = modelToLogicalPoint({ x: 2000, y: 1500 }, display)
    expect(overflow.x).toBe(1440)
    expect(overflow.y).toBe(900)
  })
})
