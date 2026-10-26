import type { CSSProperties, ReactElement } from 'react'
import { ChevronRight, type LucideProps } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DisclosureChevronProps extends LucideProps {
  /** 未传时跟随触发器的 Radix data-state 或 aria-expanded。 */
  expanded?: boolean
}
interface DisclosureStyle extends CSSProperties {
  '--disclosure-size': string | number
}

/** 固定占位的内容折叠标记；显隐只作用于图形，不改变文字和点击区域。 */
export function DisclosureChevron({ expanded, size = 14, strokeWidth = 1.5, className, style, ...props }: DisclosureChevronProps): ReactElement {
  const dimensions: DisclosureStyle = {
    '--disclosure-size': typeof size === 'number' ? `${size}px` : size,
    ...style,
  }
  return (
    <ChevronRight
      aria-hidden="true"
      focusable="false"
      {...props}
      size={size}
      strokeWidth={strokeWidth}
      className={cn('gamma-disclosure-indicator shrink-0', className)}
      data-disclosure-chevron=""
      data-expanded={expanded}
      style={dimensions}
    />
  )
}
