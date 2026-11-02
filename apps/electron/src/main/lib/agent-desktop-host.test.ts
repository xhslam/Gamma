import { describe, expect, it } from 'bun:test'
import { resolve, join } from 'node:path'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AgentDesktopHost } from './agent-desktop-host'

const binaryPath = resolve(
  import.meta.dir,
  '../../../resources/agent-desktop/agent-desktop',
)

describe('AgentDesktopHost', () => {
  it('正确执行真实二进制 version 命令并返回 envelope 2.5', async () => {
    const host = new AgentDesktopHost(() => ({ executable: binaryPath }))
    const result = await host.execute('test-version', ['version'])

    expect(result.ok).toBe(true)
    expect(result.command).toBe('version')
    expect(result.version).toBe('2.5')
    expect(result.data).toMatchObject({
      version: '1.0.2',
    })

    await host.terminate('test-version')
  })

  it('正确执行 status 命令', async () => {
    const host = new AgentDesktopHost(() => ({ executable: binaryPath }))
    const result = await host.execute('test-status', ['status'])

    expect(result.ok).toBe(true)
    expect(result.command).toBe('status')
    expect(result.version).toBe('2.5')

    await host.terminate('test-status')
  })

  for (const namespace of [
    'agent:session/run:123',
    '桌面操作/运行 1',
    `run-${'a'.repeat(100)}`,
    '',
  ]) {
    it(`Given 原始 namespace ${JSON.stringify(namespace)} When 调用真实 status Then 映射为合法且稳定的 session`, async () => {
      const host = new AgentDesktopHost(() => ({ executable: binaryPath }))
      try {
        const first = await host.execute(namespace, ['status'])
        const second = await host.execute(namespace, ['status'])
        expect(first.ok).toBe(true)
        expect(second.ok).toBe(true)
        const sessionId = (first.data as { session_id: string }).session_id
        expect(sessionId).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
        expect(second.data).toMatchObject({ session_id: sessionId })
      } finally {
        await host.terminate()
      }
    })
  }

  it('Given 易因替换或截断碰撞的 namespace When 执行和停止 Then session 独立且仍按原始标识禁止重放', async () => {
    const host = new AgentDesktopHost(() => ({ executable: binaryPath }))
    const namespaces = ['run:a', 'run/a', `run-${'a'.repeat(80)}-1`, `run-${'a'.repeat(80)}-2`]
    try {
      const sessionIds: string[] = []
      for (const namespace of namespaces) {
        const result = await host.execute(namespace, ['status'])
        expect(result.ok).toBe(true)
        sessionIds.push((result.data as { session_id: string }).session_id)
      }
      expect(new Set(sessionIds).size).toBe(namespaces.length)
      await host.terminate(namespaces[0])
      expect(host.isStopped(namespaces[0]!)).toBe(true)
      await expect(host.execute(namespaces[0]!, ['status'])).rejects.toThrow('桌面运行已停止；不得重放')
      expect((await host.execute(namespaces[1]!, ['status'])).ok).toBe(true)
    } finally {
      await host.terminate()
    }
  })

  it('终止后禁止重放，后续执行抛错', async () => {
    const host = new AgentDesktopHost(() => ({ executable: binaryPath }))
    await host.execute('test-term', ['version'])
    await host.terminate('test-term')

    expect(host.isStopped('test-term')).toBe(true)
    await expect(host.execute('test-term', ['version'])).rejects.toThrow(
      '桌面运行已停止；不得重放',
    )
  })

  it('同一 namespace 并发命令被拒绝', async () => {
    const host = new AgentDesktopHost(() => ({ executable: binaryPath }))
    const p1 = host.execute('test-concurrent', ['version'])
    // 立即发起第二条
    await expect(
      host.execute('test-concurrent', ['version']),
    ).rejects.toThrow('同一 namespace 不允许并发命令')
    await p1
    await host.terminate('test-concurrent')
  })

  it('支持 AbortSignal 取消执行', async () => {
    const host = new AgentDesktopHost(() => ({ executable: binaryPath }))
    const controller = new AbortController()
    controller.abort()

    await expect(
      host.execute('test-abort', ['version'], controller.signal),
    ).rejects.toThrow('桌面运行已停止；不得重放')
  })
})

