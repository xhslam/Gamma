import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { createAgyEnvironment, createAgyInvocation, formatAgyLaunchError, resolveAgyExecutable } from './agy-process-launch'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function files(...paths: string[]) { return (path: string) => paths.some(file => file.toLowerCase() === path.toLowerCase()) }
const home = 'C:\\Users\\测试用户'
const local = win32.join(home, 'AppData', 'Local')

describe('Given Windows agy 程序发现', () => {
  test('When CLI 在官方安装目录且 GUI PATH 未刷新 Then 无需复制二进制也能找到', () => {
    const executable = win32.join(local, 'agy', 'bin', 'agy.exe')
    for (const env of [{ LOCALAPPDATA: local }, {}]) {
      expect(resolveAgyExecutable({ platform: 'win32', home, env, canExecute: files(executable) })).toBe(executable)
    }
  })
  test('When PATH 使用混合大小写、引号和环境占位符 Then 按目录与扩展名顺序查找', () => {
    const executable = 'D:\\CLI Tools\\agy.CMD'
    expect(resolveAgyExecutable({ platform: 'win32', home, env: { Path: '"%CLI_HOME%";C:\\other', CLI_HOME: 'D:\\CLI Tools', PathExt: '.CMD;.EXE' }, canExecute: files(executable) }).toLowerCase()).toBe(executable.toLowerCase())
  })
  test('When 指定 AGY_BIN Then 优先使用且无效路径不静默降级', () => {
    const executable = 'D:\\custom\\agy.exe'
    const options = { platform: 'win32' as const, home, env: { agy_bin: `"${executable}"`, PATH: 'C:\\tools' }, canExecute: files(executable, 'C:\\tools\\agy.exe') }
    expect(resolveAgyExecutable(options)).toBe(executable)
    expect(() => resolveAgyExecutable({ ...options, env: { AGY_BIN: 'D:\\missing\\agy.exe' } })).toThrow('AGY_BIN')
    expect(() => resolveAgyExecutable({ ...options, env: { AGY_BIN: 'agy.exe' } })).toThrow('绝对路径')
    expect(() => resolveAgyExecutable({ ...options, env: { AGY_BIN: 'D:\\custom\\agy.ps1' }, canExecute: () => true })).toThrow('.exe')
  })
  test('When 只有旧安装位置、npm shim 或 Programs 安装 Then 保持兼容', () => {
    for (const executable of [win32.join(home, '.local', 'bin', 'agy.exe'), win32.join(local, 'Programs', 'agy', 'agy.exe'), win32.join(home, 'AppData', 'Roaming', 'npm', 'agy.cmd')]) {
      expect(resolveAgyExecutable({ platform: 'win32', home, env: {}, canExecute: files(executable) }).toLowerCase()).toBe(executable.toLowerCase())
    }
  })
  test('When PATH 含空项或相对目录 Then 不从项目 cwd 捡起同名程序', () => {
    const attempted: string[] = []
    expect(() => resolveAgyExecutable({ platform: 'win32', home, env: { PATH: ';.;tools;""' }, canExecute: path => { attempted.push(path); return false } })).toThrow('where.exe agy')
    expect(attempted.every(path => win32.isAbsolute(path))).toBe(true)
  })
  test('When 安装位置在两次启动之间变化 Then 每次重新发现而不缓存失效路径', () => {
    let current = 'C:\\first\\agy.exe'
    const options = { platform: 'win32' as const, home, env: { PATH: 'C:\\first;C:\\second' }, canExecute: (path: string) => path.toLowerCase() === current.toLowerCase() }
    expect(resolveAgyExecutable(options)).toBe(current)
    current = 'C:\\second\\agy.exe'
    expect(resolveAgyExecutable(options)).toBe(current)
  })
})

describe('Given macOS/Linux 已正常工作的 agy', () => {
  test('When PATH 有自定义安装 Then 保持 PATH 优先且不执行登录 shell', () => {
    expect(resolveAgyExecutable({ platform: 'darwin', home: '/Users/test', env: { PATH: '/custom/bin:/usr/bin' }, canExecute: files('/custom/bin/agy', '/Users/test/.local/bin/agy') })).toBe('/custom/bin/agy')
  })
  test('When GUI PATH 精简 Then 保留 .local/bin 和 Homebrew 兜底', () => {
    for (const executable of ['/Users/test/.local/bin/agy', '/opt/homebrew/bin/agy', '/usr/local/bin/agy']) {
      expect(resolveAgyExecutable({ platform: 'darwin', home: '/Users/test', env: { PATH: '/usr/bin:/bin' }, canExecute: files(executable) })).toBe(executable)
    }
    expect(resolveAgyExecutable({ platform: 'linux', home: '/home/test', env: {}, canExecute: files('/home/test/.local/bin/agy') })).toBe('/home/test/.local/bin/agy')
  })
  test('When 文件不是可执行程序或是目录 Then 不误认为已安装', () => {
    const root = mkdtempSync(join(tmpdir(), 'agy-launch-')); roots.push(root)
    const path = join(root, 'agy.exe')
    mkdirSync(path)
    expect(() => resolveAgyExecutable({ executable: path })).toThrow('不可执行')
    if (process.platform !== 'win32') {
      const file = join(root, 'not-executable')
      writeFileSync(file, '#!/bin/sh\nexit 0\n'); chmodSync(file, 0o600)
      expect(() => resolveAgyExecutable({ executable: file })).toThrow('不可执行')
    }
  })
})

