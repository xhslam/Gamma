import { describe, expect, test } from 'bun:test'
import { computerElementRefs, computerObservationFingerprint, presentComputerAX } from './computer-observation'

describe('Given 不可信 AX 观察的展示与更新', () => {
  test('When 生成显示文本 Then 索引只来自真实 ref 行并保留完整最新引用', () => {
    const ax = 'ref=fresh-a 0 AXWindow title=Notes\nref=fresh-b 1 AXTextArea title=正文'
    expect(computerElementRefs(ax)).toEqual(['fresh-a', 'fresh-b'])
    expect(presentComputerAX(ax).ax).toBe('[1] ref=fresh-a 0 AXWindow title=Notes\n[2] ref=fresh-b 1 AXTextArea title=正文')
  })
  test('When 仅引用改变 Then 不误判为布局变化但明确旧引用失效', () => {
    const old = 'ref=old 0 AXButton title=保存', fresh = 'ref=fresh 0 AXButton title=保存'
    const presented = presentComputerAX(fresh, old)
    expect(presented.ax).toContain('ref=fresh')
    expect(presented.axDiff).toContain('内容未变化')
    expect(presented.axDiff).toContain('旧元素引用已失效')
    expect(computerObservationFingerprint(old, 'png-a', 'notes')).toBe(computerObservationFingerprint(fresh, 'png-b', 'notes'))
  })
  test('When 控件值/重复控件数量变化 Then 摘要包含实际变化且关闭摘要可获取全量', () => {
    const before = 'ref=a 0 AXTextArea value=旧\nref=b 1 AXButton title=保存\nref=c 1 AXButton title=保存'
    const after = 'ref=x 0 AXTextArea value=新\nref=y 1 AXButton title=保存'
    const result = presentComputerAX(after, before)
    expect(result.axDiff).toContain('- 0 AXTextArea value=旧')
    expect(result.axDiff).toContain('+ 0 AXTextArea value=新')
    expect(result.axDiff).toContain('- 1 AXButton title=保存')
    expect(presentComputerAX(after, before, true).axDiff).toBeUndefined()
  })
  test('When AX 不可用或应用切换 Then 以图像或应用身份区分稳定性', () => {
    expect(computerObservationFingerprint('', 'a', 'notes')).not.toBe(computerObservationFingerprint('', 'b', 'notes'))
    expect(computerObservationFingerprint('[AX 不可用]', 'a', 'notes')).not.toBe(computerObservationFingerprint('[AX 不可用]', 'b', 'notes'))
    expect(computerObservationFingerprint('ref=a AXButton', 'a', 'notes')).not.toBe(computerObservationFingerprint('ref=b AXButton', 'a', 'safari'))
  })
})
