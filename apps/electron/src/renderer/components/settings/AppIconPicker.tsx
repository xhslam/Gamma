import * as React from 'react'
import { atom, useAtom } from 'jotai'
import { Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { APP_ICON_PREVIEWS } from '@/lib/app-icons'
import { detectIsMac, detectIsWindows } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { normalizeAppIconVariant } from '../../../types/app-icons'
import type { AppIconVariantId } from '../../../types/app-icons'
import { SettingsCard, SettingsSection } from './primitives'

interface AppIconPickerState {
  activeIcon: AppIconVariantId
  initializing: boolean
  pendingIcon: AppIconVariantId | null
  loadError: boolean
}

interface AppIconGridProps {
  activeIcon: AppIconVariantId
  disabled?: boolean
  pendingIcon?: AppIconVariantId | null
  onSelect: (variantId: AppIconVariantId) => void
}

/** 原生按钮保留 Tab、Enter、空格操作，并向辅助技术暴露当前选择。 */
export function AppIconGrid({
  activeIcon,
  disabled = false,
  pendingIcon = null,
  onSelect,
}: AppIconGridProps): React.ReactElement {
  return (
    <div
      role="group"
      aria-label="应用图标配色"
      aria-busy={pendingIcon !== null}
      className="grid grid-cols-2 gap-3 min-[420px]:grid-cols-5"
    >
      {APP_ICON_PREVIEWS.map((variant) => {
        const isSelected = activeIcon === variant.id
        const isPending = pendingIcon === variant.id
        return (
          <Button
            key={variant.id}
            type="button"
            variant="ghost"
            aria-label={`${variant.name}${variant.id === 'default' ? '（默认）' : ''}`}
            aria-pressed={isSelected}
            disabled={disabled || pendingIcon !== null}
            onClick={() => onSelect(variant.id)}
            className={cn(
              'relative h-auto min-w-0 flex-col gap-2 rounded-xl px-2 py-3',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              isSelected ? 'bg-primary/5 ring-2 ring-primary' : 'text-muted-foreground',
            )}
          >
            <img
              src={variant.src}
              alt=""
              className="size-16 max-w-full object-contain"
              draggable={false}
              decoding="async"
            />
            <span className={cn('max-w-full truncate text-xs', isSelected && 'text-foreground')}>
              {variant.name}
            </span>
            {isPending ? (
              <Loader2 aria-hidden="true" className="absolute right-1.5 top-1.5 size-4 animate-spin text-primary" />
            ) : isSelected ? (
              <span className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check aria-hidden="true" className="size-3" />
              </span>
            ) : null}
          </Button>
        )
      })}
    </div>
  )
}

export function AppIconPicker(): React.ReactElement {
  const stateAtom = React.useMemo(() => atom<AppIconPickerState>({
    activeIcon: 'default',
    initializing: true,
    pendingIcon: null,
    loadError: false,
  }), [])
  const [state, setState] = useAtom(stateAtom)
  const platform = React.useMemo(() => ({
    isMac: detectIsMac(),
    isWindows: detectIsWindows(),
  }), [])
  const operationInFlight = React.useRef(false)

  const loadSettings = React.useCallback(async () => {
    setState((current) => ({ ...current, initializing: true, loadError: false }))
    try {
      const settings = await window.electronAPI.getSettings()
      setState((current) => ({
        ...current,
        activeIcon: normalizeAppIconVariant(settings.appIconVariant),
        initializing: false,
      }))
    } catch {
      setState((current) => ({ ...current, initializing: false, loadError: true }))
    }
  }, [setState])

  React.useEffect(() => { void loadSettings() }, [loadSettings])

  const handleIconSelect = React.useCallback(async (variantId: AppIconVariantId) => {
    if (!platform.isMac || state.initializing || state.loadError || operationInFlight.current) return
    if (variantId === state.activeIcon) return
    operationInFlight.current = true
    setState((current) => ({ ...current, pendingIcon: variantId }))
    try {
      const success = await window.electronAPI.setAppIcon(variantId)
      if (success) {
        setState((current) => ({ ...current, activeIcon: variantId }))
        toast.success('应用图标已更换')
      } else {
        toast.error('图标切换失败，请重试')
      }
    } catch {
      toast.error('图标切换失败，请重试')
    } finally {
      operationInFlight.current = false
      setState((current) => ({ ...current, pendingIcon: null }))
    }
  }, [platform.isMac, state.activeIcon, state.initializing, state.loadError, setState])

  return (
    <SettingsSection title="应用图标" description="白底黑银为默认图标，可选择其余九款配色">
      <SettingsCard divided={false}>
        <div className="space-y-3 px-4 py-4">
          <AppIconGrid
            activeIcon={state.activeIcon}
            pendingIcon={state.pendingIcon}
            disabled={state.initializing || state.loadError || !platform.isMac}
            onSelect={(variantId) => { void handleIconSelect(variantId) }}
          />
          {state.loadError ? (
            <div role="alert" className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>无法读取当前图标设置，请重试。</span>
              <Button type="button" variant="outline" size="sm" onClick={() => { void loadSettings() }}>
                重试
              </Button>
            </div>
          ) : (
            <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
              {state.initializing ? '正在读取图标设置…'
                : state.pendingIcon ? '正在更换应用图标…'
                  : platform.isMac ? '选择后立即更新 Dock 图标，重启后保留。'
                    : platform.isWindows ? 'Windows 系统暂不支持更换应用图标。'
                      : '当前系统暂不支持动态更换应用图标。'}
            </p>
          )}
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}
