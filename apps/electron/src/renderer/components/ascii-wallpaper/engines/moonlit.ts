import type { AsciiWallpaperEngine } from '../engine-types'
import { CELL_WIDTH, CELL_HEIGHT, MONOSPACE_FONT } from '../engine-types'

export class MoonlitEngine implements AsciiWallpaperEngine {
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

    // 深夜靛蓝
    ctx.fillStyle = '#090C1C'
    ctx.fillRect(0, 0, this.width, this.height)

    ctx.font = MONOSPACE_FONT
    ctx.textBaseline = 'top'

    const t = now * 0.001
    const cols = Math.ceil(this.width / CELL_WIDTH)
    const rows = Math.ceil(this.height / CELL_HEIGHT)

    // 1. 繁星闪烁
    for (let r = 0; r < Math.floor(rows * 0.75); r += 3) {
      for (let c = 0; c < cols; c += 4) {
        const seed = (c * 197 + r * 389) % 100
        if (seed < 8) {
          const twinkle = Math.sin(t * 2.5 + seed)
          if (twinkle > 0.1) {
            ctx.fillStyle = '#EEF2FF'
            ctx.globalAlpha = twinkle * 0.5
            ctx.fillText(seed % 2 === 0 ? '*' : '·', c * CELL_WIDTH, r * CELL_HEIGHT)
          }
        }
      }
    }

    // 2. 右上方明月
    const moonCenterX = this.width * 0.78
    const moonCenterY = this.height * 0.22
    const moonRadius = 45

    const moonGridCols = Math.ceil(moonRadius * 2 / CELL_WIDTH)
    const moonGridRows = Math.ceil(moonRadius * 2 / CELL_HEIGHT)

    for (let mr = -moonGridRows / 2; mr <= moonGridRows / 2; mr++) {
      for (let mc = -moonGridCols / 2; mc <= moonGridCols / 2; mc++) {
        const px = moonCenterX + mc * CELL_WIDTH
        const py = moonCenterY + mr * CELL_HEIGHT
        const dist = Math.hypot(px - moonCenterX, py - moonCenterY)

        if (dist <= moonRadius) {
          const glowRatio = 1 - (dist / moonRadius)
          ctx.fillStyle = dist < moonRadius * 0.75 ? '#FEF08A' : '#FDE047'
          ctx.globalAlpha = 0.5 + glowRatio * 0.45
          ctx.fillText(dist < moonRadius * 0.5 ? '@' : '#', px, py)
        } else if (dist <= moonRadius * 1.35) {
          // 月晕
          const halo = Math.sin((dist - moonRadius) * 0.2 - t * 0.5)
          if (halo > 0) {
            ctx.fillStyle = '#FEF9C3'
            ctx.globalAlpha = 0.08
            ctx.fillText('~', px, py)
          }
        }
      }
    }

    ctx.globalAlpha = 1.0
  }

  dispose(): void {
    this.ctx = null
  }
}