// 仅启动测试自有进程，不调用桌面应用。
describe('AgentDesktopHost 传输和停止屏障', () => {
  it('Given UTF-8 中文跨 stdout chunk When 解析响应 Then 原文不损坏', async () => {
    const host = new AgentDesktopHost(() => ({ executable: process.execPath }))
    try {
      const result = await host.execute('utf8', ['-e', `
        const bytes = Buffer.from(JSON.stringify({version:'2.5',ok:true,command:'test',data:'中文'}));
        const split = bytes.indexOf(Buffer.from('中')) + 1;
        process.stdout.write(bytes.subarray(0, split));
        setTimeout(() => process.stdout.write(bytes.subarray(split)), 80);
      `])
      expect(result.data).toBe('中文')
    } finally {
      await host.terminate()
    }
  })

  it('Given 运行中自有子进程 When 取消 Then 等待 close 且拒绝重放', async () => {
    const host = new AgentDesktopHost(() => ({ executable: process.execPath }))
    const controller = new AbortController()
    const result = host.execute('running', ['-e', 'setInterval(() => {}, 1000)'], controller.signal)
    setTimeout(() => controller.abort(), 80)
    await expect(result).rejects.toThrow('桌面操作已停止')
    await expect(host.execute('running', ['-e', ''])).rejects.toThrow('已停止')
    await host.terminate()
  })

  for (const failure of ['enumeration', 'signal', 'windows'] as const) {
    it(`Given ${failure} 失败 When 停止 Then 报错并允许重试停止而非重放命令`, async () => {
      let fail = true
      const host = new AgentDesktopHost(
        () => ({ executable: process.execPath }),
        failure === 'windows' ? 'win32' : process.platform,
        {
          ...(failure === 'enumeration' ? { listProcesses: async () => {
            if (fail) throw new Error('枚举失败')
            return []
          } } : {}),
          ...(failure === 'signal' ? { signal: (pid: number, signal: NodeJS.Signals) => {
            if (fail) throw new Error('终止失败')
            process.kill(pid, signal)
          } } : {}),
          ...(failure === 'windows' ? { terminateWindows: async (pid: number) => {
            if (fail) throw new Error('taskkill 失败')
            process.kill(pid, 'SIGKILL')
          } } : {}),
        },
      )
      const result = host.execute('failure', ['-e', 'setInterval(() => {}, 1000)'])
      // 尽早注册 rejection，停止成功后的 close 会结束执行。
      const settled = result.catch((error: unknown) => error)
      try {
        await expect(host.terminate('failure')).rejects.toThrow('失败')
        await expect(host.execute('failure', ['-e', ''])).rejects.toThrow('不得重放')
      } finally {
        fail = false
        await host.terminate('failure')
        await settled
      }
    })
  }
})


describe('AgentDesktopHost 后代进程退出验证', () => {
  it('Given 运行中的执行者和后代 When 取消 Then 两者退出且不等待僵尸回收', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gamma-host-test-'))
    const ready = join(dir, 'ready')
    const host = new AgentDesktopHost(() => ({ executable: process.execPath }))
    const controller = new AbortController()
    const result = host.execute('descendants', ['-e', `
      const {spawn} = require('node:child_process');
      const {writeFileSync} = require('node:fs');
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'ignore'});
      writeFileSync(${JSON.stringify(ready)}, JSON.stringify([process.pid, child.pid]));
      setInterval(() => {}, 1000);
    `], controller.signal)
    const settled = result.catch((error: unknown) => error)
    try {
      const deadline = Date.now() + 2000
      while (!existsSync(ready)) {
        if (Date.now() > deadline) throw new Error('测试进程未就绪')
        await new Promise<void>((resolve) => setTimeout(resolve, 10))
      }
      const pids = JSON.parse(readFileSync(ready, 'utf8')) as number[]
      controller.abort()
      expect(await settled).toBeInstanceOf(Error)
      const {stdout} = await promisify(execFile)('/bin/ps', ['-axo', 'pid=,stat='])
      const alive = stdout.trim().split('\n').some((line) => {
        const [pid, state] = line.trim().split(/\s+/)
        return pids.includes(Number(pid)) && !state?.startsWith('Z')
      })
      expect(alive).toBe(false)
    } finally {
      await host.terminate()
      await settled
      rmSync(dir, {recursive: true, force: true})
    }
  })

  it('Given 取消时停止失败 When 稍后重试停止 Then 不产生未处理拒绝且保留进程所有权', async () => {
    let fail = true
    const controller = new AbortController()
    const host = new AgentDesktopHost(() => ({executable: process.execPath}), process.platform, {
      signal(pid, signal) {
        if (fail) throw new Error('拒绝终止')
        try { process.kill(pid, signal) } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
        }
      },
    })
    const result = host.execute('abort-failure', ['-e', 'setInterval(() => {}, 1000)'], controller.signal)
    controller.abort()
    try {
      await expect(result).rejects.toThrow('进程树停止未确认')
      await expect(host.execute('abort-failure', ['-e', ''])).rejects.toThrow('已停止')
    } finally {
      fail = false
      await host.terminate('abort-failure')
    }
  })
})


