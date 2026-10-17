import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Provider, createStore } from 'jotai'
import type { ComputerRiskPolicy } from '@gamma/shared'
import { computerUseViewAtom } from '../../atoms/computer-use'
import type { ComputerUseView } from './computer-use-model'
import { ComputerUseStatus } from './ComputerUseStatus'
import { ComputerRiskPolicyOptions } from './ComputerRiskPolicySetting'

const idleView: ComputerUseView = {
  sessionId: 's1', state: { supported: true, phase: 'disabled' }, loading: false, pending: null, error: null,
}

function renderStatus(updates: Partial<ComputerUseView> = {}): string {
  const store = createStore()
  store.set(computerUseViewAtom, { ...idleView, ...updates })
  return renderToStaticMarkup(<Provider store={store}><ComputerUseStatus sessionId="s1" /></Provider>)
}

/** 只隔离当前 TSX 的 hooks 与依赖，不导入 AppShell/GeneralSettings 的整个依赖树。 */
function loadComponent<T>(file: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}): T {
  const module = { exports: {} }
  const { code } = transformSync(readFileSync(`${import.meta.dir}/${file}`, 'utf8'), {
    loader: 'tsx', jsx: 'transform', format: 'cjs', target: 'es2022',
  })
  runInNewContext(code, {
    module, exports: module.exports,
    require: (name: string) => {
      if (!(name in dependencies)) throw new Error(`未配置组件测试依赖：${name}`)
      return dependencies[name]
    },
    ...globals,
  })
  return module.exports as T
}

interface PolicyRowProps {
  children: React.ReactElement<{ onChange: (policy: ComputerRiskPolicy) => void; value: ComputerRiskPolicy; disabled: boolean }>
  description: React.ReactNode
}

