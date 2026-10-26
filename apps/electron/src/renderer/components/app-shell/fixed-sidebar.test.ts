import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { LEFT_SIDEBAR_WIDTH } from '../../atoms/sidebar-atoms'

const shellSource = readFileSync(new URL('./AppShell.tsx', import.meta.url), 'utf8')
const atomSource = readFileSync(new URL('../../atoms/sidebar-atoms.ts', import.meta.url), 'utf8')
const sidebarSource = readFileSync(new URL('./LeftSidebar.tsx', import.meta.url), 'utf8')

describe('Given 固定展开宽度的左侧导航', () => {
  test('When 渲染展开侧栏 Then 使用 256px 且不读取历史拖拽宽度', () => {
    expect(LEFT_SIDEBAR_WIDTH).toBe(256)
    expect(shellSource).toContain('<LeftSidebar width={LEFT_SIDEBAR_WIDTH} />')
    expect(atomSource).not.toContain('gamma-left-sidebar-width')
    expect(shellSource).not.toContain('leftSidebarWidthAtom')
  })

  test('When 使用侧栏边界 Then 不提供宽度拖拽入口但保留折叠布局和右侧拖拽', () => {
    expect(shellSource).not.toContain('handleLeftSidebarMouseDown')
    expect(shellSource).not.toContain('isDraggingLeftSidebar')
    expect(shellSource).toContain('useAtom(sidebarCollapsedAtom)')
    expect(shellSource).toContain('sidebarCollapsed ? 0 : LEFT_SIDEBAR_WIDTH + PANEL_GAP_PX')
    expect(shellSource).toContain('sidebarCollapsedDuringDrag ? 0 : LEFT_SIDEBAR_WIDTH + PANEL_GAP_PX')
    expect(shellSource).toContain('onResizeStart={handleMouseDown}')
    expect(shellSource).toContain('onResizeKeyDown={handleResizeKeyDown}')
  })
})

describe('Given 完全收起的左侧导航', () => {
  test('When 开始收起 Then 导航内容不提前卸载，保留离场动画', () => {
    expect(sidebarSource).not.toContain('if (sidebarCollapsed) {')
  })

  test('When 收起 Then 顶部出现展开入口且侧栏不保留分隔线', () => {
    expect(shellSource).toContain('{sidebarCollapsed && !hasAgentSessionHeader && <CollapsedSidebarHeader />}')
    expect(shellSource).toContain('<SidebarTransition collapsed={sidebarCollapsed} width={LEFT_SIDEBAR_WIDTH}>')
    expect(shellSource).not.toContain("sidebarCollapsed && 'hidden'")
    expect(shellSource).not.toContain('COLLAPSED_LEFT_SIDEBAR_WIDTH')
  })
})
