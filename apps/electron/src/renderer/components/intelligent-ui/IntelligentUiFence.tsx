import { Component, lazy, Suspense } from 'react'
import type { ReactNode } from 'react'

// 关闭开关时不导入上游运行时；引擎在对应组件出现时再加载。
const Block = lazy(() => import('./IntelligentUiBlock'))
class FenceBoundary extends Component<{ children: ReactNode; source: string }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  override render() { return this.state.failed ? <UiSourceFallback source={this.props.source} message="UI 加载失败" /> : this.props.children }
}
export function UiSourceFallback({ source, message }: { source: string; message: string }) {
  return <div className="not-prose rounded-lg border border-border p-3 text-sm" data-intelligent-ui-fallback=""><p role="status">{message}</p><details><summary>查看 UI 源码</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{source}</pre></details></div>
}
export function IntelligentUiFence({ source, blockId, isStreaming, complete }: { source: string; blockId: string; isStreaming: boolean; complete: boolean }) {
  if (isStreaming || !complete) return <UiSourceFallback source={source} message={isStreaming ? '正在生成交互界面…' : 'UI 围栏未完整闭合'} />
  return <FenceBoundary source={source}><Suspense fallback={<p className="text-sm text-muted-foreground" role="status">正在加载交互界面…</p>}><Block source={source} blockId={blockId} /></Suspense></FenceBoundary>
}
