import type { AsciiWallpaperEngine } from '../engine-types'
import { CELL_WIDTH, CELL_HEIGHT, MONOSPACE_FONT } from '../engine-types'

export class JellyfishEngine implements AsciiWallpaperEngine {
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

    // 深海暗夜蓝
    ctx.fillStyle = '#0B2030'
    ctx.fillRect(0, 0, this.width, this.height)

    ctx.font = MONOSPACE_FONT
    ctx.textBaseline = 'top'

    const t = now * 0.001

    // 3 只不同大小、相位的发光水母
    const jellies = [
      { xPct: 0.25, speed: 0.35, phase: 0.0, scale: 1.0 },
      { xPct: 0.65, speed: 0.28, phase: 2.1, scale: 1.2 },
      { xPct: 0.45, speed: 0.42, phase: 4.5, scale: 0.8 },
    ]

    for (const j of jellies) {
      // 周期性收缩上浮与滑翔
      const cycleTime = (t * j.speed + j.phase) % (Math.PI * 2)
      const pulse = Math.sin(cycleTime * 2) // 伞盖伸缩
      const rise = ((t * 25 * j.speed) % (this.height + 150))
      const jx = j.xPct * this.width + Math.sin(t * 0.8 + j.phase) * 30
      const jy = this.height - rise

      const domeChars = pulse > 0 ? ' (######) ' : '  (####)  '
      const rimChars  = pulse > 0 ? ' (======) ' : '  (====)  '
      const tentacleWave = Math.sin(t * 3 + j.phase) * 6

      ctx.fillStyle = '#38BDF8'
      ctx.globalAlpha = 0.65
      ctx.fillText(domeChars, jx, jy)
      ctx.fillText(rimChars, jx, jy + CELL_HEIGHT)

      ctx.fillStyle = '#7DD3FC'
      ctx.globalAlpha = 0.45
      ctx.fillText('   |  |   ', jx + tentacleWave, jy + CELL_HEIGHT * 2)
      ctx.fillText('   :  :   ', jx - tentacleWave, jy + CELL_HEIGHT * 3)
      ctx.fillText('   .  .   ', jx + tentacleWave * 0.5, jy + CELL_HEIGHT * 4)
    }

    // 环境微光泡泡
    ctx.fillStyle = '#BAE6FD'
    ctx.globalAlpha = 0.15
    for (let i = 0; i < 15; i++) {
      const bx = (Math.sin(i * 123 + t * 0.2) * 0.5 + 0.5) * this.width
      const by = (Math.cos(i * 321 + t * 0.4) * 0.5 + 0.5) * this.height
      ctx.fillText('o', bx, by)
    }

    ctx.globalAlpha = 1.0
  }

  dispose(): void {
    this.ctx = null
  }
}
