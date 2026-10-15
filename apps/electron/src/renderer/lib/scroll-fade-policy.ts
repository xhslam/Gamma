export type ScrollFadeOrientation = 'vertical' | 'horizontal' | 'both'

export interface ScrollFadeEdges {
  start: number
  end: number
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

function axisMask(direction: string, start: string, end: string): string {
  const samples = [[0.15, 0.05], [0.30, 0.15], [0.45, 0.30], [0.60, 0.50], [0.75, 0.70], [0.87, 0.85]]
  return `linear-gradient(to ${direction}, transparent 0px, ${samples.map(([stop, alpha]) => `rgba(0,0,0,${alpha}) calc(var(${start}) * ${stop})`).join(', ')}, #000 var(${start}), #000 calc(100% - var(${end})), ${[...samples].reverse().map(([stop, alpha]) => `rgba(0,0,0,${alpha}) calc(100% - var(${end}) * ${stop})`).join(', ')}, transparent 100%)`
}

export function getScrollFadeMask(orientation: ScrollFadeOrientation): string {
  const vertical = axisMask('bottom', '--scroll-fade-top', '--scroll-fade-bottom')
  const horizontal = axisMask('right', '--scroll-fade-left', '--scroll-fade-right')
  return orientation === 'both' ? `${vertical}, ${horizontal}` : orientation === 'vertical' ? vertical : horizontal
}
