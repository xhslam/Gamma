#!/usr/bin/env bun
/** 从统一像素矢量源导出十三款带透明留白的应用图标，复用现有 sharp 和 electron-builder。 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { APP_ICON_VARIANTS } from '../src/types/app-icons'
import { generateTrayIcons } from './generate-tray-icons'

interface IconConversionResult {
  error?: string
  icons?: Array<{ file: string }>
}

const resourcesDir = resolve(import.meta.dir, '../resources')
const rendererDir = resolve(import.meta.dir, '../src/renderer/assets')
// 在原有 824px 主体上放大 4%，以整数像素导出，同时保持 1024px 画布。
// Electron dock.setIcon 不会替普通 PNG 裁圆角，遮罩必须写进资源的 alpha。
const canvasSize = 1024
const iconScale = 1.04
const bodySize = Math.round(824 * iconScale)
const leadingPadding = Math.floor((canvasSize - bodySize) / 2)
const trailingPadding = canvasSize - bodySize - leadingPadding
const cornerRadius = 185 * iconScale
const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${bodySize}" height="${bodySize}"><rect width="${bodySize}" height="${bodySize}" rx="${cornerRadius}" fill="white"/></svg>`)
const defaultPath = join(resourcesDir, 'icon.png')
const require = createRequire(import.meta.url)
// app-builder-bin 随现有 electron-builder 提供，不额外引入图像转换依赖。
const { appBuilderPath }: { appBuilderPath: string } = require('app-builder-bin')
const tempDir = mkdtempSync(join(tmpdir(), 'gamma-icons-'))

try {
  for (const variant of APP_ICON_VARIANTS) {
    // 每款共用同一矢量轮廓，确保颜色切换时形状与留白一致。
    const source = readFileSync(join(resourcesDir, 'icon-sources/pixel-gamma.svg'), 'utf-8')
      .replace('#F2EBDD', variant.background)
      .replace('#345F6C', variant.foreground)
    const body = await sharp(Buffer.from(source))
      .resize(bodySize, bodySize)
      .ensureAlpha()
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer()
    // 只裁外部几何轮廓，保留不透明底板与像素笔画。
    const output = await sharp(body)
      .extend({ top: leadingPadding, bottom: trailingPadding, left: leadingPadding, right: trailingPadding, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
    await Bun.write(join(resourcesDir, 'gamma-logos', variant.fileName), output)
    await Bun.write(join(rendererDir, 'bots/gamma-logos', variant.fileName), output)
    if (variant.id === 'default') {
      await Bun.write(defaultPath, output)
      await Bun.write(join(rendererDir, 'models/gamma.png'), output)
    }
  }

  for (const format of ['icns', 'ico']) {
    const result = spawnSync(appBuilderPath, [
      'icon', '--format', format, '--input', defaultPath,
      '--out', join(tempDir, format),
    ], { encoding: 'utf8' })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(result.stderr || `生成 ${format} 图标失败`)
    const conversion = JSON.parse(result.stdout) as IconConversionResult
    const iconPath = conversion.icons?.[0]?.file
    if (conversion.error || !iconPath) throw new Error(conversion.error || `未生成 ${format} 图标`)
    copyFileSync(iconPath, join(resourcesDir, `icon.${format}`))
  }

  await generateTrayIcons()
  console.log('[图标] 已导出十三款像素 γ 透明圆角 PNG、默认 ICNS / ICO 及菜单栏模板图标')
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
