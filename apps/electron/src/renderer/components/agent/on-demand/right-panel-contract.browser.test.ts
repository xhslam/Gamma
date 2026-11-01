import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(String.raw`
    import { mountRightPanelContractFixture } from '@/../test-utils/right-panel-contract-fixture'
    window.mountRightPanelContract = mountRightPanelContractFixture
  `, {
    mainProcessSetup: String.raw`
      const { ipcMain } = require('electron')
      ipcMain.handle('layout-test-resize', (event, width) => {
        if (![320, 900, 1440].includes(width)) throw new Error('invalid test width')
        BrowserWindow.fromWebContents(event.sender).setContentSize(width, 700)
      })
      ipcMain.handle('layout-test-capture', async (event, name) => {
        if (!/^(320|900|1440)-(light|dark)$/.test(name) || !process.env.ARTIFACTS_DIR) return
        require('node:fs').mkdirSync(process.env.ARTIFACTS_DIR, { recursive: true })
        require('node:fs').writeFileSync(require('node:path').join(process.env.ARTIFACTS_DIR, 'conversation-' + name + '.png'), (await event.sender.capturePage()).toPNG())
      })
    `,
    preloadSource: String.raw`
      const { contextBridge, ipcRenderer } = require('electron')
      contextBridge.exposeInMainWorld('layoutTest', { resize: width => ipcRenderer.invoke('layout-test-resize', width), capture: name => ipcRenderer.invoke('layout-test-capture', name) })
    `,
  })
}, 60_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given 生产按需导航与独立 typed preload 契约', () => {
  test('When 展开内联侧栏并关闭 Then 面板在标题栏下方占位且 Escape 回到原按钮', async () => {
    const result = await renderer.run<{ aligned: boolean; below: boolean; focusedSearch: boolean; returnedFocus: boolean }>(String.raw`
      const f = await window.mountRightPanelContract()
      const trigger = document.querySelector('[data-testid="on-demand-right-panel-nav"] button')
      trigger.focus(); trigger.click()
      await f.until(() => Boolean(document.querySelector('[data-testid="on-demand-overlay-panel"] input')))
      await f.delay(180)
      const panel = document.querySelector('[data-testid="on-demand-overlay-panel"]')
      const nav = document.querySelector('[data-testid="on-demand-right-panel-nav"]')
      const p = panel.getBoundingClientRect(), n = nav.getBoundingClientRect()
      const focusedSearch = document.activeElement === panel.querySelector('input')
      const chat = document.querySelector('[data-testid="contract-conversation"]').getBoundingClientRect()
      const result = { aligned: chat.right <= p.left, below: p.top >= n.bottom, focusedSearch }
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      await f.until(() => !document.querySelector('[data-testid="on-demand-overlay-panel"]'))
      await f.delay(180)
      return { ...result, returnedFocus: document.activeElement === trigger }
    `)
    expect(result).toEqual({ aligned: true, below: true, focusedSearch: true, returnedFocus: true })
  }, 30_000)

  test('When 展开侧栏再关闭 Then 消息和输入框共同向左让位且恢复原布局', async () => {
    const result = await renderer.run<{ movedTogether: boolean; narrowed: boolean; restored: boolean; noPortal: boolean }>(String.raw`
      const f = await window.mountRightPanelContract()
      const trigger = document.querySelector('[data-testid="on-demand-right-panel-nav"] button')
      const chat = document.querySelector('[data-testid="contract-conversation"]')
      const input = document.querySelector('[data-testid="contract-input"]')
      const original = chat.getBoundingClientRect(), initialInput = input.getBoundingClientRect()
      trigger.click()
      await f.until(() => Boolean(document.querySelector('[data-testid="on-demand-overlay-panel"]')))
      await f.delay(240)
      const panel = document.querySelector('[data-testid="on-demand-overlay-panel"]')
      const narrowed = chat.getBoundingClientRect(), shiftedInput = input.getBoundingClientRect()
      const movedTogether = Math.abs((narrowed.left - original.left) - (shiftedInput.left - initialInput.left)) < 2
      const noPortal = Boolean(panel.closest('[data-testid="on-demand-conversation-layout"]')) && getComputedStyle(panel).position !== 'fixed'
      trigger.click()
      await f.delay(240)
      return { movedTogether, narrowed: narrowed.width < original.width, restored: Math.abs(chat.getBoundingClientRect().width - original.width) < 2, noPortal }
    `)
    expect(result).toEqual({ movedTogether: true, narrowed: true, restored: true, noPortal: true })
  }, 30_000)

  test('When 渲染消息并滚动 Then 用户靠右、AI 靠左且隐藏滑杆但仍能滚动', async () => {
    const result = await renderer.run<{ rightAligned: boolean; assistantLeft: boolean; hidden: boolean; scrollable: boolean }>(String.raw`
      const f = await window.mountRightPanelContract()
      const user = document.querySelector('.is-user'), assistant = document.querySelector('.is-assistant')
      const u = user.querySelector(':scope > div').getBoundingClientRect(), a = assistant.querySelector(':scope > div').getBoundingClientRect()
      const viewport = document.querySelector('[data-conversation-scroll-viewport]')
      await f.delay(100)
      viewport.scrollTop = 120
      await f.delay(50)
      return { rightAligned: Math.abs(u.right - (user.getBoundingClientRect().right - 10)) < 2, assistantLeft: a.left < u.left, hidden: getComputedStyle(viewport).scrollbarWidth === 'none', scrollable: viewport.scrollHeight > viewport.clientHeight && viewport.scrollTop > 0 }
    `)
    expect(result).toEqual({ rightAligned: true, assistantLeft: true, hidden: true, scrollable: true })
  }, 30_000)

  for (const width of [320, 900, 1440]) {
    for (const theme of ['light', 'dark']) {
      test(`When ${width}px ${theme} 打开文件并关闭 Then 消息/输入区无覆盖和水平溢出且恢复居中`, async () => {
        const result = await renderer.run<{ separate: boolean; inputInside: boolean; noHorizontalOverflow: boolean; restored: boolean }>(String.raw`
          await window.layoutTest.resize(${width})
          document.documentElement.classList.toggle('dark', '${theme}' === 'dark')
          document.documentElement.classList.toggle('theme-terminal-dark', '${theme}' === 'dark')
          const f = await window.mountRightPanelContract()
          const chat = document.querySelector('[data-testid="contract-conversation"]')
          const trigger = document.querySelector('[data-testid="on-demand-right-panel-nav"] button')
          const original = chat.getBoundingClientRect()
          trigger.click()
          await f.until(() => document.querySelector('[data-testid="on-demand-overlay-panel"] input'))
          await f.delay(100)
          const panel = document.querySelector('[data-testid="on-demand-overlay-panel"]').getBoundingClientRect()
          const rect = chat.getBoundingClientRect(), input = document.querySelector('[data-testid="contract-input"]').getBoundingClientRect()
          const viewport = document.querySelector('[data-conversation-scroll-viewport]')
          viewport.scrollTop = 0
          await f.delay(80)
          await window.layoutTest.capture('${width}-${theme}')
          const result = {
            separate: rect.right <= panel.left && panel.right <= innerWidth && rect.width > 0,
            inputInside: input.left >= rect.left && input.right <= rect.right && input.right <= panel.left,
            noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth && viewport.scrollWidth <= viewport.clientWidth,
          }
          document.querySelector('[data-panel-close]').click()
          await f.until(() => !document.querySelector('[data-testid="on-demand-overlay-panel"]'))
          return { ...result, restored: Math.abs(chat.getBoundingClientRect().left - original.left) < 2 && Math.abs(chat.getBoundingClientRect().width - original.width) < 2 }
        `)
        expect(result).toEqual({ separate: true, inputInside: true, noHorizontalOverflow: true, restored: true })
      }, 30_000)
    }
  }

  test('When 项目附件 map 使用真实 workspaceId Then 文件侧栏可见该附件而非误用 slug', async () => {
    const result = await renderer.run<{ rootVisible: boolean; attachmentVisible: boolean }>(String.raw`
      const f = await window.mountRightPanelContract()
      document.querySelector('[data-testid="on-demand-right-panel-nav"] button').click()
      await f.until(() => document.body.innerText.includes('root-file.ts'))
      const panel = document.querySelector('[data-testid="on-demand-overlay-panel"]')
      return { rootVisible: panel.innerText.includes('root-file.ts'), attachmentVisible: panel.innerText.includes('pinned.md') }
    `)
    expect(result).toEqual({ rootVisible: true, attachmentVisible: true })
  }, 30_000)

  test('When 项目根与会话私有目录不同 Then 沿用既有 diff 范围和文件访问上下文', async () => {
    const result = await renderer.run<{ diffRoot: string; expectedRoot: string; fileSession: string | null; expectedSession: string }>(String.raw`
      const f = await window.mountRightPanelContract()
      document.querySelector('[data-testid="on-demand-right-panel-nav"] button').click()
      await f.until(() => f.diffCalls.length > 0 && f.directoryCalls.length > 0)
      return {
        diffRoot: f.diffCalls[0][0], expectedRoot: f.projectRoot,
        fileSession: f.directoryCalls.find(item => item.path === f.projectRoot)?.access?.sessionId ?? null,
        expectedSession: f.sessionId,
      }
    `)
    expect(result.diffRoot).toBe(result.expectedRoot)
    expect(result.fileSession).toBe(result.expectedSession)
  }, 30_000)
})