function setupPolicy(api: {
  getComputerPreferences: () => Promise<{ riskPolicy: ComputerRiskPolicy }>
  updateComputerPreferences: (updates: { riskPolicy: ComputerRiskPolicy }) => Promise<{ riskPolicy: ComputerRiskPolicy }>
}) {
  const slots: unknown[] = []
  const effects: Array<() => void | (() => void)> = []
  let cursor = 0
  let rendered = false
  const hooks = {
    ...React,
    useState: (initial: unknown) => {
      const index = cursor++
      if (!(index in slots)) slots[index] = initial
      return [slots[index], (next: unknown) => { slots[index] = next }]
    },
    useRef: (initial: unknown) => {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useCallback: (callback: unknown) => callback,
    useEffect: (effect: () => void | (() => void)) => { if (!rendered) effects.push(effect) },
  }
  const component = loadComponent<{ ComputerRiskPolicySetting(): React.ReactElement<PolicyRowProps> }>('ComputerRiskPolicySetting.tsx', {
    react: hooks,
    '@/components/ui/button': { Button: 'button' },
    '@/components/settings/primitives/SettingsRow': { SettingsRow: 'section' },
    '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
  }, { window: { electronAPI: api } })
  const render = () => {
    cursor = 0
    const result = component.ComputerRiskPolicySetting()
    rendered = true
    return result
  }
  render()
  const cleanups = effects.map((effect) => effect())
  return { render, cleanup: () => cleanups.forEach((cleanup) => cleanup?.()) }
}

// preferences promises 各有一层 await；让读取/保存和 finally 均完成。
async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('自主桌面工具运行时状态控件', () => {
  test('Given 任何桌面状态 When ComputerUseStatus 渲染 Then 始终返回空（不在应用内放悬浮卡片）', () => {
    expect(renderStatus()).toBe('')
    expect(renderStatus({ state: { supported: true, phase: 'active', sessionId: 's2', targetApp: { bundleId: 'app.notes', name: '备忘录' }, message: '正在观察桌面' } })).toBe('')
    expect(renderStatus({ state: { supported: true, phase: 'paused' } })).toBe('')
    expect(renderStatus({ pending: 'stop' })).toBe('')
  })

  test('Given AppShell 存活 Then 应用内无悬浮状态卡片，仅挂载 ComputerModals 且无常驻面板', () => {
    const shell = readFileSync(`${import.meta.dir}/../app-shell/AppShell.tsx`, 'utf8')
    const sidebar = readFileSync(`${import.meta.dir}/../app-shell/LeftSidebar.tsx`, 'utf8')
    const modals = readFileSync(`${import.meta.dir}/ComputerModals.tsx`, 'utf8')
    expect(shell).not.toContain('<ComputerUseStatus')
    expect(shell).toContain('<ComputerModals />')
    expect(sidebar).not.toContain('ComputerUsePanel')
    expect(sidebar).not.toContain('onComputerStateChanged')
    expect(modals).toContain('onComputerAppAuthRequested')
    expect(modals).toContain('onComputerRiskConfirmRequested')
    expect(modals).not.toContain('getComputerPreferences')
    expect(modals).not.toContain('requestComputerPermission')
    expect(modals).not.toContain('不包含键盘密码')
  })
})

describe('通用设置中的桌面风险策略', () => {
  test('Given 任一策略 When 渲染 Then 三档均可访问且只选中当前值', () => {
    for (const value of ['strict', 'standard', 'relaxed'] as const) {
      const html = renderToStaticMarkup(<ComputerRiskPolicyOptions value={value} onChange={() => {}} />)
      for (const label of ['严格', '标准', '宽松']) expect(html).toContain(label)
      expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
      expect(html).toContain('桌面操作风险策略')
      expect(html).toContain('focus-visible:ring-2')
    }
    const html = renderToStaticMarkup(<ComputerRiskPolicyOptions value={null} disabled onChange={() => {}} />)
    expect(html.match(/disabled=""/g)).toHaveLength(3)
    expect(html).not.toContain('aria-pressed="true"')
  })

  test('Given 已加载偏好 When 修改风险策略 Then 只更新 riskPolicy 并保留所有档的高风险确认说明', async () => {
    const writes: Array<{ riskPolicy: ComputerRiskPolicy }> = []
    const context = setupPolicy({
      getComputerPreferences: async () => ({ riskPolicy: 'standard' }),
      updateComputerPreferences: async (updates) => { writes.push(updates); return updates },
    })
    expect(context.render().props.children.props.disabled).toBe(true)
    await settle()
    let row = context.render()
    expect(row.props.children.props.value).toBe('standard')
    expect(renderToStaticMarkup(<>{row.props.description}</>)).toContain('三档均保留已知高风险操作的人工确认')
    row.props.children.props.onChange('strict')
    expect(context.render().props.children.props.disabled).toBe(true)
    await settle()
    row = context.render()
    expect(row.props.children.props.value).toBe('strict')
    expect(writes).toEqual([{ riskPolicy: 'strict' }])
    context.cleanup()
  })

  test('Given 保存失败 When 用户再次选择 Then 保留已确认策略且显示错误，不并发写入', async () => {
    let writes = 0
    const context = setupPolicy({
      getComputerPreferences: async () => ({ riskPolicy: 'standard' }),
      updateComputerPreferences: async () => { writes++; throw new Error('write failed') },
    })
    await settle()
    const options = context.render().props.children.props
    options.onChange('relaxed')
    options.onChange('strict')
    await settle()
    const row = context.render()
    expect(writes).toBe(1)
    expect(row.props.children.props.value).toBe('standard')
    expect(row.props.children.props.disabled).toBe(false)
    expect(renderToStaticMarkup(<>{row.props.description}</>)).toContain('风险策略保存失败，已保留原设置。')
    context.cleanup()
  })

  test('Given 读取失败 When 用户打开设置 Then 不默认覆盖策略并提供重试入口', async () => {
    const context = setupPolicy({
      getComputerPreferences: async () => { throw new Error('read failed') },
      updateComputerPreferences: async () => { throw new Error('不应写入') },
    })
    await settle()
    const row = context.render()
    expect(row.props.children.props.value).toBeNull()
    expect(row.props.children.props.disabled).toBe(true)
    const html = renderToStaticMarkup(<>{row.props.description}</>)
    expect(html).toContain('无法读取桌面操作风险策略，请重试。')
    expect(html).toContain('重试读取')
    context.cleanup()
  })
})
