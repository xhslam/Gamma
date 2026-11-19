interface ComputerQuitOptions {
  stop: () => Promise<void>
  phase: () => string
  quit: () => void
  onFailure: (error: unknown) => void
}

/**
 * Electron 的 before-quit 必须同步阻止第一次退出，再异步确认桌面执行者已经停止。
 * stop() resolve 只代表清理流程返回；controller 的 error 状态仍表示停止未被确认。
 */
export function createComputerQuitBarrier(options: ComputerQuitOptions): (preventDefault: () => void) => boolean {
  let complete = false
  let pending = false
  return (preventDefault) => {
    if (complete) return true
    preventDefault()
    if (pending) return false
    pending = true
    void options.stop().then(() => {
      if (options.phase() === 'error') throw new Error('桌面操作进程退出未完全确认')
      complete = true
      options.quit()
    }).catch((error: unknown) => {
      options.onFailure(error)
    }).finally(() => {
      pending = false
    })
    return false
  }
}
