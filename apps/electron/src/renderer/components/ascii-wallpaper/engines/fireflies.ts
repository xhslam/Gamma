import type { AsciiWallpaperEngine } from '../engine-types'
import { CELL_WIDTH, CELL_HEIGHT, MONOSPACE_FONT } from '../engine-types'

interface Firefly {
  x: number
  y: number
  vx: number
  vy: number
  phase: number
  char: string
}

export class FirefliesEngine implements AsciiWallpaperEngine {
  private ctx: CanvasRenderingContext2D | null = null
  private width = 0
  private height = 0
  private fireflies: Firefly[] = []

  init(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    this.ctx = ctx
    this.width = width
    this.height = height
    this.initFireflies()
  }

  private initFireflies(): void {
    const count = 35
    const chars = ['*', '+', '·', 'o', 'O']
    this.fireflies = []
    for (let i = 0; i < count; i++) {
      this.fireflies.push({
        x: Math.random() * (this.width || 800),
        y: Math.random() * (this.height || 600),
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        phase: Math.random() * Math.PI * 2,
        char: chars[Math.floor(Math.random() * chars.length)]!,
      })
    }
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = height
    if (this.fireflies.length === 0) {
      this.initFireflies()
    }
  }

  paint(now: number): void {
    const ctx = this.ctx
    if (!ctx || this.width === 0 || this.height === 0) return

    // 暮夜幽黑
    ctx.fillStyle = '#091216'
    ctx.fillRect(0, 0, this.width, this.height)

    ctx.font = MONOSPACE_FONT
    ctx.textBaseline = 'top'

    const t = now * 0.001

    for (const f of this.fireflies) {
      f.x += f.vx
      f.y += f.vy

      // 视口循环包裹
      if (f.x < 0) f.x = this.width
      if (f.x > this.width) f.x = 0
      if (f.y < 0) f.y = this.height
      if (f.y > this.height) f.y = 0

      // 正弦呼吸呼吸光
      const glow = Math.sin(t * 2.2 + f.phase)
      if (glow > 0.05) {
        const alpha = Math.min(0.9, Math.pow(glow, 1.8))
        ctx.fillStyle = glow > 0.7 ? '#FACC15' : '#84CC16'
        ctx.globalAlpha = alpha

        const gridX = Math.floor(f.x / CELL_WIDTH) * CELL_WIDTH
        const gridY = Math.floor(f.y / CELL_HEIGHT) * CELL_HEIGHT
        ctx.fillText(f.char, gridX, gridY)
      }
    }

    ctx.globalAlpha = 1.0
  }

  dispose(): void {
    this.ctx = null
    this.fireflies = []
  }
}
