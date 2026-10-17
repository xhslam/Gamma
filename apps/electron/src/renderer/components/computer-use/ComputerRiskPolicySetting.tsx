import * as React from 'react'
import type { ComputerRiskPolicy } from '@gamma/shared'
import { Button } from '@/components/ui/button'
import { SettingsRow } from '@/components/settings/primitives/SettingsRow'
import { cn } from '@/lib/utils'

const POLICIES: ReadonlyArray<{ value: ComputerRiskPolicy; label: string }> = [
  { value: 'strict', label: '严格' },
  { value: 'standard', label: '标准' },
  { value: 'relaxed', label: '宽松' },
]

interface ComputerRiskPolicyOptionsProps {
  value: ComputerRiskPolicy | null
  disabled?: boolean
  onChange: (value: ComputerRiskPolicy) => void
}

export function ComputerRiskPolicyOptions({ value, disabled, onChange }: ComputerRiskPolicyOptionsProps): React.ReactElement {
  return (
    <div className="flex gap-1 rounded-lg bg-muted/60 p-1" role="group" aria-label="桌面操作风险策略">
      {POLICIES.map((policy) => (
        <button
          key={policy.value}
          type="button"
          disabled={disabled}
          aria-pressed={value === policy.value}
          onClick={() => onChange(policy.value)}
          className={cn(
            'min-h-8 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
            value === policy.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {policy.label}
        </button>
      ))}
    </div>
  )
}

/** 使用已有偏好接口；读取失败时不以默认值覆盖用户选择。 */
export function ComputerRiskPolicySetting(): React.ReactElement {
  const [policy, setPolicy] = React.useState<ComputerRiskPolicy | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const mounted = React.useRef(false)
  const savingRef = React.useRef(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const preferences = await window.electronAPI.getComputerPreferences()
      if (mounted.current) setPolicy(preferences.riskPolicy)
    } catch {
      if (mounted.current) setError('无法读取桌面操作风险策略，请重试。')
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    mounted.current = true
    void load()
    return () => { mounted.current = false }
  }, [load])

  const changePolicy = async (next: ComputerRiskPolicy): Promise<void> => {
    if (savingRef.current || loading || policy === null || next === policy) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const preferences = await window.electronAPI.updateComputerPreferences({ riskPolicy: next })
      if (mounted.current) setPolicy(preferences.riskPolicy)
    } catch {
      if (mounted.current) setError('风险策略保存失败，已保留原设置。')
    } finally {
      savingRef.current = false
      if (mounted.current) setSaving(false)
    }
  }

  return (
    <SettingsRow
      label="桌面操作风险策略"
      description={<>
        <span>严格 / 标准 / 宽松用于调整确认频率；三档均保留已知高风险操作的人工确认。</span>
        <span className="mt-1 block">Agent 按需调用桌面工具，无需开启模式。暂停后发送新消息“继续”或新任务即可恢复。</span>
        {error && <span role="alert" className="mt-1 block text-destructive">{error}</span>}
        {loading && <span role="status" className="mt-1 block">正在读取风险策略…</span>}
        {saving && <span role="status" className="mt-1 block">正在保存风险策略…</span>}
        {!loading && policy === null && <Button type="button" size="sm" variant="ghost" onClick={() => { void load() }}>重试读取</Button>}
      </>}
    >
      <ComputerRiskPolicyOptions value={policy} disabled={loading || saving || policy === null} onChange={(next) => { void changePolicy(next) }} />
    </SettingsRow>
  )
}
