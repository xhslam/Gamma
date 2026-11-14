import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Check, Palette, X } from 'lucide-react'
import { toast } from 'sonner'
import { chatWallpaperAtom, saveChatWallpaperAtom, wallpaperSavingAtom } from '@/atoms/theme'
import { inputToolbarButtonClass } from '@/components/ai-elements/input-toolbar-styles'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { THEME_STYLES, type ThemeStyle } from '../../../types'
import { ASCII_THEME_REGISTRY } from '@/lib/ascii-theme-registry'
import { cn } from '@/lib/utils'
import './ascii-wallpaper.css'

import claudeCode from '@/assets/theme-previews/theme-claude-code.webp'
import cloudDrift from '@/assets/theme-previews/theme-cloud-drift.webp'
import honuLagoon from '@/assets/theme-previews/theme-honu-lagoon.webp'
import koiPond from '@/assets/theme-previews/theme-koi-pond.webp'
import jellyfish from '@/assets/theme-previews/theme-jellyfish.webp'
import paperBoats from '@/assets/theme-previews/theme-paper-boats.webp'
import fireflies from '@/assets/theme-previews/theme-fireflies.webp'
import moonlit from '@/assets/theme-previews/theme-moonlit.webp'

const thumbnails = {
  'claude-code': claudeCode,
  'cloud-drift': cloudDrift,
  'honu-lagoon': honuLagoon,
  'koi-pond': koiPond,
  'jellyfish': jellyfish,
  'paper-boats': paperBoats,
  'fireflies': fireflies,
  'moonlit': moonlit,
}

interface WallpaperChoicesProps {
  onSelect?: (style: ThemeStyle, point: { x: number; y: number } | null, previousStyle: ThemeStyle) => void
  dock?: boolean
}

export function WallpaperChoices({ onSelect, dock = false }: WallpaperChoicesProps): React.ReactElement {
  const current = useAtomValue(chatWallpaperAtom)
  const saving = useAtomValue(wallpaperSavingAtom)
  const saveWallpaper = useSetAtom(saveChatWallpaperAtom)
  const choices = React.useRef<HTMLDivElement>(null)

  const select = async (style: ThemeStyle, event: React.MouseEvent<HTMLButtonElement>): Promise<void> => {
    if (saving) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const point = event.detail > 0
      ? { x: event.clientX, y: event.clientY }
      : { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
    try {
      const changed = await saveWallpaper(style)
      onSelect?.(style, changed ? point : null, current)
    } catch {
      toast.error('场景主题保存失败，请重试。')
    }
  }

  return (
    <div className={cn('space-y-2', dock && 'gamma-wallpaper-choices-dock px-2.5 pb-2.5')} aria-busy={saving}>
      <div className="flex items-center justify-between gap-2">
        {!dock && <span className="text-sm font-medium">场景主题</span>}
        <button
          type="button"
          aria-pressed={current === 'default'}
          aria-disabled={saving}
          className="ml-auto flex min-h-7 items-center gap-1.5 rounded-md px-2 text-xs text-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          onClick={(event) => void select('default', event)}
        >
          {current === 'default' && <Check aria-hidden="true" className="size-3" />}
          关闭场景主题
        </button>
      </div>
      <div
        ref={choices}
        role="group"
        aria-label="场景主题选项"
        className={cn('gamma-wallpaper-choices grid gap-x-2 gap-y-3', dock ? 'grid-cols-4' : 'grid-cols-2')}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          const buttons = Array.from(choices.current?.querySelectorAll('button') ?? [])
          const index = buttons.findIndex((button) => button === event.target)
          if (index < 0) return
          event.preventDefault()
          const direction = event.key === 'ArrowRight' ? 1 : -1
          buttons[(index + direction + buttons.length) % buttons.length]?.focus()
        }}
      >
        {THEME_STYLES.map((style) => {
          if (style === 'default') return null
          const definition = ASCII_THEME_REGISTRY[style]
          const selected = current === style
          return (
            <button
              key={style}
              type="button"
              aria-pressed={selected}
              aria-disabled={saving}
              data-wallpaper-choice={style}
              onClick={(event) => void select(style, event)}
              className="group flex min-w-0 flex-col gap-1.5 rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span
                className={cn('relative block aspect-video w-full overflow-hidden rounded-md border border-border group-hover:border-foreground/50', selected && 'ring-1 ring-foreground')}
                style={{ backgroundColor: definition.backgroundColor }}
              >
                <img src={thumbnails[style]} alt="" draggable={false} className="size-full object-cover" />
              </span>
              <span className="flex min-w-0 items-start gap-1 text-[11px] leading-snug text-foreground">
                {definition.englishName}
                {selected && <Check aria-hidden="true" className="size-3 shrink-0" />}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface ThemeFloatingDockProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: NonNullable<WallpaperChoicesProps['onSelect']>
  onCloseAutoFocus: (event: Event) => void
  children: React.ReactElement
}

export function ThemeFloatingDock({
  open, onOpenChange, onSelect, onCloseAutoFocus, children,
}: ThemeFloatingDockProps): React.ReactElement {
  const options = React.useRef<HTMLDivElement>(null)
  const interactedOutside = React.useRef(false)
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        ref={options}
        aria-label="场景主题"
        side="top"
        sideOffset={8}
        collisionPadding={12}
        className="gamma-wallpaper-dock max-h-[var(--radix-popover-content-available-height)] w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-24px)] overflow-y-auto p-0"
        onInteractOutside={() => { interactedOutside.current = true }}
        onCloseAutoFocus={(event) => {
          if (interactedOutside.current) event.preventDefault()
          interactedOutside.current = false
          onCloseAutoFocus(event)
        }}
        onOpenAutoFocus={(event) => {
          interactedOutside.current = false
          const selected = options.current?.querySelector<HTMLButtonElement>('[data-wallpaper-choice][aria-pressed="true"]')
          const first = selected ?? options.current?.querySelector<HTMLButtonElement>('[data-wallpaper-choice]')
          if (!first) return
          event.preventDefault()
          first.focus({ preventScroll: true })
        }}
      >
        <div className="flex items-center gap-2 px-2.5 pt-2">
          <span className="text-xs font-medium">场景主题</span>
          <button type="button" aria-label="关闭选择器" className="ml-auto grid size-7 place-items-center rounded-md hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => onOpenChange(false)}>
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </div>
        <WallpaperChoices dock onSelect={onSelect} />
      </PopoverContent>
    </Popover>
  )
}

export function ThemeDockTrigger(): React.ReactElement {
  return (
    <PopoverTrigger asChild>
      <button
        type="button"
        aria-label="选择场景主题"
        title="选择场景主题"
        className={inputToolbarButtonClass}
      >
        <Palette aria-hidden="true" className="size-4" />
      </button>
    </PopoverTrigger>
  )
}
