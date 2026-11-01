import { describe, expect, it } from 'bun:test'
import { resolve } from 'node:path'
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