describe('Given 外部进程白名单环境和启动参数', () => {
  test('When Windows 环境键大小写不一致 Then 保留必要系统目录但不传密钥与 Electron 注入', () => {
    const env = createAgyEnvironment({ Path: 'C:\\tools', SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\System32\\cmd.exe', LocalAppData: local, AppData: 'C:\\roaming', PATHEXT: '.EXE;.CMD', USERPROFILE: home, API_KEY: 'secret', NODE_OPTIONS: '--require=evil', ELECTRON_RUN_AS_NODE: '1', AGY_BIN: 'D:\\cli\\agy.exe' }, 'win32')
    expect(env.PATH).toBe('C:\\tools')
    expect(env.SYSTEMROOT).toBe('C:\\Windows')
    expect(env.COMSPEC).toContain('cmd.exe')
    expect(env.LOCALAPPDATA).toBe(local)
    expect(env.APPDATA).toBe('C:\\roaming')
    for (const name of ['API_KEY', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'AGY_BIN']) expect(env[name]).toBeUndefined()
    expect(Object.keys(env).filter(key => key.toLowerCase() === 'path')).toHaveLength(1)
    expect(createAgyEnvironment({ PATH: '/bin', HOME: '/home/test', LANG: 'zh_CN.UTF-8', API_KEY: 'secret' }, 'darwin')).toEqual({ PATH: '/bin', HOME: '/home/test', LANG: 'zh_CN.UTF-8' })
  })
  test('When 直接运行 exe 或 POSIX 程序 Then 参数原样保留而不经过 shell', () => {
    const args = ['--json-schema', '{"title":"中文 & %PATH%"}']
    expect(createAgyInvocation('D:\\Program Files\\agy.exe', args, {}, 'win32')).toEqual({ command: 'D:\\Program Files\\agy.exe', args })
    expect(createAgyInvocation('/Users/test/.local/bin/agy', args, {}, 'darwin')).toEqual({ command: '/Users/test/.local/bin/agy', args })
  })
  test('When cmd 参数含控制字符 Then 拒绝而不是交给 shell 执行', () => {
    expect(() => createAgyInvocation('C:\\tools\\agy.cmd', ['line1\nline2'], {}, 'win32')).toThrow('控制字符')
  })
  test('When 启动失败 Then 区分未找到、权限与可执行格式并给出修复办法', () => {
    expect(formatAgyLaunchError(Object.assign(new Error('spawn missing ENOENT'), { code: 'ENOENT' }), 'C:\\tools\\agy.exe', 'C:\\work', 'win32')).toContain('AGY_BIN')
    expect(formatAgyLaunchError(Object.assign(new Error('denied'), { code: 'EACCES' }), '/cli/agy', '/work', 'darwin')).toContain('执行权限')
    expect(formatAgyLaunchError(Object.assign(new Error('bad format'), { code: 'ENOEXEC' }), '/cli/agy', '/work', 'linux')).toContain('格式')
  })
  test.skipIf(process.platform !== 'win32')('When Windows cmd/bat shim 在含空格中文路径 Then stdin 与元字符参数不丢失也不执行额外命令', () => {
    const base = mkdtempSync(join(tmpdir(), 'agy shim 中文 & test ')); roots.push(base)
    const root = join(base, 'literal %AGY_TEST_EXPAND% ! ^ (path)'); mkdirSync(root)
    writeFileSync(join(root, 'fixture.cjs'), 'let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>console.log(JSON.stringify({args:process.argv.slice(2),input:s})));')
    for (const extension of ['cmd', 'bat']) {
      const executable = join(root, `agy.${extension}`)
      writeFileSync(executable, `@echo off\r\n"${process.execPath}" "%~dp0fixture.cjs" %*\r\n`)
      const args = ['--model', 'gemini-3.8-flash-high', '--json-schema', join(root, 'schema & (test).json')]
      const env = { ...createAgyEnvironment(), AGY_TEST_EXPAND: 'SHOULD_NOT_EXPAND' }
      const invocation = createAgyInvocation(executable, args, env)
      const result = spawnSync(invocation.command, invocation.args, { env, input: '中文提示词\n第二行 & %PATH%', encoding: 'utf8', windowsVerbatimArguments: invocation.windowsVerbatimArguments, windowsHide: true, shell: false, timeout: 10000 })
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({ args, input: '中文提示词\n第二行 & %PATH%' })
      expect(result.stderr).toBe('')
    }
  })
})
