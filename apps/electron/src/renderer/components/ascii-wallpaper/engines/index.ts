import { ASCII_THEME_REGISTRY } from '../../../lib/ascii-theme-registry'
import type { ThemeStyle } from '../../../../types'

type SceneId = Exclude<ThemeStyle, 'default'>
type Palette = readonly [ink: string, fill: string]
type Mask = (x: number, y: number) => Palette | undefined

interface Figure {
  x: number
  y: number
  width: number
  height: number
  color: Palette
  kind: 'cloud' | 'burst' | 'turtle' | 'koi' | 'lily' | 'jelly' | 'boat' | 'moon' | 'grass' | 'lights'
  drift?: number
  angle?: number
}

const cream = ['#6e849d', '#f7fbff'] as const
const amber = ['#824218', '#e7a248'] as const
const lagoon = ['#485831', '#b9ad55'] as const
const shell = ['#4a2934', '#a24a52'] as const
const rose = ['#59315b', '#df9bc8'] as const
const blue = ['#322d61', '#95a5e6'] as const
const green = ['#275344', '#87bc86'] as const

const scenes: Record<SceneId, { backdrop: string; left: string; right: string; figures: Figure[] }> = {
  'claude-code': { backdrop: '#141213', left: '#39312a', right: '#3a2b25', figures: [
    { kind: 'burst', x: .76, y: .25, width: .25, height: .42, color: ['#55382f', '#bf795e'], angle: -.16 },
  ] },
  'cloud-drift': { backdrop: '#c0e1f4', left: '#77c7f2', right: '#7cc6ef', figures: [
    { kind: 'cloud', x: .03, y: .08, width: .16, height: .12, color: cream, drift: .8 },
    { kind: 'cloud', x: .32, y: .15, width: .19, height: .16, color: cream, drift: 1 },
    { kind: 'cloud', x: .69, y: .11, width: .16, height: .12, color: cream, drift: .7 },
    { kind: 'cloud', x: .59, y: .50, width: .17, height: .11, color: cream, drift: .55 },
    { kind: 'cloud', x: .26, y: .71, width: .20, height: .16, color: cream, drift: .8 },
    { kind: 'cloud', x: .91, y: .83, width: .25, height: .095, color: cream, drift: .65 },
  ] },
  'honu-lagoon': { backdrop: '#1f6767', left: '#48d6cf', right: '#20a1bc', figures: [
    { kind: 'turtle', x: .55, y: .46, width: .37, height: .33, color: lagoon, drift: 1, angle: -.72 },
    { kind: 'turtle', x: .19, y: .87, width: .16, height: .14, color: cream, drift: .75, angle: -.58 },
  ] },
  'koi-pond': { backdrop: '#2a5345', left: '#72cbb1', right: '#398b72', figures: [
    { kind: 'koi', x: .76, y: .29, width: .25, height: .18, color: amber, drift: .8, angle: .7 },
    { kind: 'koi', x: .83, y: .62, width: .25, height: .15, color: amber, drift: .7, angle: -1.2 },
    { kind: 'koi', x: .15, y: .48, width: .22, height: .13, color: cream, drift: 1, angle: -.35 },
    { kind: 'lily', x: .10, y: .78, width: .13, height: .11, color: green, angle: .5 },
    { kind: 'lily', x: .90, y: .84, width: .17, height: .14, color: green, angle: -.3 },
    { kind: 'lily', x: .92, y: .15, width: .10, height: .08, color: green },
  ] },
  'jellyfish': { backdrop: '#0a2131', left: '#103954', right: '#13436a', figures: [
    { kind: 'jelly', x: .28, y: .29, width: .17, height: .33, color: blue, drift: .65 },
    { kind: 'jelly', x: .84, y: .49, width: .20, height: .37, color: ['#835354', '#e8b89c'], drift: .85 },
    { kind: 'jelly', x: .07, y: .85, width: .21, height: .40, color: rose, drift: .75 },
  ] },
  'paper-boats': { backdrop: '#2c5052', left: '#75c5bf', right: '#408e96', figures: [
    { kind: 'boat', x: .76, y: .25, width: .20, height: .12, color: cream, drift: .7, angle: -1.15 },
    { kind: 'boat', x: .45, y: .52, width: .17, height: .12, color: cream, drift: .85, angle: .63 },
    { kind: 'boat', x: .14, y: .72, width: .18, height: .12, color: cream, drift: .62, angle: .6 },
    { kind: 'boat', x: .93, y: .73, width: .19, height: .13, color: cream, drift: .72, angle: -.49 },
    { kind: 'boat', x: .08, y: .27, width: .14, height: .09, color: cream, drift: .55, angle: .3 },
  ] },
  'fireflies': { backdrop: '#091717', left: '#0d2725', right: '#0b2821', figures: [
    { kind: 'grass', x: .50, y: .97, width: 1, height: .15, color: green, drift: .3 },
    ...[[.16,.27],[.30,.14],[.08,.52],[.73,.34],[.88,.16],[.76,.66],[.28,.67],[.93,.48],[.49,.42],[.55,.80]].map(
      ([x, y]): Figure => ({ kind: 'lights', x: x!, y: y!, width: .07, height: .10, color: ['#526a32', '#e2f59a'], drift: .6 }),
    ),
  ] },
  'moonlit': { backdrop: '#091022', left: '#111a42', right: '#172454', figures: [
    { kind: 'moon', x: .71, y: .22, width: .13, height: .23, color: ['#89847c', '#f5e7b5'], angle: -.18 },
    { kind: 'cloud', x: .24, y: .27, width: .28, height: .07, color: blue, drift: .65 },
    { kind: 'cloud', x: .80, y: .47, width: .28, height: .08, color: blue, drift: .8 },
    { kind: 'cloud', x: .43, y: .68, width: .26, height: .06, color: blue, drift: .6 },
  ] },
}

const ellipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean =>
  ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1

function figureMask({ kind, color }: Figure): Mask {
  return (x, y) => {
    switch (kind) {
      case 'cloud':
        return ellipse(x, y, -.43, .17, .52, .48)
          || ellipse(x, y, .02, -.18, .51, .69)
          || ellipse(x, y, .48, .11, .49, .47)
          || ellipse(x, y, .12, .37, .76, .38) ? color : undefined
      case 'burst': {
        const radius = Math.hypot(x, y)
        const angle = Math.atan2(y, x)
        const spoke = Math.cos(angle * 11)
        const length = .76 + .19 * Math.cos(Math.round(angle * 11 / (2 * Math.PI)) * 2.4)
        return radius < .21 || (spoke > .60 && radius < length) ? color : undefined
      }
      case 'turtle':
        if (ellipse(x, y, 0, 0, .38, .43)) {
          return Math.cos(x * 23 + y * 7) + Math.cos(y * 17) > 0.5 ? [shell[0], '#803943'] : shell
        }
        if (ellipse(x, y, .51, 0, .20, .18) || ellipse(x, y, -.43, 0, .19, .10)) return color
        const fin = Math.abs(y)
        return (ellipse(x + (fin - .38) * .70, fin, .18, .54, .50, .15)
          || ellipse(x + (fin - .48) * .46, fin, -.47, .36, .29, .10)) ? color : undefined
      case 'koi': {
        if (ellipse(x, y, .18, 0, .69, .51)) {
          return Math.sin(x * 10 + y * 3) + Math.cos(y * 6) > 1.1 ? cream : color
        }
        return (x < -.40 && Math.abs(y) < (-x - .36) * 1.24)
          || ellipse(x, y, .12, 0, .30, .74) ? color : undefined
      }
      case 'lily':
        return ellipse(x, y, 0, 0, .90, .82) && (x < 0 || Math.abs(y) > x * .38) ? color : undefined
      case 'jelly':
        if ((y < -.31 && ellipse(x, y, 0, -.29, .94, .63)) || ellipse(x, y, 0, -.35, .99, .18)) {
          return y > -.49 ? cream : color
        }
        for (let i = -2; i <= 2; i++) {
          if (y > -.38 && y < .89 - Math.abs(i) * .22 && Math.abs(x - i * .32 - Math.sin(y * 5 + i) * .10) < .087) {
            return color
          }
        }
        return undefined
      case 'boat': {
        const span = Math.abs(x)
        if (span > .94 || y < span * 1.07 - .91 || y > .60 - span * .40) return undefined
        return Math.abs(y - x * .20) < .11 ? cream : x + y * .36 > .12 ? ['#4a6e6c', '#a5bbb2'] : color
      }
      case 'moon':
        return ellipse(x, y, 0, 0, .91, .93) && !ellipse(x, y, .38, -.30, .87, .87) ? color : undefined
      case 'grass': {
        const stalk = Math.floor((x + 1) * 27)
        const offset = ((x + 1) * 27) % 1
        const height = .20 + (Math.sin(stalk * 17.1) + 1) * .35
        return offset < .56 && y > 1 - height * 2 ? color : undefined
      }
      case 'lights':
        return Math.abs(x) < .26 && Math.abs(y) < .38 ? color : undefined
    }
  }
}

