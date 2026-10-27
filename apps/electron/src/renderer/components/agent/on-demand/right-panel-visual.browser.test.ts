import { setDefaultTimeout, afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createVisualRendererHarness, type VisualRendererHarness } from '../../../../test-utils/visual-renderer'
import { rightPanelFixture } from './right-panel-fixture'

const artifacts = process.env.ARTIFACTS_DIR || join(tmpdir(), 'gamma-right-panel-visual')
mkdirSync(artifacts, { recursive: true })
const boot = `await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-right-panel-nav"]'));`
const openChanges = `${boot}
  window.onDemandTest.inject1181Changes();
  window.onDemandTest.toggleOverlay('changes');
  await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-changes-virtual-container"] button'));
  await window.onDemandTest.delay(220);
`

interface PanelMetrics {
  background: string
  radius: string
  border: string
  padding: string
  shadow: string
  width: number
  height: number
  anchorRight: number
  right: number
  top: number
  anchorBottom: number
  rowHeight: number
  totalHeight: number
  mounted: number
  uiFont: string
  monoFont: string
  badgeColor: string
  bottomFade: string
  topFade: string
  midBottomFade: string
  lastTopFade: string
  lastBottomFade: string
  chatBefore: number
  chatAfter: number
  icons: number
}

// 原生 Chromium 冷启动可能超过 Bun 的 5 秒默认限时。
setDefaultTimeout(30_000)

interface FileMetrics {
  rowHeight: number
  totalHeight: number
  mounted: number
  longTitle: boolean
  longMask: string
  longOverflow: string
  shortMask: string
  fullTextLength: number
  collapsedOpacity: string
  expandedOpacity: string
  expandedTransform: string
  titleXBefore: number
  titleXAfter: number
  slotWidth: number
  scrollFade: string | undefined
  bigOpen: boolean
  overlayClosed: boolean
  previewPath: string
  fileReady: boolean
}

