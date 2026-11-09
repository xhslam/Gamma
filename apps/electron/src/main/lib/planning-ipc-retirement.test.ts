import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PLANNING_IPC_CHANNELS } from '@gamma/shared'
import { DEFAULT_PRODUCTIVITY_TOOLS_SETTINGS, normalizeProductivityToolsSettings } from '../../types/settings'
import { PLANNING_REMOVED_ERROR, registerRemovedPlanningHandlers } from './planning-ipc-retirement'

const readSource = (relativePath: string): string => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

describe('Todo 与日程运行时下线', () => {
  test('Given 缺省、损坏或旧版开启配置 When 归一化 Then 两项始终关闭且不修改输入', () => {
    expect(DEFAULT_PRODUCTIVITY_TOOLS_SETTINGS).toEqual({ todosEnabled: false, calendarEnabled: false })
    for (const input of [undefined, null, 'invalid', {}, { todosEnabled: true }, { calendarEnabled: true }, { todosEnabled: true, calendarEnabled: true }]) {
      const before = JSON.stringify(input)
      expect(normalizeProductivityToolsSettings(input)).toEqual({ todosEnabled: false, calendarEnabled: false })
      expect(JSON.stringify(input)).toBe(before)
    }
  })

  test('Given 旧 preload 请求任意 Planning 能力 When 注册并调用 Then 统一拒绝且不读取数据或请求系统权限', () => {
    const handlers = new Map<string, () => never>()
    registerRemovedPlanningHandlers({ handle: (channel, handler) => { handlers.set(channel, handler) } })
    const broadcasts = ['CHANGED', 'REMINDER_DUE', 'AGENT_OPERATION']
    for (const [name, channel] of Object.entries(PLANNING_IPC_CHANNELS)) {
      if (broadcasts.includes(name)) {
        expect(handlers.has(channel)).toBe(false)
        continue
      }
      const handler = handlers.get(channel)
      expect(handler).toBeDefined()
      expect(handler!).toThrow(PLANNING_REMOVED_ERROR)
    }
    expect([...handlers.keys()].every((channel) => channel.startsWith('planning:'))).toBe(true)
  })

  test('Given 主进程启动与 IPC 注册 When 检查运行时接线 Then 不启动旧调度且 Automation 保持独立', () => {
    const application = readSource('../application.ts')
    expect(application).not.toContain('startPlanningReminderScheduler')
    expect(application).not.toContain('startPlanningNativeSyncCoordinator')
    const island = readSource('./agent-island-service.ts')
    expect(island).not.toContain("from './planning-manager'")
    expect(island).not.toContain('onPlanningChanged')
    expect(island).not.toContain('scheduleNextPlanningAttention')
    expect(island).toContain('overdueTodoCount: 0, todos: [], events: []')
    expect(application).toContain("safeRun('startScheduler', startScheduler)")
    const ipc = readSource('../ipc.ts')
    expect(ipc).toContain('registerRemovedPlanningHandlers(ipcMain)')
    expect(ipc).not.toContain('ipcMain.handle(PLANNING_IPC_CHANNELS.')
    expect(ipc).not.toContain("from './lib/planning-manager'")
    expect(ipc).not.toContain("from './lib/planning-native-sync-service'")
    expect(ipc).toMatch(/ipcMain\.handle\(\s*AUTOMATION_IPC_CHANNELS\./)
  })

  test('Given 旧界面恢复 When 挂载应用 Then 不加载旧数据或挂载提醒，PlanningView 仅展示 Automation', () => {
    const main = readSource('../../renderer/main.tsx')
    expect(main).not.toContain('PlanningInitializer')
    expect(main).not.toContain('onPlanningChanged')
    expect(main).toContain('<AutomationInitializer />')
    expect(readSource('../../renderer/App.tsx')).not.toContain('PlanningReminderRail')
    const view = readSource('../../renderer/components/planning/PlanningView.tsx')
    expect(view).toContain('<AutomationsListView />')
    expect(view).not.toContain('TodoWorkspace')
    expect(view).not.toContain('CalendarWorkspace')
    expect(view).not.toContain('productivityToolsAtom')
    const settings = readSource('../../renderer/components/settings/GeneralSettings.tsx')
    expect(settings).not.toContain('label="Todo"')
    expect(settings).not.toContain('label="日程"')
    expect(settings).toContain('intelligentUiEnabled')
  })
})
