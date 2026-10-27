import { describe, expect, spyOn, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createComputerFixture, tinyComputerImage } from '../../test-utils/computer-fixture'
import * as logger from './computer-logger'

const secret = 'TEXT_PRIVATE_CANARY_4831'

describe('Given 电脑操作日志包含不可信错误和回执', () => {
  for (const action of ['type', 'paste', 'set_value', ' TYPE_TEXT ']) {
    for (const failure of ['error', 'receipt'] as const) {
      test(`When ${action} 的${failure}回显输入 Then 日志仅包含文本长度`, async () => {
        const logs: logger.ComputerLogEntry[] = []
        const log = spyOn(logger, 'logComputerUseEvent').mockImplementation(entry => { logs.push(entry) })
        const f = createComputerFixture({ call: async (method, params) => {
          if (method === 'observe') return { observationId: 'native-ref', epoch: params.epoch, image: tinyComputerImage, ax: 'ref=body 0 AXTextArea', targetApp: { name: 'Notes', bundleId: 'com.apple.Notes' } }
          if (method === 'perform') {
            if (failure === 'error') throw Object.assign(new Error(secret), { code: secret })
            return { actionId: params.actionId, outcome: 'outcome-unknown', message: secret }
          }
          return undefined
        } })
        try {
          const state = await f.controller.executeAutonomousAction({ action: 'get_app_state' }, undefined, f.binding)
          await expect(f.controller.executeAutonomousAction({ action, text: secret, ...(action === 'set_value' ? { observationId: state.observationId, elementRef: 'body' } : {}) }, undefined, f.binding)).rejects.toThrow()
          expect(logs.some(entry => entry.textLength === secret.length)).toBe(true)
          expect(JSON.stringify(logs)).not.toContain(secret)
        } finally { await f.controller.finishRun(f.binding); log.mockRestore() }
      })
    }
  }
  test('When 文本动作取消且取消原因包含输入 Then 日志不泄露取消原因', async () => {
    const logs: logger.ComputerLogEntry[] = []
    const log = spyOn(logger, 'logComputerUseEvent').mockImplementation(entry => { logs.push(entry) })
    let entered!: () => void
    let release!: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve })
    const barrier = new Promise<void>(resolve => { release = resolve })
    const f = createComputerFixture({ call: async (method, params) => {
      if (method === 'perform') { entered(); await barrier; return { actionId: params.actionId, outcome: 'dispatched-unverified' } }
      return undefined
    } })
    const abort = new AbortController()
    try {
      const running = f.controller.executeAutonomousAction({ action: 'type', text: secret }, abort.signal, f.binding)
      await waiting
      abort.abort(secret)
      release()
      await expect(running).rejects.toThrow()
      expect(logs.some(entry => entry.textLength === secret.length)).toBe(true)
      expect(JSON.stringify(logs)).not.toContain(secret)
    } finally { release(); await f.controller.finishRun(f.binding); log.mockRestore() }
  })
  test('When 原生记录 AX 元素 Then 只读取明确允许的属性', () => {
    const source = readFileSync(join(import.meta.dir, '../../../native/computer-use/Protocol.swift'), 'utf8')
    const body = source.slice(source.indexOf('func describeAXElementInfo('), source.indexOf('func currentSystemFocusedElementDict('))
    expect(body).not.toContain('kAXValueAttribute')
    expect(body).not.toContain('kAXDescriptionAttribute')
    expect([...body.matchAll(/dict\["([^"]+)"\]/g)].map(match => match[1]).sort()).toEqual(['frame', 'identifier', 'role', 'subrole', 'title'])
  })
})
