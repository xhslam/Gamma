import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'
import { AGY_REDRAW_CAPTURE } from './fixtures/agy-redraw-capture'

interface TuiFrame {
  input: string
  visibleLines: string[]
  expectedLines: string[]
  cursorReply: string
  expectedCursorReply: string
  cursorColumn: number
  expectedCursorColumn: number
}

interface ResizeTuiResult {
  beforeCols: number
  afterCols: number
  frame: TuiFrame
}

interface TuiObservation {
  visibleLines: string[]
  cursorReply: string
  cursorColumn: number | null
}

let renderer: ElectronRendererHarness

beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { TerminalTabContent } from '@/components/tabs/TerminalTabContent'
    import '@/styles/globals.css'

    Object.defineProperty(navigator, 'platform', { value: 'MacIntel' })
    document.head.insertAdjacentHTML('beforeend', '<style>html,body,#root{margin:0;height:100%;min-height:0}#root{width:500px;height:420px}#root>div{height:100%;box-sizing:border-box}</style>')
    const delay = () => new Promise(resolve => setTimeout(resolve, 5))
    const until = async (condition, label) => {
      for (let attempt = 0; attempt < 300; attempt++) {
        if (condition()) return
        await delay()
      }
      throw new Error(label)
    }
    const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    // 本 fixture 只使用宽度稳定的 ASCII 与基本汉字；emoji/ZWJ 需要与 CLI 的 Unicode 规则单独对照。
    const cells = character => /[\\u2e80-\\ua4cf\\uac00-\\ud7a3\\uf900-\\ufaff\\ufe10-\\ufe6f\\uff01-\\uff60\\uffe0-\\uffe6]/u.test(character) ? 2 : 1
    const layout = (text, cols) => {
      const lines = ['> ']
      let column = 2
      for (const character of text) {
        if (character === '\\n') { lines.push(''); column = 0; continue }
        const width = cells(character)
        if (column + width >= cols) { lines.push(''); column = 0 }
        lines[lines.length - 1] += character
        column += width
      }
      return { lines, column, row: lines.length + 1 }
    }
    window.tuiRegression = {
      async mount(buffer = 'normal') {
        const inputs = []
        const replies = []
        let outputListener
        let sequence = 1
        let acknowledged = 0
        let dimensions
        const rootElement = document.getElementById('root')
        window.electronAPI = {
          createTerminal: async input => { dimensions = { cols: input.cols, rows: input.rows } },
          getTerminalSnapshot: async () => ({ output: (buffer === 'alternate' ? '\\x1b[?1049h' : '') + '\\x1b[?2004h', sequence: 1 }),
          resizeTerminal: async input => { dimensions = { cols: input.cols, rows: input.rows } },
          acknowledgeTerminalOutput: async input => { acknowledged = input.sequence },
          onTerminalOutput: listener => { outputListener = listener; return () => {} },
          onTerminalExit: () => () => {},
          writeTerminal: async input => {
            if (input.data.startsWith('\\x1b[200~')) inputs.push(input.data.slice(6, -6).replace(/\\r/g, '\\n'))
            else if (/^\\x1b\\[\\d+;\\d+R$/.test(input.data)) replies.push(input.data)
          },
          getTerminalClipboardContent: async () => ({ type: 'empty' }),
          getPathForFile: () => '',
          saveTerminalPastedImage: async () => ({ filePath: '/回归/图片一.png' }),
          killTerminal: async () => {},
        }
        const root = createRoot(rootElement)
        root.render(React.createElement(TerminalTabContent, { terminalId: 'tui-regression', sessionId: 'session-regression' }))
        await until(() => acknowledged === 1 && document.querySelector('.xterm-helper-textarea'), 'TUI 终端恢复未完成')
        const textarea = document.querySelector('.xterm-helper-textarea')
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, bubbles: true, cancelable: true }))
        const output = async data => {
          const current = ++sequence
          outputListener({ terminalId: 'tui-regression', sequence: current, data })
          await until(() => acknowledged >= current, 'TUI 控制序列未完成解析')
          await paint()
        }
        return {
          dimensions: () => ({ ...dimensions }),
          async observe(data) {
            for (const chunk of Array.isArray(data) ? data : [data]) await output(chunk)
            await output('\\x1b[6n')
            const cursor = document.querySelector('.xterm-cursor')
            const cellWidth = document.querySelector('.xterm-screen').getBoundingClientRect().width / dimensions.cols
            return {
              visibleLines: Array.from(document.querySelector('.xterm-rows').children).map(row => row.textContent.trimEnd()),
              cursorReply: replies[replies.length - 1],
              cursorColumn: cursor ? (cursor.getBoundingClientRect().left - cursor.parentElement.getBoundingClientRect().left) / cellWidth : null,
            }
          },
          async paste(text) {
            const previous = inputs.length
            const clipboardData = new DataTransfer()
            clipboardData.setData('text/plain', text)
            textarea.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }))
            await until(() => inputs.length > previous, 'TUI 粘贴没有到达宿主')
            return inputs[inputs.length - 1]
          },
          async draw(text, erase = true) {
            const model = layout(text, dimensions.cols)
            let data = '\\x1b[?2026h\\x1b[2;1H' + (erase ? '\\x1b[J' : '')
            for (let index = 0; index < model.lines.length; index++) {
              data += '\\x1b[' + (index + 2) + ';1H' + (erase ? '\\x1b[2K' : '') + '\\x1b[1G' + model.lines[index]
            }
            data += '\\x1b[' + model.row + ';' + (model.column + 1) + 'H\\x1b[?2026l\\x1b[6n'
            await output(data)
            const rows = Array.from(document.querySelector('.xterm-rows').children)
            const cursor = document.querySelector('.xterm-cursor')
            if (!cursor) throw new Error('TUI 光标未渲染')
            const row = cursor.parentElement
            const cellWidth = document.querySelector('.xterm-screen').getBoundingClientRect().width / dimensions.cols
            return {
              input: text,
              visibleLines: rows.slice(1, 1 + model.lines.length).map(row => row.textContent.trimEnd()),
              expectedLines: model.lines.map(line => line.trimEnd()),
              cursorReply: replies[replies.length - 1],
              expectedCursorReply: '\\x1b[' + model.row + ';' + (model.column + 1) + 'R',
              cursorColumn: (cursor.getBoundingClientRect().left - row.getBoundingClientRect().left) / cellWidth,
              expectedCursorColumn: model.column,
            }
          },
          async scroll() {
            await output(Array.from({ length: dimensions.rows + 10 }, (_, index) => '\\r\\n滚屏结果 ' + index).join(''))
          },
          async resize(width) {
            const oldCols = dimensions.cols
            rootElement.style.width = width + 'px'
            await until(() => dimensions.cols !== oldCols, 'TUI 列数没有随容器缩放')
            await paint()
          },
          async resizeGrid(cols, rows) {
            const screen = document.querySelector('.xterm-screen')
            const host = document.querySelector('.xterm').parentElement
            const cellWidth = screen.getBoundingClientRect().width / dimensions.cols
            const cellHeight = screen.getBoundingClientRect().height / dimensions.rows
            const paddingWidth = rootElement.clientWidth - host.clientWidth
            const paddingHeight = rootElement.clientHeight - host.clientHeight
            rootElement.style.width = ((cols + 0.5) * cellWidth + paddingWidth + 14) + 'px'
            rootElement.style.height = ((rows + 0.5) * cellHeight + paddingHeight) + 'px'
            try { await until(() => dimensions.cols === cols && dimensions.rows === rows, 'TUI 未匹配录制时的行列尺寸') }
            catch { throw new Error('TUI 行列尺寸：' + JSON.stringify({ dimensions, cols, rows, cellWidth, cellHeight, root: rootElement.getBoundingClientRect().toJSON(), host: host.getBoundingClientRect().toJSON(), screen: screen.getBoundingClientRect().toJSON() })) }
            await paint()
          },
        }
      },
    }
  `)
}, 20_000)

afterAll(async () => { await renderer?.dispose() })

function expectMatchingFrame(frame: TuiFrame): void {
  expect(frame.visibleLines).toEqual(frame.expectedLines)
  expect(frame.cursorReply).toBe(frame.expectedCursorReply)
  // 验证渲染出来的宽字符格位，而不是用 UTF-16 字符数代替真实光标列。
  expect(frame.cursorColumn).toBeCloseTo(frame.expectedCursorColumn, 1)
}

describe('侧边栏终端的两轮中文 TUI 重绘协议', () => {
  test('Given agy 1.3.2 首轮回复的真实 PTY 输出 When 第二轮图片、中文、第三次图片与多行粘贴依次重放 Then 内容与实际 CLI 光标定位一致', async () => {
    const observations = await renderer.run<TuiObservation[]>(`
      const capture = ${JSON.stringify(AGY_REDRAW_CAPTURE)}
      const terminal = await window.tuiRegression.mount()
      await terminal.resizeGrid(capture.cols, capture.rows)
      const observations = []
      for (const frame of capture.frames) {
        if (frame.input !== undefined) {
          const delivered = await terminal.paste(frame.input)
          if (delivered !== frame.input) throw new Error('录制场景输入发生变化：' + frame.label)
        }
        observations.push(await terminal.observe(frame.outputChunks))
      }
      return observations
    `)
    expect(observations).toHaveLength(AGY_REDRAW_CAPTURE.frames.length)
    for (const [index, frame] of AGY_REDRAW_CAPTURE.frames.entries()) {
      const observation = observations[index]
      if (!observation) throw new Error(`缺少 agy 录制节点：${frame.label}`)
      expect(observation.cursorReply).toBe(`\x1b[${frame.cursorY + 1};${frame.cursorX + 1}R`)
      for (const line of frame.expectedLines) expect(observation.visibleLines[line.row]).toBe(line.text)
      // DOM 字形度量有亚像素舍入；DSR 验证精确格位，视觉误差仍须远小于一格。
      if (observation.cursorColumn !== null) expect(Math.abs(observation.cursorColumn - frame.cursorX)).toBeLessThan(0.2)
    }
  }, 20_000)

  test('Given PTY 已使用 CUP 定位中文内容 When 后续 LF 没有 CR Then 保留当前列且不将 TUI 续行送回行首', async () => {
    const result = await renderer.run<TuiObservation>(`
      const terminal = await window.tuiRegression.mount()
      return terminal.observe('\\x1b[2;6H中文\\n继续')
    `)
    expect(result.visibleLines.slice(0, 4)).toEqual(['', '     中文', '         继续', ''])
    expect(result.cursorReply).toBe('\x1b[3;14R')
  }, 20_000)

  for (const buffer of ['normal', 'alternate']) {
    test(
      `Given ${buffer} buffer 中第一轮长中文路径 When 第二轮多行内容经 CUP、CHA、erase 重绘 Then 内容和光标格位一致且无旧尾部`,
      async () => {
        const frames = await renderer.run<TuiFrame[]>(`
          const terminal = await window.tuiRegression.mount(${JSON.stringify(buffer)})
          const firstInput = await terminal.paste('/回归测试/第一轮很长的中文文件夹/截图第一张图片.png ')
          const first = await terminal.draw(firstInput)
          const secondInput = await terminal.paste('/回归/第二张.png \\n帮我检查这张图片\\n继续输入中文')
          const second = await terminal.draw(secondInput)
          return [first, second]
        `)
        expect(frames[0]?.input).toBe('/回归测试/第一轮很长的中文文件夹/截图第一张图片.png ')
        expect(frames[1]?.input).toBe('/回归/第二张.png \n帮我检查这张图片\n继续输入中文')
        for (const frame of frames) expectMatchingFrame(frame)
      },
      20_000,
    )

    test(
      `Given ${buffer} buffer 中首轮中文粘贴与滚屏 When 侧栏缩窄后第二轮重新重绘 Then 按新列数定位且无覆盖`,
      async () => {
        const result = await renderer.run<ResizeTuiResult>(`
          const terminal = await window.tuiRegression.mount(${JSON.stringify(buffer)})
          await terminal.draw(await terminal.paste('/回归测试/第一轮图片.png '))
          await terminal.scroll()
          const beforeCols = terminal.dimensions().cols
          await terminal.resize(340)
          const input = await terminal.paste('/第二轮中文图片路径/缩放之后的截图.png \\n后续输入')
          const frame = await terminal.draw(input)
          return { beforeCols, afterCols: terminal.dimensions().cols, frame }
        `)
        expect(result.afterCols).toBeLessThan(result.beforeCols)
        expectMatchingFrame(result.frame)
      },
      20_000,
    )
  }

  test('Given 同一位置的长中文首轮内容 When 第二轮流缺少 erase Then 回归观测能识别残留尾部', async () => {
    const frame = await renderer.run<TuiFrame>(`
      const terminal = await window.tuiRegression.mount()
      await terminal.draw(await terminal.paste('第一轮较长的中文路径/图片截图.png'))
      return terminal.draw(await terminal.paste('第二轮'), false)
    `)
    // 对照组证明 fixture 会捕获重绘残影；它不代表已定位 agy 的实际输出错误。
    expect(frame.visibleLines).not.toEqual(frame.expectedLines)
    expect(frame.visibleLines[0]).toContain('中文路径')
  }, 20_000)
})
