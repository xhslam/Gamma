import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReasoningCapability } from '@gamma/shared'
import { ReasoningStrengthSlider, getReasoningSliderSelection } from './ReasoningStrengthSlider'

const capability: ReasoningCapability = {
  source: 'pi-catalog', levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], defaultLevel: 'high',
}

describe('推理强度滑杆', () => {
  test('Given 模型支持 minimal When 渲染 Then 保持最小档位并为滑杆提供中文可访问标签', () => {
    const html = renderToStaticMarkup(<ReasoningStrengthSlider capability={capability} thinkingLevel="minimal" onThinkingLevelChange={() => {}} />)
    expect(html).toContain('role="slider"')
    expect(html).toContain('right:100%')
    expect(html).toMatch(/role="slider"[^>]*aria-label="推理强度"/)
    expect(html).toMatch(/role="slider"[^>]*aria-valuetext="最小"/)
  })

  test('Given 模型不允许关闭且存有 off When 渲染 Then 显示有效档位而非负滑杆位置', () => {
    const html = renderToStaticMarkup(<ReasoningStrengthSlider capability={capability} thinkingLevel="off" onThinkingLevelChange={() => {}} />)
    expect(html).toContain('right:40%')
    expect(html).not.toContain('NaN')
    expect(html).toContain('aria-valuetext="高"')
    expect(html).not.toContain('关闭')
  })

  test('Given 只支持一个档位 When 渲染 Then 禁用滑杆而不生成零长度范围', () => {
    const html = renderToStaticMarkup(<ReasoningStrengthSlider capability={{ ...capability, levels: ['high'] }} thinkingLevel="high" onThinkingLevelChange={() => {}} />)
    expect(html).toContain('aria-disabled="true"')
    expect(html).not.toContain('NaN')
  })

  test('Given 用户拖动到各刻度 When 解析提交值 Then 仅返回模型支持的档位', () => {
    for (let index = 0; index < capability.levels.length; index += 1) {
      expect(getReasoningSliderSelection(capability.levels, index)).toBe(capability.levels[index])
    }
    for (const position of [undefined, -1, 99, 1.5, NaN]) {
      expect(getReasoningSliderSelection(capability.levels, position)).toBeUndefined()
    }
  })

  test('Given 渲染推理面板 When 尚未提交交互 Then 不调用持久化回调', () => {
    const selected: string[] = []
    const html = renderToStaticMarkup(<ReasoningStrengthSlider capability={capability} thinkingLevel="max" onThinkingLevelChange={(level) => selected.push(level)} />)
    expect(selected).toEqual([])
    expect(html).toContain('aria-valuetext="最大"')
    expect(html).toContain('响应更快')
    expect(html).toContain('推理更深入')
  })
})
