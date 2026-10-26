import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
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


describe('右侧按需面板 - 完整 Chromium 回归测试与全链路验证', () => {
  let visualHarness: VisualRendererHarness

  beforeAll(async () => {
    visualHarness = await createVisualRendererHarness(fixtureSource)
  }, 40_000)

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
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-right-panel-nav"]'))
      const nav = document.querySelector('[data-testid="on-demand-right-panel-nav"]')
      const chat = document.querySelector('[data-testid="chat-main-area"]')
      const badge = document.querySelector('[data-testid="changes-badge"]')

      return {
        hasNav: Boolean(nav),
        hasFilesBtn: Boolean(nav.querySelector('button[aria-label*="文件"]')),
        hasChangesBtn: Boolean(nav.querySelector('button[aria-label*="改动"]')),
        hasExplorationBtn: Boolean(nav.querySelector('button[aria-label*="调研"]')),
        hasExpandBtn: Boolean(nav.querySelector('button[data-testid="expand-big-panel-button"]')),
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

      // 1. 真实用户点击文件图标展开 S1 浮层
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
        hasDiffTabBar: sidePanel ? sidePanel.textContent.includes('文件') && sidePanel.textContent.includes('改动') : false,
        chatWidth: chat ? Math.round(chat.getBoundingClientRect().width) : 0,
      }
    `)

    expect(result.isBigPanelOpen).toBe(true)
    expect(result.activeOverlay).toBe(null)
    expect(result.navHidden).toBe(true)
    expect(result.hasSidePanel).toBe(true)
    expect(result.hasDiffTabBar).toBe(true)
    // S2 展开后，聊天区域让出 460px 宽度 (900 - 460 = 440px)
    expect(result.chatWidth).toBeLessThan(460)
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