describe('Given 新版按需右侧组件与已完成六步视觉', () => {
  let harness: VisualRendererHarness
  beforeAll(async () => { harness = await createVisualRendererHarness(rightPanelFixture) }, 300_000)
  afterAll(async () => { await harness?.dispose() })

  for (const theme of ['light', 'dark'] as const) {
    test(`When ${theme} 改动浮层展开 Then 暖色几何、虚拟34px和24px渐隐一致且不挤聊天`, async () => {
      const result = await harness.run<PanelMetrics>(`${boot}
        window.onDemandTest.setTheme('${theme}');
        const chat = document.querySelector('[data-testid="chat-main-area"]');
        const chatBefore = chat.getBoundingClientRect().width;
        ${openChanges}
        const panel = document.querySelector('[data-testid="on-demand-overlay-panel"]');
        const nav = document.querySelector('[data-testid="on-demand-right-panel-nav"]');
        const scroll = document.querySelector('[data-testid="on-demand-changes-scroll"]');
        const list = document.querySelector('[data-testid="on-demand-changes-virtual-container"]');
        scroll.blur();
        await window.onDemandTest.delay(40);
        const style = getComputedStyle(panel), rect = panel.getBoundingClientRect(), anchor = nav.getBoundingClientRect();
        const bottomFade = getComputedStyle(scroll).getPropertyValue('--scroll-fade-bottom').trim();
        scroll.scrollTop = 500;
        await window.onDemandTest.delay(50);
        const topFade = getComputedStyle(scroll).getPropertyValue('--scroll-fade-top').trim();
        const midBottomFade = getComputedStyle(scroll).getPropertyValue('--scroll-fade-bottom').trim();
        scroll.scrollTop = scroll.scrollHeight;
        await window.onDemandTest.delay(50);
        return {
          background: style.backgroundColor, radius: style.borderRadius, border: style.borderTopWidth,
          padding: style.paddingTop, shadow: style.boxShadow, width: rect.width, height: rect.height,
          right: rect.right, top: rect.top, anchorRight: anchor.right, anchorBottom: anchor.bottom,
          rowHeight: list.querySelector('button').getBoundingClientRect().height,
          totalHeight: list.getBoundingClientRect().height, mounted: list.querySelectorAll('button').length,
          uiFont: getComputedStyle(nav).fontFamily, monoFont: getComputedStyle(list.querySelector('button .font-mono')).fontFamily,
          badgeColor: getComputedStyle(document.querySelector('[data-testid="changes-badge"] span')).color,
          bottomFade, topFade, midBottomFade,
          lastTopFade: getComputedStyle(scroll).getPropertyValue('--scroll-fade-top').trim(),
          lastBottomFade: getComputedStyle(scroll).getPropertyValue('--scroll-fade-bottom').trim(),
          chatBefore, chatAfter: chat.getBoundingClientRect().width,
          icons: nav.querySelectorAll('button[data-icon-button="true"]').length,
        };
      `, { screenshot: join(artifacts, `six-step-${theme}-changes.png`) })
      expect(result.background).toBe(theme === 'dark' ? 'rgb(38, 38, 36)' : 'rgb(255, 255, 255)')
      expect(result.radius).toBe('12px')
      expect(result.border).toBe('1px')
      expect(result.padding).toBe('16px')
      expect(result.shadow).toBe('none')
      expect(result.width).toBe(380)
      expect(result.height).toBeLessThanOrEqual(420)
      expect(Math.abs(result.right - result.anchorRight)).toBeLessThanOrEqual(1)
      expect(result.top).toBeGreaterThanOrEqual(result.anchorBottom + 5)
      expect(result.rowHeight).toBe(34)
      expect(result.totalHeight).toBe(1181 * 34)
      expect(result.mounted).toBeGreaterThan(0)
      expect(result.mounted).toBeLessThan(35)
      expect(result.uiFont).toContain('Inter')
      expect(result.monoFont).toMatch(/mono|Consolas/i)
      expect(result.badgeColor).toBe(theme === 'dark' ? 'rgb(176, 174, 165)' : 'rgb(94, 93, 89)')
      expect(result.bottomFade).toBe('24px')
      expect(result.topFade).toBe('24px')
      expect(result.midBottomFade).toBe('24px')
      expect(result.lastTopFade).toBe('24px')
      expect(result.lastBottomFade).toBe('0px')
      expect(result.chatAfter).toBe(result.chatBefore)
      expect(result.icons).toBe(4)
    })
  }

  test('When 千项文件树有长标题和目录 Then 原滚动层虚拟化、标题渐隐、固定折叠槽及文件直达仍生效', async () => {
    const result = await harness.run<FileMetrics>(`${boot}
      window.onDemandTest.inject1181Files();
      window.onDemandTest.toggleOverlay('files');
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-files-virtual-container"] button'));
      await window.onDemandTest.delay(220);
      const list = document.querySelector('[data-testid="on-demand-files-virtual-container"]');
      const rows = [...list.querySelectorAll('button')];
      const longRow = rows.find(row => row.textContent.includes('very-long-file-title-'));
      const longTitle = longRow.querySelector('.gamma-fade-title');
      const shortTitle = rows[0].querySelector('.gamma-fade-title');
      const directory = rows[0], collapsed = rows.find(row => row.textContent.includes('folder-2')).querySelector('[data-disclosure-chevron]');
      const titleXBefore = shortTitle?.getBoundingClientRect().x ?? 0;
      const first = {
        rowHeight: rows[0].getBoundingClientRect().height,
        totalHeight: list.getBoundingClientRect().height, mounted: rows.length,
        longTitle: Boolean(longTitle), longMask: longTitle ? getComputedStyle(longTitle).maskImage : 'none',
        longOverflow: longTitle ? getComputedStyle(longTitle).textOverflow : 'ellipsis',
        shortMask: shortTitle ? getComputedStyle(shortTitle).maskImage : 'missing',
        fullTextLength: longTitle?.textContent.length ?? 0,
        collapsedOpacity: collapsed ? getComputedStyle(collapsed).opacity : 'missing', titleXBefore,
        slotWidth: collapsed?.parentElement.getBoundingClientRect().width ?? 0,
        scrollFade: document.querySelector('[data-testid="on-demand-files-scroll"]').dataset.scrollFade,
      };
      directory.click();
      await window.onDemandTest.delay(190);
      const expanded = directory.querySelector('[data-disclosure-chevron]');
      const after = {
        expandedOpacity: expanded ? getComputedStyle(expanded).opacity : 'missing',
        expandedTransform: expanded ? getComputedStyle(expanded).transform : 'missing',
        titleXAfter: directory.querySelector('.gamma-fade-title')?.getBoundingClientRect().x ?? 1,
      };
      longRow.click();
      await window.onDemandTest.until(() => window.onDemandTest.getIsBigPanelOpen());
      await window.onDemandTest.until(() => window.onDemandTest.fileReads.length > 0);
      return {...first, ...after,
        bigOpen: window.onDemandTest.getIsBigPanelOpen(),
        overlayClosed: window.onDemandTest.getActiveOverlay() === null,
        previewPath: window.onDemandTest.getPreviewFile()?.filePath ?? '',
        fileReady: window.onDemandTest.fileReads.length > 0 && Boolean(document.querySelector('[role="tab"][aria-selected="true"]')), 
      };
    `)
    expect(result.rowHeight).toBe(34)
    expect(result.totalHeight).toBe(1181 * 34)
    expect(result.mounted).toBeLessThan(35)
    expect(result.longTitle).toBe(true)
    expect(result.longMask).toContain('24px')
    expect(result.longOverflow).toBe('clip')
    expect(result.shortMask).toBe('none')
    expect(result.fullTextLength).toBeGreaterThan(300)
    expect(result.collapsedOpacity).toBe('0')
    expect(result.expandedOpacity).toBe('1')
    expect(result.expandedTransform).toBe('matrix(0, 1, -1, 0, 0, 0)')
    expect(result.titleXAfter).toBe(result.titleXBefore)
    expect(result.slotWidth).toBe(16)
    expect(result.scrollFade).toBe('vertical')
    expect(result.bigOpen).toBe(true)
    expect(result.overlayClosed).toBe(true)
    expect(result.fileReady).toBe(true)
    expect(result.previewPath).toContain('very-long-file-title-')
  })

  test('When 普通图标悬浮 Then 只执行180ms与1px微动且不缩放', async () => {
    const result = await harness.run<{ translate: string; duration: string; markers: number; scales: number }>(`${boot}
      await window.onDemandTest.delay(240);
      const nav = document.querySelector('[data-testid="on-demand-right-panel-nav"]');
      const button = nav.querySelector('button');
      return { translate: getComputedStyle(button.querySelector('svg')).translate,
        duration: getComputedStyle(button).transitionDuration,
        markers: nav.querySelectorAll('[data-icon-button="true"]').length,
        scales: nav.querySelectorAll('[class*="active:scale"]').length };
    `, { hoverSelector: '[data-testid="on-demand-right-panel-nav"] button' })
    expect(result.translate).toBe('0px -1px')
    expect(result.duration).toBe('0.18s')
    expect(result.markers).toBe(4)
    expect(result.scales).toBe(0)
  })

  test('When 停留在收起状态 Then 改动取数只发生一次，不因渲染产生重复 IPC', async () => {
    const result = await harness.run<{ first: number; second: number }>(`${boot}
      await window.onDemandTest.delay(500);
      const first = window.onDemandTest.diffFetchCount();
      await window.onDemandTest.delay(400);
      return { first, second: window.onDemandTest.diffFetchCount() };
    `)
    expect(result.first).toBeLessThanOrEqual(6)
    expect(result.second).toBe(result.first)
  })

  test('When 窄窗且reduced-motion Then 浮层不越界、无缩放位移动画且保留焦点回到入口', async () => {
    const result = await harness.run<{ left: number; right: number; width: number; viewport: number; animation: string; translation: string; focused: boolean }>(`${boot}
      window.onDemandTest.toggleOverlay('files');
      await window.onDemandTest.until(() => document.querySelector('[data-testid="on-demand-overlay-panel"] input'));
      await window.onDemandTest.delay(50);
      const panel = document.querySelector('[data-testid="on-demand-overlay-panel"]'), rect = panel.getBoundingClientRect();
      const style = getComputedStyle(panel);
      const metric = {left: rect.left, right: rect.right, width: rect.width, viewport: innerWidth,
        animation: style.animationName, translation: getComputedStyle(document.querySelector('[data-testid="on-demand-right-panel-nav"] button svg')).translate};
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}));
      await window.onDemandTest.delay(60);
      return {...metric, focused: document.activeElement?.getAttribute('aria-label')?.includes('文件') === true};
    `, { reducedMotion: true, zoom: 2, screenshot: join(artifacts, 'six-step-narrow-reduced.png') })
    expect(result.left).toBeGreaterThanOrEqual(12)
    expect(result.right).toBeLessThanOrEqual(result.viewport - 12)
    expect(result.width).toBe(Math.min(380, result.viewport - 24))
    expect(result.animation).toBe('none')
    expect(result.translation).toBe('none')
    expect(result.focused).toBe(true)
  })

  test('When 调研浮层呈现两行标题 Then 复用24px标题与滚动层但保留跳转箭头', async () => {
    const result = await harness.run<{ fade: string | undefined; titles: number; disclosure: number; rowHeight: number }>(`${boot}
      window.onDemandTest.toggleOverlay('exploration');
      await window.onDemandTest.until(() => document.querySelector('[aria-label="动态调研分支快捷面板"] [role="option"]'));
      const root = document.querySelector('[aria-label="动态调研分支快捷面板"]');
      return {fade: root.querySelector('[data-scroll-fade]')?.dataset.scrollFade,
        titles: root.querySelectorAll('.gamma-fade-title').length,
        disclosure: root.querySelectorAll('[data-disclosure-chevron]').length,
        rowHeight: root.querySelector('[role="option"]').getBoundingClientRect().height};
    `)
    expect(result.fade).toBe('vertical')
    expect(result.titles).toBe(2)
    expect(result.disclosure).toBe(0)
    expect(result.rowHeight).toBeGreaterThanOrEqual(34)
  })
})
