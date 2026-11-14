import type { AsciiWallpaperEngine } from '../engine-types'
import { CELL_WIDTH, CELL_HEIGHT, MONOSPACE_FONT } from '../engine-types'

export class PaperBoatsEngine implements AsciiWallpaperEngine {
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

    // 青波水底
    ctx.fillStyle = '#284A4B'
    ctx.fillRect(0, 0, this.width, this.height)

    ctx.font = MONOSPACE_FONT
    ctx.textBaseline = 'top'

    const t = now * 0.001
    const cols = Math.ceil(this.width / CELL_WIDTH)
    const rows = Math.ceil(this.height / CELL_HEIGHT)

    // 1. 水面波浪层
    const waterLevelRow = Math.floor(rows * 0.6)
    for (let r = waterLevelRow; r < rows; r += 2) {
      const y = r * CELL_HEIGHT
      for (let c = 0; c < cols; c += 2) {
        const x = c * CELL_WIDTH
        const wave = Math.sin(x * 0.015 - t * 2.5 + r * 0.5)
        if (wave > 0.4) {
          ctx.fillStyle = '#2DD4BF'
          ctx.globalAlpha = 0.18
          ctx.fillText('~', x, y)
        }
      }
    }

    // 2. 漂浮的折纸小船
    const boatX = (this.width * 0.45) + Math.sin(t * 0.6) * 40
    const boatWave = Math.sin(boatX * 0.015 - t * 2.5) * 8
    const boatY = waterLevelRow * CELL_HEIGHT - CELL_HEIGHT * 3 + boatWave
    const tilt = Math.cos(t * 2) * 4

    const boatLines = [
      '    /|      ',
      '   / |\\     ',
      '  /__|__\\   ',
      ' \\       /  ',
      '  \\_____/   ',
    ]

    ctx.fillStyle = '#F0FDFA'
    ctx.globalAlpha = 0.85
    for (let i = 0; i < boatLines.length; i++) {
      const offset = i < 3 ? tilt : 0
      ctx.fillText(boatLines[i]!, boatX + offset, boatY + i * CELL_HEIGHT)
    }

    ctx.globalAlpha = 1.0
  }

  dispose(): void {
    this.ctx = null
  }
}
