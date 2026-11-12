#!/usr/bin/env bun
/** 菜单栏复用 App 的像素 γ 轮廓，移除底板并输出透明单色模板。 */
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import sharp from 'sharp'

const resourcesDir = resolve(import.meta.dir, '../resources')

export function createTrayIconSvg(source: string): string {
  const path = source.match(/<path\b[^>]*\bd="([^"]+)"/i)?.[1]
  if (!path) throw new Error('应用图标缺少像素 γ 路径')
  // 580 × 683 的原始轮廓居中放入正方形，再保留约 2px 的菜单栏留白。
  return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="118.5 119 836 836"><path fill="black" d="${path}"/></svg>`
}

export async function generateTrayIcons(): Promise<void> {
  const source = readFileSync(join(resourcesDir, 'icon-sources/pixel-gamma.svg'), 'utf8')
  const svg = Buffer.from(createTrayIconSvg(source))
  for (const scale of [1, 2, 3]) {
    const suffix = scale === 1 ? '' : `@${scale}x`
    await sharp(svg).resize(22 * scale, 22 * scale).png()
      .toFile(join(resourcesDir, `gamma-logos/iconTemplate${suffix}.png`))
  }
}

if (import.meta.main) await generateTrayIcons()
