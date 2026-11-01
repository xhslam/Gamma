import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComputerResultRenderer } from './computer-result'

describe('ComputerResultRenderer', () => {
  test('Given 中断结果 When 渲染 Then 显示桌面操作已中断及原因', () => {
    const json = JSON.stringify({ interrupted: true, reason: '用户主动中止' })
    const html = renderToStaticMarkup(<ComputerResultRenderer result={json} isError={false} />)
    expect(html).toContain('桌面操作已中断：用户主动中止')
  })

  test('Given snapshot 截断元素树 When 渲染 Then 显示抓取元素树与部分元素树截断标签', () => {
    const json = JSON.stringify({
      ok: true,
      command: 'snapshot',
      summary: '获取窗口元素树（50 个节点）',
      complete: false,
      data: { nodes: 50 },
    })
    const html = renderToStaticMarkup(<ComputerResultRenderer result={json} isError={false} />)
    expect(html).toContain('抓取元素树')
    expect(html).toContain('部分元素树 (截断)')
    expect(html).toContain('获取窗口元素树（50 个节点）')
    expect(html).toContain('查看回执详情')
  })

  test('Given disposition.retry 为 safe When 渲染 Then 显示可安全重试标签', () => {
    const json = JSON.stringify({
      ok: false,
      command: 'click',
      error: '控件暂时不可交互',
      disposition: { retry: 'safe' },
    })
    const html = renderToStaticMarkup(<ComputerResultRenderer result={json} isError={false} />)
    expect(html).toContain('点击')
    expect(html).toContain('可安全重试')
    expect(html).toContain('控件暂时不可交互')
  })

  test('Given 附带截图标记 When 渲染 Then 显示截图已附加', () => {
    const json = JSON.stringify({
      ok: true,
      command: 'screenshot',
      summary: '屏幕截图已捕获',
      imageAttached: true,
    })
    const html = renderToStaticMarkup(<ComputerResultRenderer result={json} isError={false} />)
    expect(html).toContain('截取屏幕')
    expect(html).toContain('已附屏幕截图')
  })

  test('Given 非结构化纯文本 When 渲染 Then 回退到默认渲染器', () => {
    const text = 'Raw command line output without JSON'
    const html = renderToStaticMarkup(<ComputerResultRenderer result={text} isError={false} />)
    expect(html).toContain('Raw command line output without JSON')
  })
})
