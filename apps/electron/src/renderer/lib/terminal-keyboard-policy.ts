interface TerminalShortcutContext {
  inTerminal: boolean
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** shell/TUI 使用 Ctrl+C/D/L/K/B 等原始控制键；保留应用的 Cmd、Ctrl+Shift 和 Ctrl+Tab 组合。 */
export function shouldPreserveTerminalControlKey(event: TerminalShortcutContext): boolean {
  return event.inTerminal && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key !== 'Tab'
}
