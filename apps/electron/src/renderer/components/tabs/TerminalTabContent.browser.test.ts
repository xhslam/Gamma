import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness

beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { TerminalTabContent } from '@/components/tabs/TerminalTabContent'
    import { SidebarTransition } from '@/components/app-shell/SidebarTransition'
    import '@/styles/globals.css'

    document.head.insertAdjacentHTML('beforeend', '<style>html,body,#root{margin:0;width:100%;height:100%}#root>div{height:100%}#root>div:not([data-sidebar-transition]){display:flex;flex-direction:column;padding:8px;box-sizing:border-box}#root>div>div{flex:1;min-height:0}</style>')
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel' })
    const delay = (milliseconds = 20) => new Promise(resolve => setTimeout(resolve, milliseconds))
    const until = async (condition, message) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (condition()) return
        await delay(5)
      }
      throw new Error(message)
    }
    window.terminalRegression = {
      delay,
      async mount(options = {}) {
        const writes = []
        const savedImages = []
        let terminalCreates = 0
        let terminalKills = 0
        let outputListener
        let outputSequence = 1
        let acknowledgedSequence = 0
        let readClipboard = options.readClipboard || (() => Promise.resolve({ type: 'text', text: 'PASTED_TEXT' }))
        window.electronAPI = {
          createTerminal: async () => { terminalCreates++ },
          getTerminalSnapshot: async () => ({ output: options.snapshotOutput ?? '\\x1b[?2004h', sequence: 1 }),
          resizeTerminal: async () => {},
          acknowledgeTerminalOutput: async ({ sequence }) => { acknowledgedSequence = sequence },
          onTerminalOutput: (listener) => { outputListener = listener; return () => { outputListener = undefined } },
          onTerminalExit: () => () => {},
          writeTerminal: async (input) => {
            writes.push(input.data)
            if (options.echo && input.data.startsWith('\\x1b[200~')) {
              outputListener?.({ terminalId: 'terminal-regression', data: input.data.slice(6, -6), sequence: ++outputSequence })
            }
          },
          getTerminalClipboardContent: () => readClipboard(),
          saveTerminalPastedImage: async (input) => { savedImages.push(input); return options.saveImage ? options.saveImage(input) : { filePath: '/regression/pasted-image.png' } },
          getPathForFile: () => '',
          killTerminal: async () => { terminalKills++ },
        }
        const root = createRoot(document.getElementById('root'))
        const renderTerminal = (collapsed = false) => {
          const content = React.createElement(TerminalTabContent, { terminalId: 'terminal-regression', sessionId: 'session-regression', terminateOnUnmount: options.terminateOnUnmount ?? true })
          root.render(options.animateWorkspace ? React.createElement(SidebarTransition, { collapsed, width: 480, region: 'workspace' }, content) : content)
        }
        renderTerminal()
        await until(() => document.querySelector('.xterm-helper-textarea') && acknowledgedSequence >= 1, '终端 DOM 或快照恢复未完成')
        const textarea = document.querySelector('.xterm-helper-textarea')
        if (!textarea) throw new Error('真实终端 textarea 未挂载')
        textarea.focus()
        return {
          writes,
          savedImages,
          textarea,
          root,
          terminalCreates: () => terminalCreates,
          terminalKills: () => terminalKills,
          async setCollapsed(collapsed) {
            renderTerminal(collapsed)
            await until(() => {
              const shell = document.querySelector('[data-sidebar-transition]')
              return shell?.dataset.collapsed === String(collapsed) && getComputedStyle(shell.querySelector('[data-sidebar-transition-content]')).opacity === (collapsed ? '0' : '1') && shell.getBoundingClientRect().width === (collapsed ? 0 : 480)
            }, '终端所在工作区的动画未完成')
          },
          async hide() { root.render(React.createElement('div')); await until(() => !textarea.isConnected, '终端未分离 DOM') },
          async show() { renderTerminal(); await until(() => textarea.isConnected, '终端未重新挂载 DOM') },
          async emitOutput(data) {
            const sequence = ++outputSequence
            outputListener?.({ terminalId: 'terminal-regression', data, sequence })
            await until(() => acknowledgedSequence >= sequence, '终端输出未解析完成')
          },
          async waitForWrites(count) {
            await until(() => writes.length >= count, '终端输入未提交')
            await until(() => acknowledgedSequence >= outputSequence, '终端回显未解析完成')
            await new Promise(requestAnimationFrame)
          },
          setReadClipboard: (next) => { readClipboard = next },
          cursor() {
            const cursor = document.querySelector('.xterm-cursor')
            if (!cursor) throw new Error('真实终端光标未渲染')
            const row = cursor.parentElement
            const range = document.createRange()
            range.selectNodeContents(row)
            range.setEndBefore(cursor)
            return { column: range.toString().length, rowText: row.textContent }
          },
          pasteText(text) {
            const clipboardData = new DataTransfer()
            clipboardData.setData('text/plain', text)
            const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData })
            textarea.dispatchEvent(event)
            return event.defaultPrevented
          },
          pasteImage() {
            const clipboardData = new DataTransfer()
            clipboardData.items.add(new File(['image-fixture'], 'image.png', { type: 'image/png' }))
            const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData })
            textarea.dispatchEvent(event)
            return event.defaultPrevented
          },
          pasteShortcut() {
            const event = new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', keyCode: 86, metaKey: true, bubbles: true, cancelable: true })
            textarea.dispatchEvent(event)
            return event.defaultPrevented
          },
        }
      },
    }
  `)
}, 20_000)

afterAll(async () => { await renderer?.dispose() })

describe('侧边栏终端的真实 Chromium 粘贴事件', () => {
  test('Given Cmd+V 后 Chromium 发出 paste When 焦点位于 xterm textarea Then 阻止原生默认行为并且内容仅输入一次', async () => {
    const result = await renderer.run<{ shortcutPrevented: boolean; pastePrevented: boolean | null; writes: string[] }>(`
      const terminal = await window.terminalRegression.mount()
      const shortcutPrevented = terminal.pasteShortcut()
      // Chromium 仅在 keydown 默认行为未取消时继续发出原生 paste。
      const pastePrevented = shortcutPrevented ? null : terminal.pasteText('PASTED_TEXT')
      await window.terminalRegression.delay(80)
      return { shortcutPrevented, pastePrevented, writes: terminal.writes }
    `)
    expect(result).toEqual({ shortcutPrevented: true, pastePrevented: null, writes: ['\x1b[200~PASTED_TEXT\x1b[201~'] })
  }, 20_000)

  test('Given 原生应用菜单向 xterm textarea 粘贴文字 When 捕获 paste Then 阻止 xterm 原生 listener 并只输入一次', async () => {
    const result = await renderer.run<{ pastePrevented: boolean; writes: string[] }>(`
      const terminal = await window.terminalRegression.mount()
      const pastePrevented = terminal.pasteText('MENU_TEXT')
      await window.terminalRegression.delay(50)
      return { pastePrevented, writes: terminal.writes }
    `)
    expect(result).toEqual({ pastePrevented: true, writes: ['\x1b[200~MENU_TEXT\x1b[201~'] })
  }, 20_000)

  test('Given 原生应用菜单向 xterm textarea 粘贴图片 When 图片保存完成 Then 只输入图片路径并且没有空 bracketed paste', async () => {
    const result = await renderer.run<{ pastePrevented: boolean; savedImages: number; writes: string[] }>(`
      const terminal = await window.terminalRegression.mount()
      const pastePrevented = terminal.pasteImage()
      await window.terminalRegression.delay(80)
      return { pastePrevented, savedImages: terminal.savedImages.length, writes: terminal.writes }
    `)
    expect(result).toEqual({ pastePrevented: true, savedImages: 1, writes: ['\x1b[200~/regression/pasted-image.png \x1b[201~'] })
  }, 20_000)

  test('Given 两次快速原生粘贴 When 两个 paste 在同一轮触发 Then 每次文字都保留且顺序正确', async () => {
    const result = await renderer.run<string[]>(`
      const terminal = await window.terminalRegression.mount()
      terminal.pasteText('FIRST')
      terminal.pasteText('SECOND')
      await window.terminalRegression.delay(50)
      return terminal.writes
    `)
    expect(result).toEqual(['\x1b[200~FIRST\x1b[201~', '\x1b[200~SECOND\x1b[201~'])
  }, 20_000)

  test('Given 首次剪贴板读取缓慢且第二次立即完成 When 快速连续按 Cmd+V Then 按触发顺序提交两次粘贴', async () => {
    const result = await renderer.run<string[]>(`
      let count = 0
      const terminal = await window.terminalRegression.mount({
        readClipboard: async () => {
          const order = ++count
          await window.terminalRegression.delay(order === 1 ? 80 : 0)
          return { type: 'text', text: order === 1 ? 'FIRST' : 'SECOND' }
        },
      })
      terminal.pasteShortcut()
      terminal.pasteShortcut()
      await window.terminalRegression.delay(200)
      return terminal.writes
    `)
    expect(result).toEqual(['\x1b[200~FIRST\x1b[201~', '\x1b[200~SECOND\x1b[201~'])
  }, 20_000)

  test('Given 图片剪贴板读取仍未完成 When agy 发出 DSR 与 DA 查询 Then 即时返回协议回复并在读取完成后提交图片', async () => {
    const result = await renderer.run<{ duringPaste: string[]; afterPaste: string[] }>(`
      let finishRead
      const terminal = await window.terminalRegression.mount({
        readClipboard: () => new Promise(resolve => { finishRead = resolve }),
      })
      terminal.pasteShortcut()
      await terminal.emitOutput('\\x1b[6n\\x1b[c')
      const duringPaste = [...terminal.writes]
      finishRead({ type: 'image', filePath: '/regression/pasted-image.png' })
      await window.terminalRegression.delay(60)
      return { duringPaste, afterPaste: terminal.writes }
    `)
    expect(result.duringPaste).toEqual(['\x1b[1;1R', '\x1b[?1;2c'])
    expect(result.afterPaste).toEqual(['\x1b[1;1R', '\x1b[?1;2c', '\x1b[200~/regression/pasted-image.png \x1b[201~'])
  }, 20_000)

  test('Given 图片保存缓慢且用户切换到其他输入框 When 保存完成 Then 粘贴图片但不抢回焦点', async () => {
    const result = await renderer.run<{ activeInputId: string; writes: string[] }>(`
      let finishSave
      const terminal = await window.terminalRegression.mount({
        saveImage: () => new Promise(resolve => { finishSave = resolve }),
      })
      terminal.pasteImage()
      for (let attempt = 0; attempt < 100 && !finishSave; attempt++) await window.terminalRegression.delay(5)
      const otherInput = document.createElement('input')
      otherInput.id = 'other-input'
      document.body.append(otherInput)
      otherInput.focus()
      finishSave({ filePath: '/regression/pasted-image.png' })
      await window.terminalRegression.delay(60)
      return { activeInputId: document.activeElement.id, writes: terminal.writes }
    `)
    expect(result).toEqual({ activeInputId: 'other-input', writes: ['\x1b[200~/regression/pasted-image.png \x1b[201~'] })
  }, 20_000)

  test('Given 图片保存过程中保留 PTY 的终端组件卸载 When 保存完成 Then 取消过期粘贴并保留其他输入框焦点', async () => {
    const result = await renderer.run<{ activeInputId: string; writes: string[] }>(`
      let finishSave
      const terminal = await window.terminalRegression.mount({
        terminateOnUnmount: false,
        saveImage: () => new Promise(resolve => { finishSave = resolve }),
      })
      terminal.pasteImage()
      for (let attempt = 0; attempt < 100 && !finishSave; attempt++) await window.terminalRegression.delay(5)
      terminal.root.unmount()
      const otherInput = document.createElement('input')
      otherInput.id = 'other-input'
      document.body.append(otherInput)
      otherInput.focus()
      finishSave({ filePath: '/regression/pasted-image.png' })
      await window.terminalRegression.delay(60)
      return { activeInputId: document.activeElement.id, writes: terminal.writes }
    `)
    expect(result).toEqual({ activeInputId: 'other-input', writes: [] })
  }, 20_000)

  test('Given 旧粘贴仍未读取且组件分离后重新挂载 When 新挂载触发粘贴 Then 新事务立即提交并且旧事务作废', async () => {
    const result = await renderer.run<{ beforeOldResolves: string[]; afterOldResolves: string[] }>(`
      let finishOldRead
      const terminal = await window.terminalRegression.mount({
        terminateOnUnmount: false,
        readClipboard: () => new Promise(resolve => { finishOldRead = resolve }),
      })
      terminal.pasteShortcut()
      await terminal.hide()
      await terminal.show()
      terminal.setReadClipboard(async () => ({ type: 'text', text: 'NEW_ATTACHMENT' }))
      terminal.pasteShortcut()
      await window.terminalRegression.delay(50)
      const beforeOldResolves = [...terminal.writes]
      finishOldRead({ type: 'text', text: 'STALE_ATTACHMENT' })
      await window.terminalRegression.delay(50)
      return { beforeOldResolves, afterOldResolves: terminal.writes }
    `)
    expect(result).toEqual({
      beforeOldResolves: ['\x1b[200~NEW_ATTACHMENT\x1b[201~'],
      afterOldResolves: ['\x1b[200~NEW_ATTACHMENT\x1b[201~'],
    })
  }, 20_000)

  test('Given 图片保存失败且系统剪贴板已变化 When 随后粘贴文字 Then 不读取变化后的系统剪贴板并且后续事务继续成功', async () => {
    const result = await renderer.run<{ clipboardReads: number; writes: string[]; errorBefore: string | null; errorAfter: string | null }>(`
      let clipboardReads = 0
      const terminal = await window.terminalRegression.mount({
        saveImage: async () => { throw new Error('REGRESSION_SAVE_FAILED') },
        readClipboard: async () => { clipboardReads++; return { type: 'text', text: 'UNRELATED_CLIPBOARD' } },
      })
      terminal.pasteImage()
      await window.terminalRegression.delay(60)
      const errorBefore = document.querySelector('[role="alert"]')?.textContent ?? null
      terminal.pasteText('NEXT_PASTE')
      await window.terminalRegression.delay(60)
      return { clipboardReads, writes: terminal.writes, errorBefore, errorAfter: document.querySelector('[role="alert"]')?.textContent ?? null }
    `)
    expect(result.clipboardReads).toBe(0)
    expect(result.writes).toEqual(['\x1b[200~NEXT_PASTE\x1b[201~'])
    expect(result.errorBefore).toContain('REGRESSION_SAVE_FAILED')
    expect(result.errorAfter).toBeNull()
  }, 20_000)

  test('Given 模拟 CLI 回显粘贴结果 When 依次粘贴文字与图片 Then 真实 DOM 光标停在完整内容末尾', async () => {
    const result = await renderer.run<{ textCursor: { column: number; rowText: string }; imageCursor: { column: number; rowText: string }; writes: string[] }>(`
      const terminal = await window.terminalRegression.mount({ echo: true })
      // CLI 启动前的真实键盘输入会初始化 xterm 光标；使用公开 DOM 事件，不访问私有状态。
      terminal.textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, bubbles: true, cancelable: true }))
      terminal.writes.length = 0
      terminal.pasteText('TEXT_')
      await terminal.waitForWrites(1)
      const textCursor = terminal.cursor()
      terminal.pasteImage()
      await terminal.waitForWrites(2)
      return { textCursor, imageCursor: terminal.cursor(), writes: terminal.writes }
    `)
    expect(result.textCursor.column).toBe('TEXT_'.length)
    expect(result.textCursor.rowText.trimEnd()).toBe('TEXT_')
    expect(result.imageCursor.column).toBe('TEXT_/regression/pasted-image.png '.length)
    expect(result.imageCursor.rowText.trimEnd()).toBe('TEXT_/regression/pasted-image.png')
    expect(result.writes).toEqual(['\x1b[200~TEXT_\x1b[201~', '\x1b[200~/regression/pasted-image.png \x1b[201~'])
  }, 20_000)

  test('Given 浅色深色与 CRT 应用主题 When CLI 输出与底色接近的 truecolor Then 真实 DOM 文字对比度保持至少 7', async () => {
    const results = await renderer.run<{ theme: string; contrast: number; background: string; outerBackground: string; color: string; textShadow: string }[]>(`
      const terminal = await window.terminalRegression.mount()
      await terminal.emitOutput('\\x1b[38;2;24;24;27mLOW_CONTRAST\\x1b[0m')
      const rgb = value => value.match(/[\\d.]+/g).slice(0, 3).map(Number)
      const luminance = color => rgb(color).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
      const results = []
      for (const theme of ['', 'dark', 'dark theme-terminal-dark']) {
        document.documentElement.className = theme
        document.getElementById('root').className = 'text-foreground'
        await window.terminalRegression.delay(30)
        const span = Array.from(document.querySelectorAll('.xterm-rows span')).find(node => node.textContent.includes('LOW_CONTRAST'))
        if (!span) throw new Error('真实 xterm truecolor 文字未显示')
        const style = getComputedStyle(span)
        // xterm 6 的真实背景在 ScrollableElement；.xterm-viewport 保留旧版默认 CSS，不能作为实际底色。
        const background = getComputedStyle(document.querySelector('.xterm-screen').parentElement).backgroundColor
        const foregroundLuminance = luminance(style.color)
        const backgroundLuminance = luminance(background)
        results.push({ theme, contrast: (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05), background, color: style.color, textShadow: style.textShadow, outerBackground: getComputedStyle(document.getElementById('root').firstElementChild).backgroundColor })
      }
      return results
    `)
    expect(results).toHaveLength(3)
    for (const result of results) {
      expect(result.background).toBe(result.theme ? 'rgb(38, 38, 36)' : 'rgb(255, 255, 255)')
      expect(result.outerBackground).toBe(result.background)
      expect(result.textShadow).toBe('none')
      expect(result.contrast).toBeGreaterThanOrEqual(7)
    }
  }, 20_000)

  test('Given 面板内已有终端 When 亮暗切换并收起再恢复 Then 三层背景一致且复用原终端与输出', async () => {
    const result = await renderer.run<{ colorsMatch: boolean; retained: boolean; terminalCreates: number }>(`
      const terminal = await window.terminalRegression.mount({ terminateOnUnmount: false, snapshotOutput: 'THEME_HISTORY' })
      const screen = document.querySelector('.xterm-screen')
      const referencePanel = document.createElement('section')
      referencePanel.className = 'gamma-panel'
      referencePanel.dataset.panel = 'workspace'
      document.body.append(referencePanel)
      let colorsMatch = true
      for (const theme of ['', 'dark', 'dark theme-terminal-dark', '']) {
        await terminal.hide()
        document.documentElement.className = theme
        await terminal.show()
        await window.terminalRegression.delay(40)
        const panelBackground = getComputedStyle(referencePanel).backgroundColor
        const terminalBackground = getComputedStyle(document.querySelector('.xterm-screen').parentElement).backgroundColor
        const shellBackground = getComputedStyle(document.getElementById('root').firstElementChild).backgroundColor
        colorsMatch &&= panelBackground === terminalBackground && panelBackground === shellBackground
      }
      return { colorsMatch, retained: document.querySelector('.xterm-screen') === screen && document.querySelector('.xterm-rows').textContent.includes('THEME_HISTORY'), terminalCreates: terminal.terminalCreates() }
    `)
    expect(result).toEqual({ colorsMatch: true, retained: true, terminalCreates: 1 })
  }, 20_000)

  test('Given 动画工作区内已有终端 When 连续收放且收起期间继续输出 Then 原终端始终挂载、历史完整且不重建进程', async () => {
    const result = await renderer.run(`
      const terminal = await window.terminalRegression.mount({ animateWorkspace: true, terminateOnUnmount: false, snapshotOutput: 'KEEP_HISTORY\\r\\n' })
      const screen = document.querySelector('.xterm-screen');let connected = true
      for (let i = 0; i < 3; i++) {
        await terminal.setCollapsed(true);connected &&= screen.isConnected
        await terminal.emitOutput('HIDDEN_OUTPUT_' + i + '\\r\\n')
        await terminal.setCollapsed(false);connected &&= screen === document.querySelector('.xterm-screen')
      }
      const text = document.querySelector('.xterm-rows').textContent
      return { connected, history: ['KEEP_HISTORY','HIDDEN_OUTPUT_0','HIDDEN_OUTPUT_1','HIDDEN_OUTPUT_2'].every(value => text.includes(value)), creates: terminal.terminalCreates(), kills: terminal.terminalKills() }
    `)
    expect(result).toEqual({ connected: true, history: true, creates: 1, kills: 0 })
  }, 20_000)
})
