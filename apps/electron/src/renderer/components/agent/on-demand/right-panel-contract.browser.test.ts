import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(String.raw`
    import { mountRightPanelContractFixture } from '@/../test-utils/right-panel-contract-fixture'
    window.mountRightPanelContract = mountRightPanelContractFixture
  `)
}, 60_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given 生产按需导航与独立 typed preload 契约', () => {
  test('When 标题栏不在窗口顶边并关闭浮层 Then 面板跟随实际入口且 Escape 回到原按钮', async () => {
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
      const result = { aligned: Math.abs(p.right - n.right) <= 2, below: p.top >= n.bottom && p.top <= n.bottom + 16, focusedSearch }
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      await f.until(() => !document.querySelector('[data-testid="on-demand-overlay-panel"]'))
      await f.delay(180)
      return { ...result, returnedFocus: document.activeElement === trigger }
    `)
    expect(result).toEqual({ aligned: true, below: true, focusedSearch: true, returnedFocus: true })
  }, 30_000)

  test('When 项目附件 map 使用真实 workspaceId Then 文件浮层可见该附件而非误用 slug', async () => {
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
