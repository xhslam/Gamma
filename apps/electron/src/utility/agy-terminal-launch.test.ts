import { describe, expect, test } from 'bun:test'
import { resolveAgyTerminalLaunch } from './agy-terminal-launch'

const exists = (executable: string) => (candidate: string): boolean => candidate === executable

describe('AGY 交互 PTY 的平台启动契约', () => {
  for (const executable of ['/Users/测试用户/.local/bin/agy', '/opt/homebrew/bin/agy', '/usr/local/bin/agy']) {
    test(`Given macOS GUI 精简 PATH When 使用 ${executable} Then 直接启动且补齐工具路径/UTF-8 而不加载 shell profile`, () => {
      const launch = resolveAgyTerminalLaunch({ platform: 'darwin', home: '/Users/测试用户', env: { PATH: '/usr/bin:/bin:.:relative', HOME: '/Users/测试用户', NODE_OPTIONS: '--require=unsafe', API_KEY: 'do-not-forward' }, canExecute: exists(executable) })
      expect(launch.file).toBe(executable)
      expect(launch.args).toEqual(['--dangerously-skip-permissions'])
      expect(launch.env.LANG).toBe('en_US.UTF-8')
      expect(launch.env.PATH?.split(':')).toContain('/opt/homebrew/bin')
      expect(launch.env.PATH?.split(':')).toContain('/Users/测试用户/.local/bin')
      expect(launch.env.PATH?.split(':')).not.toContain('.')
      expect(launch.env.NODE_OPTIONS).toBeUndefined()
      expect(launch.env.API_KEY).toBeUndefined()
      expect(launch.env.TERM_PROGRAM).toBe('Gamma')
    })
  }
  test('Given macOS 已配置中文语言 When 启动 Then 不覆盖用户的 locale', () => {
    const executable = '/custom/agy'
    const launch = resolveAgyTerminalLaunch({ platform: 'darwin', home: '/Users/test', env: { AGY_BIN: executable, LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8', PATH: '/custom:/usr/bin' }, canExecute: exists(executable) })
    expect(launch.env.LANG).toBe('zh_CN.UTF-8')
    expect(launch.env.LC_ALL).toBe('zh_CN.UTF-8')
  })
  test('Given Windows 程序路径包含中文与空格 When 启动 exe Then 参数独立且系统变量大小写统一', () => {
    const executable = 'C:\\Users\\测试用户\\CLI Tools\\agy.exe'
    const launch = resolveAgyTerminalLaunch({ platform: 'win32', home: 'C:\\Users\\测试用户', env: { agy_bin: executable, Path: 'C:\\Windows\\System32;.;C:\\Windows\\System32', SystemRoot: 'C:\\Windows', ELECTRON_RUN_AS_NODE: '1' }, canExecute: exists(executable) })
    expect(launch.file).toBe(executable)
    expect(launch.args).toEqual(['--dangerously-skip-permissions'])
    expect(launch.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(launch.env.PATH?.split(';')).toContain('C:\\Users\\测试用户\\CLI Tools')
    expect(launch.env.PATH?.split(';').filter(path => path.toLowerCase() === 'c:\\windows\\system32')).toHaveLength(1)
  })
  test('Given Windows cmd 垫片 When 传入 PTY Then 使用 COMSPEC 与已转义命令行而非 PowerShell 命令注入', () => {
    const executable = 'C:\\CLI 中文 & (tools)\\agy.cmd'
    const launch = resolveAgyTerminalLaunch({ platform: 'win32', home: 'C:\\Users\\test', env: { AGY_BIN: executable, ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, canExecute: exists(executable) })
    expect(launch.file).toBe('C:\\Windows\\System32\\cmd.exe')
    expect(typeof launch.args).toBe('string')
    expect(launch.args).toContain('/d /v:off /s /c')
    expect(launch.args).toContain('--dangerously-skip-permissions')
  })
  test('Given 程序缺失或无权限 When 启动 Then 明确报错而非回落到任意 shell', () => {
    expect(() => resolveAgyTerminalLaunch({ platform: 'darwin', home: '/Users/test', env: {}, canExecute: () => false })).toThrow('未找到 agy')
    expect(() => resolveAgyTerminalLaunch({ platform: 'win32', home: 'C:\\Users\\test', env: { AGY_BIN: 'C:\\missing.exe' }, canExecute: () => false })).toThrow('不可执行')
  })
})
