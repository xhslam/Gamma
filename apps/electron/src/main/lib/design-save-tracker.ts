/** 在 Electron 唯一 webRequest listener 中观察写入；不改变目标授权或请求内容。 */
export class DesignSaveTracker {
  private readonly pending = new Map<number, number>()
  private readonly changed = new Map<number, number>()
  private readonly failed = new Set<number>()

  started(requestId: number, contentsId: number): void {
    this.pending.set(requestId, contentsId)
    this.changed.set(contentsId, Date.now())
  }

  finished(requestId: number, success: boolean): void {
    const contentsId = this.pending.get(requestId)
    if (contentsId === undefined) return
    this.pending.delete(requestId)
    this.changed.set(contentsId, Date.now())
    if (success) this.failed.delete(contentsId)
    else this.failed.add(contentsId)
  }

  clear(contentsId: number): void {
    for (const [id, contents] of this.pending) if (contents === contentsId) this.pending.delete(id)
    this.changed.delete(contentsId)
    this.failed.delete(contentsId)
  }

  async wait(contentsId: number, options: { timeoutMs?: number; quietMs?: number } = {}): Promise<void> {
    const began = Date.now()
    const deadline = began + (options.timeoutMs ?? 8_000)
    const quietMs = options.quietMs ?? 750
    while (Date.now() <= deadline) {
      if (this.failed.has(contentsId)) throw new Error('设计稿写入失败，请在编辑器中完成保存后重试')
      const busy = [...this.pending.values()].includes(contentsId)
      if (!busy && Date.now() - Math.max(began, this.changed.get(contentsId) ?? 0) >= quietMs) return
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw new Error('设计稿仍在写入，请稍后重试')
  }
}
