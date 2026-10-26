export type ScrollFadeOrientation = 'vertical' | 'horizontal' | 'both'

export interface ScrollFadeEdges {
  start: number
  end: number
}

export interface ScrollFadeGutters {
  vertical?: number
  horizontal?: number
  verticalSide?: 'left' | 'right'
}

/** 亚像素边缘与系统弹性回滚不能令首尾内容被误遮淡。 */
export function getScrollFadeEdges(contentSize: number, viewportSize: number, offset: number, fadeSize: number): ScrollFadeEdges {
  const maximum = Math.max(0, contentSize - viewportSize)
  const position = Math.max(0, Math.min(maximum, offset))
  const size = Math.max(0, Math.min(fadeSize, viewportSize / 2))
  return {
    start: position > 1 ? size : 0,
    end: maximum - position > 1 ? size : 0,
  }
}

function axisMask(direction: string, start: string, end: string, startInset = 0, endInset = 0): string {
  const samples = [[0.15, 0.05], [0.30, 0.15], [0.45, 0.30], [0.60, 0.50], [0.75, 0.70], [0.87, 0.85]]
  return `linear-gradient(to ${direction}, transparent ${startInset}px, ${samples.map(([stop, alpha]) => `rgba(0,0,0,${alpha}) calc(${startInset}px + var(${start}) * ${stop})`).join(', ')}, #000 calc(${startInset}px + var(${start})), #000 calc(100% - ${endInset}px - var(${end})), ${[...samples].reverse().map(([stop, alpha]) => `rgba(0,0,0,${alpha}) calc(100% - ${endInset}px - var(${end}) * ${stop})`).join(', ')}, transparent calc(100% - ${endInset}px))`
}

function gutterMasks({ vertical = 0, horizontal = 0, verticalSide = 'right' }: ScrollFadeGutters): string[] {
  const masks: string[] = []
  if (vertical > 0) masks.push(`linear-gradient(to ${verticalSide === 'right' ? 'left' : 'right'}, #000 ${vertical}px, transparent ${vertical}px)`)
  if (horizontal > 0) masks.push(`linear-gradient(to top, #000 ${horizontal}px, transparent ${horizontal}px)`)
  return masks
}

/** 条带与内容遮罩相加，原生滚动条不会随首尾文字一起变淡。RGB只参与alpha遮罩，不是界面配色。 */
export function getScrollFadeMask(orientation: ScrollFadeOrientation, gutters: ScrollFadeGutters = {}): string {
  const { vertical = 0, horizontal = 0, verticalSide = 'right' } = gutters
  const y = axisMask('bottom', '--scroll-fade-top', '--scroll-fade-bottom', 0, horizontal)
  const x = axisMask('right', '--scroll-fade-left', '--scroll-fade-right', verticalSide === 'left' ? vertical : 0, verticalSide === 'right' ? vertical : 0)
  return [...gutterMasks(gutters), ...(orientation === 'both' ? [y, x] : [orientation === 'vertical' ? y : x])].join(', ')
}

export function getScrollFadeComposite(orientation: ScrollFadeOrientation, gutters: ScrollFadeGutters = {}): string {
  return [...gutterMasks(gutters).map(() => 'add'), ...(orientation === 'both' ? ['intersect', 'add'] : ['add'])].join(', ')
}
