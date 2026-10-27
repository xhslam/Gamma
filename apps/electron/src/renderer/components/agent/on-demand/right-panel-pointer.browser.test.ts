import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness

beforeAll(async () => {
  renderer = await createElectronRendererHarness(String.raw`
    import { mountRightPanelContractFixture } from '@/../test-utils/right-panel-contract-fixture'
    import { activeOnDemandOverlayAtom } from '@/atoms/on-demand-panel-atoms'
    import { currentSessionSidePanelOpenAtom } from '@/atoms/agent-atoms'
    window.mountPointerFixture = async () => {
      const fixture = await mountRightPanelContractFixture()
      return {
        ...fixture,
        activeOverlay: () => fixture.store.get(activeOnDemandOverlayAtom),
        bigPanelOpen: () => fixture.store.get(currentSessionSidePanelOpenAtom),
        onBigPanelOpen: (callback) => fixture.store.sub(currentSessionSidePanelOpenAtom, callback),
      }
    }
  `, {
    // 使用 Chromium 原生输入，保留 pointerdown → focus → click 及 Radix outside 事件顺序。
    mainProcessSetup: String.raw`
      const { ipcMain } = require('electron')
      ipcMain.handle('right-panel-native-input', async (event, input) => {
        if (input.type === 'click') {
          const position = { x: input.x, y: input.y }
          event.sender.sendInputEvent({ type: 'mouseMove', ...position })
          event.sender.sendInputEvent({ type: 'mouseDown', ...position, button: 'left', clickCount: 1 })
          await new Promise(resolve => setTimeout(resolve, 30))
          event.sender.sendInputEvent({ type: 'mouseUp', ...position, button: 'left', clickCount: 1 })
        } else if (input.type === 'escape') {
          event.sender.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
          event.sender.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
        }
      })
    `,
    preloadSource: String.raw`
      const { contextBridge, ipcRenderer } = require('electron')
      contextBridge.exposeInMainWorld('rightPanelNativeInput', input => ipcRenderer.invoke('right-panel-native-input', input))
    `,
    timeoutMs: 20_000,
  })
}, 60_000)

afterAll(async () => { await renderer?.dispose() })

const pointerScenario = String.raw`
  const f = await window.mountPointerFixture()
  const nav = document.querySelector('[data-testid="on-demand-right-panel-nav"]')
  const files = nav.querySelector('button[aria-label^="文件"]')
  const changes = nav.querySelector('button[aria-label^="改动"]')
  const nativeClick = async (element) => {
    const box = element.getBoundingClientRect()
    await window.rightPanelNativeInput({ type: 'click', x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) })
    await f.delay(180)
  }
`

interface PointerSwitchResult {
  first: string | null
  switched: string | null
  switchedBack: string | null
  sameButtonClosed: boolean
  sameButtonFocused: boolean
  trustedClicks: number
  untrustedClicks: number
}

