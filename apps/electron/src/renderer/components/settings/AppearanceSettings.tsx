/**
 * AppearanceSettings - 外观设置页
 *
 * 应用配色、聊天壁纸和工作台显示偏好。
 * 通过 Jotai atom 管理状态，持久化到 ~/.carpus/settings.json。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { WallpaperChoices } from '@/components/ascii-wallpaper/ThemeFloatingDock'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsSegmentedControl,
} from './primitives'
import { themeModeAtom, saveThemeModeAtom } from '@/atoms/theme'
import {
  markdownFontSizeAtom,
  updateMarkdownFontSize,
} from '@/atoms/markdown-font-size'
import { workbenchDensityAtom, updateWorkbenchDensity } from '@/atoms/ui-preferences'
import { normalizeWorkbenchDensity } from '../../../types/settings'
import type { ThemeMode, MarkdownFontSize } from '../../../types'

import { AppIconPicker } from './AppIconPicker'
import { CustomThemeSettings } from './CustomThemeSettings'

const THEME_OPTIONS = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'custom', label: '自定义' },
]

const MARKDOWN_FONT_SIZE_OPTIONS = [
  { value: 'small', label: '小' },
  { value: 'medium', label: '中' },
  { value: 'large', label: '大' },
]

/** 根据平台返回缩放快捷键提示 */
const isMac = navigator.userAgent.includes('Mac')
const ZOOM_HINT = isMac
  ? '使用 ⌘+ 放大、⌘- 缩小、⌘0 恢复默认大小'
  : '使用 Ctrl++ 放大、Ctrl+- 缩小、Ctrl+0 恢复默认大小'

export function AppearanceSettings(): React.ReactElement {
  const [density, setDensity] = useAtom(workbenchDensityAtom)
  const [densitySaving, setDensitySaving] = React.useState(false)
  const [densityError, setDensityError] = React.useState<string | null>(null)
  const handleDensityChange = async (value: string): Promise<void> => {
    if (densitySaving) return
    setDensitySaving(true)
    setDensityError(null)
    const next = normalizeWorkbenchDensity(value)
    try {
      await updateWorkbenchDensity(next)
      setDensity(next)
    } catch {
      setDensityError('工作台密度保存失败，请重试。')
    } finally {
      setDensitySaving(false)
    }
  }
  const themeMode = useAtomValue(themeModeAtom)
  const saveThemeMode = useSetAtom(saveThemeModeAtom)
  const [themeSaving, setThemeSaving] = React.useState(false)
  const [themeError, setThemeError] = React.useState(false)
  const [markdownFontSize, setMarkdownFontSize] = useAtom(markdownFontSizeAtom)

  const handleThemeChange = async (value: string): Promise<void> => {
    if (themeSaving || value === themeMode) return
    setThemeSaving(true)
    setThemeError(false)
    try {
      await saveThemeMode(value as ThemeMode)
    } catch {
      setThemeError(true)
    } finally {
      setThemeSaving(false)
    }
  }

  /** 切换 Markdown 字号 */
  const handleMarkdownFontSizeChange = React.useCallback((value: string) => {
    const size = value as MarkdownFontSize
    setMarkdownFontSize(size)
    updateMarkdownFontSize(size)
  }, [setMarkdownFontSize])

  return (
    <div className="space-y-6">
      <SettingsSection
        title="外观设置"
        description="自定义应用的视觉风格"
      >
        <SettingsCard>
          <fieldset disabled={themeSaving} aria-busy={themeSaving}>
            <SettingsSegmentedControl
              label="模式"
              description="场景主题启用时会暂时覆盖此配色。"
              value={themeMode}
              onValueChange={(value) => { void handleThemeChange(value) }}
              options={THEME_OPTIONS}
            />
          </fieldset>
          {themeError && <p role="alert" className="px-4 pb-3 text-sm text-destructive">应用配色保存失败，请重试。</p>}
          {themeMode === 'custom' && <CustomThemeSettings />}
          <div data-wallpaper-settings className="px-4 py-3">
            <WallpaperChoices />
          </div>

          <fieldset disabled={densitySaving} aria-busy={densitySaving}>
            <SettingsSegmentedControl
              label="工作台密度"
              description="列表行高统一为 34px；紧凑/舒适保留 12px/14px 输入圆角差异，不改变主题与字号。"
              value={density}
              onValueChange={(value) => { void handleDensityChange(value) }}
              options={[{ value: 'compact', label: '紧凑' }, { value: 'comfortable', label: '舒适' }]}
            />
          </fieldset>
          {densityError && <p role="alert" className="px-4 pb-3 text-sm text-destructive">{densityError}</p>}
          <SettingsRow
            label="界面缩放"
            description={ZOOM_HINT}
          />

          <SettingsSegmentedControl
            label="Markdown 字号"
            description="调整 AI 回复与 Markdown 编辑器的正文字号"
            value={markdownFontSize}
            onValueChange={handleMarkdownFontSizeChange}
            options={MARKDOWN_FONT_SIZE_OPTIONS}
          />

        </SettingsCard>
      </SettingsSection>

      <AppIconPicker />
    </div>
  )
}
