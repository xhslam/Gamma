import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { decodeComputerFixtureState, verifyComputerUseLive } from './verify-computer-use-live'
import { buildComputerAppKitFixture, createComputerLiveFixture, emptyComputerFixtureState } from './computer-use-live-fixtures'

const token = '00000000-0000-4000-8000-000000000210'
describe('Given 真实键鼠验收脚本', () => {
  test('When 未显式确认 Then 拒绝且不触发应用、服务器或权限操作', async () => {
    await expect(verifyComputerUseLive(false)).rejects.toThrow('显式传入 --confirm-local-test')
  })
  test('When 检查验收证据 Then 复用生产授权与输入链路，以真实页面事件而非投递回执判定', () => {
    const source = readFileSync(new URL('./verify-computer-use-live.ts', import.meta.url), 'utf8')
    expect(source).toContain('new ComputerAuthorizationManager()')
    expect(source).toContain('new ComputerController(host, { authManager: auth })')
    expect(source).not.toContain('setUiHandlers(')
    expect(source).not.toContain('updatePreferences(')
    expect(source).toContain("state.text !== '中文输入验收🚀'")
    expect(source).toContain('state.clicks !== 1')
    expect(source).toContain('state.scrollY <= beforeScroll')
    expect(source).toContain("key: 'cmd+l'")
    expect(source).toContain('focused=true')
    expect(source).toContain('windowId: b.windowId')
    expect(source).toContain('a.pid !== b.pid')
    expect(source).toContain("states['native-A']!.text !== '原生窗口A🚀'")
    expect(source).toContain('await controller.finishRun(binding)')
    expect(source).toContain('await native.terminate()')
    expect(source).toContain("appKitProcess?.kill('SIGTERM')")
  })
  test('When 创建动态场景 Then 深树、计时、标题更新与延迟移动是夹具业务行为，不伪造原生输入', () => {
    const fixture = createComputerLiveFixture(token)
    expect(fixture.title).toContain(token)
    expect(fixture.html.match(/role="group"/g)).toHaveLength(20)
    expect(fixture.html).toContain('setInterval(')
    expect(fixture.html).toContain('document.title=')
    expect(fixture.html).toContain('translateX(360px)')
    expect(fixture.html).toContain('8000')
    expect(fixture.html).not.toMatch(/input\.value\s*=|\.click\(|\.focus\(/)
    expect(fixture.html).not.toMatch(/https?:\/\//)
  })
  test('When 夹具标识非法 Then 在创建文件或编译之前拒绝', () => {
    expect(() => createComputerLiveFixture('<script>')).toThrow('UUID')
    expect(() => buildComputerAppKitFixture('/unused', '../other')).toThrow('UUID')
  })
  test('When 真实状态包含中文与emoji Then 保留UTF16选择范围和不同窗口来源', () => {
    const value = { ...emptyComputerFixtureState(), source: 'native-B', text: '甲🚀乙', selectionStart: 1, selectionEnd: 3, pid: 123 }
    expect(decodeComputerFixtureState(value)).toEqual({ source: 'native-B', state: { ...emptyComputerFixtureState(), text: '甲🚀乙', selectionStart: 1, selectionEnd: 3, pid: 123 } })
  })
  test('When 回报缺失或数值无效 Then 不将错误数据当成实际业务证据', () => {
    expect(decodeComputerFixtureState(null)).toBeUndefined()
    const value = { ...emptyComputerFixtureState(), source: 'web' }
    for (const invalid of [{ source: 'other' }, { ticks: NaN }, { clicks: -1 }, { text: 1 }, { moved: 'true' }, { selectionStart: 2 }, { selectionEnd: 1 }]) {
      expect(decodeComputerFixtureState({ ...value, ...invalid })).toBeUndefined()
    }
  })
})
