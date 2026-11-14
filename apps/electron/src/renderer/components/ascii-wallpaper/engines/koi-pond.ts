import type { AsciiWallpaperEngine } from '../engine-types'
import { CELL_WIDTH, CELL_HEIGHT, MONOSPACE_FONT } from '../engine-types'

const POND_GLYPHS = '()~sSo*'

export class KoiPondEngine implements AsciiWallpaperEngine {
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

    // 锦鲤碧潭深绿底
    ctx.fillStyle = '#254B3E'
    ctx.fillRect(0, 0, this.width, this.height)

    ctx.font = MONOSPACE_FONT
    ctx.textBaseline = 'top'

    const t = now * 0.001
    const cols = Math.ceil(this.width / CELL_WIDTH)
    const rows = Math.ceil(this.height / CELL_HEIGHT)

    // 1. 水面同心涟漪
    const centerX = this.width * 0.5
    const centerY = this.height * 0.5
    for (let r = 0; r < rows; r += 2) {
      const y = r * CELL_HEIGHT
      for (let c = 0; c < cols; c += 2) {
        const x = c * CELL_WIDTH
        const dist = Math.hypot(x - centerX, y - centerY)
        const ripple = Math.sin(dist * 0.03 - t * 2.5)
        if (ripple > 0.85) {
          ctx.fillStyle = '#6EE7B7'
          ctx.globalAlpha = 0.12
          ctx.fillText('~', x, y)
        }
      }
    }

    // 2. 双锦鲤巡游 (参数化椭圆轨迹)
    const fishConfigs = [
      { speed: 0.7, rx: this.width * 0.35, ry: this.height * 0.28, phase: 0, color: '#F97316' },
      { speed: 0.55, rx: this.width * 0.28, ry: this.height * 0.22, phase: Math.PI, color: '#FB923C' },
    ]

    for (const f of fishConfigs) {
      const angle = t * f.speed + f.phase
      const fx = centerX + Math.cos(angle) * f.rx
      const fy = centerY + Math.sin(angle * 1.5) * f.ry
      const tailWag = Math.sin(t * 6) * 5

      const fishPattern = [
        '  ><(((°>  ',
        '   ~=~=~   ',
      ]

      ctx.fillStyle = f.color
      ctx.globalAlpha = 0.75
      for (let i = 0; i < fishPattern.length; i++) {
        const offset = i === 1 ? tailWag : 0
        ctx.fillText(fishPattern[i]!, fx + offset, fy + i * CELL_HEIGHT)
      }
    }

    ctx.globalAlpha = 1.0
  }

  dispose(): void {
    this.ctx = null
  }
}
