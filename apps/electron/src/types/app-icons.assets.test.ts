import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { APP_ICON_VARIANTS, getAppIconResourcePath } from './app-icons'

const electronDir = resolve(import.meta.dir, '../..')
const resourcesDir = join(electronDir, 'resources')
const sourcesDir = join(resourcesDir, 'icon-sources')
const logosDir = join(resourcesDir, 'gamma-logos')
const previewsDir = join(electronDir, 'src/renderer/assets/bots/gamma-logos')

// 独立验收配色数量与默认品牌色，避免旧金属资源混入导出。
const SOURCE_IDENTITIES = APP_ICON_VARIANTS

interface DecodedIcon {
  pixels: Buffer
  width: number
  height: number
}

interface AlphaBounds {
  left: number
  top: number
  right: number
  bottom: number
}

interface IcnsImage {
  kind: string
  png: Buffer
}

async function decodeRgba(image: Buffer, size: number): Promise<DecodedIcon> {
  expect(await sharp(image).metadata()).toMatchObject({
    width: size, height: size, format: 'png', channels: 4, hasAlpha: true,
  })
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true })
  expect(info.channels).toBe(4)
  return { pixels: data, width: info.width, height: info.height }
}

function alphaAt(image: DecodedIcon, x: number, y: number): number {
  return image.pixels[(y * image.width + x) * 4 + 3]!
}

function getAlphaBounds(image: DecodedIcon, threshold = 1): AlphaBounds | null {
  let left = image.width
  let top = image.height
  let right = -1
  let bottom = -1
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (alphaAt(image, x, y) < threshold) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  return right < 0 ? null : { left, top, right, bottom }
}

function expectDockGeometry(image: DecodedIcon): void {
  // 独立验收：824px 主体放大 4% 后舍入为 857px，1024 画布两侧留白 83/84px。
  expect(getAlphaBounds(image)).toEqual({ left: 83, top: 83, right: 939, bottom: 939 })
  expect(Math.abs(857 / 824 - 1.04)).toBeLessThan(0.001)
  let nonTransparentMarginPixels = 0
  let antialiasedPixels = 0
  for (let y = 0; y < 1024; y++) {
    for (let x = 0; x < 1024; x++) {
      const alpha = alphaAt(image, x, y)
      if ((x < 83 || x >= 940 || y < 83 || y >= 940) && alpha !== 0) nonTransparentMarginPixels++
      if (alpha > 0 && alpha < 255) antialiasedPixels++
    }
  }
  expect(nonTransparentMarginPixels).toBe(0)
  expect(antialiasedPixels).toBeGreaterThan(100)
  for (const [x, y] of [[0, 0], [1023, 0], [0, 1023], [1023, 1023], [83, 83], [939, 83], [83, 939], [939, 939]] as const) {
    expect(alphaAt(image, x, y)).toBe(0)
  }
  for (const [x, y] of [[512, 83], [512, 939], [83, 512], [939, 512], [512, 512]] as const) {
    expect(alphaAt(image, x, y)).toBe(255)
  }

  // 从圆心沿三条射线取内外样本，检查圆角也按 4% 比例放大。
  for (const angle of [Math.PI / 6, Math.PI / 4, Math.PI / 3]) {
    for (const [radius, expectedAlpha] of [[189, 255], [196, 0]] as const) {
      const localX = Math.round(192.4 - radius * Math.cos(angle))
      const localY = Math.round(192.4 - radius * Math.sin(angle))
      for (const [x, y] of [
        [83 + localX, 83 + localY], [939 - localX, 83 + localY],
        [83 + localX, 939 - localY], [939 - localX, 939 - localY],
      ] as const) expect(alphaAt(image, x, y)).toBe(expectedAlpha)
    }
  }
}

