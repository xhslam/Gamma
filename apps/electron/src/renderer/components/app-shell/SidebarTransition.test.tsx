import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SidebarTransition } from './SidebarTransition'

function renderSidebar(collapsed: boolean): string {
  return renderToStaticMarkup(
    <SidebarTransition collapsed={collapsed} width={256}>
      <button>导航内容</button>
    </SidebarTransition>,
  )
}

describe('Given 可折叠的主导航动画外壳', () => {
  test('When 展开 Then 固定内容占256px且不额外占用分隔线宽度', () => {
    const html = renderSidebar(false)
    expect(html).not.toContain('width:257px')
    expect(html).toContain('width:256px')
    expect(html).toContain('visibility:visible')
    expect(html).not.toContain('aria-hidden="true"') // 间隙由布局承担，不再额外画分隔线
    expect(html).not.toContain('inert=""')
    expect(html).toContain('<button>导航内容</button>')
  })

  test('When 收起 Then 宽度归零但内容仍挂载且不可交互', () => {
    const html = renderSidebar(true)
    expect(html).toContain('width:0')
    expect(html).toContain('width:256px')
    expect(html).toContain('inert=""')
    expect(html).toContain('visibility:hidden')
    expect(html).toContain('220ms')
    expect(html).toContain('opacity-0')
    expect(html).toContain('<button>导航内容</button>')
  })

  test('When 系统减少动态效果 Then 外壳和内容均禁用过渡', () => {
    const html = renderSidebar(true)
    expect(html.match(/motion-reduce:transition-none/g)).toHaveLength(2)
  })

  test('When 展开收起反复切换 Then 样式直接由目标状态驱动且无需卸载内容', () => {
    for (const collapsed of [false, true, false, true, false]) {
      const html = renderSidebar(collapsed)
      expect(html.includes('inert=""')).toBe(collapsed)
      expect(html).toContain(collapsed ? 'opacity-0' : 'opacity-100')
      expect(html).toContain('overflow-hidden')
      expect(html).toContain('导航内容')
    }
  })
})
