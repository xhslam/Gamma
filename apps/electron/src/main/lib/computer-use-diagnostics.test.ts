import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runComputerUseDiagnostics } from './computer-use-diagnostics'
import type { ComputerUseDiagnosticsOptions, ComputerUseDiagnosticsReport } from './computer-use-diagnostics'

const reportPath = `/tmp/gamma-computer-use-diagnostics-${process.pid}.json`
const roots: string[] = []
afterEach(() => {
  rmSync(reportPath, { force: true })
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(parentAX = true, helperAX = true) {
  const events: string[] = []
  const paths: string[] = []
  const listeners: Array<() => void> = []
  const options: ComputerUseDiagnosticsOptions = {
    argv: ['Gamma', '--computer-use-diagnostics'], resourcesPath: '/Applications/Gamma.app/Contents/Resources',
    app: {
      isPackaged: true,
      setName: name => { events.push(`name:${name}`) },
      setPath: (name, path) => { expect(existsSync(path)).toBe(true); paths.push(path); events.push(`path:${name}`) },
      getPath: () => '/Applications/Gamma.app/Contents/MacOS/Gamma',
      getAppPath: () => '/Applications/Gamma.app/Contents/Resources/app.asar', getVersion: () => '0.19.fixture',
      whenReady: async () => { events.push('ready'); expect(paths).toHaveLength(2) },
      on: (_event, callback) => { listeners.push(callback) },
      quit: () => { events.push('quit'); for (const callback of listeners) callback() },
    },
    parentAccessibility: () => { events.push('parentAX'); return parentAX },
    createHost: executable => {
      events.push(`host:${executable}`)
      return {
        call: async (method, params, timeout) => {
          expect(method).toBe('status'); expect(params).toEqual({}); expect(timeout).toBe(5000)
          events.push('status')
          return { permissions: { accessibility: helperAX, screen: false, listen: false, post: false }, message: 'SECRET_AX_CANARY', ax: 'SECRET_AX_CANARY' }
        },
        terminate: async () => { events.push('terminate') },
      }
    },
  }
  return { options, events, paths }
}

async function collect(options: ComputerUseDiagnosticsOptions): Promise<{ report: ComputerUseDiagnosticsReport; metadata: unknown }> {
  const output = spyOn(console, 'log').mockImplementation(() => {})
  try {
    const task = runComputerUseDiagnostics(options)
    expect(task).toBeDefined()
    await task
    return { report: JSON.parse(readFileSync(reportPath, 'utf8')) as ComputerUseDiagnosticsReport, metadata: JSON.parse(String(output.mock.calls[0]?.[0])) as unknown }
  } finally { output.mockRestore() }
}

describe('Given真实GUI父进程的Computer Use只读诊断入口', () => {
  test('When未指定准确开关 Then不初始化Gamma身份、profile或helper', () => {
    const { options, events } = fixture()
    options.argv = ['Gamma', '--computer-use-diagnostics=/tmp/arbitrary']
    expect(runComputerUseDiagnostics(options)).toBeUndefined()
    expect(events).toEqual([])
    expect(existsSync(reportPath)).toBe(false)
  })

  test('When启动诊断 Then同步隔离profile，ready后只请求status并先回收helper再退出', async () => {
    const { options, events, paths } = fixture()
    const { report, metadata } = await collect(options)
    expect(events.slice(0, 4)).toEqual(['name:Gamma', 'path:userData', 'path:sessionData', 'ready'])
    expect(events.indexOf('ready')).toBeLessThan(events.indexOf('parentAX'))
    expect(events.indexOf('terminate')).toBeLessThan(events.indexOf('quit'))
    expect(paths[0]).toBe(paths[1])
    expect(paths[0]?.startsWith('/tmp/gamma-computer-use-diagnostics-profile-')).toBe(true)
    expect(paths.every(path => !existsSync(path))).toBe(true)
    expect(report.parentAX).toBe(true)
    expect(report.helperPermissions).toEqual({ accessibility: true, screen: false, listen: false, post: false })
    expect(report.identitiesMatch).toBe(true)
    expect(report.inheritanceVerified).toBe(true)
    expect(report.readOnly).toBe(true)
    expect(report.errors).toEqual([])
    expect(report.helperExecutable).toBe('/Applications/Gamma.app/Contents/Resources/computer-use/gamma-computer-use-helper')
    expect(readFileSync(reportPath, 'utf8')).not.toContain('SECRET_AX_CANARY')
    expect(statSync(reportPath).mode & 0o777).toBe(0o600)
    expect(metadata).toEqual({ diagnosticsReportPath: reportPath, reportWritten: true })
  })

  test('When父AX已授权但CLI未授权 Then明确报告继承失败证据', async () => {
    const { report } = await collect(fixture(true, false).options)
    expect(report.identitiesMatch).toBe(false)
    expect(report.inheritanceVerified).toBe(false)
  })

  test('When父子都未授权 Then不能把状态一致当作权限继承已证明', async () => {
    const { report } = await collect(fixture(false, false).options)
    expect(report.identitiesMatch).toBe(true)
    expect(report.inheritanceVerified).toBe(false)
  })

  test('When原生status或回收失败 Then仅记录有界错误码、仍退出并清理隔离profile', async () => {
    const { options, paths } = fixture()
    options.createHost = () => ({ call: async () => { throw new Error('SECRET_AX_CANARY'.repeat(1000)) }, terminate: async () => { throw new Error('SECRET_CREDENTIAL') } })
    const { report } = await collect(options)
    expect(report.errors).toEqual(['native-status-failed', 'native-termination-unconfirmed'])
    expect(report.helperPermissions).toBeNull()
    expect(report.identitiesMatch).toBeNull()
    expect(report.inheritanceVerified).toBe(false)
    expect(paths.every(path => !existsSync(path))).toBe(true)
    expect(readFileSync(reportPath, 'utf8')).not.toContain('SECRET')
  })

  test('When外部参数试图指定输出路径且报告目标是符号链接 Then忽略参数且原子替换链接而不改其目标', async () => {
    const root = mkdtempSync('/tmp/gamma-diagnostics-link-test-'); roots.push(root)
    const canary = join(root, 'canary.json')
    writeFileSync(canary, 'original')
    symlinkSync(canary, reportPath)
    const { options } = fixture()
    options.argv = ['Gamma', '--computer-use-diagnostics', `--output=${canary}`]
    await collect(options)
    expect(readFileSync(canary, 'utf8')).toBe('original')
    expect(lstatSync(reportPath).isSymbolicLink()).toBe(false)
  })

  test('When开发态诊断 Then选择app目录内相同裸CLI且不导入业务service', async () => {
    const { options } = fixture()
    options.app = { ...options.app, isPackaged: false, getAppPath: () => '/workspace/Gamma/apps/electron' }
    const { report } = await collect(options)
    expect(report.helperExecutable).toBe('/workspace/Gamma/apps/electron/resources/computer-use/gamma-computer-use-helper')
  })
})
