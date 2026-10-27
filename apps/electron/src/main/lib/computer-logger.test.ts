import { describe, expect, test } from 'bun:test'
import * as path from 'node:path'
import { loadIsolatedModule } from '../../test-utils/isolated-module'

type Logger = typeof import('./computer-logger')

function makeLogger(options: { failFile?: boolean; failConsole?: boolean } = {}) {
  const lines: string[] = []
  const logger = loadIsolatedModule<Logger>(`${import.meta.dir}/computer-logger.ts`, {
    'node:path': path,
    'node:os': { homedir: () => '/home/test' },
    'node:fs': {
      mkdirSync: () => { if (options.failFile) throw new Error('disk') },
      appendFileSync: (_path: string, line: string) => { lines.push(line) },
    },
  }, {
    process: { env: { GAMMA_COMPUTER_LOG_PATH: '/logs/utility.log' } },
    console: { log: () => { if (options.failConsole) throw new Error('console') } },
  })
  return { logger, lines }
}

describe('Given 电脑操作日志', () => {
  test('When Utility 接收主进程的路径 Then 写到该路径并保留就绪信息', () => {
    const { logger, lines } = makeLogger()
    expect(logger.getComputerLogPath()).toBe('/logs/utility.log')
    logger.logComputerUseEvent({ time: 'now', event: 'logger-ready', process: 'utility', version: '1', pid: 42 })
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: 'logger-ready', process: 'utility', version: '1', pid: 42 })
    logger.configureComputerLogPath('/logs/main.log')
    expect(logger.getComputerLogPath()).toBe('/logs/main.log')
  })
  test('When 序列化、文件或控制台失败 Then 不向调用方抛出', () => {
    const circular: Record<string, unknown> = { time: 'now' }; circular.self = circular
    expect(() => makeLogger().logger.logComputerUseEvent(circular as { time: string })).not.toThrow()
    expect(() => makeLogger({ failFile: true }).logger.logComputerUseEvent({ time: 'now' })).not.toThrow()
    expect(() => makeLogger({ failConsole: true }).logger.logComputerUseEvent({ time: 'now' })).not.toThrow()
  })
})
