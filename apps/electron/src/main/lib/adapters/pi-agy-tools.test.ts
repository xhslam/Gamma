import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// mock 仅在隔离进程生效，避免污染其他测试的主进程 controller 单例。
describe('Given Pi 原生 agy 工具桥接', () => {
  test('When 前台主会话注册与调用 Then 捕获所属会话、工具幂等 ID 和已授权根', () => {
    const controller = fileURLToPath(new URL('../agy-task-controller.ts', import.meta.url))
    const tools = fileURLToPath(new URL('./pi-agy-tools.ts', import.meta.url))
    const script = `
      import { mock, expect } from 'bun:test';
      const calls = [];
      const task = { id:'task', sessionId:'owner', status:'running' };
      mock.module(${JSON.stringify(controller)}, () => ({ agyTaskService: {
        start(...args) { calls.push(args); return task },
        list(id) { calls.push(['list',id]); return [task] },
        read(...args) { calls.push(['read',...args]); return {task,events:[]} },
        async wait(...args) { calls.push(['wait',...args]); return task },
        async stop(...args) { calls.push(['stop',...args]); return {...task,status:'cancelled'} },
      } }));
      const { buildPiAgyTools } = await import(${JSON.stringify(tools)});
      const ctx = {sessionId:'owner',workspaceId:'ws',channelId:'channel',allowedRoots:['/authorized']};
      const defs = buildPiAgyTools(ctx);
      expect(defs.map(t=>t.name)).toEqual(['AgyStart','AgyList','AgyRead','AgyWait','AgyStop']);
      for (const triggeredBy of ['automation','delegation','external']) expect(buildPiAgyTools({...ctx,triggeredBy})).toEqual([]);
      expect(buildPiAgyTools({...ctx,workspaceId:undefined})).toEqual([]);
      const signal = new AbortController().signal;
      await defs[0].execute('call-id',{prompt:'hello'},signal);
      expect(calls[0]).toEqual(['owner',{prompt:'hello'},'call-id',signal,['/authorized']]);
      await defs[2].execute('read-id',{taskId:'task',afterSequence:200});
      expect(calls[1]).toEqual(['read','owner','task',200]);
      await defs[3].execute('wait-id',{taskId:'task',timeoutSeconds:1},signal);
      expect(calls[2]).toEqual(['wait','owner','task',1,signal]);
      await defs[4].execute('stop-id',{taskId:'task'});
      expect(calls[3]).toEqual(['stop','owner','task']);
      expect(JSON.stringify(defs[0].parameters)).not.toContain('skip-permissions');
      console.log('AGY_TOOLS_OK');
    `
    const child = spawnSync(process.execPath, ['--eval', script], { encoding: 'utf8', timeout: 20_000 })
    expect(child.stderr).toBe('')
    expect(child.status).toBe(0)
    expect(child.stdout).toContain('AGY_TOOLS_OK')
  })
})
