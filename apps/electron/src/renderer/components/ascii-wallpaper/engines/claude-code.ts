import type { AsciiWallpaperEngine } from '../engine-types'
import { CELL_WIDTH, CELL_HEIGHT, MONOSPACE_FONT } from '../engine-types'

const GLYPHS = '+-/*~|abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export class ClaudeCodeEngine implements AsciiWallpaperEngine {
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

    ctx.fillStyle = '#1F1E1D'
    ctx.fillRect(0, 0, this.width, this.height)

    ctx.font = MONOSPACE_FONT
    ctx.textBaseline = 'top'

    const t = now * 0.001
    const cols = Math.ceil(this.width / CELL_WIDTH)
    const rows = Math.ceil(this.height / CELL_HEIGHT)

    for (let r = 0; r < rows; r++) {
      const y = r * CELL_HEIGHT
      for (let c = 0; c < cols; c++) {
        const x = c * CELL_WIDTH
        const seed = (c * 374761393 + r * 668265263) >>> 0
        const char = GLYPHS[seed % GLYPHS.length]!

        // 柔和光弧沿对角线扫掠
        const wave = Math.sin(x * 0.004 + y * 0.003 - t * 1.2)
        const scan = Math.pow(Math.max(0, wave), 4)

        if (scan > 0.05) {
          ctx.fillStyle = scan > 0.6 ? '#D97757' : '#B0AEA5'
          ctx.globalAlpha = 0.06 + scan * 0.45
          ctx.fillText(char, x, y)
        } else if ((seed % 19) === 0) {
          ctx.fillStyle = '#85837B'
          ctx.globalAlpha = 0.05
          ctx.fillText(char, x, y)
        }
      }
    }
    ctx.globalAlpha = 1.0
  }

  dispose(): void {
    this.ctx = null
  }
}
