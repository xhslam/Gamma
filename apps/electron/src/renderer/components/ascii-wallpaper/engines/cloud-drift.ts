import type { AsciiWallpaperEngine } from '../engine-types'
import { CELL_WIDTH, CELL_HEIGHT, MONOSPACE_FONT } from '../engine-types'

const CLOUD_GLYPHS = '%;:st+|#@*'

export class CloudDriftEngine implements AsciiWallpaperEngine {
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

    // 天青蓝浅色天空
    ctx.fillStyle = '#BAEEF5'
    ctx.fillRect(0, 0, this.width, this.height)

    ctx.font = MONOSPACE_FONT
    ctx.textBaseline = 'top'

    const t = now * 0.0006
    const cols = Math.ceil(this.width / CELL_WIDTH)
    const rows = Math.ceil(this.height / CELL_HEIGHT)

    for (let r = 0; r < rows; r++) {
      const y = r * CELL_HEIGHT
      for (let c = 0; c < cols; c++) {
        const x = c * CELL_WIDTH

        // 多层云团正弦干涉生成流动云层
        const n1 = Math.sin((x * 0.006 - t * 1.5) + Math.sin(y * 0.008))
        const n2 = Math.cos((x * 0.012 - t * 0.9) + y * 0.015)
        const n3 = Math.sin((x * 0.003 - t * 0.4) + y * 0.004)
        const density = (n1 * 0.45 + n2 * 0.35 + n3 * 0.5)

        if (density > 0.15) {
          const glyphIdx = Math.floor(Math.abs(density * 7)) % CLOUD_GLYPHS.length
          const char = CLOUD_GLYPHS[glyphIdx]!
          const alpha = Math.min(0.65, Math.max(0.1, (density - 0.15) * 0.9))

          // 白云团块与高光
          ctx.fillStyle = density > 0.6 ? '#FFFFFF' : '#475569'
          ctx.globalAlpha = density > 0.6 ? alpha * 1.2 : alpha * 0.4
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
