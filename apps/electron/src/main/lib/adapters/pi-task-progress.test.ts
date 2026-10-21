import { describe, expect, test } from 'bun:test'
import {
  defineTool,
  createExtensionRuntime,
  ExtensionRunner,
  SessionManager,
  type Extension,
  type ExtensionAPI,
  type ExtensionToolContext,
  type ModelRegistry,
} from '@earendil-works/pi-coding-agent'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ToolResultMessage } from '@earendil-works/pi-ai'
import { buildGammaProductToolDefinitions } from './pi-agent-adapter'
import { GammaTaskProgressController, type GammaTaskItem } from './pi-task-progress'
import { sanitizePiMessageImageContent } from '../image-content-validation'
import { normalizePiToolResultDetails } from './pi-tool-result-json'

function taskResult(toolName: string, task: GammaTaskItem, isError = false): ToolResultMessage {
  return {
    role: 'toolResult',
    toolName,
    toolCallId: `call-${task.id}`,
    content: [{ type: 'text', text: JSON.stringify({ task }) }],
    details: normalizePiToolResultDetails({ task }),
    isError,
    timestamp: 1,
  }
}

function branchMessages(manager: SessionManager): unknown[] {
  return manager.getBranch().filter((entry) => entry.type === 'message').map((entry) => entry.message)
}

async function executeTaskTool(controller: GammaTaskProgressController, name: string, input: Record<string, unknown>): Promise<unknown> {
  const tool = buildGammaProductToolDefinitions({ defineTool }, undefined, controller.tasks).find((definition) => definition.name === name)
  if (!tool) throw new Error(`测试工具未注册: ${name}`)
  const result = await tool.execute(`call-${name}`, input, undefined, undefined, {} as ExtensionToolContext)
  return result.details
}

function extensionHarness(controller: GammaTaskProgressController): {
  emit: (name: string, event: Record<string, unknown>) => unknown
} {
  const handlers = new Map<string, (event: Record<string, unknown>) => unknown>()
  const pi = {
    on(name: string, handler: (event: Record<string, unknown>) => unknown) {
      handlers.set(name, handler)
      return () => { handlers.delete(name) }
    },
  } as unknown as ExtensionAPI
  controller.createExtension()(pi)
  return { emit: (name, event) => handlers.get(name)?.(event) }
}

function realExtensionRunner(controller: GammaTaskProgressController, manager: SessionManager): ExtensionRunner {
  const extension: Extension = {
    path: '<task-progress-test>',
    resolvedPath: '<task-progress-test>',
    sourceInfo: { path: '<task-progress-test>', source: 'test', scope: 'temporary', origin: 'top-level' },
    handlers: new Map(),
    tools: new Map(),
    messageRenderers: new Map(),
    commands: new Map(),
    flags: new Map(),
    shortcuts: new Map(),
  }
  controller.createExtension()({
    on(name: string, handler: (event: Record<string, unknown>) => unknown) {
      extension.handlers.set(name, [handler as never])
      return () => { extension.handlers.delete(name) }
    },
  } as unknown as ExtensionAPI)
  // 这些 hooks 不使用 modelRegistry；通过真实 Runner 验证 Pi 的 context 两阶段恢复逻辑。
  return new ExtensionRunner([extension], createExtensionRuntime(), process.cwd(), manager, {} as ModelRegistry)
}

const activeTask: GammaTaskItem = {
  id: 'task-1',
  subject: '调查任务进度',
  status: 'in_progress',
  description: '定位并修复阶段滞后',
  activeForm: '正在读取日志',
}

