import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { createTrayIconSvg } from './generate-tray-icons'

const resourcesDir = resolve(import.meta.dir, '../resources')

describe('菜单栏像素 γ 图标', () => {
  test('给定 App 矢量源，生成相同轮廓且不包含底板的单色模板', () => {
    const source = readFileSync(resolve(resourcesDir, 'icon-sources/pixel-gamma.svg'), 'utf8')
    const svg = createTrayIconSvg(source)
    expect(svg).toContain(source.match(/\bd="([^"]+)"/)![1]!)
    expect(svg).toContain('fill="black"')
    expect(svg).not.toContain('<rect')
  })

  test('给定缺失轮廓的源文件，拒绝生成空白图标', () => {
    expect(() => createTrayIconSvg('<svg/>')).toThrow('缺少像素 γ 路径')
  })

  for (const scale of [1, 2, 3]) {
    test(`给定 ${scale}x 资源，与 App 轮廓导出一致且四周透明`, async () => {
      const suffix = scale === 1 ? '' : `@${scale}x`
      const source = readFileSync(resolve(resourcesDir, 'icon-sources/pixel-gamma.svg'), 'utf8')
      const actual = await sharp(resolve(resourcesDir, `gamma-logos/iconTemplate${suffix}.png`)).raw().toBuffer({ resolveWithObject: true })
      const expected = await sharp(Buffer.from(createTrayIconSvg(source))).resize(22 * scale, 22 * scale).raw().toBuffer()
      expect(actual.info.width).toBe(22 * scale)
      expect(actual.info.height).toBe(22 * scale)
      expect(actual.info.channels).toBe(4)
      expect(actual.data.equals(expected)).toBe(true)
      const size = actual.info.width
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const offset = (y * size + x) * 4
          expect(actual.data[offset]).toBe(0)
          expect(actual.data[offset + 1]).toBe(0)
          expect(actual.data[offset + 2]).toBe(0)
          if (x === 0 || y === 0 || x === size - 1 || y === size - 1) {
            expect(actual.data[offset + 3]).toBe(0)
          }
        }
      }
    })
  }
})
