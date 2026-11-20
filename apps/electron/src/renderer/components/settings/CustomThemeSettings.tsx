import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { RotateCcw } from 'lucide-react'
import { customThemeAtom, saveCustomThemeAtom } from '@/atoms/theme'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DEFAULT_CUSTOM_THEME,
  isCustomThemeColor,
  type CustomThemeColors,
} from '../../../types'
import { SettingsRow } from './primitives'

const COLOR_FIELDS = [
  { key: 'accent', label: '强调色' },
  { key: 'background', label: '背景' },
  { key: 'foreground', label: '前景' },
] as const

type CustomThemeColorKey = keyof CustomThemeColors

/** 参考 Codex 的三色编辑器，颜色保存后由统一主题令牌驱动整个工作台。 */
export function CustomThemeSettings(): React.ReactElement {
  const colors = useAtomValue(customThemeAtom)
  const saveCustomTheme = useSetAtom(saveCustomThemeAtom)
  const [drafts, setDrafts] = React.useState<CustomThemeColors>(colors)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => { setDrafts(colors) }, [colors])

  const save = async (next: CustomThemeColors): Promise<void> => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await saveCustomTheme(next)
      setDrafts(next)
    } catch {
      setError('自定义配色保存失败，请重试。')
    } finally {
      setSaving(false)
    }
  }

  const commit = (key: CustomThemeColorKey, value: string): void => {
    if (!isCustomThemeColor(value)) {
      setError('请输入 6 位十六进制颜色，例如 #458588。')
      return
    }
    const normalized = value.toUpperCase()
    if (normalized === colors[key]) {
      setDrafts((current) => ({ ...current, [key]: normalized }))
      setError(null)
      return
    }
    void save({ ...colors, [key]: normalized })
  }

  return (
    <div data-custom-theme-settings>
      <fieldset disabled={saving} aria-busy={saving}>
        {COLOR_FIELDS.map(({ key, label }) => (
          <SettingsRow key={key} label={label}>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label={`${label}选择器`}
                value={colors[key]}
                className="size-8 cursor-pointer rounded-md border border-border/60 bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                onChange={(event) => {
                  setDrafts((current) => ({ ...current, [key]: event.target.value.toUpperCase() }))
                  commit(key, event.target.value)
                }}
              />
              <Input
                aria-label={`${label}十六进制色值`}
                value={drafts[key]}
                maxLength={7}
                spellCheck={false}
                autoComplete="off"
                className="h-8 w-24 px-2 font-mono text-xs uppercase"
                onChange={(event) => {
                  setDrafts((current) => ({ ...current, [key]: event.target.value }))
                  setError(null)
                }}
                onBlur={(event) => { commit(key, event.target.value) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
            </div>
          </SettingsRow>
        ))}
        <div className="flex justify-end px-4 pb-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => {
              setDrafts(DEFAULT_CUSTOM_THEME)
              void save(DEFAULT_CUSTOM_THEME)
            }}
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
            恢复默认
          </Button>
        </div>
      </fieldset>
      {error && <p role="alert" className="px-4 pb-3 text-xs text-destructive">{error}</p>}
    </div>
  )
}
