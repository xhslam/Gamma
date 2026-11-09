import { describe, expect, test } from 'bun:test'
import { buildIntelligentUiActionMessage, isPublicUiUrl, parseIntelligentUiSource, uiContentFingerprint, validateIntelligentUiAction } from './intelligent-ui-policy'
import { mergeUiState } from './intelligent-ui-state'

const spec = (node: object) => JSON.stringify({ items: [node] })
describe('Intelligent UI 安全与隔离', () => {
  test('Given 合法组件 When 预校验 Then 保留声明式数据', () => {
    const source = spec({ type: 'table', columns: ['数量'], rows: [['12']] })
    expect(parseIntelligentUiSource(source)).toEqual(JSON.parse(source))
    expect(parseIntelligentUiSource(spec({ type: 'input', id: 'name', label: '名称' }))).toBeTruthy()
  })
  test('Given 凭据、危险协议、宿主控制、SVG 脚本或 Mermaid 覆盖 When 解析 Then 拒绝', () => {
    for (const node of [
      { type: 'input', inputType: 'password' }, { type: 'input', label: 'API key' },
      { type: 'textarea', id: 'access_token' }, { type: 'image', src: 'file:///etc/passwd' },
      { type: 'image', src: 'https://127.0.0.1/a' }, { type: 'link', href: 'javascript:alert(1)' },
      { type: 'svg', code: '<svg onload="alert(1)" />' }, { type: 'svg', code: '<svg><foreignObject/></svg>' },
      { type: 'mermaid', code: '%%{init:{securityLevel:"loose"}}%%\ngraph TD\nA-->B' },
      { type: 'custom', component: 'evil' }, { type: 'card', panel: true },
    ]) expect(() => parseIntelligentUiSource(spec(node))).toThrow()
    expect(() => parseIntelligentUiSource('{"items":[],"__proto__":{}}')).toThrow()
  })
  test('Given 未完成、超大或嵌套超限 JSON When 解析 Then 有界失败', () => {
    expect(() => parseIntelligentUiSource('{')).toThrow()
    expect(() => parseIntelligentUiSource(spec({ type: 'text', content: '中'.repeat(50000) }))).toThrow()
    let node: object = { type: 'text', content: 'x' }
    for (let i = 0; i < 9; i++) node = { type: 'col', items: [node] }
    expect(() => parseIntelligentUiSource(spec(node))).toThrow()
    expect(() => parseIntelligentUiSource(JSON.stringify({ items: Array.from({ length: 201 }, () => ({ type: 'text', content: 'x' })) }))).toThrow()
  })
  test('Given 公开 HTTPS 与本地/认证 URL When 判断 Then 只允许公开域名', () => {
    expect(isPublicUiUrl('https://example.com/a')).toBe(true)
    for (const url of ['http://example.com', '/local', 'https://localhost/a', 'https://abc.local/a', 'https://[::1]/', 'https://user:pass@example.com', 'data:text/html,x']) expect(isPublicUiUrl(url)).toBe(false)
  })
  test('Given 回传数据 When 打包 Then 仅携带结构化数据且限制大小与凭据', () => {
    const event = validateIntelligentUiAction('analyze', { fields: { name: 'A' } })
    expect(buildIntelligentUiActionMessage('message:1', event)).toContain('"source": "gamma-intelligent-ui"')
    expect(() => validateIntelligentUiAction('save', { apiKey: 'x' })).toThrow()
    expect(() => validateIntelligentUiAction('save', { text: 'x'.repeat(17000) })).toThrow()
    expect(() => validateIntelligentUiAction('', {})).toThrow()
  })
  test('Given 同内容不同来源 When 保存状态 Then 身份隔离且最多保留 200 块', () => {
    expect(uiContentFingerprint('same')).toBe(uiContentFingerprint('same'))
    expect(uiContentFingerprint('other')).not.toBe(uiContentFingerprint('same'))
    const previous = Array.from({ length: 200 }, (_, i) => ({ key: `workspace:session:${i}`, state: { fields: { value: String(i) } } }))
    const next = mergeUiState(previous, 'other-workspace:other-session:0', { fields: { value: 'new' } })
    expect(next).toHaveLength(200)
    expect(next[0]?.state.fields?.value).toBe('new')
    expect(next.find(entry => entry.key === 'workspace:session:0')?.state.fields?.value).toBe('0')
  })
})
