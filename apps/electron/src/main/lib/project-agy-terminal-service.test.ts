import { describe, expect, test } from 'bun:test'
import type { TerminalCreateInput, TerminalSnapshot, TerminalState } from '@gamma/shared'
import { ProjectAgyTerminalService } from './project-agy-terminal-service'

function setup() {
  const states = new Map<string, TerminalSnapshot>()
  const created: TerminalCreateInput[] = []
  const killed: string[] = []
  let root = '/project'
  let pending: Promise<void> = Promise.resolve()
  const service = new ProjectAgyTerminalService({
    resolveCwd: (id) => { if (id === 'missing' || !root) throw new Error('项目目录不可用'); return `${root}/${id}` },
    create: async (input) => {
      created.push(input)
      await pending
      const state: TerminalState = { ...input, cwd: input.cwd!, title: 'AGY', profile: 'default', pid: created.length }
      states.set(input.terminalId, { state, output: '', sequence: 0 })
      return state
    },
    snapshot: (id) => { const state = states.get(id); if (!state) throw new Error('终端不存在'); return state },
    kill: (id) => { killed.push(id); states.delete(id) },
  })
  return { service, created, killed, states, setRoot: (value: string) => { root = value }, delay: (value: Promise<void>) => { pending = value } }
}
const request = { workspaceId: 'a', skipPermissionsConfirmed: true }

describe('项目级交互 AGY 终端', () => {
  test('Given 未确认权限风险或项目失效 When 打开 Then 不启动任何进程', async () => {
    const context = setup()
    await expect(context.service.open({ ...request, skipPermissionsConfirmed: false })).rejects.toThrow('确认')
    await expect(context.service.open({ ...request, workspaceId: 'missing' })).rejects.toThrow('不可用')
    expect(context.created).toHaveLength(0)
  })
  test('Given 同一项目 When 并发点击和重新打开 Then 只启动一次并保留实例', async () => {
    const context = setup()
    const [first, second] = await Promise.all([context.service.open(request), context.service.open(request)])
    expect(second.terminalId).toBe(first.terminalId)
    expect((await context.service.open(request)).terminalId).toBe(first.terminalId)
    expect(context.created).toHaveLength(1)
    expect(first.cwd).toBe('/project/a')
    expect(first.ownerId).toBe('project-agy:a')
  })
  test('Given 切换项目 When 打开 Then 不改变原项目进程目录', async () => {
    const context = setup()
    const first = await context.service.open(request)
    const second = await context.service.open({ ...request, workspaceId: 'b' })
    expect(second.terminalId).not.toBe(first.terminalId)
    expect(second.cwd).toBe('/project/b')
    expect(context.killed).toHaveLength(0)
  })
  test('Given CLI 已退出 When 再次点击 Then 保留最终状态而非静默重启', async () => {
    const context = setup()
    const first = await context.service.open(request)
    context.states.get(first.terminalId)!.exitCode = 7
    expect(await context.service.open(request)).toMatchObject({ terminalId: first.terminalId, exitCode: 7 })
    expect(context.created).toHaveLength(1)
  })
  test('Given 项目重新关联目录 When 再打开 Then 回收旧进程并严格使用新目录', async () => {
    const context = setup()
    const first = await context.service.open(request)
    context.setRoot('/new')
    const second = await context.service.open(request)
    expect(context.killed).toContain(first.terminalId)
    expect(second.cwd).toBe('/new/a')
    context.setRoot('')
    await expect(context.service.open(request)).rejects.toThrow('不可用')
    expect(context.created).toHaveLength(2)
  })
  test('Given 显式关闭或项目删除 When 再次打开 Then 创建新实例', async () => {
    const context = setup()
    const first = await context.service.open(request)
    context.service.close('a')
    expect(context.killed).toContain(first.terminalId)
    expect((await context.service.open(request)).terminalId).not.toBe(first.terminalId)
  })
  test('Given 创建期间项目被删除 When 创建完成 Then 回收并拒绝迟到实例', async () => {
    const context = setup()
    let release!: () => void
    context.delay(new Promise<void>((resolve) => { release = resolve }))
    const creation = context.service.open(request)
    context.service.close('a')
    release()
    await expect(creation).rejects.toThrow('启动期间关闭')
    expect(context.states.size).toBe(0)
  })
})
