import * as React from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { detectIsMac, detectIsWindows } from '@/lib/platform'
import { getWindowsPtyOptions } from '@/lib/terminal-windows-pty'
import { TerminalOutputStream } from '@/lib/terminal-output-stream'
import { TerminalViewRegistry } from '@/lib/terminal-view-registry'
import { getTerminalAppearanceOptions, TERMINAL_BACKGROUND } from '@/lib/terminal-theme'
import { copyTextToClipboard } from '@/lib/clipboard'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

// 保持系统等宽字体的字形度量；仅在 Powerline 私有区字符缺字时回退到 Nerd Font。
const TERMINAL_FONT_FALLBACKS = [
  'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas',
  '"MesloLGS NF"', '"JetBrainsMono Nerd Font"', '"JetBrains Mono Nerd Font"',
  '"FiraCode Nerd Font"', '"Fira Code Nerd Font"', 'monospace',
].join(', ')

export interface TerminalTabContentProps {
  terminalId: string
  sessionId: string
  cwd?: string
  /** 右侧工作区统一关闭 Tab；普通卸载只分离 DOM，不关闭 PTY/解析器。 */
  terminateOnUnmount?: boolean
  /** 项目级终端已由专用入口创建；挂载绝不能再创建 shell。 */
  existingOnly?: boolean
  /** 仅用户主动显示的交互终端请求焦点；异步恢复不能抢走后来选中的其他输入框。 */
  autoFocus?: boolean
}

interface TerminalView {
  sessionId: string
  attach(host: HTMLElement, onError: (message: string | null) => void, autoFocus?: boolean): () => void
  dispose(): void
  hasSelection(): boolean
  copySelection(): Promise<void>
  paste(): Promise<void>
  selectAll(): void
  clear(): void
  onSelectionChange(listener: (hasSelection: boolean) => void): () => void
}

const terminalViews = new TerminalViewRegistry<TerminalView>()

/** 对非当前会话的终端也保留解析器，确保 TUI 的 DSR/DA 查询始终能获得回应。 */
export function retainTerminalViews(tabs: ReadonlyMap<string, readonly { terminalId: string; cwd?: string; existingOnly?: boolean }[]>): void {
  const retainedIds = new Set<string>()
  for (const [sessionId, terminals] of tabs) {
    for (const tab of terminals) {
      retainedIds.add(tab.terminalId)
      ensureTerminalView({ ...tab, sessionId })
    }
  }
  terminalViews.retainOnly(retainedIds)
}

function ensureTerminalView(input: Pick<TerminalTabContentProps, 'terminalId' | 'sessionId' | 'cwd' | 'existingOnly'>, initialHost?: HTMLElement): TerminalView {
  return terminalViews.acquire(input.terminalId, input.sessionId, () => createTerminalView(input, initialHost))
}

