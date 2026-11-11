import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createGammaComputerUseCommand, GAMMA_COMPUTER_USE_EXECUTABLE, GAMMA_COMPUTER_USE_APP, validateGammaComputerUseInstallation } from './gamma-computer-use-command'

function fixture() {
  const calls: string[][] = []
  let running = false
  let reply = '{"kind":"hello","version":1,"engine":"1.0.2"}'
  let stopped = true
  let time = 0
  let launches = 0
  const command = createGammaComputerUseCommand({
    validate() {},
    async launch() { launches++; running = true },
    async invoke(args, identity) {
      calls.push(args)
      if (!running) throw new Error('unavailable')
      if (args[0] === '--stop-session') {
        expect(identity).toEqual({ root: '/private/test', sessionId: 'a'.repeat(64) })
        return JSON.stringify({ kind: stopped ? 'stopped' : 'error', exitCode: stopped ? 0 : 70 })
      }
      return reply
    },
    now: () => time,
    async wait() { time += 1000 },
  })
  return { command, calls, launches: () => launches, running: (value: boolean) => { running = value }, reply: (value: string) => { reply = value }, stopped: (value: boolean) => { stopped = value } }
}

describe('Given 独立 macOS 桌面权限持有组件', () => {
  test('When 解析命令 Then 固定选择独立应用代理、不选择 Gamma 资源路径', () => {
    const { command } = fixture()
    expect(command.executable).toBe(GAMMA_COMPUTER_USE_EXECUTABLE)
    expect(command.argsPrefix).toEqual(['--client'])
  })
  test('When 未安装或校验失败 Then 不尝试启动、不静默使用内置引擎', () => {
    expect(() => createGammaComputerUseCommand({ validate() { throw new Error('未安装') } })).toThrow('未安装')
  })
  test('When 服务未运行 Then 仅用 LaunchServices 启动、握手后才可操作', async () => {
    const f = fixture()
    await f.command.prepare?.()
    expect(f.launches()).toBe(1)
    expect(f.calls).toEqual([['--ping'], ['--ping']])
  })
  test('When 服务已运行 Then 不重复启动应用、不替换组件', async () => {
    const f = fixture(); f.running(true)
    await f.command.prepare?.()
    expect(f.launches()).toBe(0)
    expect(f.calls).toEqual([['--ping']])
  })
  test('When 多个 run 同时准备 Then 共享一次握手', async () => {
    const f = fixture()
    await Promise.all([f.command.prepare?.(), f.command.prepare?.()])
    expect(f.launches()).toBe(1)
  })
  test('When 已连接但协议不兼容 Then 明确拒绝、不重启、不自动更新', async () => {
    const f = fixture(); f.running(true); f.reply('{"kind":"hello","version":2,"engine":"1.0.2"}')
    await expect(f.command.prepare?.()).rejects.toThrow('协议不兼容')
    expect(f.launches()).toBe(0)
  })
  test('When LaunchServices 成功但组件始终不可连接 Then 有界失败且只发送无副作用握手', async () => {
    let now = 0
    const command = createGammaComputerUseCommand({ validate() {}, async launch() {}, async invoke() { throw new Error('offline') }, now: () => now, async wait() { now += 1000 } })
    await expect(command.prepare?.()).rejects.toThrow('未投递桌面操作')
  })
  test('When 停止 Then 必须取得独立服务端停止确认', async () => {
    const f = fixture(); f.running(true)
    const identity = { root: '/private/test', sessionId: 'a'.repeat(64) }
    await f.command.stop?.(identity)
    f.stopped(false)
    await expect(f.command.stop?.(identity)).rejects.toThrow('未确认执行者停止')
  })
})

// 实际执行 codesign，而非只 mock validate，覆盖 requirement 字面量被当作文件名的问题。
describe('Given 已安装的真实 macOS 独立组件', () => {
  test.skipIf(process.platform !== 'darwin' || !existsSync(GAMMA_COMPUTER_USE_APP))('When 校验正确签名及身份 Then 允许接入', () => {
    expect(() => validateGammaComputerUseInstallation()).not.toThrow()
  })
  test.skipIf(process.platform !== 'darwin' || !existsSync(GAMMA_COMPUTER_USE_APP))('When 要求错误身份 Then codesign 明确拒绝', () => {
    const result = spawnSync('/usr/bin/codesign', ['--verify', '-R', '=identifier "invalid.gamma.identity"', GAMMA_COMPUTER_USE_APP], { encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('failed to satisfy')
  })
})
