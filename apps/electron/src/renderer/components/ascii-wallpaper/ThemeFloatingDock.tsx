import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { themeStyleAtom, themeModeAtom, updateThemeStyle, updateThemeMode } from '@/atoms/theme'
import { themePickerOpenAtom, circleRevealStateAtom } from '@/atoms/theme-picker'
import { THEME_STYLES, type ThemeStyle } from '../../../types'
import { ASCII_THEME_REGISTRY } from '@/lib/ascii-theme-registry'
import { cn } from '@/lib/utils'

import themeClaudeCode from '@/assets/theme-previews/theme-claude-code.webp'
import themeCloudDrift from '@/assets/theme-previews/theme-cloud-drift.webp'
import themeHonuLagoon from '@/assets/theme-previews/theme-honu-lagoon.webp'
import themeKoiPond from '@/assets/theme-previews/theme-koi-pond.webp'
import themeJellyfish from '@/assets/theme-previews/theme-jellyfish.webp'
import themePaperBoats from '@/assets/theme-previews/theme-paper-boats.webp'
import themeFireflies from '@/assets/theme-previews/theme-fireflies.webp'
import themeMoonlit from '@/assets/theme-previews/theme-moonlit.webp'

const THEME_IMAGES: Record<Exclude<ThemeStyle, 'default'>, string> = {
  'claude-code': themeClaudeCode,
  'cloud-drift': themeCloudDrift,
  'honu-lagoon': themeHonuLagoon,
  'koi-pond': themeKoiPond,
  'jellyfish': themeJellyfish,
  'paper-boats': themePaperBoats,
  'fireflies': themeFireflies,
  'moonlit': themeMoonlit,
}

const AVAILABLE_STYLES = THEME_STYLES.filter((s): s is Exclude<ThemeStyle, 'default'> => s !== 'default')

export function getNextThemeIndex(currentIndex: number, key: 'ArrowLeft' | 'ArrowRight', total: number): number {
  if (total <= 0) return 0
  if (key === 'ArrowRight') {
    return (currentIndex + 1) % total
  }
  return (currentIndex - 1 + total) % total
}

export function ThemeFloatingDock(): React.ReactElement | null {
  const [isOpen, setIsOpen] = useAtom(themePickerOpenAtom)
  const [currentStyle, setCurrentStyle] = useAtom(themeStyleAtom)
  const setThemeMode = useSetAtom(themeModeAtom)
  const setCircleReveal = useSetAtom(circleRevealStateAtom)

  const initialIndex = Math.max(0, AVAILABLE_STYLES.indexOf(currentStyle as Exclude<ThemeStyle, 'default'>))
  const [focusedIndex, setFocusedIndex] = React.useState(initialIndex >= 0 ? initialIndex : 0)
  const containerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (isOpen) {
      const idx = AVAILABLE_STYLES.indexOf(currentStyle as Exclude<ThemeStyle, 'default'>)
      setFocusedIndex(idx >= 0 ? idx : 0)
    }
  }, [isOpen, currentStyle])

  const handleSelect = React.useCallback(
    (style: ThemeStyle, origin?: { x: number; y: number }) => {
      if (origin) {
        setCircleReveal({
          active: true,
          originX: origin.x,
          originY: origin.y,
          targetStyle: style,
        })
      }
      setThemeMode('special')
      setCurrentStyle(style)
      void updateThemeMode('special')
      void updateThemeStyle(style)
      setIsOpen(false)
    },
    [setThemeMode, setCurrentStyle, setCircleReveal, setIsOpen]
  )

  React.useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setIsOpen(false)
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault()
        e.stopPropagation()
        setFocusedIndex((prev) => getNextThemeIndex(prev, e.key as 'ArrowLeft' | 'ArrowRight', AVAILABLE_STYLES.length))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        const selected = AVAILABLE_STYLES[focusedIndex]
        if (selected) {
          handleSelect(selected)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [isOpen, focusedIndex, handleSelect, setIsOpen])

  if (!isOpen) return null

  return (
    <div
      ref={containerRef}
      className="absolute bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2 z-50 w-full max-w-[820px] px-4 pointer-events-auto"
      role="dialog"
      aria-label="ASCII Wallpapers Theme Picker"
    >
      <div className="bg-popover/95 backdrop-blur-xl border border-border/80 shadow-2xl rounded-2xl p-3.5 space-y-2.5 transition-all">
        {/* Header */}
        <div className="flex items-center justify-between px-1 text-xs select-none">
          <div className="flex items-center gap-2">
            <span className="bg-primary text-primary-foreground font-mono font-semibold px-2 py-0.5 rounded-md text-[11px]">
              /theme
            </span>
            <span className="text-muted-foreground font-medium">ASCII wallpapers</span>
          </div>
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 font-mono">
            <kbd className="bg-muted px-1.5 py-0.5 rounded border border-border/50 text-[10px]">↵</kbd>
            <span>apply</span>
            <span>•</span>
            <kbd className="bg-muted px-1.5 py-0.5 rounded border border-border/50 text-[10px]">esc</kbd>
            <span>close</span>
          </div>
        </div>

        {/* 8 个横向卡片 */}
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
          {AVAILABLE_STYLES.map((style, idx) => {
            const def = ASCII_THEME_REGISTRY[style]
            const isSelected = style === currentStyle
            const isFocused = idx === focusedIndex
            return (
              <button
                key={style}
                type="button"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
                  handleSelect(style, origin)
                }}
                onMouseEnter={() => setFocusedIndex(idx)}
                className={cn(
                  'group flex flex-col items-center gap-1.5 p-1.5 rounded-lg border text-center transition-all focus:outline-none',
                  isSelected
                    ? 'border-primary ring-2 ring-primary/40 bg-accent/40'
                    : isFocused
                      ? 'border-border bg-accent/20'
                      : 'border-border/40 hover:border-border/80'
                )}
              >
                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-muted/30">
                  <img
                    src={THEME_IMAGES[style]}
                    alt={def.name}
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    loading="lazy"
                  />
                  {isSelected && (
                    <div className="absolute top-1 right-1 size-2 rounded-full bg-primary" />
                  )}
                </div>
                <span
                  className={cn(
                    'text-[10px] font-medium truncate max-w-full leading-tight',
                    isSelected ? 'text-primary font-semibold' : 'text-muted-foreground group-hover:text-foreground'
                  )}
                >
                  {def.englishName}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
