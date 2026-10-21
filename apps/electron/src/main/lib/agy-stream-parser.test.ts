import { describe, expect, test } from 'bun:test'
import type { AgyActivityEvent } from '@gamma/shared'
import { AgyStreamParser, redactAgyText, redactAgyValue } from './agy-stream-parser'

type ParsedEvent = Omit<AgyActivityEvent, 'sequence' | 'timestamp'>

function capture(): { parser: AgyStreamParser; events: ParsedEvent[] } {
  const events: ParsedEvent[] = []
  return { parser: new AgyStreamParser(event => events.push(event)), events }
}

function line(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

// 旧 flat 协议的兼容 fixtures；CLI 1.4.4 的真实 envelope 形状在下方独立覆盖。
const fixtures = [
  { type: 'init', conversation_id: 'fixture-conversation', cwd: '/tmp/agy-fixture', tools: ['read_file'], permission_mode: 'default' },
  { type: 'step_update', step_index: 0, state: 'RUNNING', step_type: 'agent_response', text_delta: '你好，' },
  { type: 'step_update', step_index: 0, state: 'RUNNING', step_type: 'agent_response', text_delta: '世界' },
  { type: 'step_update', step_index: 0, state: 'COMPLETED', step_type: 'agent_response' },
  { type: 'step_update', step_index: 1, state: 'RUNNING', step_type: 'tool', tool_name: 'read_file', tool_info: { name: 'read_file', parameters: { Path: '/tmp/agy-fixture/missing.txt' } } },
  { type: 'step_update', step_index: 1, state: 'ERROR', step_type: 'tool', tool_info: { name: 'read_file', parameters: { Path: '/tmp/agy-fixture/missing.txt' }, error: 'File not found' } },
  { type: 'result', status: 'SUCCESS', response: '文件不存在。', duration_seconds: 1.2, usage: { input_tokens: 10, output_tokens: 5 } },
]

describe('AgyStreamParser', () => {
  test('Given 120 项真实 result When 解析 Then 保留全部记录及脱敏内容且不重复套用活动摘要上限', () => {
    const { parser, events } = capture()
    const items = Array.from({ length: 120 }, (_, id) => ({ id, label: `记录-${id}`, token: 'hidden-credential' }))
    parser.push(line({ event: 'result', result: { status: 'SUCCESS', response: '完成', structured_output: { items } } }))
    parser.finish()
    expect(events.map(event => event.kind)).toEqual(['result'])
    const details = events[0]?.details as { structured_output: { items: typeof items } }
    expect(details.structured_output.items).toHaveLength(120)
    expect(details.structured_output.items[119]).toEqual({ id: 119, label: '记录-119', token: '[REDACTED]' })
    expect(JSON.stringify(events)).not.toContain('TRUNCATED')
    expect(JSON.stringify(events)).not.toContain('hidden-credential')
    expect((redactAgyValue(items) as unknown[]).length).toBe(101)
  })

  test('Given result 超过容器/节点/深度/字符上限 When 解析 Then result 之前明确警告最终结果不完整', () => {
    let deep: unknown = 'leaf'
    for (let index = 0; index < 40; index++) deep = { nested: deep }
    const oversizedValues: unknown[] = [
      Array.from({ length: 5001 }, () => 1),
      Array.from({ length: 4999 }, () => [1, 2, 3, 4]),
      deep,
      'x'.repeat(250_000),
    ]
    for (const structured_output of oversizedValues) {
      const { parser, events } = capture()
      const record = line({ event: 'result', result: { status: 'SUCCESS', structured_output } })
      expect(Buffer.byteLength(record)).toBeLessThan(256 * 1024)
      parser.push(record)
      parser.finish()
      expect(events.map(event => event.kind)).toEqual(['warning', 'result'])
      expect(events[0]?.text).toContain('最终结果不完整')
      expect(JSON.stringify(events[1]?.details)).toContain('TRUNCATED')
    }
  })

  test('Given 结果包含超过摘要长度的普通正文和较深结构 When 仍在结果上限内 Then 完整保留且继续脱敏', () => {
    const { parser, events } = capture()
    let nested: unknown = { password: 'hidden-password', code: 'const count = 2;' }
    for (let index = 0; index < 15; index++) nested = { nested }
    const response = 'x'.repeat(90_000)
    parser.push(line({ event: 'result', result: { status: 'SUCCESS', response, nested } }))
    parser.finish()
    expect(events.map(event => event.kind)).toEqual(['result'])
    expect((events[0]?.details as { response: string }).response).toBe(response)
    expect(JSON.stringify(events)).toContain('const count = 2;')
    expect(JSON.stringify(events)).not.toContain('hidden-password')
    expect(JSON.stringify(events)).not.toContain('TRUNCATED')
  })

  test('Given CLI 1.4.4 envelope fixtures When 解析 Then 使用嵌套 payload 而非 flat 字段', () => {
    const { parser, events } = capture()
    const init = { cwd: '/tmp/agy-fixture', tools: ['read_file'], permission_mode: 'default' }
    const result = { status: 'SUCCESS', response: '完成', usage: { input_tokens: 10 } }
    const stream = [
      { event: 'init', conversation_id: 'fixture-envelope', init },
      { event: 'step_update', step_update: { conversation_id: 'fixture-envelope', step_index: 0, state: 'RUNNING', step_type: 'agent_response', text_delta: '第一行\n尾部' } },
      { event: 'step_update', step_update: { conversation_id: 'fixture-envelope', step_index: 0, state: 'DONE', step_type: 'agent_response' } },
      { event: 'step_update', step_update: { conversation_id: 'fixture-envelope', step_index: 1, state: 'ERROR', step_type: 'tool', tool_info: { name: 'read_file', parameters: { Path: '/tmp/agy-fixture/missing' }, error: 'File not found' } } },
      { event: 'result', type: 'init', result },
    ]
    const bytes = Buffer.from(stream.map(line).join(''))
    for (const byte of bytes) parser.push(Buffer.from([byte]))
    parser.finish()
    expect(events.map(event => event.kind)).toEqual(['init', 'text', 'text', 'tool', 'result'])
    expect(events[0]?.details).toEqual({ conversation_id: 'fixture-envelope', ...init })
    expect(events[1]).toMatchObject({ text: '第一行\n', state: 'RUNNING', stepIndex: 0 })
    expect(events[2]).toMatchObject({ text: '尾部', state: 'DONE', stepIndex: 0 })
    expect(events[3]).toMatchObject({ toolName: 'read_file', state: 'ERROR', stepIndex: 1, details: { error: 'File not found' } })
    expect(events[4]?.details).toEqual(result)
  })

  test('Given 跨 delta 凭据及未换行尾部 When 完整行到达 Then 立即输出脱敏行并保留尾部直到 DONE', () => {
    const { parser, events } = capture()
    const push = (text_delta: string, state = 'RUNNING'): void => parser.push(line({ event: 'step_update', step_update: { step_index: 2, step_type: 'agent_response', state, text_delta } }))
    push('开始\nAuthor')
    expect(events.map(event => event.text)).toEqual(['开始\n'])
    push('ization: Bearer hidden-')
    expect(events).toHaveLength(1)
    push('credential\n未换行尾部')
    expect(events).toHaveLength(2)
    expect(events[1]?.text).toContain('[REDACTED]')
    expect(JSON.stringify(events)).not.toContain('hidden-')
    push('', 'DONE')
    expect(events[2]).toMatchObject({ text: '未换行尾部', state: 'DONE' })
  })

  test('Given 文本行超限 When 下一完整行到达 Then 丢弃超长行尾并继续逐行脱敏输出', () => {
    const { parser, events } = capture()
    const push = (text_delta: string): void => parser.push(line({ event: 'step_update', step_update: { step_index: 0, state: 'RUNNING', step_type: 'agent_response', text_delta } }))
    push('x'.repeat(70_000))
    push('hidden-overlong-tail\n下一行\n未完成')
    expect(events.filter(event => event.kind === 'text').at(-1)?.text).toBe('下一行\n')
    expect(JSON.stringify(events)).not.toContain('hidden-overlong-tail')
    expect(events.filter(event => event.kind === 'warning')).toHaveLength(1)
    parser.finish()
    expect(events.at(-1)?.text).toBe('未完成')
  })

  test('Given 已知 envelope 缺少合法 payload When 解析 Then 警告且不冒充有效终态', () => {
    const { parser, events } = capture()
    parser.push(line({ event: 'result', result: null, status: 'SUCCESS' }))
    parser.finish()
    expect(events.map(event => event.kind)).toEqual(['warning'])
  })

  test('Given flat 兼容 fixtures When UTF-8 在每个字节处分块且包含 CRLF/空行 Then 按顺序解析文本、工具和终态', () => {
    const { parser, events } = capture()
    const bytes = Buffer.from(`\r\n${fixtures.map(item => JSON.stringify(item)).join('\r\n')}\r\n`)
    for (const byte of bytes) parser.push(Buffer.from([byte]))
    parser.finish()
    expect(events.map(event => event.kind)).toEqual(['init', 'text', 'tool', 'tool', 'result'])
    expect(events[0]?.details).toEqual(fixtures[0])
    expect(events[1]).toMatchObject({ kind: 'text', text: '你好，世界', stepIndex: 0, state: 'COMPLETED' })
    expect(events[2]).toMatchObject({ kind: 'tool', stepIndex: 1, toolName: 'read_file', details: fixtures[4]?.tool_info })
    expect(events[3]).toMatchObject({ kind: 'tool', state: 'ERROR', details: { error: 'File not found' } })
    expect(events[4]?.details).toEqual(fixtures[6])
  })

  test('Given 坏 JSON、未知事件和非对象 When 继续接收有效行 Then 发出 warning/unknown 且不暴露坏行正文', () => {
    const { parser, events } = capture()
    parser.push('bad password=do-not-leak\nnull\n')
    parser.push(line({ type: 'future_event', token: 'do-not-leak', extra: 1 }))
    parser.push(line({ type: 'step_update', step_type: 'future_step' }))
    parser.push(line(fixtures[6]))
    parser.finish()
    expect(events.map(event => event.kind)).toEqual(['warning', 'warning', 'unknown', 'unknown', 'result'])
    expect(JSON.stringify(events)).not.toContain('do-not-leak')
    expect(events[2]?.details).toMatchObject({ token: '[REDACTED]', extra: 1 })
  })

  test('Given 超过 256KiB 的无换行记录 When 分块写入并随后恢复 Then 只警告一次且恢复下一行', () => {
    const { parser, events } = capture()
    for (let index = 0; index < 1024; index++) parser.push('x'.repeat(1024))
    parser.push(`\n${line(fixtures[6])}`)
    parser.finish()
    expect(events.map(event => event.kind)).toEqual(['warning', 'result'])
    expect(events[0]?.text).toContain('256')
  })

  test('Given 刚好 256KiB 的合法记录 When 换行结束 Then 不当作超长行丢弃', () => {
    const { parser, events } = capture()
    const prefix = '{"type":"future","padding":"'
    const suffix = '"}'
    parser.push(`${prefix}${'x'.repeat(256 * 1024 - Buffer.byteLength(prefix + suffix))}${suffix}\n`)
    parser.finish()
    expect(events.map(event => event.kind)).toEqual(['unknown'])
  })

  test('Given EOF 前的完整或残缺记录 When finish 重复调用 Then 解析完整记录、警告残缺记录且不重复输出', () => {
    const first = capture()
    first.parser.push(JSON.stringify(fixtures[6]))
    first.parser.finish()
    first.parser.finish()
    first.parser.push(line(fixtures[6]))
    expect(first.events).toHaveLength(1)
    const second = capture()
    second.parser.push('{"type":"result"')
    second.parser.finish()
    expect(second.events.map(event => event.kind)).toEqual(['warning'])
  })

  test('Given init/tool/result 内含凭据 When 输出 Then details 和元数据统一脱敏', () => {
    const { parser, events } = capture()
    parser.push(line({ type: 'init', apiKey: 'hidden-init' }))
    parser.push(line({ type: 'step_update', step_type: 'tool', state: 'token=hidden-state', tool_name: 'secret=hidden-name', tool_info: { parameters: { password: 'hidden-tool' } } }))
    parser.push(line({ type: 'result', status: 'SUCCESS', response: 'Bearer hidden-result' }))
    parser.finish()
    expect(events.map(event => event.kind)).toEqual(['init', 'tool', 'result'])
    expect(JSON.stringify(events)).not.toContain('hidden-')
  })

  test('Given agent_response 缺失 delta When 完成 Then 不生成空正文', () => {
    const { parser, events } = capture()
    parser.push(line({ type: 'step_update', step_type: 'agent_response', state: 'RUNNING' }))
    parser.finish()
    expect(events).toEqual([])
  })

  test('Given 秘密跨多个 text_delta When 未结束该 step Then 暂存原文并在结束时合并脱敏', () => {
    const { parser, events } = capture()
    for (const delta of ['Author', 'ization: Bea', 'rer top-', 'secret-value']) {
      parser.push(line({ type: 'step_update', step_type: 'agent_response', step_index: 3, state: 'RUNNING', text_delta: delta }))
    }
    expect(events).toHaveLength(0)
    parser.push(line({ type: 'step_update', step_type: 'agent_response', step_index: 3, state: 'COMPLETED' }))
    expect(events).toHaveLength(1)
    expect(events[0]?.text).toContain('[REDACTED]')
    expect(JSON.stringify(events)).not.toContain('top-secret-value')
  })

  test('Given 文本 step 持续增长 When 超过有界缓冲 Then 截断提示且不泄露后续 delta', () => {
    const { parser, events } = capture()
    for (let index = 0; index < 100; index++) {
      parser.push(line({ type: 'step_update', step_type: 'agent_response', step_index: 0, text_delta: 'x'.repeat(4096) }))
    }
    parser.push(line({ type: 'step_update', step_type: 'agent_response', step_index: 0, text_delta: 'secret=hidden-tail' }))
    parser.finish()
    expect(events.some(event => event.kind === 'warning')).toBe(true)
    expect(JSON.stringify(events)).not.toContain('hidden-tail')
    expect(JSON.stringify(events).length).toBeLessThan(70_000)
  })
})

describe('agy 脱敏与大小边界', () => {
  test('Given 嵌套凭据字段 When 脱敏 Then 大小写及不同命名形式均隐藏且不修改输入', () => {
    const input = { api_key: 'a', accessToken: 'b', nested: { PASSWORD: 'c', client_secret: 'd', Authorization: 'e', 'X-API-Key': 'f' }, code: 'const count = 2; return count', max_tokens: 42 }
    const result = redactAgyValue(input)
    expect(result).toEqual({ api_key: '[REDACTED]', accessToken: '[REDACTED]', nested: { PASSWORD: '[REDACTED]', client_secret: '[REDACTED]', Authorization: '[REDACTED]', 'X-API-Key': '[REDACTED]' }, code: input.code, max_tokens: 42 })
    expect(input.api_key).toBe('a')
  })

  test('Given 文本凭据、JSON 字符串及普通代码 When 脱敏 Then 隐藏凭据且保留普通正文', () => {
    const text = 'Authorization: Bearer value-one\nBearer value-two\nAPI key = "value three"\npassword=value-four\n{"token":"value-five"}\nsecret: value-six\nconst count = 2;'
    const result = redactAgyText(text)
    for (const value of ['value-one', 'value-two', 'value three', 'value-four', 'value-five', 'value-six']) expect(result).not.toContain(value)
    expect(result).toContain('const count = 2;')
    expect(redactAgyText('const tokenCount = 10; const passwordLength = 3;')).toBe('const tokenCount = 10; const passwordLength = 3;')
  })

  test('Given 被上限切断且尚未闭合的引号凭据 When 脱敏 Then 不保留空格后的秘密片段', () => {
    const result = redactAgyText(`password="first fragment ${'private-fragment '.repeat(30_000)}`)
    expect(result).not.toContain('first fragment')
    expect(result).not.toContain('private-fragment')
    expect(result).toContain('[REDACTED]')
  })

  test('Given 循环对象、超深或巨大值 When 脱敏 Then 有界返回并明确截断', () => {
    const cyclic: Record<string, unknown> = { text: 'a'.repeat(300_000) }
    cyclic.self = cyclic
    const result = JSON.stringify(redactAgyValue(cyclic))
    expect(result.length).toBeLessThan(70_000)
    expect(result).toContain('TRUNCATED')
    expect(redactAgyText('x'.repeat(300_000)).length).toBeLessThan(70_000)
    expect(JSON.stringify(redactAgyValue(Array.from({ length: 5000 }, () => ({ key: 'test' })))).length).toBeLessThan(70_000)
    let deep: unknown = { leaf: 'not-reachable' }
    for (let index = 0; index < 20; index++) deep = { nested: deep }
    const deepResult = JSON.stringify(redactAgyValue(deep))
    expect(deepResult).toContain('TRUNCATED')
    expect(deepResult).not.toContain('not-reachable')
  })
})
