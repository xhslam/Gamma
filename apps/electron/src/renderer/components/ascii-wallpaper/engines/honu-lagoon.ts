import type { AsciiWallpaperEngine } from '../engine-types'
import { CELL_WIDTH, CELL_HEIGHT, MONOSPACE_FONT } from '../engine-types'

const SEAGRASS_GLYPHS = '~sSO0*'
const WATER_GLYPHS = '~-·.'

export class HonuLagoonEngine implements AsciiWallpaperEngine {
  private ctx: CanvasRenderingContext2D | null = null
  private width = 0
  private height = 0

  init(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    this.ctx = ctx
    this.width = width
    this.height = height
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = height
  }

  paint(now: number): void {
    const ctx = this.ctx
    if (!ctx || this.width === 0 || this.height === 0) return

    // 碧海泻湖深青色
    ctx.fillStyle = '#1C4E4B'
    ctx.fillRect(0, 0, this.width, this.height)

    ctx.font = MONOSPACE_FONT
    ctx.textBaseline = 'top'

    const t = now * 0.001
    const cols = Math.ceil(this.width / CELL_WIDTH)
    const rows = Math.ceil(this.height / CELL_HEIGHT)

    // 1. 底部摇摆水草
    for (let c = 0; c < cols; c += 2) {
      const xBase = c * CELL_WIDTH
      const stalkHeight = 8 + (Math.sin(c * 17) * 4) // 8~12 行高
      const sway = Math.sin(t * 1.5 + c * 0.4) * 14

      for (let step = 0; step < stalkHeight; step++) {
        const r = rows - 1 - step
        if (r < 0) continue
        const ratio = step / stalkHeight
        const x = xBase + sway * ratio
        const y = r * CELL_HEIGHT
        const char = SEAGRASS_GLYPHS[step % SEAGRASS_GLYPHS.length]!

        ctx.fillStyle = '#34D399'
        ctx.globalAlpha = 0.25 + ratio * 0.35
        ctx.fillText(char, x, y)
      }
    }

    // 2. 游动的绿海龟 (Honu)
    const cycle = (t * 0.08) % 1.4 - 0.2 // 归一化横跨坐标
    const turtleX = cycle * this.width
    const turtleY = this.height * 0.4 + Math.sin(t * 0.8) * (this.height * 0.12)
    const finSway = Math.sin(t * 4) * 8

    const turtlePattern = [
      '   ____   ',
      '  /    \\_ ',
      ' / (OO)  >',
      ' \\______/ ',
      '   ||  ||  ',
    ]

    ctx.fillStyle = '#A7F3D0'
    ctx.globalAlpha = 0.65
    for (let tr = 0; tr < turtlePattern.length; tr++) {
      const line = turtlePattern[tr]!
      const finOffset = tr === 4 ? finSway : 0
      ctx.fillText(line, turtleX + finOffset, turtleY + tr * CELL_HEIGHT)
    }

    // 3. 散落微水流
    ctx.fillStyle = '#6EE7B7'
    ctx.globalAlpha = 0.12
    for (let r = 0; r < rows; r += 4) {
      for (let c = 0; c < cols; c += 8) {
        const wave = Math.sin(c * 0.2 + r * 0.3 - t * 2)
        if (wave > 0.7) {
          ctx.fillText(WATER_GLYPHS[(c + r) % WATER_GLYPHS.length]!, c * CELL_WIDTH, r * CELL_HEIGHT)
        }
      }
    }

    ctx.globalAlpha = 1.0
  }

  dispose(): void {
    this.ctx = null
  }
}