for (const zombie of [false, true]) {
  it(`Given 终止后枚举仍存在${zombie ? '僵尸' : '活进程'} When 验证退出 Then ${zombie ? '正常完成' : '有界失败并支持停止重试'}`, async () => {
    let pid = 0
    let killed = false
    let retry = false
    const host = new AgentDesktopHost(() => ({executable: process.execPath}), process.platform, {
      signal(target, signal) {
        pid = target
        if (signal === 'SIGKILL') killed = true
        try { process.kill(target, signal) } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
        }
      },
      async listProcesses() {
        return retry ? [] : [{pid, parent: 0, state: killed && zombie ? 'Z' : 'R'}]
      },
    })
    const result = host.execute('verification', ['-e', 'setInterval(() => {}, 1000)']).catch((error: unknown) => error)
    try {
      if (zombie) await host.terminate('verification')
      else await expect(host.terminate('verification')).rejects.toThrow('进程树仍在运行')
    } finally {
      retry = true
      await host.terminate('verification')
      await result
    }
  })
}

it('Given headed 命令排队 When 等待期间授权被撤销 Then 出队后最终门禁在创建执行者前拒绝', async () => {
  let commandCalls = 0
  let valid = true
  const host = new AgentDesktopHost(() => { commandCalls++; return { executable: process.execPath } })
  const script = `setTimeout(()=>process.stdout.write(JSON.stringify({version:'2.5',ok:true,command:'test'})),80)`
  const first = host.execute('first-headed', ['-e', script, '--', '--headed'])
  const queued = host.execute('second-headed', ['-e', script, '--', '--headed'], undefined, undefined, () => {
    if (!valid) throw new Error('授权已撤销')
  }).then(() => undefined, (error: unknown) => error)
  valid = false
  try {
    await first
    expect(await queued).toBeInstanceOf(Error)
    expect(commandCalls).toBe(1)
  } finally { await host.terminate() }
})

it('Given 当前 run 的私有原生 ref store When 查询归属 Then 不能跨 run 或停止后复用', async () => {
  const host = new AgentDesktopHost(() => ({ executable: process.execPath }))
  try {
    await host.execute('ref-owner', ['-e', `
      const fs=require('node:fs'),path=require('node:path');
      const root=path.join(process.env.AGENT_DESKTOP_HOME,'sessions',process.env.AGENT_DESKTOP_SESSION,'snapshots','snapshot');
      fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'refmap.json'),JSON.stringify({inner:{'@e1':{pid:34,source_app:'Notes',process_instance:'native-instance'}}}));
      process.stdout.write(JSON.stringify({version:'2.5',ok:true,command:'snapshot'}));
    `])
    expect(await host.resolveRefTarget('ref-owner', '@snapshot:e1')).toEqual({ appName: 'Notes', pid: 34, processInstance: 'native-instance' })
    await expect(host.resolveRefTarget('foreign-run', '@snapshot:e1')).rejects.toThrow('当前有效')
    await host.terminate('ref-owner')
    await expect(host.resolveRefTarget('ref-owner', '@snapshot:e1')).rejects.toThrow('当前有效')
  } finally { await host.terminate() }
})
