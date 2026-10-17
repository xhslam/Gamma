export function assertComputerSender(input: { matchesMainWindow: boolean; matchesTopFrame: boolean; visible: boolean; focused: boolean; requiresFocus: boolean }): void {
  if (!input.matchesMainWindow || !input.matchesTopFrame || (input.requiresFocus && (!input.visible || !input.focused))) throw new Error('桌面授权仅接受可见主窗口顶层页面的本地操作')
}
