export interface RetainedTerminalView {
  sessionId: string
  dispose(): void
}

/** 缓存的是终端解析资源而非 UI 状态；Tab/会话切换不能销毁仍在运行的终端协议端点。 */
export class TerminalViewRegistry<T extends RetainedTerminalView> {
  private readonly views = new Map<string, T>()

  acquire(terminalId: string, sessionId: string, create: () => T): T {
    const existing = this.views.get(terminalId)
    if (existing) {
      if (existing.sessionId !== sessionId) throw new Error('终端不属于当前会话')
      return existing
    }
    const view = create()
    this.views.set(terminalId, view)
    return view
  }

  remove(terminalId: string): void {
    const view = this.views.get(terminalId)
    this.views.delete(terminalId)
    view?.dispose()
  }

  retainOnly(terminalIds: ReadonlySet<string>): void {
    for (const id of this.views.keys()) {
      if (!terminalIds.has(id)) this.remove(id)
    }
  }
}
