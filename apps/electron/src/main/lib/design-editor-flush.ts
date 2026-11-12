import { matchesDesignEditorThemeUrl } from './design-theme-policy'

/** 验证真实编辑 UI 已挂载，再使用上游 editor:flush 的 beforeunload 保存屏障。 */
export const DESIGN_EDITOR_FLUSH_SCRIPT = `(async () => {
  const ready = () => document.readyState === 'complete'
    && !new URL(location.href).searchParams.has('at') && !window.__baoyuHistory?.preview
    && document.querySelector('#root button, #root [role="button"], #root canvas') !== null
    && !document.querySelector('#root [data-placeholder]');
  if (!ready()) return false;
  const focused = document.activeElement;
  if (focused instanceof HTMLElement) focused.blur();
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (!ready()) return false;
    if (window.dispatchEvent(new Event('beforeunload', { cancelable: true }))) return true;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return false;
})()`

export interface DesignFlushWebContents {
  getURL(): string
  isDestroyed(): boolean
  executeJavaScript(script: string): Promise<unknown>
}

function matchesCurrentEditor(editorUrl: string, current: string): boolean {
  if (!matchesDesignEditorThemeUrl(editorUrl, current)) return false
  return !new URL(current).searchParams.has('at')
}

export async function flushDesignEditor(contents: DesignFlushWebContents, editorUrl: string, waitForWrites: () => Promise<void> = async () => {}): Promise<void> {
  if (contents.isDestroyed() || !matchesCurrentEditor(editorUrl, contents.getURL())) throw new Error('请先打开对应的设计编辑器并返回当前版本，等待页面加载完成')
  const saved = await contents.executeJavaScript(DESIGN_EDITOR_FLUSH_SCRIPT)
  if (saved !== true) throw new Error('设计稿尚未保存完成或编辑器尚未就绪，请稍后重试')
  // beforeunload 对 DB 型编辑器没有保存监听器，必须另等主进程观察到的写请求成功完成。
  await waitForWrites()
  if (contents.isDestroyed() || !matchesCurrentEditor(editorUrl, contents.getURL())) throw new Error('设计稿尚未保存完成，请稍后重试')
}