describe('Pi 任务进度同步', () => {
  test('Given 已执行的创建和更新 When 从当前分支恢复 Then 保留最新任务状态和标题', () => {
    const controller = new GammaTaskProgressController([
      taskResult('TaskCreate', { ...activeTask, status: 'pending' }),
      taskResult('TaskUpdate', activeTask),
    ])
    expect(controller.tasks.get('task-1')).toEqual(activeTask)
  })

  test('Given 已保存任务的续跑会话 When 执行真实 TaskList、TaskGet 和 TaskUpdate Then 共用恢复后的任务表', async () => {
    const manager = SessionManager.inMemory()
    manager.appendMessage(taskResult('TaskCreate', activeTask))
    const controller = new GammaTaskProgressController(branchMessages(manager))
    expect(await executeTaskTool(controller, 'TaskList', {})).toEqual({ tasks: [activeTask] })
    expect(await executeTaskTool(controller, 'TaskGet', { taskId: 'task-1' })).toEqual({ task: activeTask })
    const updated = await executeTaskTool(controller, 'TaskUpdate', { taskId: 'task-1', activeForm: '正在运行验证' }) as { task: GammaTaskItem }
    expect(updated.task.subject).toBe(activeTask.subject)
    expect(updated.task.activeForm).toBe('正在运行验证')
    expect((await executeTaskTool(controller, 'TaskGet', { taskId: 'task-1' }) as { task: GammaTaskItem }).task.activeForm).toBe('正在运行验证')
  })

  test('Given 存在废弃分支和压缩记录 When 恢复当前分支 Then 排除废弃更新且保留压缩前的真实任务', () => {
    const manager = SessionManager.inMemory()
    const initialEntryId = manager.appendMessage(taskResult('TaskCreate', activeTask))
    manager.appendMessage(taskResult('TaskUpdate', { ...activeTask, status: 'completed' }))
    manager.branch(initialEntryId)
    manager.appendCompaction('压缩摘要省略了任务表', null, 100)
    const controller = new GammaTaskProgressController(branchMessages(manager))
    expect(controller.tasks.get('task-1')).toEqual(activeTask)
  })

  test('Given 失败任务更新和无任务的全新 query When 恢复 Then 不应用失败状态或串入旧会话任务', () => {
    const controller = new GammaTaskProgressController([
      taskResult('TaskCreate', activeTask),
      taskResult('TaskUpdate', { ...activeTask, status: 'completed' }, true),
    ])
    expect(controller.tasks.get('task-1')).toEqual(activeTask)
    expect(new GammaTaskProgressController().tasks.size).toBe(0)
  })

  test('Given 只有文本的旧工具结果和数字任务 ID When 恢复 Then 规范化 ID 供真实 TaskGet 读取', async () => {
    const legacyTask = { ...activeTask, id: 42 }
    const controller = new GammaTaskProgressController([
      { role: 'toolResult', toolName: 'TaskCreate', isError: false, content: JSON.stringify({ task: legacyTask }) },
    ])
    expect(await executeTaskTool(controller, 'TaskGet', { taskId: '42' })).toEqual({ task: { ...legacyTask, id: '42' } })
  })

  test('Given 连续多个工作工具已执行但任务未更新 When 请求下一次模型 context Then 注入真实快照和更新提醒', () => {
    const controller = new GammaTaskProgressController([taskResult('TaskCreate', activeTask)])
    const harness = extensionHarness(controller)
    const messages = [{ role: 'user', content: '继续修复', timestamp: 1 }]
    for (let index = 0; index < 3; index += 1) {
      harness.emit('tool_execution_end', { toolName: 'Read', isError: false, result: { content: [] } })
    }
    const result = harness.emit('context', { type: 'context', messages }) as { messages: { content: unknown }[] } | undefined
    expect(result?.messages).toHaveLength(2)
    expect(JSON.stringify(result?.messages[1]?.content)).toContain('正在读取日志')
    expect(JSON.stringify(result?.messages[1]?.content)).toContain('TaskUpdate')
    expect(controller.tasks.get('task-1')?.status).toBe('in_progress')
    expect(messages).toHaveLength(1)
    expect(harness.emit('context', { type: 'context', messages })).toBeUndefined()
  })

  test('Given Pi 真实 extension runner 和 adapter 图片校验 When 构造 provider context Then 保留系统消息和刷新提醒且不污染会话历史', async () => {
    const manager = SessionManager.inMemory()
    manager.appendMessage(taskResult('TaskCreate', activeTask))
    const controller = new GammaTaskProgressController(branchMessages(manager))
    const runner = realExtensionRunner(controller, manager)
    const errors: string[] = []
    runner.onError((error) => { errors.push(error.error) })
    for (let index = 0; index < 3; index += 1) {
      await runner.emit({ type: 'tool_execution_end', toolCallId: `read-${index}`, toolName: 'Read', isError: false, result: { content: [] } })
    }
    const messages: AgentMessage[] = [
      { role: 'system', content: '保持原始系统提示词', timestamp: 1 },
      { role: 'user', content: '继续修复', timestamp: 2 },
    ]
    const providerContext = sanitizePiMessageImageContent(await runner.emitContext(messages))
    expect(errors).toEqual([])
    expect(providerContext).toHaveLength(3)
    expect(providerContext[0]).toEqual(messages[0])
    expect(JSON.stringify(providerContext[2])).toContain('TaskUpdate')
    expect(messages).toHaveLength(2)
    expect(manager.getBranch()).toHaveLength(1)
  })

  test('Given 成功 TaskUpdate When 下一次模型请求 Then 重置工作计数并在后续提醒中显示新阶段', () => {
    const controller = new GammaTaskProgressController([taskResult('TaskCreate', activeTask)])
    const harness = extensionHarness(controller)
    const work = { toolName: 'Read', isError: false, result: { content: [] } }
    for (let index = 0; index < 3; index += 1) harness.emit('tool_execution_end', work)
    const updatedTask = { ...activeTask, activeForm: '正在运行验证' }
    harness.emit('tool_execution_end', { toolName: 'TaskUpdate', isError: false, result: taskResult('TaskUpdate', updatedTask) })
    expect(harness.emit('context', { type: 'context', messages: [] })).toBeUndefined()
    for (let index = 0; index < 3; index += 1) harness.emit('tool_execution_end', work)
    const result = harness.emit('context', { type: 'context', messages: [] })
    expect(JSON.stringify(result)).toContain('正在运行验证')
    expect(JSON.stringify(result)).not.toContain('正在读取日志')
  })

  test('Given TaskUpdate 执行失败 When 已连续执行多个工作工具 Then 不消除同步提醒或改变任务状态', () => {
    const controller = new GammaTaskProgressController([taskResult('TaskCreate', activeTask)])
    const harness = extensionHarness(controller)
    for (let index = 0; index < 3; index += 1) harness.emit('tool_execution_end', { toolName: 'Read', isError: false, result: { content: [] } })
    harness.emit('tool_execution_end', { toolName: 'TaskUpdate', isError: true, result: taskResult('TaskUpdate', { ...activeTask, status: 'completed' }) })
    expect(harness.emit('context', { type: 'context', messages: [] })).toBeDefined()
    expect(controller.tasks.get('task-1')).toEqual(activeTask)
  })

  test('Given 仅查询任务表或不足 3 个工作工具 When 请求模型 Then 不产生高频更新提醒', () => {
    const controller = new GammaTaskProgressController([taskResult('TaskCreate', activeTask)])
    const harness = extensionHarness(controller)
    for (let index = 0; index < 5; index += 1) harness.emit('tool_execution_end', { toolName: 'TaskList', isError: false, result: { content: [] } })
    for (let index = 0; index < 2; index += 1) harness.emit('tool_execution_end', { toolName: 'Read', isError: false, result: { content: [] } })
    expect(harness.emit('context', { type: 'context', messages: [] })).toBeUndefined()
  })

  test.each(['completed', 'cancelled', 'error', 'deleted'] as const)(
    'Given 只有 %s 终态任务 When 后续工作工具完成 Then 不注入历史任务快照', (status) => {
      const controller = new GammaTaskProgressController([taskResult('TaskUpdate', { ...activeTask, status })])
      const harness = extensionHarness(controller)
      for (let index = 0; index < 3; index += 1) harness.emit('tool_execution_end', { toolName: 'Read', isError: false, result: { content: [] } })
      expect(harness.emit('context', { type: 'context', messages: [] })).toBeUndefined()
    },
  )
})