const CODE_GLYPHS = '01{}[]<>/=+-*:.#'

interface GlyphCell {
  x: number
  y: number
  phase: number
  speed: number
  glyph: HTMLCanvasElement
}

function buildCells(figure: Figure, width: number, height: number, cell: number, seed: number,
  getGlyph: (char: string, tones: Palette) => HTMLCanvasElement): GlyphCell[] {
  const mask = figureMask(figure)
  const cols = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)
  const cells: GlyphCell[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tones = mask(2 * (col + .5) / cols - 1, 2 * (row + .5) / rows - 1)
      if (!tones) continue
      const hash = ((Math.imul(col + 3, 73856093) ^ Math.imul(row + 5, 19349663) ^ Math.imul(seed + 1, 83492791)) >>> 0)
      cells.push({
        x: (col - cols / 2) * cell,
        y: (row - rows / 2) * cell,
        phase: (hash % 1021) / 1021 + .32 * col / cols,
        speed: .30 + (hash % 31) / 115,
        glyph: getGlyph(CODE_GLYPHS[hash % CODE_GLYPHS.length]!, tones),
      })
    }
  }
  return cells
}

function renderGlyph(char: string, [ink, fill]: Palette, cell: number): HTMLCanvasElement {
  const glyph = document.createElement('canvas')
  glyph.width = cell * 2
  glyph.height = cell * 2
  const ctx = glyph.getContext('2d')
  if (!ctx) return glyph
  const size = glyph.width
  // 亮色是字符本身，深色只用于字符周围的微弱格点。
  ctx.globalAlpha = .32
  ctx.fillStyle = ink
  ctx.fillRect(0, 0, size - 1, size - 1)
  ctx.globalAlpha = 1
  ctx.font = `600 ${size - 2}px ui-monospace, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = fill
  ctx.fillText(char, size / 2, size / 2)
  return glyph
}

function glyphBrightness(time: number, cell: GlyphCell): number {
  const cycle = (time * cell.speed + cell.phase) % 1
  // 每格留出熄灭时间，起落用渐变包络，避免整幅图案同步闪烁。
  const envelope = Math.max(0, Math.min((cycle - .13) / .20, (1 - cycle) / .23, 1))
  return envelope * envelope * (3 - 2 * envelope)
}

export function createAsciiWallpaperEngine(style: SceneId) {
  const scene = scenes[style]
  let canvas: CanvasRenderingContext2D | undefined
  let background: HTMLCanvasElement | undefined
  let patterns: { figure: Figure; cells: GlyphCell[] }[] = []
  let cellSize = 0
  let width = 0
  let height = 0

  return {
    init(ctx: CanvasRenderingContext2D, nextWidth: number, nextHeight: number): void {
      canvas = ctx
      width = nextWidth
      height = nextHeight
      const cell = Math.round(Math.min(9, Math.max(5, Math.min(width, height) / 70)))
      cellSize = cell
      background = document.createElement('canvas')
      background.width = Math.ceil(width)
      background.height = Math.ceil(height)
      const base = background.getContext('2d')
      if (base) {
        const gradient = base.createLinearGradient(0, 0, width, 0)
        gradient.addColorStop(0, scene.left)
        gradient.addColorStop(.29, scene.backdrop)
        gradient.addColorStop(.70, scene.backdrop)
        gradient.addColorStop(1, scene.right)
        base.fillStyle = gradient
        base.fillRect(0, 0, width, height)
        const shading = base.createLinearGradient(0, 0, 0, height)
        shading.addColorStop(0, 'rgb(0 0 0 / 18%)')
        shading.addColorStop(.38, 'transparent')
        shading.addColorStop(1, 'rgb(0 0 0 / 9%)')
        base.fillStyle = shading
        base.fillRect(0, 0, width, height)
        base.fillStyle = ASCII_THEME_REGISTRY[style].foregroundColor
        base.globalAlpha = .07
        for (let y = cell; y < height; y += cell) {
          for (let x = cell; x < width; x += cell) base.fillRect(x, y, 1, 1)
        }
        base.globalAlpha = .18
        for (let i = 0; i < 95; i++) {
          const x = ((i * 127 + i * i * 29) % 347) / 347 * width
          const y = ((i * 139 + i * i * 7) % 397) / 397 * height
          base.fillRect(x, y, i % 8 === 0 ? 2 : 1, 1)
        }
      }
      const glyphCache = new Map<string, HTMLCanvasElement>()
      const getGlyph = (char: string, tones: Palette): HTMLCanvasElement => {
        const key = tones.join('/') + char
        const cached = glyphCache.get(key)
        if (cached) return cached
        const glyph = renderGlyph(char, tones, cell)
        glyphCache.set(key, glyph)
        return glyph
      }
      patterns = scene.figures.map((figure, index) => ({
        figure,
        cells: buildCells(figure, Math.max(cell * 3, width * figure.width), Math.max(cell * 3, height * figure.height), cell, index, getGlyph),
      }))
    },
    paint(now: number, still = false): void {
      if (!canvas || !background) return
      const ctx = canvas
      const t = still ? 0 : now / 1000
      ctx.drawImage(background, 0, 0, width, height)
      patterns.forEach(({ figure, cells }, index) => {
        const drift = figure.drift ?? 0
        const phase = t * (.19 + drift * .06) + index * 1.93
        const x = width * figure.x + Math.sin(phase) * Math.min(32, width * .06) * drift
        const y = height * figure.y + Math.sin(phase * 1.45) * Math.min(22, height * .045) * drift
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate((figure.angle ?? 0) + Math.sin(phase) * drift * .10)
        let strength = 1
        if (figure.kind === 'lights') {
          strength = still ? .68 : Math.max(0, Math.cos(t * 1.65 + index * 2.17)) ** 1.6
          const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.min(36, width * .10))
          glow.addColorStop(0, `rgba(190,227,104,${strength * .34})`)
          glow.addColorStop(1, 'rgba(190,227,104,0)')
          ctx.fillStyle = glow
          ctx.fillRect(-36, -36, 72, 72)
        } else if (figure.kind === 'jelly') {
          ctx.scale(1 + Math.sin(phase * 4) * .065, 1 - Math.sin(phase * 4) * .05)
        }
        for (const cell of cells) {
          const brightness = strength * (still ? .84 : glyphBrightness(t, cell))
          if (brightness <= .025) continue
          ctx.globalAlpha = brightness
          ctx.drawImage(cell.glyph, cell.x, cell.y, cellSize, cellSize)
        }
        ctx.restore()
      })
    },
    dispose(): void {
      canvas = undefined
      background = undefined
      patterns = []
    },
  }
}
