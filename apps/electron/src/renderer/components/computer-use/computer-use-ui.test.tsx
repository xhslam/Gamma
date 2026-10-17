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

describe('自主桌面工具的常驻 renderer 控件', () => {
  test('Given 桌面待命 When 渲染 Then 常驻停止入口但没有开启/恢复模式按钮', () => {
    const html = renderStatus()
    expect(html).toContain('桌面待命')
    expect(html).toContain('停止所有会话的桌面操作')
    expect(html.match(/<button/g)).toHaveLength(1)
    expect(html).not.toContain('重新启用')
    expect(html).not.toContain('开启模式')
  })

  test('Given Agent 正在观察或操作 When 状态更新 Then 显示状态、应用与主进程消息', () => {
    const html = renderStatus({ state: { supported: true, phase: 'active', sessionId: 's2', targetApp: { bundleId: 'app.notes', name: '备忘录' }, message: '正在观察桌面' } })
    expect(html).toContain('正在操作桌面 · 备忘录')
    expect(html).toContain('正在观察桌面')
    expect(html).toContain('另一个会话正在使用桌面，仍可停止。')
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
  })

  test('Given 暂停或停止 When 显示状态 Then 提示通过新消息或新任务恢复且不重放', () => {
    for (const state of [{ supported: true, phase: 'paused' as const }, { supported: true, phase: 'disabled' as const, resumeRequired: true }]) {
      const html = renderStatus({ state })
      expect(html).toContain('发送新消息“继续”或新任务以恢复，不会重放旧动作。')
      expect(html.match(/<button/g)).toHaveLength(1)
      expect(html).not.toContain('重新启用')
    }
  })

  test('Given 读取失败或正在停止 When 渲染 Then 失败时仍可急停，停止期间阻止重复提交', () => {
    const failed = renderStatus({ error: '读取失败' })
    expect(failed).toContain('role="alert"')
    expect(failed).not.toContain('disabled=""')
    const stopping = renderStatus({ pending: 'stop' })
    expect(stopping).toContain('正在停止')
    expect(stopping).toContain('disabled=""')
  })

  test('Given 侧栏折叠或设置打开 When AppShell 存活 Then 状态订阅独立挂载且不触发启动引导', () => {
    const shell = readFileSync(`${import.meta.dir}/../app-shell/AppShell.tsx`, 'utf8')
    const sidebar = readFileSync(`${import.meta.dir}/../app-shell/LeftSidebar.tsx`, 'utf8')
    const modals = readFileSync(`${import.meta.dir}/ComputerModals.tsx`, 'utf8')
    expect(shell).toContain('<ComputerUseStatus sessionId={currentSessionId} />')
    expect(sidebar).not.toContain('ComputerUsePanel')
    expect(sidebar).not.toContain('onComputerStateChanged')
    expect(modals).toContain('onComputerAppAuthRequested')
    expect(modals).toContain('onComputerRiskConfirmRequested')
    expect(modals).not.toContain('getComputerPreferences')
    expect(modals).not.toContain('requestComputerPermission')
    expect(modals).not.toContain('不包含键盘密码')
  })

  test('Given 常驻控件挂载 When 状态事件与停止点击发生 Then 刷新并全局停止，卸载时解除订阅', () => {
    const effects: Array<() => void | (() => void)> = []
    const calls: unknown[] = []
    let onState: (() => void) | undefined
    let unsubscribed = false
    const stop = () => { calls.push('stop') }
    const refresh = () => { calls.push('refresh') }
    const select = (id: string) => { calls.push(id) }
    const component = loadComponent<{ ComputerUseStatus(props: { sessionId: string }): React.ReactElement<{ children: React.ReactNode[] }> }>('ComputerUseStatus.tsx', {
      react: { ...React, useEffect: (effect: () => void | (() => void)) => effects.push(effect) },
      jotai: { useAtomValue: () => idleView, useSetAtom: (atom: string) => atom === 'stop' ? stop : atom === 'refresh' ? refresh : select },
      'lucide-react': { AlertCircle: 'i', Loader2: 'i', Monitor: 'i', Pause: 'i', Square: 'i' },
      '@/components/ui/button': { Button: 'button' },
      '@/atoms/computer-use': { computerUseViewAtom: 'view', refreshComputerUseAtom: 'refresh', selectComputerSessionAtom: 'select', stopComputerUseAtom: 'stop' },
      './computer-use-model': { getComputerStatusLabel: () => '桌面待命', hasComputerControl: () => false },
    }, { window: { electronAPI: { onComputerStateChanged: (listener: () => void) => { onState = listener; return () => { unsubscribed = true } } } } })
    const tree = component.ComputerUseStatus({ sessionId: 's1' })
    const cleanups = effects.map((effect) => effect())
    expect(onState).toBeDefined()
    onState?.()
    const button = tree.props.children.find((node) => React.isValidElement(node) && node.type === 'button') as React.ReactElement<{ onClick: () => void }>
    button.props.onClick()
    expect(calls).toEqual(['s1', 'refresh', 'stop'])
    cleanups.forEach((cleanup) => cleanup?.())
    expect(unsubscribed).toBe(true)
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
