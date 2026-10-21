import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { AgyTaskUpdate } from '@gamma/shared'
import { AgyTaskService } from './agy-task-service'
import { AgyTaskStore } from './agy-task-store'

const roots: string[] = []
const services: AgyTaskService[] = []
afterEach(() => {
  for (const service of services.splice(0)) service.shutdown()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const output = (value: object) => `console.log(${JSON.stringify(JSON.stringify(value))});`
function setup(source: string) {
  const root = mkdtempSync(join(tmpdir(), 'gamma-agy-service-')); roots.push(root)
  const updates: AgyTaskUpdate[] = []
  let spawnCount = 0
  let args: string[] = []
  const service = new AgyTaskService({
    context(sessionId) { if (!['owner', 'other'].includes(sessionId)) throw new Error('会话不存在'); return { workbench: root, allowedRoots: [root] } },
    notify(update) { updates.push(update) },
    spawn(_command, argv, options) {
      spawnCount++; args = argv as string[]
      return spawn(process.execPath, ['-e', source], options)
    },
  })
  services.push(service)
  return { root, service, updates, get spawnCount() { return spawnCount }, get args() { return args } }
}

const success = output({ event: 'init', init: { permission_mode: 'request-review', cwd: '/fixture' } })
  + output({ event: 'step_update', step_update: { step_index: 1, step_type: 'agent_response', state: 'DONE', text_delta: '你好' } })
  + output({ event: 'result', result: { status: 'SUCCESS', response: '你好', duration_seconds: 1, usage: { total_tokens: 10 } } })

describe('Given 受管 agy 外部任务', () => {
  test('When 收到流式结果并正常退出 Then 才标记完成并保存历史', async () => {
    const fixture = setup(success)
    const task = fixture.service.start('owner', { prompt: '仅回复你好' }, 'call-1')
    expect(task.status).toBe('running')
    const final = await fixture.service.wait('owner', task.id, 5)
    expect(final.status).toBe('completed')
    expect(final.response).toBe('你好')
    expect(final.permissionMode).toBe('request-review')
    expect(fixture.service.read('owner', task.id).events.some(event => event.kind === 'text')).toBe(true)
    expect(fixture.updates[0]?.reveal).toBe(true)
    expect(fixture.args).toContain('stream-json')
    expect(fixture.args).not.toContain('--dangerously-skip-permissions')
    expect(() => fixture.service.get('other', task.id)).toThrow('不属于')
    const again = fixture.service.start('owner', { prompt: '同一次工具重放' }, 'call-1')
    expect(again.id).toBe(task.id)
    expect(fixture.spawnCount).toBe(1)
  })
  test('When 工具失败但模型成功总结 Then 子步骤错误与整体完成分开展示', async () => {
    const fixture = setup(output({ event: 'step_update', step_update: { step_type: 'tool', state: 'ERROR', step_index: 1, tool_name: 'read_file', tool_info: { error: { message: 'file does not exist' } } } }) + success)
    const task = fixture.service.start('owner', { prompt: '读取测试' }, 'call')
    expect((await fixture.service.wait('owner', task.id, 5)).status).toBe('completed')
    expect(fixture.service.read('owner', task.id).events.find(event => event.kind === 'tool')?.state).toBe('ERROR')
  })
  test('When 权限拒绝或软超时带成功信封 Then 不得误报成功', async () => {
    for (const stderr of ['cannot prompt for permission, auto-denied', 'print timeout after 1s with turn in progress']) {
      const fixture = setup(`console.error(${JSON.stringify(stderr)});` + success)
      const task = fixture.service.start('owner', { prompt: '测试' }, stderr)
      const final = await fixture.service.wait('owner', task.id, 5)
      expect(final.status).toBe(stderr.includes('timeout') ? 'timed_out' : 'failed')
    }
  })
  test('When 缺失 result、非零退出或协议损坏 Then 任务失败', async () => {
    for (const source of ['console.log("not-json");', success + 'process.exitCode=2;', output({ event: 'init', init: {} })]) {
      const fixture = setup(source)
      const task = fixture.service.start('owner', { prompt: '测试' }, 'call')
      expect((await fixture.service.wait('owner', task.id, 5)).status).toBe('failed')
    }
  })
  test('When 停止或父工具被取消 Then 终止进程并幂等返回取消状态', async () => {
    const fixture = setup('setInterval(()=>{},1000);')
    const task = fixture.service.start('owner', { prompt: '等待' }, 'call')
    const final = await fixture.service.stop('owner', task.id)
    expect(final.status).toBe('cancelled')
    expect((await fixture.service.stop('owner', task.id)).status).toBe('cancelled')
    const controller = new AbortController()
    const next = fixture.service.start('owner', { prompt: '等待' }, 'call2', controller.signal)
    controller.abort()
    expect((await fixture.service.wait('owner', next.id, 5)).status).toBe('cancelled')
  })
  test('When 独立后代占用输出管道 Then 停止在有限时间收束且明确无法确认后代状态', async () => {
    if (process.platform === 'win32') return
    const fixture = setup(`
      const {spawn}=require('node:child_process');
      spawn(process.execPath,['-e','setTimeout(()=>{},4000)'],{detached:true,stdio:['ignore','inherit','inherit']});
      ${output({ event: 'init', init: { permission_mode: 'request-review' } })}
      setInterval(()=>{},1000);
    `)
    const task = fixture.service.start('owner', { prompt: '观察测试' }, 'pipe')
    for (let i = 0; i < 100 && !fixture.service.get('owner', task.id).permissionMode; i++) await new Promise(resolve => setTimeout(resolve, 10))
    const started = Date.now()
    const final = await fixture.service.stop('owner', task.id)
    expect(final.status).toBe('cancelled')
    expect(Date.now() - started).toBeLessThan(3500)
    expect(final.error).toContain('无法确认独立后代')
  }, 10000)
  test('When 批量最终结果超过活动摘要大小 Then 独立结果仍完整且超限结果不得成功', async () => {
    const items = Array.from({length:120}, (_, id) => ({id,label:'测试'}))
    const fixture = setup(output({ event:'result',result:{status:'SUCCESS',structured_output:{items}} }))
    const task = fixture.service.start('owner', { prompt:'逐条抽取' }, 'batch')
    const final = await fixture.service.wait('owner', task.id, 5)
    expect(final.status).toBe('completed')
    expect((final.structuredOutput as {items:unknown[]}).items).toHaveLength(120)
    expect(fixture.service.read('owner',task.id).task.structuredOutput).toEqual({items})
    const huge = setup(output({ event:'result',result:{status:'SUCCESS',structured_output:{items:Array.from({length:6000},(_,id)=>id)}} }))
    const largeTask = huge.service.start('owner',{prompt:'批量'},'huge')
    const partial = await huge.service.wait('owner',largeTask.id,5)
    expect(partial.status).toBe('failed')
    expect(partial.outputIncomplete).toBe(true)
    expect(partial.error).toContain('不完整')
  })
  test('When 越界、无效参数或超过并发上限 Then 拒绝启动', async () => {
    const fixture = setup('setInterval(()=>{},1000);')
    expect(() => fixture.service.start('owner', { prompt: 'x', cwd: '/' }, 'bad')).toThrow('授权')
    expect(() => fixture.service.start('owner', { prompt: 'x', model: '--skip' + ' invalid' }, 'bad')).toThrow()
    expect(() => fixture.service.start('owner', { prompt: 'x', timeoutSeconds: 0 }, 'bad')).toThrow()
    for (let i = 0; i < 4; i++) fixture.service.start('owner', { prompt: 'x' }, String(i))
    expect(() => fixture.service.start('owner', { prompt: 'x' }, 'overflow')).toThrow('并发')
    await fixture.service.stopSession('owner')
    expect(fixture.service.list('owner').every(task => task.status === 'cancelled')).toBe(true)
  })
  test('When 应用重启遇到遗留 running 元数据 Then 标记中断而不自动续跑', () => {
    const fixture = setup(success)
    const store = new AgyTaskStore(join(fixture.root, 'agy-tasks'))
    store.save({ id: 'orphan', sessionId: 'owner', title: '残留', prompt: '', cwd: fixture.root, status: 'running', startedAt: 1, lastSequence: 0 }, [])
    expect(fixture.service.list('owner')[0]?.status).toBe('interrupted')
    expect(fixture.spawnCount).toBe(0)
  })
})