function readIcnsImages(): IcnsImage[] {
  const icns = readFileSync(join(resourcesDir, 'icon.icns'))
  expect(icns.toString('ascii', 0, 4)).toBe('icns')
  expect(icns.readUInt32BE(4)).toBe(icns.length)
  let offset = 8
  const images: IcnsImage[] = []
  while (offset < icns.length) {
    const kind = icns.toString('ascii', offset, offset + 4)
    const length = icns.readUInt32BE(offset + 4)
    expect(length).toBeGreaterThanOrEqual(8)
    expect(offset + length).toBeLessThanOrEqual(icns.length)
    const image = icns.subarray(offset + 8, offset + length)
    if (image.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') images.push({ kind, png: image })
    offset += length
  }
  expect(offset).toBe(icns.length)
  expect(images.some((image) => image.kind === 'ic10')).toBe(true)
  return images
}

function readIco256(): Buffer {
  const ico = readFileSync(join(resourcesDir, 'icon.ico'))
  expect(ico.readUInt16LE(0)).toBe(0)
  expect(ico.readUInt16LE(2)).toBe(1)
  const count = ico.readUInt16LE(4)
  expect(count).toBeGreaterThan(0)
  for (let index = 0; index < count; index++) {
    const directoryOffset = 6 + index * 16
    const width = ico[directoryOffset] || 256
    const height = ico[directoryOffset + 1] || 256
    const imageSize = ico.readUInt32LE(directoryOffset + 8)
    const imageOffset = ico.readUInt32LE(directoryOffset + 12)
    expect(imageOffset + imageSize).toBeLessThanOrEqual(ico.length)
    if (width === 256 && height === 256) return ico.subarray(imageOffset, imageOffset + imageSize)
  }
  throw new Error('Windows 图标缺少 256px 图像')
}

describe('十三款应用图标的原始来源、Dock 几何与打包资源', () => {
  test('Given 已确认的十三款像素配色 When 读取资源清单 Then ID唯一且所有预览与运行文件齐全', async () => {
    expect(APP_ICON_VARIANTS).toHaveLength(13)
    expect(new Set(APP_ICON_VARIANTS.map((variant) => variant.id)).size).toBe(13)
    expect(APP_ICON_VARIANTS[0]).toMatchObject({ id: 'default', name: '米白蓝绿', fileName: 'gamma-ivory-teal.png', background: '#F2EBDD', foreground: '#345F6C' })
    const source = readFileSync(join(sourcesDir, 'pixel-gamma.svg'), 'utf-8')
    expect(source).toContain('<path')
    expect(source).not.toContain('<image')
    const expectedFiles = SOURCE_IDENTITIES.map((source) => source.fileName).sort()
    for (const dir of [logosDir, previewsDir]) {
      expect(readdirSync(dir).filter((file) => file.startsWith('gamma-') && file.endsWith('.png')).sort()).toEqual(expectedFiles)
    }
    for (const identity of SOURCE_IDENTITIES) {
      expect(getAppIconResourcePath(identity.id)).toBe(identity.id === 'default' ? 'icon.png' : `gamma-logos/${identity.fileName}`)
    }
  })

  test('Given 十三款运行资源与renderer预览 When 解码各图 Then 主体放大4%为857px且透明圆角与预览一致', async () => {
    const distinctExports = new Set<string>()
    for (const identity of SOURCE_IDENTITIES) {
      const icon = readFileSync(join(logosDir, identity.fileName))
      expect(readFileSync(join(previewsDir, identity.fileName)).equals(icon)).toBe(true)
      expectDockGeometry(await decodeRgba(icon, 1024))
      distinctExports.add(createHash('sha256').update(icon).digest('hex'))
    }
    expect(distinctExports.size).toBe(13)
  })

  test('Given 深浅与彩色底板 When 检查笔画与留白 Then 十三款均保留不透明的像素γ与对应配色', async () => {
    for (const variant of APP_ICON_VARIANTS) {
      const image = await decodeRgba(readFileSync(join(logosDir, variant.fileName)), 1024)
      const rgb = (hex: string) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
      // 独立取样：左上臂、右上臂、下钩，以及分叉中间和两侧留白。
      for (const [x, y, color] of [
        [320, 270, variant.foreground], [680, 270, variant.foreground], [520, 750, variant.foreground],
        [510, 300, variant.background], [200, 512, variant.background], [800, 512, variant.background],
      ] as const) {
        const offset = (y * 1024 + x) * 4
        expect([...image.pixels.subarray(offset, offset + 4)]).toEqual([...rgb(color), 255])
      }
    }
  })

  test('Given 默认米白蓝绿的处理后PNG When 读取应用图标与内部品牌图 Then 两处使用同一份带透明留白的1024px导出', async () => {
    const defaultIcon = readFileSync(join(logosDir, 'gamma-ivory-teal.png'))
    const appIcon = readFileSync(join(resourcesDir, 'icon.png'))
    expect(appIcon.equals(defaultIcon)).toBe(true)
    expect(readFileSync(join(electronDir, 'src/renderer/assets/models/gamma.png')).equals(defaultIcon)).toBe(true)
    expectDockGeometry(await decodeRgba(appIcon, 1024))
  })

  test('Given macOS安装图标 When 解码容器中各分辨率PNG Then 均保留透明四角与放大后的主体且1024px图对应默认米白蓝绿', async () => {
    const defaultPixels = (await decodeRgba(readFileSync(join(resourcesDir, 'icon.png')), 1024)).pixels
    for (const entry of readIcnsImages()) {
      const size = (await sharp(entry.png).metadata()).width
      if (!size) throw new Error(`macOS 图标 ${entry.kind} 没有可读取的尺寸`)
      expect([16, 32, 64, 128, 256, 512, 1024]).toContain(size)
      const image = await decodeRgba(entry.png, size)
      const bounds = getAlphaBounds(image, 128)
      if (!bounds) throw new Error(`macOS 图标 ${entry.kind} 的主体完全透明`)
      for (const [edge, originalInset] of [[bounds.left, 83], [bounds.top, 83], [size - 1 - bounds.right, 84], [size - 1 - bounds.bottom, 84]]) {
        const expectedInset = size * originalInset! / 1024
        expect(Math.abs(edge! - expectedInset)).toBeLessThanOrEqual(1)
      }
      for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]]) {
        expect(alphaAt(image, x!, y!)).toBe(0)
      }
      if (entry.kind === 'ic10') {
        expect(size).toBe(1024)
        expectDockGeometry(image)
        expect(image.pixels.equals(defaultPixels)).toBe(true)
      }
    }
  })

  test('Given Windows安装图标 When 解码256px容器图像 Then 保留四角透明与缩放后的21px留白且内部蓝绿色不被挖空', async () => {
    const image = await decodeRgba(readIco256(), 256)
    const expectedPixels = await sharp(join(resourcesDir, 'icon.png')).resize(256, 256).raw().toBuffer()
    // 缩小滤波可在边界产生极低alpha；以半透明阈值独立验收约214px主体的实际尺寸。
    expect(getAlphaBounds(image, 128)).toEqual({ left: 21, top: 21, right: 234, bottom: 234 })
    for (const [x, y] of [[0, 0], [255, 0], [0, 255], [255, 255], [21, 21], [234, 21], [21, 234], [234, 234]] as const) {
      expect(alphaAt(image, x, y)).toBe(0)
    }
    let nonTransparentMarginPixels = 0
    let opaqueMarginPixels = 0
    let opaqueDarkPixels = 0
    let nonOpaqueInteriorPixels = 0
    let colorDifference = 0
    let comparedChannels = 0
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const alpha = alphaAt(image, x, y)
        // 容器缩小的滤波尾部最多占3px；21px主体外只允许低alpha，外侧18px完全透明。
        if ((x < 18 || x >= 238 || y < 18 || y >= 238) && alpha !== 0) nonTransparentMarginPixels++
        if ((x < 20 || x >= 236 || y < 20 || y >= 236) && alpha > 20) opaqueMarginPixels++
        if (x < 72 || x > 183 || y < 72 || y > 183) continue
        if (alpha !== 255) nonOpaqueInteriorPixels++
        const offset = (y * 256 + x) * 4
        if (image.pixels[offset]! < 90 && image.pixels[offset + 1]! < 120 && image.pixels[offset + 2]! < 130) opaqueDarkPixels++
        for (let channel = 0; channel < 3; channel++) {
          colorDifference += Math.abs(image.pixels[offset + channel]! - expectedPixels[offset + channel]!)
          comparedChannels++
        }
      }
    }
    expect(nonTransparentMarginPixels).toBe(0)
    expect(opaqueMarginPixels).toBe(0)
    expect(nonOpaqueInteriorPixels).toBe(0)
    expect(opaqueDarkPixels).toBeGreaterThan(50)
    // 不同缩小滤波器允许少量RGB差异，但应保持默认米白蓝绿。
    expect(colorDifference / comparedChannels).toBeLessThan(5)
  })
})
