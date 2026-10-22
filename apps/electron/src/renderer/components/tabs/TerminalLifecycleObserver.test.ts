import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { AgentTerminalCloseEvent, AgentTerminalOpenEvent } from '@gamma/shared'
import { loadIsolatedModule } from '../../../test-utils/isolated-module'

function setup() {
  const atoms = { agentDiffPanelTabAtom: 'active-tabs', agentTerminalTabsAtom: 'terminals', currentAgentSessionIdAtom: 'session', currentSessionSidePanelOpenAtom: 'open' }
  const state = new Map<string, unknown>([['terminals', new Map()], ['active-tabs', new Map()], ['session', 's1'], ['project-terminals', new Map()]])
  let opened!: (event: AgentTerminalOpenEvent) => void
  let closed!: (event: AgentTerminalCloseEvent) => void
  const effects: Array<() => void | (() => void)> = []
  let retained: unknown
  let unsubscribed = 0
  const store = {
    get: (atom: string) => state.get(atom),
    set: (atom: string, update: unknown) => state.set(atom, typeof update === 'function' ? update(state.get(atom)) : update),
  }
  const module = loadIsolatedModule<{ TerminalLifecycleObserver(): null }>(`${import.meta.dir}/TerminalLifecycleObserver.tsx`, {
    react: { useEffect: (effect: () => void | (() => void)) => effects.push(effect) },
    jotai: { useStore: () => store, useAtomValue: (atom: string) => store.get(atom) },
    '@/atoms/project-agy-terminal-atoms': { projectAgyTerminalsAtom: 'project-terminals' },
    '@/atoms/agent-atoms': { ...atoms, getTerminalSidePanelTab: (id: string) => `terminal:${id}` },
    './TerminalTabContent': { retainTerminalViews: (tabs: unknown) => { retained = tabs } },
  }, { window: { electronAPI: {
    onTerminalExit: () => () => { unsubscribed++ },
    onAgentTerminalOpen: (listener: typeof opened) => { opened = listener; return () => { unsubscribed++ } },
    onAgentTerminalClose: (listener: typeof closed) => { closed = listener; return () => { unsubscribed++ } },
  } } })
  module.TerminalLifecycleObserver()
  const cleanups = effects.map((effect) => effect())
  return { state, opened: (event: AgentTerminalOpenEvent) => opened(event), closed: (event: AgentTerminalCloseEvent) => closed(event), retained: () => retained, cleanup: () => cleanups.forEach((cleanup) => cleanup?.()), unsubscribed: () => unsubscribed }
}

describe('全局终端生命周期监听', () => {
  test('Given 不在 Agent 面板 When 后台会话打开和关闭终端 Then atom 仍更新且不激活另一个会话面板', () => {
    const context = setup()
    context.opened({ sessionId: 's2', terminalId: 't2', title: '后台终端', cwd: '/project' })
    const tabs = context.state.get('terminals') as Map<string, unknown[]>
    expect(tabs.get('s2')).toHaveLength(1)
    expect(context.state.get('open')).toBeUndefined()
    context.closed({ sessionId: 's2', terminalId: 't2' })
    expect((context.state.get('terminals') as Map<string, unknown[]>).has('s2')).toBe(false)
    context.cleanup()
    expect(context.unsubscribed()).toBe(3)
  })

  test('Given 当前会话打开终端 When 重复打开并关闭 Then Tab 幂等且活动视图回到文件', () => {
    const context = setup()
    const event = { sessionId: 's1', terminalId: 't1', title: '终端', cwd: '/project' }
    context.opened(event)
    context.opened(event)
    expect((context.state.get('terminals') as Map<string, unknown[]>).get('s1')).toHaveLength(1)
    expect((context.state.get('active-tabs') as Map<string, string>).get('s1')).toBe('terminal:t1')
    context.closed(event)
    expect((context.state.get('active-tabs') as Map<string, string>).get('s1')).toBe('files')
  })

  test('Given AppShell 切换设置或规划 When 右侧面板卸载 Then 全局 observer 不在 showRightPanel 条件内', () => {
    const source = readFileSync(`${import.meta.dir}/../app-shell/AppShell.tsx`, 'utf8')
    expect(source).toContain('<TerminalLifecycleObserver />')
    expect(source).not.toContain('{showRightPanel && <TerminalLifecycleObserver')
    const rightPanel = readFileSync(`${import.meta.dir}/../app-shell/RightSidePanel.tsx`, 'utf8')
    expect(rightPanel).not.toContain('onAgentTerminalOpen')
    expect(rightPanel).not.toContain('onAgentTerminalClose')
  })
})
