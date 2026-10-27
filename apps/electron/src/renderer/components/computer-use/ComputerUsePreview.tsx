import * as React from 'react'
import { atom, useAtom } from 'jotai'
import { Circle, Loader2, Monitor, Square, X } from 'lucide-react'
import type { ComputerPreview } from '@gamma/shared'
import { Button } from '@/components/ui/button'
import { DisclosureChevron } from '@/components/ui/disclosure-chevron'

interface PreviewView {
  preview: ComputerPreview | null
  expanded: boolean
  stopping: boolean
  error: string | null
  requestingScreen: boolean
  screenMessage: string | null
}

const actionNames: Record<string, string> = {
  screenshot: '观察屏幕', get_app_state: '查看应用', list_apps: '查找应用', list_windows: '查看窗口',
  click: '点击', left_click: '点击', double_click: '双击', triple_click: '三击', right_click: '右键点击',
  middle_click: '中键点击', mouse_move: '移动指针', move: '移动指针', drag: '拖动', left_click_drag: '拖动',
  type: '输入文字', type_text: '输入文字', paste: '插入文字', key: '按下快捷键', press_key: '按下快捷键',
  scroll: '滚动', wait: '等待画面', sleep: '等待画面', open_app: '打开应用', openapp: '打开应用', launch: '打开应用',
  focus_window: '切换窗口', axPress: '操作控件', axSetValue: '填写控件', axFocus: '聚焦控件',
  axAction: '操作控件', axSelectText: '选择文字', set_value: '填写控件', focus: '聚焦控件', select_text: '选择文字',
}

/** 增量帧只复用同一运行、同一观察的图片；禁止跨会话沿用旧画面。 */
export function mergeComputerPreview(previous: ComputerPreview | null, next: ComputerPreview): ComputerPreview {
  if (next.mode === 'accessibility') return { ...next, frame: undefined }
  const sameFrame = previous?.sessionId === next.sessionId && previous.runId === next.runId
    && previous.frame?.frameId === next.frame?.frameId
  const dataUrl = next.frame?.dataUrl ?? (sameFrame ? previous?.frame?.dataUrl : undefined)
  return { ...next, frame: next.frame ? { ...next.frame, dataUrl: dataUrl?.startsWith('data:image/jpeg;base64,') ? dataUrl : undefined } : undefined }
}

