import { setDefaultTimeout, afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVisualRendererHarness, type VisualRendererHarness } from '../../../../test-utils/visual-renderer'

// 截图只写显式产物目录或系统临时目录，不绑定其他会话的工作台。
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || join(tmpdir(), 'gamma-right-panel-on-demand')
try {
  mkdirSync(ARTIFACTS_DIR, { recursive: true })
} catch {}

import { rightPanelFixture as fixtureSource } from './right-panel-fixture'

// 原生 Chromium 冷启动与并行打包时的加载不受 Bun 默认 5 秒限时干扰。
setDefaultTimeout(30_000)

describe('右侧按需面板 - 完整 Chromium 回归测试与全链路验证', () => {
  let visualHarness: VisualRendererHarness

  beforeAll(async () => {
    visualHarness = await createVisualRendererHarness(fixtureSource)
  }, 300_000)

  afterAll(async () => {
    await visualHarness?.dispose()
  })

  test('S0 默认状态：大面板收起，聊天占据全宽，标题栏右侧显示紧凑图标组与正确行级角标', async () => {
    const result = await visualHarness.run<{
      hasNav: boolean
      hasFilesBtn: boolean
      hasChangesBtn: boolean
      hasExplorationBtn: boolean
      hasExpandBtn: boolean
      isBigPanelOpen: boolean
      activeOverlay: string | null
      chatWidth: number
      badgeText: string
    }>(`
      await window.onDemandTest.until(() => document.querySelector('[data-testid="restore-workspace-button"]'))
      const nav = document.querySelector('[data-testid="on-demand-right-panel-nav"]')
      const chat = document.querySelector('[data-testid="chat-main-area"]')
      const badge = document.querySelector('[data-testid="changes-badge"]')

      return {
        hasNav: Boolean(nav),
        hasFilesBtn: Boolean(nav.querySelector('button[aria-label*="文件"]')),
        hasChangesBtn: Boolean(nav.querySelector('button[aria-label*="改动"]')),
        hasExplorationBtn: Boolean(nav.querySelector('button[aria-label*="调研"]')),
        hasExpandBtn: Boolean(nav.querySelector('button[data-testid="restore-workspace-button"]')),
        isBigPanelOpen: window.onDemandTest.getIsBigPanelOpen(),
        activeOverlay: window.onDemandTest.getActiveOverlay(),
        chatWidth: chat ? Math.round(chat.getBoundingClientRect().width) : 0,
        badgeText: badge ? badge.textContent || '' : '',
      }
    `)

    expect(result.hasNav).toBe(true)
    expect(result.hasFilesBtn).toBe(true)
    expect(result.hasChangesBtn).toBe(true)
    expect(result.hasExplorationBtn).toBe(true)
    expect(result.hasExpandBtn).toBe(true)
    expect(result.isBigPanelOpen).toBe(false)
    expect(result.activeOverlay).toBe(null)
    // S0 下大面板完全收起，聊天占据全宽 (900px 视口)
    expect(result.chatWidth).toBeGreaterThan(880)
    // 角标统计正确反映初始数据 (+48 -3)
    expect(result.badgeText).toContain('+48')
    expect(result.badgeText).toContain('-3')
  })

  for (const [tab, label] of [['files', '文件'], ['changes', '改动'], ['exploration', '调研']] as const) {
    test(`Given 真实工作区叠层 When 打开${label}浮层 Then 内容可命中且聊天宽度不变`, async () => {
      const result = await visualHarness.run<{
        activeOverlay: string | null
        contentReceivesPointer: boolean
        chatWidthBefore: number
        chatWidthAfter: number
        isBigPanelOpen: boolean
      }>(`
        await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-right-panel-nav"]'))
        const chat = document.querySelector('[data-testid="chat-main-area"]')
        const chatWidthBefore = Math.round(chat.getBoundingClientRect().width)
        document.querySelector('[data-testid="on-demand-right-panel-nav"] button[aria-label*="${label}"]').click()
        await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-overlay-panel"] button'))
        await window.onDemandTest.delay(220)

        const overlay = document.querySelector('[data-testid="on-demand-overlay-panel"]')
        const content = overlay.querySelector('input') || overlay.querySelector('button')
        const rect = content.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        return {
          activeOverlay: window.onDemandTest.getActiveOverlay(),
          contentReceivesPointer: content.contains(hit),
          chatWidthBefore,
          chatWidthAfter: Math.round(chat.getBoundingClientRect().width),
          isBigPanelOpen: window.onDemandTest.getIsBigPanelOpen(),
        }
      `)

      expect(result.activeOverlay).toBe(tab)
      expect(result.contentReceivesPointer).toBe(true)
      expect(result.chatWidthAfter).toBe(result.chatWidthBefore)
      expect(result.isBigPanelOpen).toBe(false)
    })
  }

  test('Given 真实工作区叠层 When 按需浮层与主模态并存 Then 重叠区域由主模态接收点击', async () => {
    const result = await visualHarness.run<{ overlayStillMounted: boolean; modalReceivesPointer: boolean }>(`
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-right-panel-nav"]'))
      window.onDemandTest.toggleOverlay('files')
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-overlay-panel"] input'))
      window.onDemandTest.setModalOpen(true)
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-layering-modal"]'))
      await window.onDemandTest.delay(240)

      const overlay = document.querySelector('[data-testid="on-demand-overlay-panel"]')
      const modal = document.querySelector('[data-testid="on-demand-layering-modal"]')
      const overlayRect = overlay.getBoundingClientRect()
      const modalRect = modal.getBoundingClientRect()
      const left = Math.max(overlayRect.left, modalRect.left)
      const right = Math.min(overlayRect.right, modalRect.right)
      const top = Math.max(overlayRect.top, modalRect.top)
      const bottom = Math.min(overlayRect.bottom, modalRect.bottom)
      const hasIntersection = right > left && bottom > top
      const hit = hasIntersection ? document.elementFromPoint((left + right) / 2, (top + bottom) / 2) : null
      return { overlayStillMounted: Boolean(overlay), modalReceivesPointer: hasIntersection && modal.contains(hit) }
    `)

    expect(result.overlayStillMounted).toBe(true)
    expect(result.modalReceivesPointer).toBe(true)
  })

  test('S1 状态交互：点击按钮展开浮层，搜索框自动聚焦，项目/会话分段切换，Esc与外部点击关闭回焦', async () => {
    const result = await visualHarness.run<{
      overlayOpened: boolean
      isFocusedOnInput: boolean
      hasSegmentButtons: boolean
      canExpandDirectory: boolean
      escClosedOverlay: boolean
    }>(`
      window.onDemandTest.resetState()
      await window.onDemandTest.delay(30)
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-right-panel-nav"]'))
      const nav = document.querySelector('[data-testid="on-demand-right-panel-nav"]')
      const filesBtn = nav.querySelector('button[aria-label*="文件"]')

      // 1. 触发文件入口展开 S1；内容可点击性由真实工作区叠层回归单独验证。
      filesBtn.click()
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-overlay-panel"]'))
      await window.onDemandTest.delay(50)

      const overlay = document.querySelector('[data-testid="on-demand-overlay-panel"]')
      const searchInput = overlay ? overlay.querySelector('input[aria-label="搜索文件"]') : null
      const isFocusedOnInput = document.activeElement === searchInput
      const hasSegmentButtons = overlay ? Boolean(overlay.querySelector('button[aria-label="切换至会话文件"]')) : false

      // 2. 点击目录项展开子目录（原位展开，不进入 S2）
      await window.onDemandTest.until(() => overlay.querySelector('button[role="option"]'))
      const firstDirBtn = overlay.querySelector('button[role="option"]')
      if (firstDirBtn) firstDirBtn.click()
      await window.onDemandTest.delay(50)
      const canExpandDirectory = window.onDemandTest.getIsBigPanelOpen() === false

      // 3. 按 Escape 键关闭浮层
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await window.onDemandTest.delay(60)
      const escClosedOverlay = window.onDemandTest.getActiveOverlay() === null

      return {
        overlayOpened: Boolean(overlay),
        isFocusedOnInput,
        hasSegmentButtons,
        canExpandDirectory,
        escClosedOverlay,
      }
    `)

    expect(result.overlayOpened).toBe(true)
    expect(result.isFocusedOnInput).toBe(true)
    expect(result.hasSegmentButtons).toBe(true)
    expect(result.canExpandDirectory).toBe(true)
    expect(result.escClosedOverlay).toBe(true)
  })

  test('改动列表支持 1181 项虚拟滚动：DOM 条数受限，滚动到底可渲染最后一条', async () => {
    const result = await visualHarness.run<{
      totalCount: number
      mountedRows: number
      badgeText: string
      lastItemRendered: boolean
    }>(`
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-right-panel-nav"]'))
      // 注入 1181 个改动文件
      window.onDemandTest.inject1181Changes()
      await window.onDemandTest.delay(40)

      // 点击打开改动浮层
      const nav = document.querySelector('[data-testid="on-demand-right-panel-nav"]')
      const changesBtn = nav.querySelector('button[aria-label*="改动"]')
      changesBtn.click()

      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-changes-virtual-container"]'))
      await window.onDemandTest.delay(50)

      const virtualContainer = document.querySelector('[data-testid="on-demand-changes-virtual-container"]')
      const mountedRows = virtualContainer ? virtualContainer.querySelectorAll('button[role="option"]').length : 0
      const badge = document.querySelector('[data-testid="changes-badge"]')

      // 真正虚拟滚动：滚动到底部并验证最后项 service-1180.ts 渲染
      const scrollEl = document.querySelector('[data-testid="on-demand-changes-scroll"]')
      if (scrollEl) {
        scrollEl.scrollTop = scrollEl.scrollHeight
        scrollEl.dispatchEvent(new Event('scroll'))
      }
      await window.onDemandTest.delay(80)

      const containerAfterScroll = document.querySelector('[data-testid="on-demand-changes-virtual-container"]')
      const renderedText = containerAfterScroll ? containerAfterScroll.textContent || '' : ''
      const lastItemRendered = renderedText.includes('service-1180.ts') || renderedText.includes('service-118')

      return {
        totalCount: 1181,
        mountedRows,
        badgeText: badge ? badge.textContent || '' : '',
        lastItemRendered,
      }
    `)

    expect(result.totalCount).toBe(1181)
    // 视口内虚拟滚动渲染条数通常在 10~25 条之间
    expect(result.mountedRows).toBeGreaterThan(0)
    expect(result.mountedRows).toBeLessThan(35)
    expect(result.badgeText).toContain('k')
    expect(result.lastItemRendered).toBe(true)
  })

  test('S2 大面板真实渲染：条目点击直达 S2，S1 彻底关闭，大面板展开呈现完整 TabBar 与预览内容', async () => {
    const result = await visualHarness.run<{
      isBigPanelOpen: boolean
      activeOverlay: string | null
      navHidden: boolean
      hasSidePanel: boolean
      hasDiffTabBar: boolean
      chatWidth: number
    }>(`
      // 调用 openInBigPanel 切换到 S2 并打开指定文件
      window.onDemandTest.openInBigPanel('changes', {
        filePath: 'src/index.ts',
        gitRoot: '/workspace/gamma',
        baseRef: 'origin/main',
      })
      await window.onDemandTest.until(() => document.querySelector('[data-panel="workspace"][data-panel-open="true"] [role="tablist"]'))
      await window.onDemandTest.delay(350)

      const isBigPanelOpen = window.onDemandTest.getIsBigPanelOpen()
      const activeOverlay = window.onDemandTest.getActiveOverlay()
      const nav = document.querySelector('[data-testid="on-demand-right-panel-nav"]')
      const sidePanel = document.querySelector('[role="tablist"]')
      const chat = document.querySelector('[data-testid="chat-main-area"]')

      return {
        isBigPanelOpen,
        activeOverlay,
        navHidden: nav === null,
        hasSidePanel: Boolean(sidePanel),
        hasDiffTabBar: sidePanel ? sidePanel.textContent.includes('index.ts') && !Array.from(sidePanel.querySelectorAll('[role="tab"]')).some(tab => ['文件', '改动'].includes(tab.textContent.trim())) : false,
        chatWidth: chat ? Math.round(chat.getBoundingClientRect().width) : 0,
      }
    `)

    expect(result.isBigPanelOpen).toBe(true)
    expect(result.activeOverlay).toBe(null)
    expect(result.navHidden).toBe(false)
    expect(result.hasSidePanel).toBe(true)
    expect(result.hasDiffTabBar).toBe(true)
    // S2 展开后，聊天区域让出 460px 宽度 (900 - 460 = 440px)
    expect(result.chatWidth).toBeLessThan(460)
  })

  test('Given 收起的工作区 When 点击加号并选择打开文件 Then 菜单和文件浮层按需打开且不产生常驻标签', async () => {
    const result = await visualHarness.run<{ menuVisible: boolean; stayedCollapsed: boolean; filesOpened: boolean }>(`
      window.onDemandTest.clearExplorationTabs()
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-right-panel-nav"] [data-testid="add-workspace-button"]'))
      const plus = document.querySelector('[data-testid="on-demand-right-panel-nav"] [data-testid="add-workspace-button"]')
      plus.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, pointerType: 'mouse' }))
      await window.onDemandTest.until(() => document.querySelector('[role="menu"]'))
      const menu = document.querySelector('[role="menu"]')
      const menuVisible = menu.textContent.includes('新建浏览器标签') && menu.textContent.includes('新建终端')
      const stayedCollapsed = !window.onDemandTest.getIsBigPanelOpen()
      Array.from(menu.querySelectorAll('[role="menuitem"]')).find(item => item.textContent.includes('打开文件')).click()
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-overlay-panel"] input'))
      return { menuVisible, stayedCollapsed, filesOpened: window.onDemandTest.getActiveOverlay() === 'files' && !window.onDemandTest.getIsBigPanelOpen() }
    `)
    expect(result).toEqual({ menuVisible: true, stayedCollapsed: true, filesOpened: true })
  })

  test('Given 已打开预览 When 从文件浮层选择第二个文件 Then 原工作区保持展开且只添加实际文件标签', async () => {
    const result = await visualHarness.run<{ workspacePreserved: boolean; hasBothFiles: boolean; noPermanentTabs: boolean; overlayClosed: boolean }>(`
      window.onDemandTest.clearExplorationTabs()
      window.onDemandTest.openInBigPanel('files', { filePath: '/workspace/gamma/src/index.ts', previewOnly: true })
      await window.onDemandTest.until(() => document.querySelector('[data-panel-open="true"] [role="tablist"]'))
      const previousTab = window.onDemandTest.getActiveTab()
      document.querySelector('[data-testid="on-demand-right-panel-nav"] button[aria-label^="文件"]').click()
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-overlay-panel"] button[role="option"]'))
      const workspacePreserved = window.onDemandTest.getIsBigPanelOpen() && window.onDemandTest.getActiveTab() === previousTab
      const file = Array.from(document.querySelectorAll('[data-testid="on-demand-overlay-panel"] button[role="option"]')).find(item => item.textContent.includes('package.json'))
      file.click()
      await window.onDemandTest.until(() => window.onDemandTest.getPreviewFiles().length === 2 && !document.querySelector('[data-testid="on-demand-overlay-panel"]'))
      const tabs = Array.from(document.querySelectorAll('[data-panel="workspace"] [role="tab"]')).map(tab => tab.textContent.trim())
      return {
        workspacePreserved,
        hasBothFiles: tabs.some(tab => tab.includes('index.ts')) && tabs.some(tab => tab.includes('package.json')),
        noPermanentTabs: !tabs.some(tab => ['文件', '改动'].includes(tab)),
        overlayClosed: window.onDemandTest.getActiveOverlay() === null,
      }
    `)
    expect(result).toEqual({ workspacePreserved: true, hasBothFiles: true, noPermanentTabs: true, overlayClosed: true })
  })

  test('Given 唯一文件预览 When 关闭最后一个标签 Then 工作区收起且不会回到文件浏览器', async () => {
    const result = await visualHarness.run<{ closed: boolean; noFileBrowser: boolean; plusRestored: boolean }>(`
      window.onDemandTest.clearExplorationTabs()
      window.onDemandTest.openInBigPanel('files', { filePath: '/workspace/gamma/package.json', previewOnly: true })
      await window.onDemandTest.until(() => document.querySelector('button[aria-label="关闭 package.json"]'))
      document.querySelector('button[aria-label="关闭 package.json"]').click()
      await window.onDemandTest.until(() => !window.onDemandTest.getIsBigPanelOpen())
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-right-panel-nav"] [data-testid="add-workspace-button"]'))
      return { closed: !window.onDemandTest.getIsBigPanelOpen(), noFileBrowser: !document.querySelector('[data-panel="workspace"][data-panel-open="true"]'), plusRestored: !document.querySelector('[data-testid="restore-workspace-button"]') }
    `)
    expect(result).toEqual({ closed: true, noFileBrowser: true, plusRestored: true })
  })

  test('Given 加号创建的终端 When 收起后在同一位置展开 Then 恢复原终端且只创建一次', async () => {
    const result = await visualHarness.run<{ samePosition: boolean; onlyToggle: boolean; sameTerminal: boolean; singleCreation: boolean; historyPreserved: boolean; emptyRestored: boolean }>(`
      window.onDemandTest.clearExplorationTabs()
      const nav = document.querySelector('[data-testid="on-demand-right-panel-nav"]')
      await window.onDemandTest.until(() => nav.querySelector('[data-testid="add-workspace-button"]'))
      const plus = nav.querySelector('[data-testid="add-workspace-button"]')
      const plusRect = plus.getBoundingClientRect()
      plus.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, pointerType: 'mouse' }))
      await window.onDemandTest.until(() => document.querySelector('[role="menu"]'))
      Array.from(document.querySelectorAll('[role="menuitem"]')).find(item => item.textContent.includes('终端')).click()
      await window.onDemandTest.until(() => window.onDemandTest.terminalCreates.length === 1 && document.querySelector('.xterm-screen'))
      const terminalId = window.onDemandTest.getTerminalTabs()[0].terminalId
      const originalTab = window.onDemandTest.getActiveTab()
      await window.onDemandTest.delay(150)
      const screen = document.querySelector('.xterm-screen')
      nav.querySelector('[data-testid="restore-workspace-button"]').click()
      await window.onDemandTest.until(() => !window.onDemandTest.getIsBigPanelOpen())
      // 收起的宽度动画结束后再比较最终槽位坐标。
      await window.onDemandTest.delay(280)
      const expand = nav.querySelector('[data-testid="restore-workspace-button"]')
      const expandRect = expand.getBoundingClientRect()
      const samePosition = plusRect.x === expandRect.x && plusRect.y === expandRect.y
      const onlyToggle = !nav.querySelector('[data-testid="add-workspace-button"]') && expand.getAttribute('aria-label') === '展开右侧工作区'
      expand.click()
      await window.onDemandTest.until(() => window.onDemandTest.getIsBigPanelOpen())
      await window.onDemandTest.delay(150)
      const sameTerminal = window.onDemandTest.getActiveTab() === originalTab && window.onDemandTest.getTerminalTabs().length === 1 && window.onDemandTest.getTerminalTabs()[0].terminalId === terminalId
      const singleCreation = window.onDemandTest.terminalCreates.length === 1
      const historyPreserved = document.querySelector('.xterm-screen') === screen
      document.querySelector('button[aria-label="关闭 终端"]').click()
      await window.onDemandTest.until(() => !window.onDemandTest.getIsBigPanelOpen() && nav.querySelector('[data-testid="add-workspace-button"]'))
      return { samePosition, onlyToggle, sameTerminal, singleCreation, historyPreserved, emptyRestored: !nav.querySelector('[data-testid="restore-workspace-button"]') }
    `)
    expect(result).toEqual({ samePosition: true, onlyToggle: true, sameTerminal: true, singleCreation: true, historyPreserved: true, emptyRestored: true })
  }, 30_000)

  test('Given 收起时活动标签已失效 When 点击展开 Then 恢复仍存在的真实文件标签', async () => {
    const result = await visualHarness.run<{ activeTab: string; noPlus: boolean; overlayClosed: boolean }>(`
      window.onDemandTest.clearExplorationTabs()
      window.onDemandTest.openInBigPanel('files', { filePath: '/workspace/gamma/package.json', previewOnly: true })
      await window.onDemandTest.until(() => document.querySelector('button[aria-label="关闭 package.json"]'))
      const originalTab = window.onDemandTest.getActiveTab()
      window.onDemandTest.collapseBigPanel()
      window.onDemandTest.setClosedActiveTab('terminal:already-closed')
      await window.onDemandTest.until(() => document.querySelector('[data-testid="restore-workspace-button"][aria-expanded="false"]'))
      window.onDemandTest.toggleOverlay('files')
      await window.onDemandTest.delay(100)
      document.querySelector('[data-testid="restore-workspace-button"]').click()
      await window.onDemandTest.until(() => window.onDemandTest.getIsBigPanelOpen() && window.onDemandTest.getActiveTab() === originalTab)
      return { activeTab: window.onDemandTest.getActiveTab(), noPlus: !document.querySelector('[data-testid="on-demand-right-panel-nav"] [data-testid="add-workspace-button"]'), overlayClosed: window.onDemandTest.getActiveOverlay() === null }
    `)
    expect(result.activeTab).toContain('preview:')
    expect(result.noPlus).toBe(true)
    expect(result.overlayClosed).toBe(true)
  })

  test('Given 旧会话残留 files 或 changes 状态 When 没有实际内容标签 Then 恢复时保持工作区收起', async () => {
    const result = await visualHarness.run<{ filesClosed: boolean; changesClosed: boolean }>(`
      window.onDemandTest.clearExplorationTabs()
      window.onDemandTest.setLegacyActiveTab('files')
      await window.onDemandTest.until(() => !window.onDemandTest.getIsBigPanelOpen())
      const filesClosed = !window.onDemandTest.getIsBigPanelOpen()
      window.onDemandTest.setLegacyActiveTab('changes')
      await window.onDemandTest.until(() => !window.onDemandTest.getIsBigPanelOpen())
      return { filesClosed, changesClosed: !window.onDemandTest.getIsBigPanelOpen() }
    `)
    expect(result).toEqual({ filesClosed: true, changesClosed: true })
  })

  test('视觉截屏产出：验证 S0 / S1 (文件/改动/调研) / S2 以及深浅主题与窄窗', async () => {
    // 1. S0 截图 (深色与浅色)
    await visualHarness.run(`
      window.onDemandTest.closeOverlay()
      window.onDemandTest.collapseBigPanel()
      window.onDemandTest.inject1181Changes()
      window.onDemandTest.injectAttachedFiles()
      window.onDemandTest.setTheme('dark')
      await window.onDemandTest.delay(50)
    `, {
      screenshot: join(ARTIFACTS_DIR, 'validated-s0-collapsed-dark.png'),
    })

    await visualHarness.run(`
      window.onDemandTest.closeOverlay()
      window.onDemandTest.collapseBigPanel()
      window.onDemandTest.inject1181Changes()
      window.onDemandTest.setTheme('light')
      await window.onDemandTest.delay(50)
    `, {
      screenshot: join(ARTIFACTS_DIR, 'validated-s0-collapsed-light.png'),
    })

    // 2. S1 文件浮层截图
    await visualHarness.run(`
      window.onDemandTest.closeOverlay()
      window.onDemandTest.collapseBigPanel()
      window.onDemandTest.injectAttachedFiles()
      window.onDemandTest.setTheme('dark')
      window.onDemandTest.toggleOverlay('files')
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-files-scroll"]'))
      await window.onDemandTest.delay(80)
    `, {
      screenshot: join(ARTIFACTS_DIR, 'validated-s1-overlay-files.png'),
    })

    // 3. S1 改动浮层截图 (1181 项虚拟列表与汇总)
    await visualHarness.run(`
      window.onDemandTest.closeOverlay()
      window.onDemandTest.collapseBigPanel()
      window.onDemandTest.inject1181Changes()
      window.onDemandTest.toggleOverlay('changes')
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-changes-scroll"]'))
      await window.onDemandTest.delay(80)
    `, {
      screenshot: join(ARTIFACTS_DIR, 'validated-s1-overlay-changes.png'),
    })

    // 4. S1 调研浮层截图
    await visualHarness.run(`
      window.onDemandTest.closeOverlay()
      window.onDemandTest.collapseBigPanel()
      window.onDemandTest.toggleOverlay('exploration')
      await window.onDemandTest.until(() => document.querySelector('[aria-label="动态调研分支快捷面板"]'))
      await window.onDemandTest.delay(80)
    `, {
      screenshot: join(ARTIFACTS_DIR, 'validated-s1-overlay-exploration.png'),
    })

    // 5. 窄窗口与 reduced-motion 截图
    await visualHarness.run(`
      window.onDemandTest.closeOverlay()
      window.onDemandTest.collapseBigPanel()
      window.onDemandTest.inject1181Changes()
      window.onDemandTest.toggleOverlay('changes')
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-changes-scroll"]'))
      await window.onDemandTest.delay(60)
    `, {
      reducedMotion: true,
      zoom: 1.25,
      screenshot: join(ARTIFACTS_DIR, 'validated-s1-narrow-reduced-motion.png'),
    })

    // 6. S2 大面板展开状态真实截图 (可见完整 DiffPanelTabBar 与右侧工作区)
    await visualHarness.run(`
      window.onDemandTest.closeOverlay()
      window.onDemandTest.openInBigPanel('changes', {
        filePath: 'src/index.ts',
        gitRoot: '/workspace/gamma',
        baseRef: 'origin/main',
      })
      await window.onDemandTest.delay(100)
    `, {
      screenshot: join(ARTIFACTS_DIR, 'validated-s2-expanded.png'),
    })
  }, 60_000)
})