describe('Given 生产按需面板与 Chromium 原生鼠标事件', () => {
  test('When 文件与改动入口交替点击 Then 一次切换内容且同图标关闭回焦', async () => {
    const result = await renderer.run<PointerSwitchResult>(pointerScenario + String.raw`
      let trustedClicks = 0, untrustedClicks = 0
      document.addEventListener('click', event => event.isTrusted ? trustedClicks++ : untrustedClicks++, true)
      await nativeClick(files)
      const first = f.activeOverlay()
      await nativeClick(changes)
      const switched = f.activeOverlay()
      await nativeClick(files)
      const switchedBack = f.activeOverlay()
      await nativeClick(files)
      return {
        first, switched, switchedBack,
        sameButtonClosed: f.activeOverlay() === null && !document.querySelector('[data-testid="on-demand-overlay-panel"]'),
        sameButtonFocused: document.activeElement === files,
        trustedClicks, untrustedClicks,
      }
    `)
    expect(result).toEqual({
      first: 'files', switched: 'changes', switchedBack: 'files',
      sameButtonClosed: true, sameButtonFocused: true,
      trustedClicks: 4, untrustedClicks: 0,
    })
  }, 30_000)

  test('When 点击外部或按 Escape Then 浮层关闭且焦点回到打开它的入口', async () => {
    const result = await renderer.run<{ outsideClosed: boolean; outsideFocused: boolean; escapeClosed: boolean; escapeFocused: boolean }>(pointerScenario + String.raw`
      await nativeClick(files)
      await nativeClick(document.querySelector('[data-testid="contract-outside"]'))
      const outsideClosed = f.activeOverlay() === null && !document.querySelector('[data-testid="on-demand-overlay-panel"]')
      const outsideFocused = document.activeElement === files
      await nativeClick(changes)
      await window.rightPanelNativeInput({ type: 'escape' })
      await f.delay(180)
      return {
        outsideClosed, outsideFocused,
        escapeClosed: f.activeOverlay() === null && !document.querySelector('[data-testid="on-demand-overlay-panel"]'),
        escapeFocused: document.activeElement === changes,
      }
    `)
    expect(result).toEqual({ outsideClosed: true, outsideFocused: true, escapeClosed: true, escapeFocused: true })
  }, 30_000)

  test('When 点击具体文件进入大面板 Then 关闭浮层且不把焦点抢回入口', async () => {
    const result = await renderer.run<{ expanded: boolean; overlayClosed: boolean; focusRetained: boolean }>(pointerScenario + String.raw`
      const focusTarget = document.querySelector('[data-testid="contract-outside"]')
      const unsubscribe = f.onBigPanelOpen(() => { if (f.bigPanelOpen()) focusTarget.focus() })
      await nativeClick(files)
      await f.until(() => Boolean(document.querySelector('[data-testid="on-demand-overlay-panel"] button[role="option"]')))
      await nativeClick(document.querySelector('[data-testid="on-demand-overlay-panel"] button[role="option"]'))
      await f.delay(180)
      unsubscribe()
      return {
        expanded: f.bigPanelOpen(),
        overlayClosed: f.activeOverlay() === null && !document.querySelector('[data-testid="on-demand-overlay-panel"]'),
        focusRetained: document.activeElement === focusTarget,
      }
    `)
    expect(result).toEqual({ expanded: true, overlayClosed: true, focusRetained: true })
  }, 30_000)

  test('When 原生点击加号打开文件并在工作区展开后再次浏览 Then 菜单可操作且 Escape 只关闭浮层并回焦', async () => {
    const result = await renderer.run<{ menuOpened: boolean; fileMenuOpenedOverlay: boolean; workspacePreserved: boolean; escapeFocused: boolean }>(pointerScenario + String.raw`
      await nativeClick(nav.querySelector('[data-testid="add-workspace-button"]'))
      await f.until(() => Boolean(document.querySelector('[role="menu"]')))
      const menuOpened = !f.bigPanelOpen()
      const openFile = Array.from(document.querySelectorAll('[role="menuitem"]')).find(item => item.textContent.includes('打开文件'))
      await nativeClick(openFile)
      await f.until(() => Boolean(document.querySelector('[data-testid="on-demand-overlay-panel"] button[role="option"]')))
      const fileMenuOpenedOverlay = f.activeOverlay() === 'files' && !f.bigPanelOpen()
      await nativeClick(document.querySelector('[data-testid="on-demand-overlay-panel"] button[role="option"]'))
      await nativeClick(files)
      const workspacePreserved = f.bigPanelOpen() && f.activeOverlay() === 'files'
      await window.rightPanelNativeInput({ type: 'escape' })
      await f.delay(180)
      return { menuOpened, fileMenuOpenedOverlay, workspacePreserved, escapeFocused: f.bigPanelOpen() && f.activeOverlay() === null && document.activeElement === files }
    `)
    expect(result).toEqual({ menuOpened: true, fileMenuOpenedOverlay: true, workspacePreserved: true, escapeFocused: true })
  }, 30_000)
})