/** 聊天内本地实时监控；不依赖工具截图，不进入消息历史或模型上下文。 */
export function ComputerUsePreview({ sessionId }: { sessionId: string }): React.ReactElement | null {
  const viewAtom = React.useMemo(() => atom<PreviewView>({ preview: null, expanded: true, stopping: false, error: null, requestingScreen: false, screenMessage: null }), [sessionId])
  const [view, setView] = useAtom(viewAtom)
  const current = React.useRef(view)
  current.current = view
  const revision = React.useRef(0)
  const retry = React.useRef<() => void>(() => {})
  const mounted = React.useRef(false)
  const screenRequest = React.useRef(false)

  React.useEffect(() => {
    mounted.current = true
    let disposed = false
    let inFlight = false
    let timer: ReturnType<typeof setTimeout>
    const pause = (): void => {
      const preview = current.current.preview
      if (preview) void window.electronAPI.getComputerPreview({ sessionId, runId: preview.runId, live: false }).catch(() => {})
    }
    const clear = (): void => {
      revision.current += 1
      current.current = { ...current.current, preview: null, error: null, screenMessage: null }
      setView(current.current)
    }
    const read = async (): Promise<void> => {
      if (disposed || inFlight || document.hidden) return
      inFlight = true
      let delay = 1000
      const generation = revision.current
      const previous = current.current.preview
      try {
        const next = await window.electronAPI.getComputerPreview({ sessionId, frameId: previous?.frame?.frameId, live: current.current.expanded })
        if (disposed || generation !== revision.current) return
        const preview = next?.sessionId === sessionId ? mergeComputerPreview(previous, next) : null
        delay = preview && current.current.expanded && ['starting', 'live'].includes(preview.mode) ? 100 : 1000
        setView(old => ({ ...old, preview, screenMessage: old.preview?.runId === preview?.runId ? old.screenMessage : null, error: old.error?.startsWith('停止未确认') ? old.error : null }))
      } catch {
        if (!disposed && generation === revision.current) {
          setView(old => ({ ...old, preview: old.preview ? { ...old.preview, frame: undefined } : null,
            error: previous ? '预览连接中断，画面已清除。可重试或停止当前操作。' : old.error }))
        }
      } finally {
        inFlight = false
        if (!disposed) { clearTimeout(timer); timer = setTimeout(() => { void read() }, delay) }
      }
    }
    retry.current = () => { void read() }
    const unsubscribe = window.electronAPI.onComputerStateChanged(state => {
      if (state.sessionId !== sessionId || !['active', 'authorizing'].includes(state.phase)) clear()
      else {
        if (state.permissions?.accessibility && state.permissions.screen === false && current.current.preview) {
          revision.current += 1
          current.current = { ...current.current, screenMessage: null, preview: { ...current.current.preview, permissions: state.permissions, mode: 'accessibility', frame: undefined } }
          setView(current.current)
        }
        void read()
      }
    })
    const visibility = (): void => { if (document.hidden) { pause(); clear() } else void read() }
    document.addEventListener('visibilitychange', visibility)
    void read()
    return () => { disposed = true; mounted.current = false; pause(); revision.current += 1; clearTimeout(timer); unsubscribe(); document.removeEventListener('visibilitychange', visibility) }
  }, [sessionId, setView])

  const toggle = (): void => {
    revision.current += 1
    const old = current.current
    const expanded = !old.expanded
    current.current = { ...old, expanded, preview: old.preview ? { ...old.preview, frame: undefined, mode: old.preview.mode === 'accessibility' ? 'accessibility' : expanded ? 'starting' : 'paused' } : null }
    setView(current.current)
    if (!expanded && old.preview) void window.electronAPI.getComputerPreview({ sessionId, runId: old.preview.runId, live: false }).catch(() => {})
    else retry.current()
  }

  const requestScreen = async (): Promise<void> => {
    const runId = current.current.preview?.runId
    if (!runId || screenRequest.current) return
    screenRequest.current = true
    setView(old => ({ ...old, requestingScreen: true, screenMessage: null }))
    try {
      await window.electronAPI.requestComputerPermission('screen')
      const state = await window.electronAPI.getComputerState(sessionId)
      if (!mounted.current || current.current.preview?.runId !== runId) return
      setView(old => ({ ...old, screenMessage: state.permissions?.screen ? null : '录屏尚未开启，辅助功能操作可继续。' }))
      retry.current()
    } catch {
      if (mounted.current && current.current.preview?.runId === runId) setView(old => ({ ...old, screenMessage: '未能开启画面预览，辅助功能操作可继续。可稍后重试。' }))
    } finally {
      screenRequest.current = false
      if (mounted.current) setView(old => ({ ...old, requestingScreen: false }))
    }
  }

  const stop = async (): Promise<void> => {
    const preview = view.preview
    if (!preview || view.stopping) return
    revision.current += 1
    setView(old => ({ ...old, stopping: true }))
    try {
      const state = await window.electronAPI.stopComputerPreview(sessionId, preview.runId)
      if (state.phase === 'error') throw new Error('原生停止尚未确认')
      revision.current += 1
      setView(old => ({ ...old, preview: null, stopping: false, error: null }))
    } catch {
      setView(old => ({ ...old, stopping: false, error: '停止未确认，请重试或按 ⌃⌥Esc。' }))
    }
  }

  const { preview } = view
  if (!preview && !view.error) return null
  const latest = preview?.activities.at(-1)
  const running = latest?.status === 'running'
  const accessibilityOnly = preview?.mode === 'accessibility'
  const label = latest ? actionNames[latest.action] ?? '执行电脑操作' : '等待下一步'
  return (
    <section aria-label="Computer Use 操作预览" className="my-4 w-full max-w-[560px] overflow-hidden rounded-2xl border border-border/60 bg-background shadow-sm">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"><Monitor className="size-4 text-foreground/70" aria-hidden="true" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Computer Use</div>
          <div className="truncate text-xs text-muted-foreground">{preview?.appName || '你的电脑'}</div>
        </div>
        {preview && <Button variant="outline" size="sm" onClick={() => { void stop() }} disabled={view.stopping} aria-label="停止当前电脑操作" className="gap-2 rounded-full">
          {view.stopping ? <Loader2 className="size-3 animate-spin" /> : <Square className="size-3 fill-current" />}停止
        </Button>}
        <Button data-disclosure-trigger="" variant="ghost" size="icon" className="size-8 rounded-full" aria-label={view.expanded ? '收起操作画面' : '展开操作画面'} aria-expanded={view.expanded} onClick={toggle}>
          <DisclosureChevron expanded={view.expanded} size={16} className="size-4" />
        </Button>
      </div>
      {view.expanded && <>
        {accessibilityOnly ? <div className="space-y-3 border-y border-border/40 bg-muted/20 px-4 py-4">
          <div className="space-y-1"><p className="text-sm font-medium">辅助功能模式</p><p className="text-xs leading-relaxed text-muted-foreground">{preview.message || '正在通过界面文字操作控件，基础操作无需录屏。'}</p></div>
          {preview.permissions?.screen !== true && <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" disabled={view.requestingScreen} onClick={() => { void requestScreen() }} aria-label="开启可选画面预览">{view.requestingScreen ? '正在请求录屏…' : '开启画面预览'}</Button>
            <span className="text-xs text-muted-foreground">可选；截图与实时画面需要录屏授权</span>
          </div>}
          {view.screenMessage && <p role="status" className="text-xs text-muted-foreground">{view.screenMessage}</p>}
        </div> : <div className="relative flex min-h-40 items-center justify-center border-y border-border/40 bg-muted/40">
          {preview?.frame?.dataUrl ? <img src={preview.frame.dataUrl} alt={`${preview.appName || '电脑'}实时监控画面`} className="max-h-72 w-full object-contain" />
            : <div className="flex h-48 items-center gap-2 text-xs text-muted-foreground"><Monitor className="size-4" />{view.error || preview?.mode === 'unavailable' ? '画面预览暂不可用，辅助功能操作可继续' : preview?.mode === 'paused' ? '画面预览已暂停' : '正在连接实时画面…'}</div>}
          {preview?.mode === 'live' && preview.frame?.dataUrl && <span className="absolute bottom-2 left-2 flex items-center gap-2 rounded-full bg-background/95 px-3 py-1 text-xs text-foreground shadow-sm"><span className="size-1.5 rounded-full bg-success" aria-hidden="true" />实时画面</span>}
        </div>}
        <div className="space-y-3 px-4 py-3">
          <div className="flex items-center gap-2 text-sm" role="status">
            {running && !view.error ? <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" /> : latest?.status === 'failed' ? <X className="size-3.5 text-warning" /> : <Circle className="size-3 shrink-0 text-muted-foreground" />}
            <span className="min-w-0 flex-1 truncate">{view.error ? '操作状态待确认' : `${label}${latest?.status === 'returned' ? ' · 已返回' : latest?.status === 'failed' ? ' · 未完成' : ''}`}</span>
            <span className="shrink-0 text-xs text-muted-foreground">⌃⌥Esc 停止</span>
          </div>
          {(preview?.activities.length ?? 0) > 1 && <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer rounded py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">近期步骤 · {preview!.activities.length}</summary>
            <ol className="mt-2 space-y-2 border-l border-border pl-3">{preview!.activities.slice(0, -1).reverse().map(activity => <li key={activity.id} className="flex justify-between gap-3"><span>{actionNames[activity.action] ?? '电脑操作'}</span><span>{activity.status === 'failed' ? '未完成' : activity.status === 'running' ? '进行中' : '已返回'}</span></li>)}</ol>
          </details>}
        </div>
      </>}
      {view.error && <div role="alert" className="flex items-center gap-2 border-t border-border px-4 py-3 text-xs text-warning dark:text-warning"><span className="flex-1">{view.error}</span><Button variant="ghost" size="sm" onClick={() => retry.current()}>重试</Button></div>}
    </section>
  )
}
