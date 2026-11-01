import { describe, expect, it } from 'bun:test'
import {
  AGENT_DESKTOP_COMMANDS,
  buildAgentDesktopArgs,
  parseAgentDesktopEnvelope,
} from './agent-desktop-protocol'

describe('agent-desktop-protocol', () => {
  describe('parseAgentDesktopEnvelope', () => {
    it('正常解析成功响应 envelope 2.5', () => {
      const text = JSON.stringify({
        version: '2.5',
        ok: true,
        command: 'version',
        data: { version: '1.0.2', target: 'aarch64' },
      })
      const result = parseAgentDesktopEnvelope(text)
      expect(result.ok).toBe(true)
      expect(result.command).toBe('version')
      expect(result.version).toBe('2.5')
      expect(result.data).toEqual({ version: '1.0.2', target: 'aarch64' })
    })

    it('正常解析错误响应并保留 disposition', () => {
      const text = JSON.stringify({
        version: '2.5',
        ok: false,
        command: 'click',
        error: {
          code: 'STALE_REF',
          message: 'Ref expired',
          disposition: { delivery: 'not_delivered', retry: 'safe' },
        },
      })
      const result = parseAgentDesktopEnvelope(text)
      expect(result.ok).toBe(false)
      expect(result.error?.code).toBe('STALE_REF')
      expect(result.error?.disposition).toEqual({ delivery: 'not_delivered', retry: 'safe' })
    })

    it('当错误响应缺少 disposition 时，降级为 unknown / unsafe，绝不假定 safe', () => {
      const text = JSON.stringify({
        version: '2.5',
        ok: false,
        command: 'click',
        error: { code: 'FAIL', message: 'Failed' },
      })
      const result = parseAgentDesktopEnvelope(text)
      expect(result.ok).toBe(false)
      expect(result.error?.disposition).toEqual({ delivery: 'unknown', retry: 'unsafe' })
    })

    it('非 JSON 输出抛出投递未知错误', () => {
      expect(() => parseAgentDesktopEnvelope('Fatal error: segfault')).toThrow(
        'agent-desktop 返回非 JSON；投递状态未知，不得重试',
      )
    })

    it('envelope version 不是 2.5 时拒绝', () => {
      const text = JSON.stringify({ version: '2.4', ok: true, command: 'version' })
      expect(() => parseAgentDesktopEnvelope(text)).toThrow('agent-desktop envelope 不兼容')
    })

    it('保留 partial snapshot (complete: false) 属性', () => {
      const text = JSON.stringify({
        version: '2.5',
        ok: true,
        command: 'snapshot',
        data: {
          complete: false,
          snapshot_id: 's1',
          nodes_observed: 100,
          tree: { role: 'window' },
        },
      })
      const result = parseAgentDesktopEnvelope(text)
      expect(result.ok).toBe(true)
      expect((result.data as { complete: boolean }).complete).toBe(false)
    })
  })

  describe('60 命令覆盖矩阵与参数构建', () => {
    it('总计定义 60 个命令', () => {
      expect(Object.keys(AGENT_DESKTOP_COMMANDS)).toHaveLength(60)
    })

    it('4 个 held-input 命令明确拒绝执行', () => {
      for (const cmd of ['key-down', 'key-up', 'mouse-down', 'mouse-up']) {
        expect(() => buildAgentDesktopArgs({ command: cmd, combo: 'shift' })).toThrow(
          'stateless held-input 被明确禁用',
        )
      }
    })

    it('batch 命令明确拒绝直接执行', () => {
      expect(() => buildAgentDesktopArgs({ command: 'batch' })).toThrow(
        'batch 必须由 Gamma 逐项执行并分别授权',
      )
    })

    it('snapshot 正确构造参数', () => {
      const args = buildAgentDesktopArgs({
        command: 'snapshot',
        app: 'Notes',
        windowId: 'win_123',
        surface: 'window',
        skeleton: true,
        interactiveOnly: true,
        maxDepth: 5,
        timeoutMs: 4000,
      })
      expect(args).toEqual([
        'snapshot',
        '--app=Notes',
        '--window-id=win_123',
        '--timeout-ms=4000',
        '--surface=window',
        '--max-depth=5',
        '--interactive-only',
        '--skeleton',
      ])
    })

    it('find 正确构造参数与 state 数组', () => {
      const args = buildAgentDesktopArgs({
        command: 'find',
        app: 'Safari',
        role: 'button',
        name: 'Submit',
        states: ['enabled=true', 'visible=true'],
        first: true,
      })
      expect(args).toEqual([
        'find',
        '--app=Safari',
        '--role=button',
        '--name=Submit',
        '--state=enabled=true',
        '--state=visible=true',
        '--first',
      ])
    })

    it('click/type/press 包含 ref、text 与 headed 标志', () => {
      const clickArgs = buildAgentDesktopArgs({
        command: 'click',
        ref: '@s1:e5',
        headed: true,
      })
      expect(clickArgs).toEqual(['--headed', 'click', '@s1:e5'])

      const typeArgs = buildAgentDesktopArgs({
        command: 'type',
        ref: '@s1:e5',
        text: 'hello world',
      })
      expect(typeArgs).toEqual(['type', '@s1:e5', 'hello world'])

      const pressArgs = buildAgentDesktopArgs({
        command: 'press',
        combo: 'cmd+c',
        app: 'Notes',
      })
      expect(pressArgs).toEqual(['press', 'cmd+c', '--app=Notes'])
    })

    it('拒绝未审阅参数（如 --cdp、argv）', () => {
      expect(() =>
        buildAgentDesktopArgs({
          command: 'launch',
          app: 'Safari',
          cdp: 'http://localhost:9222',
        } as unknown as { command: string }),
      ).toThrow('包含未审阅选项: cdp')
    })

    it('拒绝包含空字节的输入', () => {
      expect(() =>
        buildAgentDesktopArgs({
          command: 'type',
          ref: '@s1:e5',
          text: 'bad\0input',
        }),
      ).toThrow('无效字符串选项')
    })
  })
})