/** 格式化终端中粘贴或拖放的文件路径，若包含空格或特殊字符则转义包裹，并添加尾部空格。 */
export function formatTerminalPath(filePath: string): string {
  if (/[\s'"\\$`!*?()[\]{}|&;<>]/.test(filePath)) {
    return `'${filePath.replace(/'/g, `'\\''`)}' `
  }
  return `${filePath} `
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const res = reader.result
      if (typeof res === 'string') resolve(res)
      else reject(new Error('FileReader 读取未返回 string'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

function createTerminalView({ terminalId, sessionId, cwd, existingOnly }: Pick<TerminalTabContentProps, 'terminalId' | 'sessionId' | 'cwd' | 'existingOnly'>, initialHost?: HTMLElement): TerminalView {
  const element = document.createElement('div')
  element.className = 'h-full min-h-0 w-full min-w-0'
  initialHost?.appendChild(element)
  const terminal = new Terminal({
    cursorBlink: true,
    disableStdin: true,
    // PTY 的换行由 termios/CLI 控制；将 LF 强制变为 CRLF 会破坏 TUI 的相对光标重绘。
    convertEol: false,
    reflowCursorLine: false,
    fontFamily: TERMINAL_FONT_FALLBACKS,
    fontSize: 13,
    lineHeight: 1.25,
    scrollback: 5_000,
    windowsPty: detectIsWindows() ? getWindowsPtyOptions() : undefined,
    ...getTerminalAppearanceOptions(),
  })
  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(element)
  // 已挂载终端随亮暗主题更新，不重建 PTY 或丢失选区/历史。
  const themeObserver = new MutationObserver(() => {
    terminal.options.theme = getTerminalAppearanceOptions().theme
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
  let disposed = false
  let ptyCreated = false
  let exited = false
  let restored = false
  let pendingExitCode: number | undefined
  let host: HTMLElement | undefined = initialHost
  let errorMessage: string | null = null
  let errorListener: ((message: string | null) => void) | undefined
  let dimensions: { cols: number; rows: number } | undefined
  let fitFrame = 0
  let attachmentGeneration = 0
  let focusRequest: { host: HTMLElement; origin: Element | null; generation: number } | undefined
  const focusWhenReady = (): void => {
    const request = focusRequest
    if (!request || disposed || exited || !restored || !host) return
    if (request.host !== host || request.generation !== attachmentGeneration) { focusRequest = undefined; return }
    if (!host.isConnected || host.offsetParent === null || host.clientWidth <= 0 || host.clientHeight <= 0) return
    const active = document.activeElement
    // 用户在启动/恢复期间转到别处时，迟到的 PTY 和动画完成不得夺回光标。
    if (active && active !== document.body && active !== request.origin && !host.contains(active)) { focusRequest = undefined; return }
    focusRequest = undefined
    terminal.focus()
  }
  let pasteTail = Promise.resolve()
  const selectionListeners = new Set<(hasSelection: boolean) => void>()

  const reportError = (prefix: string, error: unknown): void => {
    if (disposed) return
    errorMessage = `${prefix}：${error instanceof Error ? error.message : String(error)}`
    errorListener?.(errorMessage)
  }
  const fit = (): void => {
    if (disposed || !host || host.clientWidth <= 0 || host.clientHeight <= 0 || host.offsetParent === null) return
    try {
      fitAddon.fit()
      const { cols, rows } = terminal
      if (ptyCreated && !exited && cols > 0 && rows > 0 && (dimensions?.cols !== cols || dimensions.rows !== rows)) {
        dimensions = { cols, rows }
        void window.electronAPI.resizeTerminal({ terminalId, cols, rows }).catch((error: unknown) => reportError('终端尺寸同步失败', error))
      }
      focusWhenReady()
    } catch {
      // 字体尚未完成测量时等待下一次布局变化。
    }
  }
  const resizeObserver = new ResizeObserver(fit)
  const output = new TerminalOutputStream({
    write: (data, callback) => terminal.write(data, callback),
    onParsed: (sequence) => window.electronAPI.acknowledgeTerminalOutput({ terminalId, sequence }),
    onError: (error) => {
      terminal.options.disableStdin = true
      reportError('终端渲染失败，请关闭此标签后新建终端', error)
    },
  })
  const showExit = (exitCode: number): void => {
    terminal.options.disableStdin = true
    output.writeStatus(`\r\n\x1b[90m终端已退出（${exitCode}），请新建终端\x1b[0m\r\n`)
  }
  const finishRestore = (): void => {
    if (disposed) return
    restored = true
    terminal.options.disableStdin = exited
    if (pendingExitCode !== undefined) showExit(pendingExitCode)
    focusWhenReady()
  }
  const disposeInput = terminal.onData((data) => {
    if (disposed || exited) return
    void window.electronAPI.writeTerminal({ terminalId, data }).catch((error: unknown) => reportError('终端输入失败', error))
  })
  const disposeOutput = window.electronAPI.onTerminalOutput((event) => {
    if (event.terminalId === terminalId) output.push(event)
  })
  const disposeExit = window.electronAPI.onTerminalExit((event) => {
    if (event.terminalId !== terminalId) return
    exited = true
    terminal.options.disableStdin = true
    if (restored) showExit(event.exitCode)
    else pendingExitCode = event.exitCode
  })

  // ===== 剪贴板统一处理（文字、图片、复制文件） =====

  const readFilePaths = async (files: readonly File[]): Promise<string> => {
    const paths: string[] = []
    for (const file of files) {
      let diskPath = ''
      try {
        diskPath = window.electronAPI.getPathForFile(file)
      } catch {
        // 剪贴板图片通常没有原始磁盘路径，继续暂存图片。
      }
      if (diskPath) paths.push(diskPath)
      else if (file.type.startsWith('image/')) {
        const data = await fileToBase64(file)
        const result = await window.electronAPI.saveTerminalPastedImage({ data, mimeType: file.type })
        if (result.filePath) paths.push(result.filePath)
      }
    }
    return paths.map(formatTerminalPath).join('')
  }

  const readSystemClipboard = async (): Promise<string> => {
    const content = await window.electronAPI.getTerminalClipboardContent()
    if (content.type === 'image' && content.filePath) return formatTerminalPath(content.filePath)
    if (content.type === 'files' && content.filePaths) return content.filePaths.map(formatTerminalPath).join('')
    if (content.type === 'text' && content.text) return content.text
    return ''
  }

  const enqueuePaste = (content: Promise<string>): Promise<void> => {
    const generation = attachmentGeneration
    // 立即读取本次剪贴板，但按触发顺序提交；不阻塞 onData 中的 DSR/DA 等协议回复。
    const settled = content.then<PromiseSettledResult<string>, PromiseSettledResult<string>>(
      (value) => ({ status: 'fulfilled', value }),
      (reason: unknown) => ({ status: 'rejected', reason }),
    )
    terminal.focus()
    pasteTail = pasteTail.then(async () => {
      const result = await settled
      if (disposed || exited || !host || generation !== attachmentGeneration) return
      if (result.status === 'rejected') {
        reportError('终端粘贴失败', result.reason)
        return
      }
      // 光标由 CLI 处理 bracketed paste 后定位；异步完成不能抢走其他输入框的焦点。
      if (result.value) {
        terminal.paste(result.value)
        if (errorMessage?.startsWith('终端粘贴失败：')) {
          errorMessage = null
          errorListener?.(null)
        }
      }
    }).catch((error: unknown) => reportError('终端粘贴失败', error))
    return pasteTail
  }

  const handleTerminalPaste = (event?: ClipboardEvent): Promise<void> => {
    if (disposed || exited || !restored || !host) return Promise.resolve()
    // 在事件有效期内拍下 files/text，不能等前一张图片保存完成后再读剪贴板。
    const files = Array.from(event?.clipboardData?.files ?? [])
    const plainText = event?.clipboardData?.getData('text/plain') ?? ''
    const content = (async (): Promise<string> => {
      if (files.length > 0) {
        try {
          const paths = await readFilePaths(files)
          return paths || plainText
        } catch (error) {
          // 只能使用本次事件的文本兜底；此时系统剪贴板可能已经变成下一次复制的内容。
          if (!plainText) throw error
          return plainText
        }
      }
      return plainText || readSystemClipboard()
    })()
    return enqueuePaste(content)
  }

  const handleCopySelection = async (): Promise<void> => {
    if (disposed) return
    const selection = terminal.getSelection()
    terminal.focus()
    if (selection) {
      await copyTextToClipboard(selection)
    }
  }

  // 监听选区变化通知 UI 更新复制按钮禁用态
  const disposeSelection = terminal.onSelectionChange(() => {
    const has = terminal.hasSelection()
    for (const listener of selectionListeners) {
      listener(has)
    }
  })

  // 快捷键拦截：保证各平台的 Cmd+C / Cmd+V / Ctrl+Shift+C / Ctrl+Shift+V / Ctrl+V 正确生效
  terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
    if (event.type !== 'keydown') return true

    const isMacPlatform = detectIsMac()

    // 复制快捷键
    const isCopyShortcut =
      (isMacPlatform && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && (event.key === 'c' || event.key === 'C')) ||
      (!isMacPlatform && event.ctrlKey && event.shiftKey && (event.key === 'c' || event.key === 'C')) ||
      (!isMacPlatform && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && (event.key === 'c' || event.key === 'C') && terminal.hasSelection())

    if (isCopyShortcut) {
      if (terminal.hasSelection()) {
        event.preventDefault()
        event.stopPropagation()
        void handleCopySelection()
        return false
      }
      if (isMacPlatform) return false
    }

    // 粘贴快捷键：macOS 为 Cmd+V 与 Ctrl+Shift+V；Windows/Linux 为 Ctrl+V、Ctrl+Shift+V 与 Shift+Insert
    const isPasteShortcut =
      (isMacPlatform && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && (event.key === 'v' || event.key === 'V')) ||
      (event.ctrlKey && event.shiftKey && (event.key === 'v' || event.key === 'V')) ||
      (!isMacPlatform && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && (event.key === 'v' || event.key === 'V')) ||
      (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Insert')

    if (isPasteShortcut) {
      // return false 只取消 xterm 键处理，必须同时取消浏览器原生 paste。
      event.preventDefault()
      event.stopPropagation()
      void handleTerminalPaste()
      return false
    }

    // 全选快捷键
    const isSelectAllShortcut =
      (isMacPlatform && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && (event.key === 'a' || event.key === 'A')) ||
      (!isMacPlatform && event.ctrlKey && event.shiftKey && (event.key === 'a' || event.key === 'A'))

    if (isSelectAllShortcut) {
      event.preventDefault()
      event.stopPropagation()
      terminal.selectAll()
      return false
    }

    return true
  })

  // DOM 粘贴事件监听（响应原生应用菜单角色 paste 触发）
  const handlePasteEvent = (e: ClipboardEvent): void => {
    e.preventDefault()
    e.stopImmediatePropagation()
    void handleTerminalPaste(e)
  }
  // 必须在捕获阶段接管，否则 textarea 内的 xterm 监听会先粘贴并停止冒泡。
  element.addEventListener('paste', handlePasteEvent, true)

  // 拖拽文件到终端自动贴入路径
  const handleDragOver = (e: DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  const handleDrop = (e: DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (disposed || exited || !restored || !host) return

    const files = Array.from(e.dataTransfer?.files || [])
    if (files.length === 0) return

    void enqueuePaste(readFilePaths(files))
  }

  element.addEventListener('dragover', handleDragOver)
  element.addEventListener('drop', handleDrop)

  // 首次可见挂载先测量真实行列，避免 ConPTY 从 80×24 重排交互光标。
  fit()
  // 既有 PTY 可能按 100×30 启动。DOM 已 fit 不等于 PTY 已 resize，首次 ready 必须同步一次。
  dimensions = undefined
  const creation = existingOnly ? Promise.resolve() : window.electronAPI.createTerminal({ terminalId, sessionId, cwd, cols: terminal.cols, rows: terminal.rows })
  void (async () => {
    try {
      await creation
      if (disposed) return
      ptyCreated = true
      fit()
      try {
        const snapshot = await window.electronAPI.getTerminalSnapshot(terminalId)
        if (disposed) return
        if (snapshot.exitCode !== undefined) {
          exited = true
          pendingExitCode = snapshot.exitCode
        }
        // 每个 PTY 只恢复一次。首次恢复时尚无解析器回应过查询，必须允许协议回应。
        terminal.options.disableStdin = exited
        output.restore(snapshot.output, snapshot.sequence, finishRestore)
      } catch (error) {
        if (disposed) return
        reportError('终端历史恢复失败，已继续接收实时输出', error)
        terminal.options.disableStdin = exited
        output.restore('', 0, finishRestore)
      }
    } catch (error) {
      if (disposed) return
      reportError('无法启动终端，请关闭此标签后重试', error)
      output.restore('', 0)
    }
  })()

  return {
    sessionId,
    attach(nextHost, onError, autoFocus = false) {
      attachmentGeneration++
      const origin = document.activeElement
      const editingElsewhere = origin instanceof HTMLElement && !nextHost.contains(origin)
        && origin.matches('input, textarea, [contenteditable="true"], [role="textbox"]')
      focusRequest = autoFocus && !editingElsewhere ? { host: nextHost, origin, generation: attachmentGeneration } : undefined
      pasteTail = Promise.resolve()
      host = nextHost
      errorListener = onError
      onError(errorMessage)
      nextHost.appendChild(element)
      resizeObserver.disconnect()
      resizeObserver.observe(nextHost)
      fit()
      fitFrame = requestAnimationFrame(() => { fit(); focusWhenReady() })
      // 鼠标进入空白区域也应将焦点交给当前终端。
      const focus = (): void => terminal.focus()
      nextHost.addEventListener('pointerdown', focus)
      return () => {
        nextHost.removeEventListener('pointerdown', focus)
        if (host !== nextHost) return
        attachmentGeneration++
        focusRequest = undefined
        pasteTail = Promise.resolve()
        host = undefined
        errorListener = undefined
        resizeObserver.disconnect()
        cancelAnimationFrame(fitFrame)
        element.remove()
        terminal.blur()
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      element.removeEventListener('paste', handlePasteEvent, true)
      element.removeEventListener('dragover', handleDragOver)
      element.removeEventListener('drop', handleDrop)
      resizeObserver.disconnect()
      cancelAnimationFrame(fitFrame)
      themeObserver.disconnect()
      output.dispose()
      disposeInput.dispose()
      disposeOutput()
      disposeExit()
      disposeSelection.dispose()
      selectionListeners.clear()
      terminal.dispose()
      element.remove()
      host = undefined
      errorListener = undefined
    },
    hasSelection() {
      return terminal.hasSelection()
    },
    copySelection() {
      return handleCopySelection()
    },
    paste() {
      return handleTerminalPaste()
    },
    selectAll() {
      terminal.selectAll()
      terminal.focus()
    },
    clear() {
      terminal.clear()
      terminal.focus()
    },
    onSelectionChange(listener) {
      selectionListeners.add(listener)
      return () => {
        selectionListeners.delete(listener)
      }
    },
  }
}

/** UI 卸载只分离 DOM；解析资源由全部终端 Tab 的生命周期统一回收。 */
export function TerminalTabContent({ terminalId, sessionId, cwd, existingOnly, autoFocus = false, terminateOnUnmount = true }: TerminalTabContentProps): React.ReactElement {
  const hostRef = React.useRef<HTMLDivElement>(null)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [hasSelection, setHasSelection] = React.useState(false)
  const lifecycleGenerationRef = React.useRef(0)
  const activeViewRef = React.useRef<TerminalView | null>(null)
  const isMac = detectIsMac()

  React.useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const generation = ++lifecycleGenerationRef.current
    const view = ensureTerminalView({ terminalId, sessionId, cwd, existingOnly }, host)
    activeViewRef.current = view
    const detach = view.attach(host, setErrorMessage, autoFocus)
    const unsubSelection = view.onSelectionChange(setHasSelection)
    setHasSelection(view.hasSelection())

    return () => {
      unsubSelection()
      detach()
      activeViewRef.current = null
      if (terminateOnUnmount) queueMicrotask(() => {
        if (lifecycleGenerationRef.current !== generation) return
        terminalViews.remove(terminalId)
        void window.electronAPI.killTerminal(terminalId).catch(console.error)
      })
    }
  }, [autoFocus, cwd, existingOnly, sessionId, terminalId, terminateOnUnmount])

  const handleCopy = React.useCallback(async () => {
    await activeViewRef.current?.copySelection()
  }, [])

  const handlePaste = React.useCallback(async () => {
    await activeViewRef.current?.paste()
  }, [])

  const handleSelectAll = React.useCallback(() => {
    activeViewRef.current?.selectAll()
  }, [])

  const handleClear = React.useCallback(() => {
    activeViewRef.current?.clear()
  }, [])

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex h-full w-full flex-col overflow-hidden p-2 titlebar-no-drag" style={{ backgroundColor: TERMINAL_BACKGROUND, textShadow: 'none' }}>
          {errorMessage && <div role="alert" className="mb-2 shrink-0 rounded-md bg-destructive/15 px-3 py-2 text-xs text-destructive">{errorMessage}</div>}
          <div ref={hostRef} className="min-h-0 w-full min-w-0 flex-1" />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44 min-w-0 p-1">
        <ContextMenuItem
          disabled={!hasSelection}
          onSelect={handleCopy}
        >
          复制
          <ContextMenuShortcut>{isMac ? '⌘C' : 'Ctrl+Shift+C'}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={handlePaste}
        >
          粘贴
          <ContextMenuShortcut>{isMac ? '⌘V' : 'Ctrl+V'}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={handleSelectAll}
        >
          全选
          <ContextMenuShortcut>{isMac ? '⌘A' : 'Ctrl+Shift+A'}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={handleClear}
        >
          清屏
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
